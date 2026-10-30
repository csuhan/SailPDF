import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setCharacterSqueeze,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  setTextRise,
  setWordSpacing,
  showText,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { EditOp, StandardFontName, TextEditRun } from './ops'
import { computePageState } from './pageOrder'
import { fontForText, textNeedsCustomFont } from './cjkFont'
import { findEmbeddedFont, findSystemFont, loadFontkit } from './extractFonts'
import { closeMatrix, walkImagePaints } from './imageOps'
import { redactAnnotations, redactPage, sanitizeRedactedDocument, type RedactArea } from './redact'
import { deleteFileAnnotations } from '../annotations'

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const v = parseInt(m[1], 16)
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 }
}

// A PDFFont belongs to one document; concurrent exports must never share it.
const FONT_CACHE = new WeakMap<PDFDocument, Map<string, PDFFont>>()

/** our StandardFontName -> pdf-lib StandardFonts (Times-* names differ) */
const STANDARD_FONT_MAP: Record<StandardFontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  'Times-Italic': StandardFonts.TimesRomanItalic,
  'Times-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
}

async function fontFor(doc: PDFDocument, name: StandardFontName, text?: string): Promise<PDFFont> {
  if (text && textNeedsCustomFont(text)) {
    // CJK / non-WinAnsi content: embed a system font (PingFang/YaHei/Noto)
    return fontForText(doc, text)
  }
  let cache = FONT_CACHE.get(doc)
  if (!cache) FONT_CACHE.set(doc, (cache = new Map()))
  let f = cache.get(name)
  if (!f) {
    f = await doc.embedFont(STANDARD_FONT_MAP[name] ?? StandardFonts.Helvetica)
    cache.set(name, f)
  }
  return f
}

const EMBED_CACHE = new WeakMap<PDFDocument, Map<Uint8Array, Promise<PDFFont>>>()

// ── original font resources ────────────────────────────────────

const normFontName = (s: string) => s.replace(/^\//, '').replace(/[,_]/g, '-').replace(/\s/g, '')

function nameOf(v: unknown): string {
  return v instanceof PDFName ? normFontName(v.decodeText()) : ''
}

/** BaseFont plus descriptor FontName (pdf.js may report either) */
function fontNamesOf(dict: PDFDict): string[] {
  const names = [nameOf(dict.get(PDFName.of('BaseFont')))]
  try {
    let d: unknown = dict
    const desc = dict.lookup(PDFName.of('DescendantFonts'))
    if (desc instanceof PDFArray) d = desc.lookup(0)
    if (d instanceof PDFDict) {
      names.push(nameOf(d.get(PDFName.of('BaseFont'))))
      const fd = d.lookup(PDFName.of('FontDescriptor'))
      if (fd instanceof PDFDict) names.push(nameOf(fd.get(PDFName.of('FontName'))))
    }
  } catch {
    /* malformed font dict */
  }
  return names.filter(Boolean)
}

/** find the font dict ref whose BaseFont matches, preferring the page's own resources */
/** how well a simple font dict's /Widths match the sampled code->width pairs */
function widthScore(doc: PDFDocument, dict: PDFDict, sig: [number, number][] | undefined): number {
  if (!sig || sig.length === 0) return 0
  try {
    const first = dict.lookup(PDFName.of('FirstChar'))
    const widths = dict.lookup(PDFName.of('Widths'))
    if (!(first instanceof PDFNumber) || !(widths instanceof PDFArray)) return 0
    const fc = first.asNumber()
    let hit = 0
    for (const [code, w] of sig) {
      const v = widths.lookup(code - fc)
      const n = v instanceof PDFNumber ? v.asNumber() : NaN
      if (Number.isFinite(n) && Math.abs(n - w) < Math.max(0.5, Math.abs(w) * 0.002)) hit++
      else hit -= 2
    }
    return hit
  } catch {
    void doc
    return 0
  }
}

/** find the font dict ref matching name (+ width signature), page resources first */
function findFontRef(doc: PDFDocument, page: PDFPage, baseFont: string, sig?: [number, number][]): PDFRef | null {
  const want = normFontName(baseFont)
  const visited = new Set<unknown>()
  const found: PDFRef[] = []
  const searchResources = (res: unknown, depth: number) => {
    if (!(res instanceof PDFDict) || visited.has(res) || depth > 6) return
    visited.add(res)
    const fonts = res.lookup(PDFName.of('Font'))
    if (fonts instanceof PDFDict) {
      for (const [, v] of fonts.entries()) {
        if (!(v instanceof PDFRef) || found.includes(v)) continue
        const d = doc.context.lookup(v)
        if (d instanceof PDFDict && fontNamesOf(d).includes(want)) found.push(v)
      }
    }
    const xobjs = res.lookup(PDFName.of('XObject'))
    if (xobjs instanceof PDFDict) {
      for (const [, v] of xobjs.entries()) {
        const x = doc.context.lookup(v)
        if (x instanceof PDFStream) searchResources(x.dict.lookup(PDFName.of('Resources')), depth + 1)
      }
    }
  }
  try {
    searchResources(page.node.Resources(), 0)
  } catch {
    /* fall through to a document-wide scan */
  }
  if (found.length === 0) {
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Font') {
        const sub = obj.get(PDFName.of('Subtype'))?.toString()
        if (sub !== '/CIDFontType0' && sub !== '/CIDFontType2' && fontNamesOf(obj).includes(want)) {
          found.push(ref)
        }
      }
    }
  }
  if (found.length <= 1) return found[0] ?? null
  // several fonts share the name (e.g. split encodings of one web font):
  // pick the one whose widths agree with the codes we are about to write
  let best = found[0]
  let bestScore = -Infinity
  for (const ref of found) {
    const d = doc.context.lookup(ref)
    const sc = d instanceof PDFDict ? widthScore(doc, d, sig) : -Infinity
    if (sc > bestScore) {
      bestScore = sc
      best = ref
    }
  }
  return best
}

