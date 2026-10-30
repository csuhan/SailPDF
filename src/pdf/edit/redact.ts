import { tr } from '../../i18n/locale'
/**
 * True redaction (Acrobat "标记密文 → 应用"): content under a redaction area
 * is REMOVED from the page, not just covered.
 *
 * - text: every glyph whose box touches an area is dropped from its show-text
 *   operator; the following glyphs keep their exact position (the removed
 *   advance becomes a TJ kerning adjustment)
 * - images: an image that intersects an area is removed (Acrobat replaces
 *   the affected pixels; removing the whole image never leaks pixel data)
 * - vector paths fully inside an area are removed
 * Form XObjects are rewritten copy-on-write and recursed into.
 * A black box is drawn over each area afterwards (fill color configurable).
 */
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib'
import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts'
import { parseContent, rewrite, type Instruction, type Token } from './contentStream'

type Mat = [number, number, number, number, number, number]
const ID: Mat = [1, 0, 0, 1, 0, 0]
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const apply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

export interface RedactArea {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

function boxOf(m: Mat, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  }
}

const hits = (b: Box, areas: RedactArea[]) =>
  areas.some((a) => b.x1 > a.x0 && b.x0 < a.x1 && b.y1 > a.y0 && b.y0 < a.y1)
const inside = (b: Box, areas: RedactArea[]) =>
  areas.some((a) => b.x0 >= a.x0 - 0.5 && b.x1 <= a.x1 + 0.5 && b.y0 >= a.y0 - 0.5 && b.y1 <= a.y1 + 0.5)

function streamBytes(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) {
    // Refuse an undecodable content stream rather than claiming redaction
    // succeeded while leaving the original bytes underneath its cover.
    return decodePDFRawStream(s).decode()
  }
  // Content just drawn by pdf-lib is a PDFContentStream, whose getContents()
  // is compressed. Read its operators before encoding them.
  const content = s as PDFStream & { getUnencodedContents?: () => Uint8Array }
  return content.getUnencodedContents?.() ?? s.getContents()
}

function cloneResources(doc: PDFDocument, resources: PDFDict | undefined): PDFDict | undefined {
  if (!resources) return undefined
  const clone = resources.clone(doc.context)
  const xobjects = resources.lookup(PDFName.of('XObject'))
  if (xobjects instanceof PDFDict) clone.set(PDFName.of('XObject'), xobjects.clone(doc.context))
  return clone
}

// ── fonts: char code splitting + widths ─────────────────────────

interface FontInfo {
  /** bytes per char code */
  bytes: number
  /** glyph-space width / 1000 for a code */
  width: (code: number) => number
  /** Type3 font matrix scale (else 0.001) */
  scale: number
}

const fontCache = new WeakMap<object, FontInfo>()

