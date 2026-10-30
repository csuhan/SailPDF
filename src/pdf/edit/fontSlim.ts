/**
 * Shrink embedded TrueType fonts that are much larger than what the
 * document uses (typically a whole system CJK font embedded "unsubsetted").
 *
 * Glyph ids must stay stable (CIDToGIDMap / Identity encodings refer to them),
 * so instead of renumbering, unused glyphs are emptied: their outlines are
 * dropped from `glyf`, `loca` is rebuilt, everything else is copied as is.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib'
import pako from 'pako'
import { parseContent } from './contentStream'

interface Table {
  tag: string
  data: Uint8Array
}

function readTables(b: Uint8Array): { sfnt: number; tables: Table[] } | null {
  if (b.length < 12) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const sfnt = dv.getUint32(0)
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) return null // TrueType only
  const n = dv.getUint16(4)
  const tables: Table[] = []
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    if (o + 16 > b.length) return null
    const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
    const off = dv.getUint32(o + 8)
    const len = dv.getUint32(o + 12)
    if (off + len > b.length) return null
    tables.push({ tag, data: b.subarray(off, off + len) })
  }
  return { sfnt, tables }
}

function checksum(d: Uint8Array): number {
  let sum = 0
  const padded = new Uint8Array((d.length + 3) & ~3)
  padded.set(d)
  const dv = new DataView(padded.buffer)
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0
  return sum
}

function writeFont(sfnt: number, tables: Table[]): Uint8Array {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const n = tables.length
  let size = 12 + n * 16
  const offsets: number[] = []
  for (const t of tables) {
    offsets.push(size)
    size += (t.data.length + 3) & ~3
  }
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, sfnt)
  dv.setUint16(4, n)
  let es = 0
  while (1 << (es + 1) <= n) es++
  dv.setUint16(6, (1 << es) * 16)
  dv.setUint16(8, es)
  dv.setUint16(10, n * 16 - (1 << es) * 16)
  tables.forEach((t, i) => {
    const o = 12 + i * 16
    for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k)
    dv.setUint32(o + 4, checksum(t.data))
    dv.setUint32(o + 8, offsets[i])
    dv.setUint32(o + 12, t.data.length)
    out.set(t.data, offsets[i])
  })
  // head.checkSumAdjustment
  const head = tables.findIndex((t) => t.tag === 'head')
  if (head >= 0) {
    const ho = offsets[head]
    dv.setUint32(ho + 8, 0)
    dv.setUint32(ho + 8, (0xb1b0afba - checksum(out)) >>> 0)
  }
  return out
}

/** keep only `used` glyph outlines (plus composites' components) */
export function slimTrueType(font: Uint8Array, used: Set<number>): Uint8Array | null {
  const parsed = readTables(font)
  if (!parsed) return null
  const get = (tag: string) => parsed.tables.find((t) => t.tag === tag)
  const head = get('head')
  const loca = get('loca')
  const glyf = get('glyf')
  const maxp = get('maxp')
  if (!head || !loca || !glyf || !maxp) return null
  const hv = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength)
  const longLoca = hv.getInt16(50) === 1
  const numGlyphs = new DataView(maxp.data.buffer, maxp.data.byteOffset).getUint16(4)
  const lv = new DataView(loca.data.buffer, loca.data.byteOffset, loca.data.byteLength)
  const off = (g: number) => (longLoca ? lv.getUint32(g * 4) : lv.getUint16(g * 2) * 2)
  if (loca.data.length < (numGlyphs + 1) * (longLoca ? 4 : 2)) return null
  const gv = new DataView(glyf.data.buffer, glyf.data.byteOffset, glyf.data.byteLength)

  // composite glyphs pull in their components
  const keep = new Set<number>([0])
  const stack = Array.from(used).filter((g) => g < numGlyphs)
  while (stack.length) {
    const g = stack.pop()!
    if (keep.has(g) && g !== 0) continue
    keep.add(g)
    const s = off(g)
    const e = off(g + 1)
    if (e - s < 10 || e > glyf.data.length) continue
    if (gv.getInt16(s) >= 0) continue
    let p = s + 10
    for (let guard = 0; guard < 64 && p + 4 <= e; guard++) {
      const flags = gv.getUint16(p)
      const comp = gv.getUint16(p + 2)
      if (!keep.has(comp)) stack.push(comp)
      p += 4 + (flags & 1 ? 4 : 2)
      if (flags & 8) p += 2
      else if (flags & 0x40) p += 4
      else if (flags & 0x80) p += 8
      if (!(flags & 0x20)) break
    }
  }

  // rebuild glyf + (long) loca
  let total = 0
  for (const g of keep) total += (off(g + 1) - off(g) + 3) & ~3
  const nglyf = new Uint8Array(total)
  const nloca = new Uint8Array((numGlyphs + 1) * 4)
  const nlv = new DataView(nloca.buffer)
  let pos = 0
  for (let g = 0; g < numGlyphs; g++) {
    nlv.setUint32(g * 4, pos)
    if (!keep.has(g)) continue
    const s = off(g)
    const e = off(g + 1)
    if (e > s && e <= glyf.data.length) {
      nglyf.set(glyf.data.subarray(s, e), pos)
      pos += (e - s + 3) & ~3
    }
  }
  nlv.setUint32(numGlyphs * 4, pos)
  const nhead = head.data.slice()
  new DataView(nhead.buffer).setInt16(50, 1)
  const tables = parsed.tables
    // hinting-only / unused-by-PDF tables that can be large in system fonts
    .filter(
      (t) =>
        !['DSIG', 'GSUB', 'GPOS', 'GDEF', 'morx', 'mort', 'kerx', 'feat', 'trak', 'hdmx', 'VDMX', 'LTSH'].includes(
          t.tag,
        ),
    )
    .map((t) =>
      t.tag === 'glyf'
        ? { tag: 'glyf', data: nglyf.subarray(0, pos) }
        : t.tag === 'loca'
          ? { tag: 'loca', data: nloca }
          : t.tag === 'head'
            ? { tag: 'head', data: nhead }
            : { tag: t.tag, data: t.data.slice() },
    )
  return writeFont(parsed.sfnt, tables)
}