const FONT_KEY_CACHE = new WeakMap<PDFPage, Map<string, PDFName | null>>()

/** resource key on `page` for the original font (added to the page if needed) */
function originalFontKey(doc: PDFDocument, page: PDFPage, baseFont: string, sig?: [number, number][]): PDFName | null {
  let perPage = FONT_KEY_CACHE.get(page)
  if (!perPage) {
    perPage = new Map()
    FONT_KEY_CACHE.set(page, perPage)
  }
  const ref = findFontRef(doc, page, baseFont, sig)
  const cacheKey = ref ? ref.toString() : `none:${baseFont}`
  if (perPage.has(cacheKey)) return perPage.get(cacheKey)!
  const key = ref ? page.node.newFontDictionary('OrigF', ref) : null
  perPage.set(cacheKey, key)
  return key
}

/**
 * Draw a run. Pieces encodable in the original font are written with that
 * font resource itself (exact look); the rest falls back to a matched font.
 */
async function drawEditRun(
  out: PDFDocument,
  src: PDFDocument,
  page: PDFPage,
  run: TextEditRun,
  baselineY: number,
): Promise<void> {
  const rc = hexToRgb(run.color)
  const color = rgb(rc.r, rc.g, rc.b)
  const fallbackFont = (text: string) =>
    resolveBakeFont(out, src, {
      baseFamily: run.baseFamily,
      bold: run.bold,
      italic: run.italic,
      fontName: run.fontName ?? standardNameFor(run.baseFamily),
      text,
    })
  const origKey =
    run.pdfFont && run.pieces ? originalFontKey(out, page, run.pdfFont.baseFont, run.pdfFont.widthSig) : null
  if (!origKey || !run.pieces) {
    page.drawText(run.text, {
      x: run.x,
      y: baselineY,
      size: run.fontSize,
      font: await fallbackFont(run.text),
      color,
    })
    return
  }
  for (const piece of run.pieces) {
    if (!piece.text.trim()) continue
    if (piece.hex || piece.glyphs?.length) {
      const mode = run.renderMode ?? 0
      const sc = run.strokeColor ? hexToRgb(run.strokeColor) : rc
      // TJ with per-glyph adjustments reproduces exact original positions
      const body: ReturnType<typeof showText>[] = []
      if (piece.glyphs?.length) {
        const k = run.fontSize * (run.hScale ?? 1)
        const parts: (PDFHexString | PDFNumber)[] = []
        let pen = 0
        for (const g of piece.glyphs) {
          const gap = g.dx - pen
          if (Math.abs(gap) > 1e-4) parts.push(PDFNumber.of(-Math.round((gap / k) * 1000 * 1000) / 1000))
          parts.push(PDFHexString.of(g.hex))
          pen = g.dx + g.w
        }
        body.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [out.context.obj(parts)]))
      } else {
        body.push(showText(PDFHexString.of(piece.hex!)))
      }
      page.pushOperators(
        pushGraphicsState(),
        beginText(),
        setFillingRgbColor(rc.r, rc.g, rc.b),
        setStrokingRgbColor(sc.r, sc.g, sc.b),
        setLineWidth(run.strokeWidth ?? 1),
        setFontAndSize(origKey, run.fontSize),
        setCharacterSpacing(0),
        setWordSpacing(0),
        setCharacterSqueeze(100 * (run.hScale ?? 1)),
        setTextRise(0),
        setTextRenderingMode(mode === 1 || mode === 2 ? mode : 0),
        setTextMatrix(1, 0, 0, 1, piece.x, baselineY),
        ...body,
        endText(),
        popGraphicsState(),
      )
    } else {
      page.drawText(piece.text, {
        x: piece.x,
        y: baselineY,
        size: run.fontSize,
        font: await fallbackFont(piece.text),
        color,
      })
    }
  }
}