function fontInfo(doc: PDFDocument, dict: PDFDict | undefined): FontInfo {
  const fallback: FontInfo = { bytes: 1, width: () => 500, scale: 0.001 }
  if (!dict) return fallback
  const hit = fontCache.get(dict)
  if (hit) return hit
  let info = fallback
  const sub = dict.lookup(PDFName.of('Subtype'))
  if (sub === PDFName.of('Type0')) {
    // composite: assume 2-byte codes (Identity-H and virtually all CJK CMaps
    // used in practice); widths from the descendant /W array
    const desc = dict.lookup(PDFName.of('DescendantFonts'))
    const cid = desc instanceof PDFArray ? desc.lookup(0) : undefined
    const widths = new Map<number, number>()
    let dw = 1000
    if (cid instanceof PDFDict) {
      const d = cid.lookup(PDFName.of('DW'))
      if (d instanceof PDFNumber) dw = d.asNumber()
      const w = cid.lookup(PDFName.of('W'))
      if (w instanceof PDFArray) {
        for (let i = 0; i < w.size(); ) {
          const first = w.lookup(i)
          const next = w.lookup(i + 1)
          if (!(first instanceof PDFNumber)) break
          if (next instanceof PDFArray) {
            for (let k = 0; k < next.size(); k++) {
              const v = next.lookup(k)
              if (v instanceof PDFNumber) widths.set(first.asNumber() + k, v.asNumber())
            }
            i += 2
          } else {
            const last = w.lookup(i + 1)
            const v = w.lookup(i + 2)
            if (last instanceof PDFNumber && v instanceof PDFNumber) {
              for (let c = first.asNumber(); c <= last.asNumber(); c++) widths.set(c, v.asNumber())
            }
            i += 3
          }
        }
      }
    }
    // Identity CMaps: code == CID
    info = { bytes: 2, width: (c) => widths.get(c) ?? dw, scale: 0.001 }
  } else {
    const first = dict.lookup(PDFName.of('FirstChar'))
    const w = dict.lookup(PDFName.of('Widths'))
    const fc = first instanceof PDFNumber ? first.asNumber() : 0
    let missing = 0
    const fd = dict.lookup(PDFName.of('FontDescriptor'))
    if (fd instanceof PDFDict) {
      const mw = fd.lookup(PDFName.of('MissingWidth'))
      if (mw instanceof PDFNumber) missing = mw.asNumber()
    }
    let scale = 0.001
    if (sub === PDFName.of('Type3')) {
      const fm = dict.lookup(PDFName.of('FontMatrix'))
      const a = fm instanceof PDFArray ? fm.lookup(0) : undefined
      if (a instanceof PDFNumber) scale = Math.abs(a.asNumber()) || 0.001
    }
    const arr: number[] = []
    if (w instanceof PDFArray) {
      for (let k = 0; k < w.size(); k++) {
        const v = w.lookup(k)
        arr.push(v instanceof PDFNumber ? v.asNumber() : missing)
      }
    }
    if (arr.length === 0) {
      // standard-14 font without /Widths: use its AFM metrics
      info = { bytes: 1, width: standardWidths(dict), scale }
    } else {
      info = { bytes: 1, width: (c) => arr[c - fc] ?? missing, scale }
    }
  }
  fontCache.set(dict, info)
  return info
}

const STD_ALIASES: Record<string, string> = {
  Arial: 'Helvetica',
  'Arial,Bold': 'Helvetica-Bold',
  'Arial,Italic': 'Helvetica-Oblique',
  'Arial,BoldItalic': 'Helvetica-BoldOblique',
  TimesNewRoman: 'Times-Roman',
  'TimesNewRoman,Bold': 'Times-Bold',
  'TimesNewRoman,Italic': 'Times-Italic',
  'TimesNewRoman,BoldItalic': 'Times-BoldItalic',
  CourierNew: 'Courier',
}

/** code -> width for a standard-14 font (WinAnsi / Standard encoding) */
function standardWidths(dict: PDFDict): (code: number) => number {
  const bf = dict.lookup(PDFName.of('BaseFont'))
  let name = bf instanceof PDFName ? bf.decodeText() : 'Helvetica'
  name = name.replace(/^[A-Z]{6}\+/, '')
  name = STD_ALIASES[name] ?? name
  const known = Object.values(FontNames) as string[]
  if (!known.includes(name))
    name = /Times/i.test(name) ? 'Times-Roman' : /Courier/i.test(name) ? 'Courier' : 'Helvetica'
  const font = Font.load(name as FontNames)
  if (name === 'Symbol' || name === 'ZapfDingbats') {
    const enc = Encodings[name as 'Symbol' | 'ZapfDingbats']
    const byCode = new Map<number, string>()
    for (const cp of enc.supportedCodePoints) {
      const { code, name: g } = enc.encodeUnicodeCodePoint(cp)
      byCode.set(code, g)
    }
    return (c) => font.getWidthOfGlyph(byCode.get(c) ?? '') ?? 500
  }
  // WinAnsi: code -> glyph name through the unicode mapping table
  const win = Encodings.WinAnsi
  const byCode = new Map<number, string>()
  for (const cp of win.supportedCodePoints) {
    const { code, name: g } = win.encodeUnicodeCodePoint(cp)
    if (!byCode.has(code)) byCode.set(code, g)
  }
  return (c) => font.getWidthOfGlyph(byCode.get(c) ?? 'space') ?? 500
}