function decoded(s: PDFStream): Uint8Array | null {
  try {
    return s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : null
  } catch {
    return null
  }
}

/** glyph ids used by Identity-encoded Type0 fonts across all content */
function usedCids(doc: PDFDocument): Map<PDFDict, Set<number>> {
  const used = new Map<PDFDict, Set<number>>()
  const visitedStreams = new Set<unknown>()
  const walk = (bytes: Uint8Array, res: PDFDict | undefined, depth: number) => {
    if (depth > 10) return
    const fonts = res?.lookup(PDFName.of('Font'))
    const xobjs = res?.lookup(PDFName.of('XObject'))
    let cur: Set<number> | null = null
    for (const ins of parseContent(bytes)) {
      if (ins.op === 'Tf') {
        const nm = ins.args[0]?.value
        const f = typeof nm === 'string' && fonts instanceof PDFDict ? fonts.lookup(PDFName.of(nm)) : undefined
        cur = null
        if (f instanceof PDFDict && f.lookup(PDFName.of('Subtype')) === PDFName.of('Type0')) {
          const enc = f.lookup(PDFName.of('Encoding'))
          if (enc === PDFName.of('Identity-H') || enc === PDFName.of('Identity-V')) {
            cur = used.get(f) ?? new Set()
            used.set(f, cur)
          }
        }
      } else if (cur && (ins.op === 'Tj' || ins.op === 'TJ' || ins.op === "'" || ins.op === '"')) {
        const tok = ins.args[ins.args.length - 1]
        if (!tok) continue
        const raw = String.fromCharCode(...bytes.subarray(tok.start, tok.end))
        // hex strings: <....>; literal strings in Identity fonts are rare
        // (a hex string at the very start of the token has no '(' / '[')
        for (const m of raw.matchAll(/<([0-9a-fA-F\s]*)>/g)) {
          const h = m[1].replace(/\s+/g, '')
          for (let i = 0; i + 4 <= h.length; i += 4) cur.add(parseInt(h.slice(i, i + 4), 16))
        }
        for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
          const s = m[1].replace(/\\([0-7]{1,3}|.)/g, (_, e: string) =>
            /^[0-7]+$/.test(e)
              ? String.fromCharCode(parseInt(e, 8))
              : (({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[e] ?? e),
          )
          for (let i = 0; i + 1 < s.length; i += 2) cur.add((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1))
        }
      } else if (ins.op === 'Do' && xobjs instanceof PDFDict) {
        const nm = ins.args[ins.args.length - 1]?.value
        const x = typeof nm === 'string' ? xobjs.lookup(PDFName.of(nm)) : undefined
        if (
          x instanceof PDFStream &&
          x.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form') &&
          !visitedStreams.has(x)
        ) {
          visitedStreams.add(x)
          const b = decoded(x)
          const r = x.dict.lookup(PDFName.of('Resources'))
          if (b) walk(b, r instanceof PDFDict ? r : res, depth + 1)
        }
      }
    }
  }
  for (const page of doc.getPages()) {
    const c = page.node.Contents()
    const parts: Uint8Array[] = []
    if (c instanceof PDFArray)
      for (let i = 0; i < c.size(); i++) {
        const s = c.lookup(i)
        const d = s instanceof PDFStream ? decoded(s) : null
        if (d) parts.push(d, new Uint8Array([10]))
      }
    else if (c instanceof PDFStream) {
      const d = decoded(c)
      if (d) parts.push(d)
    }
    const joined = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
    let o = 0
    for (const p of parts) {
      joined.set(p, o)
      o += p.length
    }
    const res = page.node.Resources()
    walk(joined, res instanceof PDFDict ? res : undefined, 0)
  }
  return used
}

// ── CFF-flavoured OpenType ('OTTO'): empty unused CharStrings ─────

/** read a CFF INDEX at `pos`; returns item ranges and the end offset */
function readIndex(b: Uint8Array, pos: number): { items: [number, number][]; end: number } | null {
  if (pos + 2 > b.length) return null
  const count = (b[pos] << 8) | b[pos + 1]
  if (count === 0) return { items: [], end: pos + 2 }
  const offSize = b[pos + 2]
  if (offSize < 1 || offSize > 4) return null
  const offAt = (i: number) => {
    let v = 0
    const o = pos + 3 + i * offSize
    for (let k = 0; k < offSize; k++) v = v * 256 + b[o + k]
    return v
  }
  const dataStart = pos + 3 + (count + 1) * offSize - 1
  const items: [number, number][] = []
  for (let i = 0; i < count; i++) items.push([dataStart + offAt(i), dataStart + offAt(i + 1)])
  const end = dataStart + offAt(count)
  return end <= b.length ? { items, end } : null
}

function writeIndex(items: Uint8Array[]): Uint8Array {
  const total = items.reduce((a, it) => a + it.length, 0)
  const offSize = total + 1 < 256 ? 1 : total + 1 < 65536 ? 2 : total + 1 < 1 << 24 ? 3 : 4
  const out = new Uint8Array(3 + (items.length + 1) * offSize + total)
  out[0] = items.length >> 8
  out[1] = items.length & 255
  out[2] = offSize
  let off = 1
  const put = (i: number, v: number) => {
    for (let k = offSize - 1; k >= 0; k--) {
      out[3 + i * offSize + k] = v & 255
      v = Math.floor(v / 256)
    }
  }
  let p = 3 + (items.length + 1) * offSize
  items.forEach((it, i) => {
    put(i, off)
    out.set(it, p)
    p += it.length
    off += it.length
  })
  put(items.length, off)
  return out
}

/** a DICT operand: its numeric value (integers) and the original bytes */
interface Operand {
  v: number
  raw: Uint8Array
}

/** parse a CFF DICT into operator -> operands (raw bytes kept for re-encoding) */
function parseDict(b: Uint8Array, s: number, e: number): Map<number, Operand[]> {
  const out = new Map<number, Operand[]>()
  let ops: Operand[] = []
  let i = s
  while (i < e) {
    const v = b[i]
    const st = i
    let val = 0
    if (v <= 21) {
      let op = v
      i++
      if (v === 12) op = 1200 + b[i++]
      out.set(op, ops)
      ops = []
      continue
    } else if (v === 28) {
      val = ((b[i + 1] << 24) >> 16) | b[i + 2]
      i += 3
    } else if (v === 29) {
      val = (b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]
      i += 5
    } else if (v === 30) {
      // real number: nibbles until 0xf; value unused (never an offset)
      i++
      while (i < e) {
        const x = b[i++]
        if ((x & 15) === 15 || x >> 4 === 15) break
      }
    } else if (v >= 32 && v <= 246) {
      val = v - 139
      i++
    } else if (v >= 247 && v <= 250) {
      val = (v - 247) * 256 + b[i + 1] + 108
      i += 2
    } else if (v >= 251 && v <= 254) {
      val = -(v - 251) * 256 - b[i + 1] - 108
      i += 2
    } else {
      i++
      continue
    }
    ops.push({ v: val, raw: b.subarray(st, i) })
  }
  return out
}

/** 5-byte integer encoding (offsets) */
const int5 = (v: number) => new Uint8Array([29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
const intOp = (v: number): Operand => ({ v, raw: int5(v) })

function encodeDict(entries: [number, Operand[]][]): Uint8Array {
  const parts: number[] = []
  for (const [op, vals] of entries) {
    for (const o of vals) parts.push(...o.raw)
    if (op >= 1200) parts.push(12, op - 1200)
    else parts.push(op)
  }
  return new Uint8Array(parts)
}

/**
 * Rebuild a CFF so that unused glyphs have an empty charstring ("endchar").
 * Only the CharStrings INDEX shrinks; offsets in the Top DICT that point
 * behind it are moved. Returns null when the layout is unusual.
 */
function slimCff(cff: Uint8Array, used: Set<number>): Uint8Array | null {
  const hdrSize = cff[2]
  const names = readIndex(cff, hdrSize)
  if (!names) return null
  const tops = readIndex(cff, names.end)
  if (!tops || tops.items.length !== 1) return null
  const strings = readIndex(cff, tops.end)
  if (!strings) return null
  const gsubrs = readIndex(cff, strings.end)
  if (!gsubrs) return null
  const [ts, te] = tops.items[0]
  const top = parseDict(cff, ts, te)
  const csOff = top.get(17)?.[0]?.v
  if (!csOff) return null
  const cs = readIndex(cff, csOff)
  if (!cs) return null
  const keep = new Set(used)
  keep.add(0)
  const endchar = new Uint8Array([14])
  const items = cs.items.map(([s, e], gid) => (keep.has(gid) ? cff.subarray(s, e) : endchar))
  const newCs = writeIndex(items)
  const delta = newCs.length - (cs.end - csOff)
  void ts
  void te
  // FDArray font dicts hold Private offsets. Instead of patching them in
  // place (their size may change), the FDArray is re-encoded and appended at
  // the end, and the Top DICT points to the new copy.
  const before = cff.subarray(0, names.end)
  const middle = cff.subarray(tops.end, csOff)
  const after = cff.subarray(cs.end)
  const fdArrOff = top.get(1236)?.[0]?.v
  let fdTail: Uint8Array = new Uint8Array(0)
  let fdDicts: { s: number; e: number; d: Map<number, Operand[]> }[] = []
  if (fdArrOff) {
    const fda = readIndex(cff, fdArrOff)
    if (!fda) return null
    fdDicts = fda.items.map(([s0, e0]) => ({ s: s0, e: e0, d: parseDict(cff, s0, e0) }))
  }
  // final layout: before | topIdx | middle | newCs | after | fdTail
  const layout = (topLen: number) => {
    const shiftMid = topLen - (tops.end - names.end)
    const mapOff = (v: number) => (v >= cs.end ? v + delta + shiftMid : v >= tops.end ? v + shiftMid : v)
    const tailOff = before.length + topLen + middle.length + newCs.length + after.length
    return { mapOff, tailOff }
  }
  let topIdx = writeIndex([cff.subarray(ts, te)])
  for (let pass = 0; pass < 3; pass++) {
    const { mapOff, tailOff } = layout(topIdx.length)
    if (fdDicts.length) {
      fdTail = writeIndex(
        fdDicts.map(({ d }) =>
          encodeDict(
            Array.from(d.entries()).map(([op, v]): [number, Operand[]] =>
              op === 18 ? [op, [v[0], intOp(mapOff(v[1].v))]] : [op, v],
            ),
          ),
        ),
      )
    }
    const tEntries: [number, Operand[]][] = []
    for (const [op, vals] of top) {
      if (op === 17) tEntries.push([op, [intOp(mapOff(csOff))]])
      else if (op === 1236) tEntries.push([op, [intOp(tailOff)]])
      else if (op === 18) tEntries.push([op, [vals[0], intOp(mapOff(vals[1].v))]])
      else if (op === 15 || op === 16 || op === 1237)
        tEntries.push([op, vals.map((o) => (o.v > 1 ? intOp(mapOff(o.v)) : o))])
      else tEntries.push([op, vals])
    }
    tEntries.sort((a, b) => (a[0] === 1230 ? -1 : b[0] === 1230 ? 1 : 0))
    const next = writeIndex([encodeDict(tEntries)])
    if (next.length === topIdx.length && pass > 0) {
      topIdx = next
      break
    }
    topIdx = next
  }
  const out = new Uint8Array(
    before.length + topIdx.length + middle.length + newCs.length + after.length + fdTail.length,
  )
  let o = 0
  for (const part of [before, topIdx, middle, newCs, after, fdTail]) {
    out.set(part, o)
    o += part.length
  }
  return out
}

function slimOpenTypeCff(font: Uint8Array, used: Set<number>): Uint8Array | null {
  if (font.length < 4 || String.fromCharCode(font[0], font[1], font[2], font[3]) !== 'OTTO') return null
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const n = dv.getUint16(4)
  const tables: Table[] = []
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    const tag = String.fromCharCode(font[o], font[o + 1], font[o + 2], font[o + 3])
    const off = dv.getUint32(o + 8)
    const len = dv.getUint32(o + 12)
    if (off + len > font.length) return null
    tables.push({ tag, data: font.subarray(off, off + len) })
  }
  const cffT = tables.find((t) => t.tag === 'CFF ')
  if (!cffT) return null
  const slim = slimCff(cffT.data, used)
  if (!slim) return null
  const out = tables
    .filter(
      (t) => !['DSIG', 'GSUB', 'GPOS', 'GDEF', 'BASE', 'meta', 'morx', 'mort', 'kerx', 'feat', 'trak'].includes(t.tag),
    )
    .map((t) => (t.tag === 'CFF ' ? { tag: t.tag, data: slim } : { tag: t.tag, data: t.data.slice() }))
  return writeFont(0x4f54544f, out)
}

/**
 * Slim every Identity-encoded embedded font whose program is large (a full
 * system font embedded although a handful of glyphs is used).
 * Returns the number of bytes saved (uncompressed).
 */
export function slimEmbeddedFonts(doc: PDFDocument, minSize = 200_000): number {
  let saved = 0
  for (const [font, cids] of usedCids(doc)) {
    const desc = font.lookup(PDFName.of('DescendantFonts'))
    const cid = desc instanceof PDFArray ? desc.lookup(0) : undefined
    if (!(cid instanceof PDFDict) || cid.lookup(PDFName.of('Subtype')) !== PDFName.of('CIDFontType2')) continue
    // only the identity mapping: CID == GID
    const map = cid.lookup(PDFName.of('CIDToGIDMap'))
    if (map && map !== PDFName.of('Identity')) continue
    const fd = cid.lookup(PDFName.of('FontDescriptor'))
    const ffRef = fd instanceof PDFDict ? fd.get(PDFName.of('FontFile2')) : undefined
    const ff = ffRef instanceof PDFRef ? doc.context.lookup(ffRef) : undefined
    if (!(ff instanceof PDFRawStream) || !(ffRef instanceof PDFRef)) continue
    const prog = decoded(ff)
    if (!prog || prog.length < minSize) continue
    const slim = slimTrueType(prog, cids) ?? slimOpenTypeCff(prog, cids)
    if (!slim || slim.length > prog.length * 0.8) continue
    const z = pako.deflate(slim)
    const dict = doc.context.obj({ Filter: 'FlateDecode', Length1: slim.length }) as PDFDict
    doc.context.assign(ffRef, PDFRawStream.of(dict, z))
    saved += prog.length - slim.length
  }
  return saved
}