function standardNameFor(family: string | undefined): StandardFontName {
  const fam = (family ?? '').toLowerCase()
  if (/mono|courier/.test(fam)) return 'Courier'
  if (/times|serif|song|kai|ming/.test(fam)) return 'Times-Roman'
  return 'Helvetica'
}

async function embedBytes(doc: PDFDocument, bytes: Uint8Array): Promise<PDFFont> {
  let cache = EMBED_CACHE.get(doc)
  if (!cache) EMBED_CACHE.set(doc, (cache = new Map()))
  // Cached source font buffers have stable identities; unlike a length and two
  // sampled bytes, this key cannot confuse distinct font programs.
  let p = cache.get(bytes)
  if (!p) {
    p = (async () => {
      try {
        return await doc.embedFont(bytes, { subset: true })
      } catch {
        return doc.embedFont(bytes)
      }
    })()
    cache.set(bytes, p)
  }
  return p
}

/**
 * Font for a text-edit op: original embedded program when it covers the new
 * glyphs → system font matched by family → standard-14 fallback.
 */
async function bytesCoverAllGlyphs(bytes: Uint8Array, text: string): Promise<boolean> {
  try {
    const fk = (await loadFontkit()).create(bytes) as unknown as {
      hasGlyphForCodePoint?: (cp: number) => boolean
    }
    if (!fk.hasGlyphForCodePoint) return true
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (cp === 32 || cp === 10) continue
      if (!fk.hasGlyphForCodePoint(cp)) return false
    }
    return true
  } catch {
    return false
  }
}

interface FontResolveInput {
  baseFamily?: string
  bold?: boolean
  italic?: boolean
  fontName: StandardFontName
  text: string
}

async function resolveBakeFont(out: PDFDocument, src: PDFDocument, input: FontResolveInput): Promise<PDFFont> {
  const family = input.baseFamily ?? ''
  const bold = !!input.bold
  const italic = !!input.italic
  if (family) {
    // 1) the very font embedded in the original document (exact match)
    const embedded = await findEmbeddedFont(src, family, bold, italic, input.text)
    if (embedded) return embedBytes(out, embedded)
    // 2) same family from the system fonts, glyph-coverage checked
    const sys = await findSystemFont(family, bold, italic)
    if (sys && (await bytesCoverAllGlyphs(sys, input.text))) return embedBytes(out, sys)
  }
  // 3) CJK / exotic scripts: embed a system CJK face
  if (textNeedsCustomFont(input.text)) {
    return fontForText(out, input.text)
  }
  // 4) standard-14 fallback
  return fontFor(out, input.fontName, input.text)
}

async function fontForTextEdit(
  out: PDFDocument,
  src: PDFDocument,
  op: Extract<EditOp, { kind: 'text-edit' }>,
): Promise<PDFFont> {
  return resolveBakeFont(out, src, {
    baseFamily: op.baseFamily,
    bold: op.bold,
    italic: op.italic,
    fontName: op.fontName,
    text: op.newText,
  })
}