// ── string operands ─────────────────────────────────────────────

function stringBytes(src: Uint8Array, t: Token): Uint8Array | null {
  const raw = latin1(src, t.start, t.end)
  if (raw.startsWith('<')) return PDFHexString.of(raw.slice(1, -1)).asBytes()
  if (raw.startsWith('(')) return PDFString.of(raw.slice(1, -1)).asBytes()
  return null
}

function latin1(b: Uint8Array, s: number, e: number): string {
  let out = ''
  for (let k = s; k < e; k++) out += String.fromCharCode(b[k])
  return out
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const fmt = (v: number) => (Math.abs(v) < 1e-6 ? '0' : String(Math.round(v * 1000) / 1000))

/** split a TJ array operand into strings and numbers */
function tjItems(src: Uint8Array, t: Token): (Uint8Array | number)[] {
  // tokenize "<array content> X": the array items become X's operands
  const body = new Uint8Array(t.end - t.start - 2 + 3)
  body.set(src.subarray(t.start + 1, t.end - 1))
  body.set([0x20, 0x58, 0x20], t.end - t.start - 2) // " X "
  const ins = parseContent(body)
  const out: (Uint8Array | number)[] = []
  for (const tok of ins[0]?.args ?? []) {
    if (typeof tok.value === 'number') out.push(tok.value)
    else {
      const b = stringBytes(body, tok)
      if (b) out.push(b)
    }
  }
  return out
}

// ── text state ──────────────────────────────────────────────────

interface GS {
  ctm: Mat
  font: PDFDict | undefined
  size: number
  tc: number
  tw: number
  th: number
  tl: number
  rise: number
}

export interface RedactStats {
  glyphs: number
  images: number
  paths: number
}

/**
 * Remove all content inside `areas` (page user space) from the page and
 * cover the areas. Returns what was removed.
 */
export function redactPage(
  doc: PDFDocument,
  page: PDFPage,
  areas: RedactArea[],
  opts: { textOnly?: boolean } = {},
): RedactStats {
  const stats: RedactStats = { glyphs: 0, images: 0, paths: 0 }
  if (areas.length === 0) return stats

  interface Frame {
    bytes: Uint8Array
    resources: PDFDict | undefined
    edits: { start: number; end: number; with: string }[]
    ensureResources: () => PDFDict
  }

  const fontDict = (res: PDFDict | undefined, name: string): PDFDict | undefined => {
    const fonts = res?.lookup(PDFName.of('Font'))
    const f = fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name)) : undefined
    return f instanceof PDFDict ? f : undefined
  }

  const visit = (fr: Frame, ctm0: Mat, depth: number) => {
    if (depth > 12) throw new Error(tr('无法安全处理过深嵌套的 PDF 表单'))
    const instrs = parseContent(fr.bytes)
    const stack: GS[] = []
    let gs: GS = { ctm: ctm0, font: undefined, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 }
    let tm: Mat = ID
    let tlm: Mat = ID
    // path construction collected since the last painting operator
    let pathStart = -1
    let pathBox: Box | null = null
    const addPt = (x: number, y: number) => {
      const [px, py] = apply(gs.ctm, x, y)
      if (!pathBox) pathBox = { x0: px, y0: py, x1: px, y1: py }
      else {
        pathBox.x0 = Math.min(pathBox.x0, px)
        pathBox.y0 = Math.min(pathBox.y0, py)
        pathBox.x1 = Math.max(pathBox.x1, px)
        pathBox.y1 = Math.max(pathBox.y1, py)
      }
    }
    const xobjs = fr.resources?.lookup(PDFName.of('XObject'))
    const n = (ins: Instruction, k: number) => {
      const t = ins.args[k]
      return typeof t?.value === 'number' ? t.value : 0
    }

    /**
     * process one string of a show-text op: returns the rewritten TJ items
     * and advances the text matrix
     */
    const showString = (bytes: Uint8Array, out: (string | number)[]) => {
      const fi = fontInfo(doc, gs.font)
      const fs = gs.size
      let kept: number[] = []
      const flush = () => {
        if (kept.length) out.push(`<${hex(new Uint8Array(kept))}>`)
        kept = []
      }
      for (let i = 0; i + fi.bytes <= bytes.length; i += fi.bytes) {
        const code = fi.bytes === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i]
        const w0 = fi.width(code) * fi.scale
        const isSpace = fi.bytes === 1 && code === 32
        const adv = (w0 * fs + gs.tc + (isSpace ? gs.tw : 0)) * gs.th
        // glyph box in text space: [0, w] x [descent, ascent] ~ [-0.25, 0.9] em
        const trm = mul(gs.ctm, tm)
        const b = boxOf(trm, 0, gs.rise - 0.22 * fs, Math.max(w0 * fs * gs.th, 0.01), gs.rise + 0.8 * fs)
        // Secure redaction removes even partially covered glyphs. Line-edit
        // cleanup uses centers to avoid removing the adjacent unedited run.
        const cx = (b.x0 + b.x1) / 2
        const cy = (b.y0 + b.y1) / 2
        const removed = opts.textOnly
          ? areas.some((a) => cx >= a.x0 && cx <= a.x1 && cy >= a.y0 && cy <= a.y1)
          : hits(b, areas)
        if (removed) {
          flush()
          stats.glyphs++
          // keep the advance as a kerning adjustment (thousandths of em)
          if (fs !== 0 && gs.th !== 0) out.push(-(adv / (gs.th * fs)) * 1000)
          else out.push(0)
        } else {
          for (let k = 0; k < fi.bytes; k++) kept.push(bytes[i + k])
        }
        tm = mul(tm, [1, 0, 0, 1, adv, 0])
      }
      flush()
    }

    /** emit a TJ for `items`; returns null when nothing was removed */
    const showOp = (args: (Uint8Array | number)[]): string | null => {
      const before = stats.glyphs
      const out: (string | number)[] = []
      for (const a of args) {
        if (typeof a === 'number') {
          out.push(a)
          tm = mul(tm, [1, 0, 0, 1, (-a / 1000) * gs.size * gs.th, 0])
        } else showString(a, out)
      }
      if (stats.glyphs === before) return null
      // merge consecutive numbers
      const merged: (string | number)[] = []
      for (const v of out) {
        const last = merged[merged.length - 1]
        if (typeof v === 'number' && typeof last === 'number') merged[merged.length - 1] = last + v
        else merged.push(v)
      }
      return ` [${merged.map((v) => (typeof v === 'number' ? fmt(v) : v)).join(' ')}] TJ `
    }

    for (const ins of instrs) {
      switch (ins.op) {
        case 'q':
          stack.push({ ...gs })
          break
        case 'Q':
          if (stack.length) gs = stack.pop()!
          break
        case 'cm':
          if (ins.args.length >= 6)
            gs.ctm = mul(gs.ctm, [0, 1, 2, 3, 4, 5].map((k) => n(ins, ins.args.length - 6 + k)) as Mat)
          break
        case 'BT':
          tm = ID
          tlm = ID
          break
        case 'Tf': {
          const nameTok = ins.args[0]
          gs.font = typeof nameTok?.value === 'string' ? fontDict(fr.resources, nameTok.value) : undefined
          gs.size = n(ins, 1)
          break
        }
        case 'Tc':
          gs.tc = n(ins, 0)
          break
        case 'Tw':
          gs.tw = n(ins, 0)
          break
        case 'Tz':
          gs.th = n(ins, 0) / 100
          break
        case 'TL':
          gs.tl = n(ins, 0)
          break
        case 'Ts':
          gs.rise = n(ins, 0)
          break
        case 'Td':
          tlm = mul(tlm, [1, 0, 0, 1, n(ins, 0), n(ins, 1)])
          tm = tlm
          break
        case 'TD':
          gs.tl = -n(ins, 1)
          tlm = mul(tlm, [1, 0, 0, 1, n(ins, 0), n(ins, 1)])
          tm = tlm
          break
        case 'Tm':
          tlm = [0, 1, 2, 3, 4, 5].map((k) => n(ins, k)) as Mat
          tm = tlm
          break
        case 'T*':
          tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.tl])
          tm = tlm
          break
        case 'Tj':
        case "'":
        case '"': {
          if (ins.op !== 'Tj') {
            if (ins.op === '"') {
              gs.tw = n(ins, 0)
              gs.tc = n(ins, 1)
            }
            tlm = mul(tlm, [1, 0, 0, 1, 0, -gs.tl])
            tm = tlm
          }
          const strTok = ins.args[ins.args.length - 1]
          const b = strTok ? stringBytes(fr.bytes, strTok) : null
          if (!b) break
          const rep = showOp([b])
          if (rep !== null) {
            // the spacing / line move of ' and " must survive the rewrite
            const pre = ins.op === "'" ? ' T* ' : ins.op === '"' ? ` ${fmt(gs.tw)} Tw ${fmt(gs.tc)} Tc T* ` : ' '
            fr.edits.push({ start: ins.start, end: ins.end, with: pre + rep })
          }
          break
        }
        case 'TJ': {
          const arr = ins.args[ins.args.length - 1]
          if (!arr) break
          const rep = showOp(tjItems(fr.bytes, arr))
          if (rep !== null) fr.edits.push({ start: ins.start, end: ins.end, with: rep })
          break
        }
        // ── paths ──
        case 'm':
        case 'l':
          if (pathStart < 0) pathStart = ins.start
          addPt(n(ins, 0), n(ins, 1))
          break
        case 'c':
          if (pathStart < 0) pathStart = ins.start
          addPt(n(ins, 0), n(ins, 1))
          addPt(n(ins, 2), n(ins, 3))
          addPt(n(ins, 4), n(ins, 5))
          break
        case 'v':
        case 'y':
          if (pathStart < 0) pathStart = ins.start
          addPt(n(ins, 0), n(ins, 1))
          addPt(n(ins, 2), n(ins, 3))
          break
        case 're': {
          if (pathStart < 0) pathStart = ins.start
          const [x, y, w, h] = [n(ins, 0), n(ins, 1), n(ins, 2), n(ins, 3)]
          addPt(x, y)
          addPt(x + w, y + h)
          break
        }
        case 'h':
          break
        case 'S':
        case 's':
        case 'f':
        case 'F':
        case 'f*':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
        case 'n': {
          const pb = pathBox as Box | null
          if (!opts.textOnly && pathStart >= 0 && pb && ins.op !== 'n' && inside(pb, areas)) {
            fr.edits.push({ start: pathStart, end: ins.end, with: ' n ' })
            stats.paths++
          }
          pathStart = -1
          pathBox = null
          break
        }
        case 'W':
        case 'W*':
          break
        case 'BI': {
          if (!opts.textOnly && hits(boxOf(gs.ctm, 0, 0, 1, 1), areas)) {
            fr.edits.push({ start: ins.start, end: ins.end, with: ' ' })
            stats.images++
          }
          break
        }
        case 'Do': {
          const nameTok = ins.args[ins.args.length - 1]
          const name = typeof nameTok?.value === 'string' ? nameTok.value : null
          if (!name || !(xobjs instanceof PDFDict)) break
          const raw = xobjs.get(PDFName.of(name))
          const xo = raw instanceof PDFRef ? doc.context.lookup(raw) : raw
          if (!(xo instanceof PDFStream)) break
          const sub = xo.dict.lookup(PDFName.of('Subtype'))
          if (sub === PDFName.of('Image')) {
            if (!opts.textOnly && hits(boxOf(gs.ctm, 0, 0, 1, 1), areas)) {
              fr.edits.push({ start: ins.start, end: ins.end, with: ' ' })
              stats.images++
            }
          } else if (sub === PDFName.of('Form')) {
            const fm = xo.dict.lookup(PDFName.of('Matrix'))
            let m: Mat = ID
            if (fm instanceof PDFArray && fm.size() === 6) {
              m = [0, 1, 2, 3, 4, 5].map((k) => {
                const v = fm.lookup(k)
                return v instanceof PDFNumber ? v.asNumber() : 0
              }) as Mat
            }
            const fctm = mul(gs.ctm, m)
            // forms entirely outside every area need no work
            const bb = xo.dict.lookup(PDFName.of('BBox'))
            if (bb instanceof PDFArray && bb.size() === 4) {
              const v = [0, 1, 2, 3].map((k) => {
                const x = bb.lookup(k)
                return x instanceof PDFNumber ? x.asNumber() : 0
              })
              if (
                !hits(
                  boxOf(fctm, Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])),
                  areas,
                )
              )
                break
            }
            const fres = xo.dict.lookup(PDFName.of('Resources'))
            const child: Frame = {
              bytes: streamBytes(xo),
              resources: cloneResources(doc, fres instanceof PDFDict ? fres : fr.resources),
              edits: [],
              ensureResources: () => child.resources ?? (child.resources = doc.context.obj({}) as PDFDict),
            }
            const before = stats.glyphs + stats.images + stats.paths
            visit(child, fctm, depth + 1)
            if (child.edits.length && stats.glyphs + stats.images + stats.paths > before) {
              // copy-on-write: a fresh form so other users of it are untouched
              const fresh = doc.context.flateStream(rewrite(child.bytes, child.edits), {})
              for (const [k, v] of xo.dict.entries()) {
                const ks = k.toString()
                if (ks === '/Filter' || ks === '/DecodeParms' || ks === '/Length') continue
                fresh.dict.set(k, v)
              }
              if (child.resources) fresh.dict.set(PDFName.of('Resources'), child.resources)
              const ref = doc.context.register(fresh)
              const res = fr.ensureResources()
              let xd = res.lookup(PDFName.of('XObject'))
              if (!(xd instanceof PDFDict)) {
                xd = doc.context.obj({})
                res.set(PDFName.of('XObject'), xd)
              }
              const key = (xd as PDFDict).uniqueKey('FmR')
              ;(xd as PDFDict).set(key, ref)
              fr.edits.push({ start: ins.start, end: ins.end, with: ` ${key.toString()} Do ` })
            }
          }
          break
        }
        default:
          break
      }
    }
  }

  // page content (Contents may be an array: state carries across streams)
  const contents = page.node.Contents()
  const chunks: Uint8Array[] = []
  if (contents instanceof PDFArray) {
    for (let k = 0; k < contents.size(); k++) {
      const s = contents.lookup(k)
      if (s instanceof PDFStream) chunks.push(streamBytes(s))
    }
  } else if (contents instanceof PDFStream) {
    chunks.push(streamBytes(contents))
  }
  const joined = new Uint8Array(chunks.reduce((a, c) => a + c.length + 1, 0))
  let o = 0
  for (const c of chunks) {
    joined.set(c, o)
    o += c.length
    joined[o++] = 0x0a
  }
  const pr = page.node.Resources()
  // resources may be shared with other pages: clone before adding forms
  const pageRes = cloneResources(doc, pr instanceof PDFDict ? pr : undefined)
  const frame: Frame = {
    bytes: joined,
    resources: pageRes,
    edits: [],
    ensureResources: () => {
      if (!frame.resources) frame.resources = doc.context.obj({}) as PDFDict
      return frame.resources
    },
  }
  visit(frame, ID, 0)
  if (frame.edits.length) {
    const ref = doc.context.register(doc.context.flateStream(rewrite(joined, frame.edits), {}))
    page.node.set(PDFName.of('Contents'), doc.context.obj([ref]))
    if (frame.resources) page.node.set(PDFName.of('Resources'), frame.resources)
  }
  return stats
}