function drawShapeOn(page: PDFPage, op: Extract<EditOp, { kind: 'shape' }>): void {
  const col = hexToRgb(op.color)
  const color = rgb(col.r, col.g, col.b)
  if (op.shape === 'rect') {
    page.drawRectangle({
      x: op.x,
      y: op.y,
      width: op.width,
      height: op.height,
      borderColor: color,
      borderWidth: op.thickness,
      color: op.fill ? color : undefined,
    })
  } else if (op.shape === 'ellipse') {
    page.drawEllipse({
      x: op.x + op.width / 2,
      y: op.y + op.height / 2,
      xScale: Math.abs(op.width) / 2,
      yScale: Math.abs(op.height) / 2,
      borderColor: color,
      borderWidth: op.thickness,
      color: op.fill ? color : undefined,
    })
  } else {
    const x2 = op.x + op.width
    const y2 = op.y + op.height
    page.drawLine({
      start: { x: op.x, y: op.y },
      end: { x: x2, y: y2 },
      thickness: op.thickness,
      color,
    })
    if (op.shape === 'arrow') {
      const ang = Math.atan2(y2 - op.y, x2 - op.x)
      const head = 6 + op.thickness * 1.8
      for (const da of [Math.PI - 0.42, Math.PI + 0.42]) {
        page.drawLine({
          start: { x: x2, y: y2 },
          end: {
            x: x2 + head * Math.cos(ang + da),
            y: y2 + head * Math.sin(ang + da),
          },
          thickness: op.thickness,
          color,
        })
      }
    }
  }
}

/**
 * Delete / replace images of the original page content. Runs before any
 * overlay content is appended, directly on the (copied) page streams.
 * The latest op per image wins (a later replace/delete supersedes earlier).
 */
async function bakePageImageOps(out: PDFDocument, ops: EditOp[], pageMap: number[]): Promise<void> {
  for (const [pageRef, list] of pageImageOpsByPage(ops)) {
    const pageIndex = pageMap.indexOf(pageRef)
    if (pageIndex < 0) continue
    const page = out.getPage(pageIndex)
    if (page) await applyPageImageOps(out, page, list)
  }
}

/**
 * Redaction areas remove the ORIGINAL content below them (text, images,
 * vector art, annotations) before the black boxes are drawn.
 */
function bakeRedactions(out: PDFDocument, ops: EditOp[], pageMap: number[]): void {
  const byPage = new Map<number, RedactArea[]>()
  for (const op of ops) {
    if (op.kind !== 'redact' || op.width < 1 || op.height < 1) continue
    const list = byPage.get(op.page) ?? []
    list.push({ x0: op.x, y0: op.y, x1: op.x + op.width, y1: op.y + op.height })
    byPage.set(op.page, list)
  }
  for (const [pageRef, areas] of byPage) {
    const pageIndex = pageMap.indexOf(pageRef)
    const page = pageIndex >= 0 ? out.getPage(pageIndex) : null
    if (!page) continue
    redactPage(out, page, areas)
    redactAnnotations(out, page, areas)
    // Redaction is the final content operation, including newly added content.
    // Append directly: PDFPage's drawing cache still points to the old stream
    // that redactPage replaced, so drawRectangle would write into an orphan.
    const cover = areas
      .map((a) => `q 0 g ${fmt(a.x0)} ${fmt(a.y0)} ${fmt(a.x1 - a.x0)} ${fmt(a.y1 - a.y0)} re f Q`)
      .join('\n')
    page.node.addContentStream(out.context.register(out.context.flateStream(cover)))
  }
}

/**
 * Edited lines: the original glyphs under the edit's cover are removed from
 * the page content (not only painted over), so search, copy, text export and
 * AI reading see the new text only.
 */
function removeReplacedText(out: PDFDocument, ops: EditOp[], pageMap: number[]): void {
  const superseded = new Set<string>()
  for (const o of ops) if (o.kind === 'text-edit' && o.replaces) superseded.add(o.replaces)
  const byPage = new Map<number, RedactArea[]>()
  for (const op of ops) {
    if (op.kind !== 'text-edit' || superseded.has(op.id) || op.rect.width <= 0 || op.rect.height <= 0) continue
    const list = byPage.get(op.page) ?? []
    list.push({ x0: op.rect.x, y0: op.rect.y, x1: op.rect.x + op.rect.width, y1: op.rect.y + op.rect.height })
    byPage.set(op.page, list)
  }
  for (const [pageRef, areas] of byPage) {
    const idx = pageMap.indexOf(pageRef)
    const page = idx >= 0 ? out.getPage(idx) : null
    if (!page) continue
    try {
      redactPage(out, page, areas, { textOnly: true })
    } catch {
      /* the white cover still hides the old text */
    }
  }
}

type PageImageOp = Extract<EditOp, { kind: 'page-image' }>

/** page-image ops grouped by page; only the newest op per image survives */
export function pageImageOpsByPage(ops: EditOp[]): Map<number, PageImageOp[]> {
  const byPage = new Map<number, PageImageOp[]>()
  for (const op of ops) {
    if (op.kind !== 'page-image') continue
    const list = byPage.get(op.page) ?? []
    const prev = list.findIndex((o) => o.index === op.index && closeMatrix(o.matrix, op.matrix))
    if (prev >= 0) list.splice(prev, 1)
    // "replace" without data = restore the original: nothing to apply
    if (op.action === 'delete' || op.imageData) list.push(op)
    if (list.length) byPage.set(op.page, list)
    else byPage.delete(op.page)
  }
  return byPage
}

/** rewrite one page's content: delete or replace the targeted images */
export async function applyPageImageOps(out: PDFDocument, page: PDFPage, list: PageImageOp[]): Promise<number> {
  const embedded = new Map<string, { ref: PDFRef; w: number; h: number }>()
  for (const op of list) {
    if (op.action !== 'replace' || !op.imageData) continue
    const img = op.imageType === 'png' ? await out.embedPng(op.imageData) : await out.embedJpg(op.imageData)
    embedded.set(op.id, { ref: img.ref, w: img.width, h: img.height })
  }
  const pending = list.slice()
  let applied = 0
  walkImagePaints(out, page, (site) => {
    let k = pending.findIndex((t) => t.index === site.index && closeMatrix(t.matrix, site.matrix))
    if (k < 0) k = pending.findIndex((t) => closeMatrix(t.matrix, site.matrix))
    if (k < 0) return
    const op = pending.splice(k, 1)[0]
    if (op.action === 'delete') {
      site.replace(' ')
      applied++
      return
    }
    const img = embedded.get(op.id)
    if (!img) return
    const name = site.addXObject(img.ref, 'ImgR')
    // contain: keep the new image's aspect ratio inside the original unit
    // square (the CTM at the paint site already maps it onto the old box)
    let inner = ''
    if (op.fit !== 'stretch' && img.w > 0 && img.h > 0) {
      const m = site.matrix
      const boxW = Math.hypot(m[0], m[1])
      const boxH = Math.hypot(m[2], m[3])
      if (boxW > 0 && boxH > 0) {
        const ra = img.w / img.h / (boxW / boxH)
        const sx = ra >= 1 ? 1 : ra
        const sy = ra >= 1 ? 1 / ra : 1
        inner = `${fmt(sx)} 0 0 ${fmt(sy)} ${fmt((1 - sx) / 2)} ${fmt((1 - sy) / 2)} cm `
      }
    }
    site.replace(` q ${inner}${name} Do Q `)
    applied++
  })
  return applied
}

// ── document-wide ops: notes, watermark, page numbers, properties ──

type DocOp<K extends EditOp['kind']> = Extract<EditOp, { kind: K }>

function latest<K extends EditOp['kind']>(ops: EditOp[], kind: K): DocOp<K> | null {
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === kind) return ops[i] as DocOp<K>
  return null
}