/**
 * Annotations (links, notes, form widgets) inside a redaction area would
 * still reveal content: drop those whose rect intersects an area.
 */
export function redactAnnotations(doc: PDFDocument, page: PDFPage, areas: RedactArea[]): number {
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (!(annots instanceof PDFArray)) return 0
  const keep: unknown[] = []
  let removed = 0
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i)
    const a = annots.lookup(i)
    const rect = a instanceof PDFDict ? a.lookup(PDFName.of('Rect')) : undefined
    if (rect instanceof PDFArray && rect.size() === 4) {
      const v = [0, 1, 2, 3].map((k) => {
        const x = rect.lookup(k)
        return x instanceof PDFNumber ? x.asNumber() : 0
      })
      const b = {
        x0: Math.min(v[0], v[2]),
        y0: Math.min(v[1], v[3]),
        x1: Math.max(v[0], v[2]),
        y1: Math.max(v[1], v[3]),
      }
      if (hits(b, areas)) {
        removed++
        continue
      }
    }
    keep.push(raw)
  }
  if (removed) page.node.set(PDFName.of('Annots'), doc.context.obj(keep as never))
  return removed
}

/**
 * Drop unused XObject resource entries after rewriting content. Otherwise the
 * old image/form remains reachable even though its Do instruction was removed.
 * Resource dictionaries are copied because several pages/forms can share one.
 */