/** text for a PDF string that may need UTF-16 (CJK etc.) */
function pdfText(t: string): PDFHexString | PDFString {
  return /^[\x20-\x7e]*$/.test(t) ? PDFString.of(t) : PDFHexString.fromText(t)
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

async function bakeDocumentOps(doc: PDFDocument, ops: EditOp[], pageMap: number[]): Promise<void> {
  const pages = doc.getPages()

  // watermark: once per page, diagonal by default
  const wm = latest(ops, 'watermark')
  if (wm && wm.text.trim()) {
    const font = textNeedsCustomFont(wm.text)
      ? await fontForText(doc, wm.text)
      : await doc.embedFont(StandardFonts.HelveticaBold)
    const c = hexToRgb(wm.color)
    for (const page of pages) {
      const { width, height } = page.getSize()
      const tw = font.widthOfTextAtSize(wm.text, wm.fontSize)
      const rad = (wm.angle * Math.PI) / 180
      // center the rotated text on the page
      const x = width / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * wm.fontSize) / 3
      const y = height / 2 - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * wm.fontSize) / 3
      page.drawText(wm.text, {
        x,
        y,
        size: wm.fontSize,
        font,
        color: rgb(c.r, c.g, c.b),
        opacity: wm.opacity,
        rotate: degrees(wm.angle),
      })
    }
  }

  // page numbers
  const pn = latest(ops, 'page-numbers')
  if (pn && pn.format.trim()) {
    const sample = pn.format.replace(/\{n\}|\{total\}/g, '0')
    const font = textNeedsCustomFont(sample)
      ? await fontForText(doc, sample)
      : await doc.embedFont(StandardFonts.Helvetica)
    const c = hexToRgb(pn.color)
    const counted = pages.length - (pn.startPage - 1)
    pages.forEach((page, i) => {
      if (i + 1 < pn.startPage) return
      const n = pn.startNumber + (i + 1 - pn.startPage)
      const label = pn.format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(pn.startNumber + counted - 1))
      const { width, height } = page.getSize()
      const box = page.getCropBox?.() ?? { x: 0, y: 0, width, height }
      const tw = font.widthOfTextAtSize(label, pn.fontSize)
      const margin = 28
      const [v, h] = pn.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
      const x =
        h === 'left' ? box.x + margin : h === 'right' ? box.x + box.width - margin - tw : box.x + (box.width - tw) / 2
      const y = v === 'top' ? box.y + box.height - margin - pn.fontSize * 0.75 : box.y + margin
      page.drawText(label, { x, y, size: pn.fontSize, font, color: rgb(c.r, c.g, c.b) })
    })
  }

  // crop boxes: the latest crop op touching a page wins
  const crops = new Map<number, Extract<EditOp, { kind: 'page-crop' }>>()
  for (const op of ops) {
    if (op.kind !== 'page-crop') continue
    const refs = op.pages === 'all' ? pageMap : op.pages
    for (const r of refs) crops.set(r, op)
  }
  for (const [ref, op] of crops) {
    const idx = pageMap.indexOf(ref)
    const page = idx >= 0 ? pages[idx] : null
    if (!page) continue
    const m = op.margins
    if (!m.left && !m.right && !m.top && !m.bottom) continue
    const box = page.getCropBox()
    const w = box.width - m.left - m.right
    const h = box.height - m.top - m.bottom
    if (w < 10 || h < 10) continue
    page.setCropBox(box.x + m.left, box.y + m.bottom, w, h)
  }

  // document properties
  const info = latest(ops, 'doc-info')
  if (info) {
    doc.setTitle(info.title, { showInWindowTitleBar: !!info.title })
    doc.setAuthor(info.author)
    doc.setSubject(info.subject)
    doc.setKeywords(info.keywords.split(/[,，;；]\s*/).filter(Boolean))
    doc.setModificationDate(new Date())
  }
}

/** sticky notes → PDF /Text annotations (open in Acrobat, Preview, browsers) */
function bakeNotes(doc: PDFDocument, ops: EditOp[], pageMap: number[]): void {
  for (const op of ops) {
    if (op.kind !== 'note' || !op.text.trim()) continue
    const pageIndex = pageMap.indexOf(op.page)
    if (pageIndex < 0) continue
    const page = doc.getPage(pageIndex)
    const c = hexToRgb(op.color)
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [op.x, op.y - 20, op.x + 20, op.y],
      Contents: pdfText(op.text),
      T: pdfText(op.author ?? ''),
      M: PDFString.of(pdfDate(new Date(op.modified))),
      C: [c.r, c.g, c.b],
      Name: 'Comment',
      F: 4,
      Open: false,
    })
    const ref = doc.context.register(annot)
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) annots.push(ref)
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
  }
}