function pruneUnusedXObjects(doc: PDFDocument): void {
  const clean = (chunks: Uint8Array[], resources: PDFDict, ancestors: Set<PDFStream>): PDFDict => {
    const res = cloneResources(doc, resources)!
    const xobjects = res.lookup(PDFName.of('XObject'))
    const used = new Set<string>()
    const scanned = new Set<PDFStream>()
    const visitForm = (stream: PDFStream) => {
      if (ancestors.has(stream) || scanned.has(stream)) return
      scanned.add(stream)
      const own = stream.dict.lookup(PDFName.of('Resources'))
      if (own instanceof PDFDict) {
        stream.dict.set(PDFName.of('Resources'), clean([streamBytes(stream)], own, new Set([...ancestors, stream])))
      } else scan(streamBytes(stream))
    }
    const scan = (bytes: Uint8Array) => {
      for (const ins of parseContent(bytes)) {
        if (ins.op !== 'Do') continue
        const name = ins.args.at(-1)?.value
        if (typeof name !== 'string') continue
        used.add(name)
        const xo = xobjects instanceof PDFDict ? xobjects.lookup(PDFName.of(name)) : undefined
        if (xo instanceof PDFStream && xo.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) visitForm(xo)
      }
    }
    chunks.forEach(scan)
    // Type3 glyph programs can inherit the enclosing resource dictionary.
    const fonts = res.lookup(PDFName.of('Font'))
    if (fonts instanceof PDFDict)
      for (const [, ref] of fonts.entries()) {
        const font = doc.context.lookup(ref)
        if (!(font instanceof PDFDict) || font.get(PDFName.of('Subtype')) !== PDFName.of('Type3')) continue
        if (font.lookup(PDFName.of('Resources')) instanceof PDFDict) continue
        const chars = font.lookup(PDFName.of('CharProcs'))
        if (chars instanceof PDFDict)
          for (const [, char] of chars.entries()) {
            const stream = doc.context.lookup(char)
            if (stream instanceof PDFStream) scan(streamBytes(stream))
          }
      }
    // Tiling patterns, like forms, may contain image paint instructions.
    const patterns = res.lookup(PDFName.of('Pattern'))
    if (patterns instanceof PDFDict)
      for (const [, ref] of patterns.entries()) {
        const pattern = doc.context.lookup(ref)
        if (pattern instanceof PDFStream) visitForm(pattern)
      }
    // A soft mask is a form program too and may inherit these resources.
    const states = res.lookup(PDFName.of('ExtGState'))
    if (states instanceof PDFDict)
      for (const [, ref] of states.entries()) {
        const state = doc.context.lookup(ref)
        const mask = state instanceof PDFDict ? state.lookup(PDFName.of('SMask')) : undefined
        const group = mask instanceof PDFDict ? mask.lookup(PDFName.of('G')) : undefined
        if (group instanceof PDFStream) visitForm(group)
      }
    if (xobjects instanceof PDFDict)
      for (const [name] of xobjects.entries()) {
        if (!used.has(name.decodeText())) xobjects.delete(name)
      }
    return res
  }
  for (const page of doc.getPages()) {
    const resources = page.node.Resources()
    if (!(resources instanceof PDFDict)) continue
    const contents = page.node.Contents()
    const streams =
      contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)) : [contents]
    page.node.set(
      PDFName.of('Resources'),
      clean(streams.filter((s): s is PDFStream => s instanceof PDFStream).map(streamBytes), resources, new Set()),
    )
  }
}

/** Remove form-field branches whose last page widget was redacted. */
function pruneRedactedFields(doc: PDFDocument): void {
  const widgets = new Set<unknown>()
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) for (let i = 0; i < annots.size(); i++) widgets.add(annots.lookup(i))
  }
  const form = doc.catalog.lookup(PDFName.of('AcroForm'))
  const fields = form instanceof PDFDict ? form.lookup(PDFName.of('Fields')) : undefined
  if (!(fields instanceof PDFArray) || !(form instanceof PDFDict)) return
  const retained = new Set<unknown>()
  const visiting = new Set<unknown>()
  const keep = (value: unknown): boolean => {
    const field = value instanceof PDFRef ? doc.context.lookup(value) : value
    if (!(field instanceof PDFDict) || visiting.has(field)) return true
    visiting.add(field)
    const kids = field.lookup(PDFName.of('Kids'))
    let survives = true
    if (kids instanceof PDFArray && kids.size()) {
      const left = kids.asArray().filter(keep)
      field.set(PDFName.of('Kids'), doc.context.obj(left))
      survives = left.length > 0
    } else if (field.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
      survives = widgets.has(field)
    }
    if (survives) retained.add(field)
    visiting.delete(field)
    return survives
  }
  form.set(PDFName.of('Fields'), doc.context.obj(fields.asArray().filter(keep)))
  const calculationOrder = form.lookup(PDFName.of('CO'))
  if (calculationOrder instanceof PDFArray)
    form.set(
      PDFName.of('CO'),
      doc.context.obj(calculationOrder.asArray().filter((ref) => retained.has(doc.context.lookup(ref)))),
    )
}

/**
 * PDF writers serialize all registered objects, including orphaned streams.
 * Trace from every trailer root (catalog, info, encryption, IDs) and retain
 * shared live objects, while deleting content detached by redaction.
 */
export function sanitizeRedactedDocument(doc: PDFDocument): void {
  pruneUnusedXObjects(doc)
  pruneRedactedFields(doc)
  const reachable = new Set<PDFRef>()
  const visited = new Set<unknown>()
  const pending: unknown[] = Object.values(doc.context.trailerInfo)
  while (pending.length) {
    const value = pending.pop()
    if (value instanceof PDFRef) {
      if (reachable.has(value)) continue
      reachable.add(value)
      pending.push(doc.context.lookup(value))
    } else if (value && !visited.has(value)) {
      visited.add(value)
      if (value instanceof PDFStream) pending.push(value.dict)
      else if (value instanceof PDFDict) pending.push(...value.values())
      else if (value instanceof PDFArray) pending.push(...value.asArray())
    }
  }
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!reachable.has(ref)) doc.context.delete(ref)
}