/** Preserve text markup as real PDF annotations, including portable appearances. */
function bakeMarkups(doc: PDFDocument, ops: EditOp[], pageMap: number[]): void {
  for (const op of ops) {
    if (op.kind !== 'markup' || !op.quads.length) continue
    const index = pageMap.indexOf(op.page)
    if (index < 0) continue
    const page = doc.getPage(index),
      c = hexToRgb(op.color)
    const rect = [
      Math.min(...op.quads.map((q) => q.x)),
      Math.min(...op.quads.map((q) => q.y)),
      Math.max(...op.quads.map((q) => q.x + q.width)),
      Math.max(...op.quads.map((q) => q.y + q.height)),
    ]
    const quads = op.quads.flatMap((q) => [
      q.x,
      q.y + q.height,
      q.x + q.width,
      q.y + q.height,
      q.x,
      q.y,
      q.x + q.width,
      q.y,
    ])
    const alpha = op.markup === 'highlight' ? (op.opacity ?? 0.35) : 1
    const commands = [
      'q',
      '/GS0 gs',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} rg`,
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} RG`,
    ]
    for (const q of op.quads) {
      if (op.markup === 'highlight') commands.push(`${fmt(q.x)} ${fmt(q.y)} ${fmt(q.width)} ${fmt(q.height)} re f`)
      else {
        const y = op.markup === 'underline' ? q.y + q.height * 0.06 : q.y + q.height / 2
        commands.push(
          `${fmt(Math.max(0.6, q.height * 0.07))} w ${fmt(q.x)} ${fmt(y)} m ${fmt(q.x + q.width)} ${fmt(y)} l S`,
        )
      }
    }
    commands.push('Q')
    const appearance = doc.context.register(
      doc.context.flateStream(commands.join('\n'), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: rect,
        Resources: {
          ExtGState: {
            GS0: { Type: 'ExtGState', ca: alpha, CA: alpha, BM: op.markup === 'highlight' ? 'Multiply' : 'Normal' },
          },
        },
      }),
    )
    const annotation = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut' }[op.markup],
        Rect: rect,
        QuadPoints: quads,
        C: [c.r, c.g, c.b],
        CA: alpha,
        F: 4,
        NM: PDFString.of(op.id),
        AP: { N: appearance },
      }),
    )
    const annotations = page.node.lookup(PDFName.of('Annots'))
    if (annotations instanceof PDFArray) annotations.push(annotation)
    else page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]))
  }
}

/** link areas → /Link annotations (URI or GoTo a page) */
function bakeLinks(doc: PDFDocument, ops: EditOp[], pageMap: number[]): void {
  for (const op of ops) {
    if (op.kind !== 'link' || (!op.url && !op.toPage)) continue
    const pageIndex = pageMap.indexOf(op.page)
    if (pageIndex < 0) continue
    const page = doc.getPage(pageIndex)
    const target = op.toPage ? doc.getPages()[op.toPage - 1] : null
    if (op.toPage && !target) continue
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [op.x, op.y, op.x + op.width, op.y + op.height],
      Border: [0, 0, 0],
      F: 4,
    })
    if (op.url) annot.set(PDFName.of('A'), doc.context.obj({ S: 'URI', URI: PDFString.of(op.url) }))
    else annot.set(PDFName.of('Dest'), doc.context.obj([target!.ref, PDFName.of('Fit')]))
    const ref = doc.context.register(annot)
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) annots.push(ref)
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
  }
}

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1e6) / 1e6))

async function bakeContentOps(out: PDFDocument, src: PDFDocument, ops: EditOp[], pageMap: number[]): Promise<void> {
  await bakePageImageOps(out, ops, pageMap)
  removeReplacedText(out, ops, pageMap)
  const contentOps = ops.filter(
    (o) =>
      o.kind === 'text-edit' ||
      o.kind === 'overlay-text' ||
      o.kind === 'image' ||
      o.kind === 'draw' ||
      o.kind === 'shape' ||
      o.kind === 'redact',
  )
  // a re-edit of a line supersedes the earlier op for that line
  const superseded = new Set<string>()
  for (const o of contentOps) if (o.kind === 'text-edit' && o.replaces) superseded.add(o.replaces)
  for (const op of contentOps) {
    if (superseded.has(op.id)) continue
    // map stable page ref → final page index (pages may be reordered/deleted)
    const pageIndex = pageMap.indexOf(op.page)
    if (pageIndex < 0) continue
    const page = out.getPage(pageIndex)
    if (!page) continue
    switch (op.kind) {
      case 'text-edit': {
        if (op.rect.width > 0 && op.rect.height > 0)
          page.drawRectangle({
            x: op.rect.x,
            y: op.rect.y,
            width: op.rect.width,
            height: op.rect.height,
            color: rgb(1, 1, 1),
          })
        // style-preserving runs take precedence when available
        if (op.runs && op.baselineY !== undefined) {
          for (const run of op.runs) {
            if (!run.text) continue
            await drawEditRun(out, src, page, run, op.baselineY)
          }
          break
        }
        const font = await fontForTextEdit(out, src, op)
        const col = hexToRgb(op.color)
        // faithful placement: exact baseline+x of the original line
        const tx = op.x ?? op.rect.x
        const ty = op.baselineY ?? op.rect.y + Math.max(0, (op.rect.height - op.fontSize) / 2)
        page.drawText(op.newText, {
          x: tx,
          y: ty,
          size: op.fontSize,
          font,
          color: rgb(col.r, col.g, col.b),
        })
        break
      }
      case 'overlay-text': {
        const font = await fontFor(out, op.fontName, op.text)
        const col = hexToRgb(op.color)
        page.drawText(op.text, {
          x: op.x,
          y: op.y,
          size: op.fontSize,
          font,
          color: rgb(col.r, col.g, col.b),
        })
        break
      }
      case 'draw': {
        const col = hexToRgb(op.color)
        for (let i = 1; i < op.points.length; i++) {
          page.drawLine({
            start: op.points[i - 1],
            end: op.points[i],
            thickness: op.thickness,
            color: rgb(col.r, col.g, col.b),
            opacity: op.opacity,
          })
        }
        break
      }
      case 'shape': {
        drawShapeOn(page, op)
        break
      }
      case 'image': {
        const img = op.imageType === 'png' ? await out.embedPng(op.imageData) : await out.embedJpg(op.imageData)
        page.drawImage(img, {
          x: op.x,
          y: op.y,
          width: op.width,
          height: op.height,
          rotate: degrees(-op.rotation),
        })
        break
      }
      default:
        break
    }
  }
}

/**
 * Bake all edit ops into the document bytes (page ops first, then content).
 */
export async function bakePdf(fileBytes: Uint8Array, ops: EditOp[]): Promise<Uint8Array> {
  const fk = (await loadFontkit()) as unknown as Parameters<PDFDocument['registerFontkit']>[0]
  const src = await PDFDocument.load(fileBytes, { updateMetadata: false })
  src.registerFontkit(fk)
  const state = computePageState(src.getPageCount(), ops)
  const pageMap = state.map
  const originalPages = src.getPages()
  const identity = pageMap.length === originalPages.length && pageMap.every((p, i) => p === i + 1)
  // Reuse the document and its page objects: copying only pages loses catalog
  // metadata, form fields and other document-level structures.
  const work = src
  if (!identity) {
    // Reparenting leaves behind their original /Pages ancestors. Materialize
    // all inheritable attributes first, while each page still has its old
    // parent chain (different branches may supply different fonts and boxes).
    for (const page of originalPages) {
      for (const name of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
        const key = PDFName.of(name)
        const value = page.node.getInheritableAttribute(key)
        if (value !== undefined) page.node.set(key, value)
      }
    }
    while (work.getPageCount()) work.removePage(work.getPageCount() - 1)
    for (const ref of pageMap) {
      if (ref > 0) work.addPage(originalPages[ref - 1])
      else {
        const size = state.blankSizes.get(ref) ?? { width: 612, height: 792 }
        work.addPage([size.width, size.height])
      }
    }
  }
  for (const [index, ref] of pageMap.entries()) {
    const rotation = state.rotations.get(ref) ?? 0
    if (rotation) {
      const page = work.getPage(index)
      page.setRotation(degrees((page.getRotation().angle + rotation) % 360))
    }
  }

  // annotations of the file the user deleted
  const annotDel = new Map<number, string[]>()
  for (const op of ops)
    if (op.kind === 'annot-delete') (annotDel.get(op.page) ?? annotDel.set(op.page, []).get(op.page)!).push(op.annotId)
  for (const [ref, ids] of annotDel) {
    const i = pageMap.indexOf(ref)
    if (i >= 0) deleteFileAnnotations(work, i, ids)
  }
  await bakeContentOps(work, src, ops, pageMap)
  bakeNotes(work, ops, pageMap)
  bakeMarkups(work, ops, pageMap)
  bakeLinks(work, ops, pageMap)
  await bakeDocumentOps(work, ops, pageMap)
  if (ops.some((op) => op.kind === 'redact')) {
    bakeRedactions(work, ops, pageMap)
    // Embedders must finish before reachability is measured, otherwise a later
    // save could register their discarded image/font objects again.
    await work.flush()
    sanitizeRedactedDocument(work)
  }
  return work.save({ useObjectStreams: true })
}

export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function saveDocument(fileName: string, fileBytes: Uint8Array, ops: EditOp[]): Promise<void> {
  const hasEdits = ops.length > 0
  const bytes = hasEdits ? await bakePdf(fileBytes, ops) : fileBytes
  const outName = fileName.toLowerCase().endsWith('.pdf')
    ? fileName.replace(/\.pdf$/i, '') + (hasEdits ? '_edited.pdf' : '.pdf')
    : fileName + '.pdf'
  downloadBytes(outName, bytes)
}
