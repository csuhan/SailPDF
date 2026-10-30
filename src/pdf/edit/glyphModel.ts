/**
 * Exact glyph model of a page, rebuilt from pdf.js' operator list.
 *
 * The DOM text layer only approximates geometry and merges differently
 * colored glyphs into one span. Here every glyph carries its real origin,
 * advance, font, size and fill color, so line editing can preserve styles
 * character by character and position new text exactly.
 */
import { AnnotationMode, OPS, normalizeUnicode, type PDFPageProxy } from 'pdfjs-dist'

export interface PageGlyph {
  /** unicode text of the glyph (ligatures normalized, e.g. "fi") */
  text: string
  /** baseline origin in pdf user space */
  x: number
  y: number
  /** natural advance incl. char/word spacing (user units, along x) */
  adv: number
  /** glyph width without spacing (user units) */
  w: number
  /** effective font size in user units */
  size: number
  /** horizontal scaling relative to the size */
  hScale: number
  /** pdf.js font id (commonObjs key / css font-face family) */
  font: string
  /** original char code and its byte length in the PDF font encoding */
  code: number
  /** private-use char pdf.js renders this glyph with */
  fontChar: string
  isSpace: boolean
  /** "#rrggbb", or null when filled with a pattern */
  color: string | null
  /** PDF text render mode (0 fill, 1 stroke, 2 fill+stroke, ...) */
  renderMode: number
  /** stroke width in page user units (render modes 1/2) */
  strokeWidth: number
  strokeColor: string | null
  /** text render mode makes it invisible (OCR layers, clipping) */
  invisible: boolean
  /** drawing order on the page */
  seq: number
}

export interface FontInfo {
  loadedName: string
  name: string
  ascent: number
  descent: number
  /** font bbox top/bottom in em */
  bboxTop: number
  bboxBottom: number
  bold: boolean
  italic: boolean
  composite: boolean
  type3: boolean
  missingFile: boolean
  fontMatrix: number[]
}

export interface GlyphModel {
  glyphs: PageGlyph[]
  fonts: Map<string, FontInfo>
  images: PageImage[]
}

/** an image painted on the page (XObject or inline) */
export interface PageImage {
  /** index among image paints on the page, in drawing order */
  index: number
  /** pdf.js object id (img_*, mask_*); null for inline images */
  objId: string | null
  inline: boolean
  /** image -> page user space matrix (unit square maps to the image) */
  matrix: [number, number, number, number, number, number]
  /** axis-aligned bounding box in page user space */
  box: { x0: number; y0: number; x1: number; y1: number }
  /** pixel size of the image data, when known */
  width: number
  height: number
  /** stencil masks paint the fill color through a 1-bit image */
  isMask: boolean
  seq: number
}

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0')

function colorArg(args: unknown[]): string | null {
  const a = args as unknown[]
  if (typeof a[0] === 'string') {
    const s = a[0] as string
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null
  }
  const r = Number(a[0])
  const g = Number(a[1])
  const b = Number(a[2])
  if (![r, g, b].every(Number.isFinite)) return null
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

interface GState {
  ctm: Matrix
  tm: Matrix
  lineX: number
  lineY: number
  x: number
  y: number
  font: string | null
  fontSize: number
  charSpacing: number
  wordSpacing: number
  hScale: number
  leading: number
  rise: number
  renderMode: number
  color: string | null
  strokeColor: string | null
  lineWidth: number
}

interface GlyphObj {
  unicode?: string
  fontChar?: string
  width?: number
  isSpace?: boolean
  originalCharCode?: number
}

interface PdfJsFont {
  name?: string
  loadedName?: string
  ascent?: number
  descent?: number
  bold?: boolean
  black?: boolean
  italic?: boolean
  composite?: boolean
  isType3Font?: boolean
  missingFile?: boolean
  fontMatrix?: number[]
  vertical?: boolean
  bbox?: number[]
}

const modelCache = new WeakMap<PDFPageProxy, Promise<GlyphModel>>()

export function getGlyphModel(page: PDFPageProxy): Promise<GlyphModel> {
  let p = modelCache.get(page)
  if (!p) {
    p = buildModel(page)
    modelCache.set(page, p)
    p.catch(() => modelCache.delete(page))
  }
  return p
}

function fontObject(page: PDFPageProxy, id: string): Promise<PdfJsFont | null> {
  return new Promise((resolve) => {
    try {
      const objs = page.commonObjs as unknown as {
        get: (id: string, cb: (data: unknown) => void) => unknown
      }
      objs.get(id, (data) => resolve((data as PdfJsFont) ?? null))
    } catch {
      resolve(null)
    }
    // never block on a font that fails to arrive
    setTimeout(() => resolve(null), 4000)
  })
}

async function buildModel(page: PDFPageProxy): Promise<GlyphModel> {
  const ol = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE })
  const { fnArray, argsArray } = ol

  // resolve every font referenced by the content first
  const fontIds = new Set<string>()
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.setFont) fontIds.add(String((argsArray[i] as unknown[])[0]))
  }
  const fonts = new Map<string, FontInfo>()
  const vertical = new Set<string>()
  await Promise.all(
    Array.from(fontIds).map(async (id) => {
      const f = await fontObject(page, id)
      if (!f) return
      if (f.vertical) vertical.add(id)
      const fm = Array.isArray(f.fontMatrix) ? f.fontMatrix : [0.001, 0, 0, 0.001, 0, 0]
      const fm3 = fm[3] || 0.001
      // glyph-space y may point down (negative fontMatrix d): flip the bbox
      let bTop = 0
      let bBottom = 0
      if (Array.isArray(f.bbox) && f.bbox.length === 4) {
        const a = f.bbox[1] * fm3
        const b = f.bbox[3] * fm3
        bTop = Math.max(a, b)
        bBottom = Math.min(a, b)
      }
      const asc = typeof f.ascent === 'number' && Number.isFinite(f.ascent) && f.ascent > 0 ? f.ascent : 0
      const desc = typeof f.descent === 'number' && Number.isFinite(f.descent) ? Math.abs(f.descent) : 0
      fonts.set(id, {
        loadedName: f.loadedName ?? id,
        name: f.name ?? '',
        // sane fallbacks when pdf.js has no (or flipped) metrics
        ascent: asc > 0.3 && asc < 1.5 ? asc : bTop > 0.3 && bTop < 1.5 ? bTop : 0.8,
        descent: desc > 0 && desc < 0.6 ? desc : bBottom < 0 && bBottom > -0.6 ? -bBottom : 0.22,
        bboxTop: bTop,
        bboxBottom: bBottom,
        bold: !!(f.bold || f.black),
        italic: !!f.italic,
        composite: !!f.composite,
        type3: !!f.isType3Font,
        missingFile: !!f.missingFile,
        fontMatrix: fm,
      })
    }),
  )

  const glyphs: PageGlyph[] = []
  const images: PageImage[] = []
  const pushImage = (objId: string | null, inline: boolean, w: number, h: number, isMask: boolean) => {
    const m = st.ctm
    const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    images.push({
      index: images.length,
      objId,
      inline,
      matrix: [...m] as PageImage['matrix'],
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      width: w,
      height: h,
      isMask,
      seq: seq++,
    })
  }
  let st: GState = {
    ctm: IDENTITY,
    tm: IDENTITY,
    lineX: 0,
    lineY: 0,
    x: 0,
    y: 0,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
    color: '#000000',
    strokeColor: '#000000',
    lineWidth: 1,
  }
  const stack: GState[] = []
  let seq = 0
  // opaque rectangles painted AFTER glyphs hide them (edits bake a white
  // cover over the replaced text). Track filled axis-aligned rects.
  const covers: { x0: number; y0: number; x1: number; y1: number; seq: number }[] = []
  let pendingRects: { x0: number; y0: number; x1: number; y1: number }[] = []
  const moveText = (x: number, y: number) => {
    st.lineX += x
    st.lineY += y
    st.x = st.lineX
    st.y = st.lineY
  }

  const six = (args: unknown[]): Matrix => {
    const a = (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? args[0] : args) as ArrayLike<unknown>
    return [0, 1, 2, 3, 4, 5].map((i) => Number(a[i])) as Matrix
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = (argsArray[i] ?? []) as unknown[]
    switch (fn) {
      case OPS.constructPath: {
        const subOps = (args[0] ?? []) as number[]
        const coords = (args[1] ?? []) as number[]
        let ci = 0
        let onlyRects = subOps.length > 0
        // axis-aligned polygon built from moveTo/lineTo (pdf-lib's drawRectangle)
        let poly: [number, number][] = []
        const flushPoly = () => {
          if (poly.length >= 4) {
            const xs = poly.map((p) => p[0])
            const ys = poly.map((p) => p[1])
            const x0 = Math.min(...xs)
            const x1 = Math.max(...xs)
            const y0 = Math.min(...ys)
            const y1 = Math.max(...ys)
            const onEdge = poly.every(
              ([px, py]) =>
                (Math.abs(px - x0) < 1e-3 || Math.abs(px - x1) < 1e-3) &&
                (Math.abs(py - y0) < 1e-3 || Math.abs(py - y1) < 1e-3),
            )
            if (onEdge) pendingRects.push({ x0, y0, x1, y1 })
            else onlyRects = false
          } else if (poly.length > 0) {
            onlyRects = false
          }
          poly = []
        }
        for (const so of subOps) {
          if (so === OPS.rectangle) {
            const [rx, ry, rw, rh] = [coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]]
            ci += 4
            const a = apply(st.ctm, rx, ry)
            const b2 = apply(st.ctm, rx + rw, ry + rh)
            if (Math.abs(st.ctm[1]) < 1e-9 && Math.abs(st.ctm[2]) < 1e-9) {
              pendingRects.push({
                x0: Math.min(a[0], b2[0]),
                y0: Math.min(a[1], b2[1]),
                x1: Math.max(a[0], b2[0]),
                y1: Math.max(a[1], b2[1]),
              })
            }
          } else if (
            (so === OPS.moveTo || so === OPS.lineTo) &&
            Math.abs(st.ctm[1]) < 1e-9 &&
            Math.abs(st.ctm[2]) < 1e-9
          ) {
            if (so === OPS.moveTo) flushPoly()
            poly.push(apply(st.ctm, coords[ci], coords[ci + 1]))
            ci += 2
          } else if (so === OPS.closePath) {
            flushPoly()
          } else {
            onlyRects = false
            ci +=
              so === OPS.moveTo || so === OPS.lineTo
                ? 2
                : so === OPS.curveTo
                  ? 6
                  : so === OPS.curveTo2 || so === OPS.curveTo3
                    ? 4
                    : 0
          }
        }
        flushPoly()
        if (!onlyRects) pendingRects = []
        break
      }
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        // only opaque white fills hide text reliably (that is what edits write)
        if (st.color === '#ffffff') for (const r of pendingRects) covers.push({ ...r, seq: seq++ })
        pendingRects = []
        break
      case OPS.endPath:
      case OPS.stroke:
      case OPS.closeStroke:
        pendingRects = []
        break
      case OPS.save:
        stack.push(st)
        st = { ...st }
        break
      case OPS.restore:
        if (stack.length) st = stack.pop()!
        break
      case OPS.transform:
        st.ctm = mul(st.ctm, six(args))
        break
      case OPS.paintFormXObjectBegin: {
        stack.push(st)
        st = { ...st }
        const m = args[0] as number[] | null
        if (m && m.length === 6) st.ctm = mul(st.ctm, six([m]))
        break
      }
      case OPS.paintFormXObjectEnd:
        if (stack.length) st = stack.pop()!
        break
      case OPS.beginGroup: {
        // the group's matrix is the form's /Matrix, which pdf.js applies again
        // in the paintFormXObjectBegin that follows: don't double it
        stack.push(st)
        st = { ...st }
        break
      }
      case OPS.paintImageXObject: {
        // args: [objId, width, height]
        pushImage(String(args[0]), false, Number(args[1]) || 0, Number(args[2]) || 0, false)
        break
      }
      case OPS.paintInlineImageXObject: {
        const d = args[0] as { width?: number; height?: number } | undefined
        pushImage(null, true, Number(d?.width) || 0, Number(d?.height) || 0, false)
        break
      }
      case OPS.paintImageMaskXObject: {
        const d = args[0] as { width?: number; height?: number; data?: unknown } | undefined
        // inline masks carry data; XObject masks too (pdf.js inlines them)
        pushImage(null, true, Number(d?.width) || 0, Number(d?.height) || 0, true)
        break
      }
      case OPS.endGroup:
        if (stack.length) st = stack.pop()!
        break
      case OPS.beginText:
        st.tm = IDENTITY
        st.x = st.lineX = 0
        st.y = st.lineY = 0
        break
      case OPS.setTextMatrix:
        st.tm = six(args)
        st.x = st.lineX = 0
        st.y = st.lineY = 0
        break
      case OPS.moveText:
        moveText(Number(args[0]), Number(args[1]))
        break
      case OPS.setLeadingMoveText:
        st.leading = Number(args[1])
        moveText(Number(args[0]), Number(args[1]))
        break
      case OPS.setLeading:
        st.leading = -Number(args[0])
        break
      case OPS.nextLine:
        moveText(0, st.leading)
        break
      case OPS.setFont:
        st.font = String(args[0])
        st.fontSize = Number(args[1])
        break
      case OPS.setCharSpacing:
        st.charSpacing = Number(args[0])
        break
      case OPS.setWordSpacing:
        st.wordSpacing = Number(args[0])
        break
      case OPS.setHScale:
        st.hScale = Number(args[0]) / 100
        break
      case OPS.setTextRise:
        st.rise = Number(args[0])
        break
      case OPS.setTextRenderingMode:
        st.renderMode = Number(args[0])
        break
      case OPS.setFillRGBColor:
        st.color = colorArg(args)
        break
      case OPS.setStrokeRGBColor:
        st.strokeColor = colorArg(args)
        break
      case OPS.setLineWidth:
        st.lineWidth = Number(args[0])
        break
      case OPS.setFillColorN:
        st.color = null
        break
      case OPS.setStrokeColorN:
        st.strokeColor = null
        break
      case OPS.setFillTransparent:
        st.color = null
        st.renderMode = 3
        break
      case OPS.setGState: {
        // ExtGState may carry LW / Font entries
        const entries = (args[0] ?? []) as [string, unknown][]
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (!Array.isArray(e)) continue
            if (e[0] === 'LW') st.lineWidth = Number(e[1])
            if (e[0] === 'Font' && Array.isArray(e[1])) {
              st.font = String(e[1][0])
              st.fontSize = Number(e[1][1])
            }
          }
        }
        break
      }
      case OPS.showText: {
        const font = st.font ? fonts.get(st.font) : undefined
        if (!font || !st.font) break
        const items = (args[0] ?? []) as (GlyphObj | number | null)[]
        const dir = st.fontSize < 0 ? -1 : 1
        const fontSize = Math.abs(st.fontSize)
        const was = fontSize * (font.fontMatrix[0] || 0.001)
        const m = mul(st.ctm, st.tm)
        const ySize = Math.hypot(m[2], m[3])
        const xScale = Math.hypot(m[0], m[1])
        const upright =
          !vertical.has(st.font) &&
          Math.abs(m[1]) < 1e-6 * xScale &&
          Math.abs(m[2]) < 1e-6 * ySize &&
          m[0] > 0 &&
          m[3] > 0
        const ctmScale = Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])) || 1
        const mode = st.renderMode
        const fillColor = (mode & 3) === 1 ? st.strokeColor : st.color
        let x = 0
        for (const g of items) {
          if (typeof g === 'number') {
            x -= (g * fontSize) / 1000
            continue
          }
          if (!g) continue
          const width = Number(g.width ?? 0)
          const spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing
          const charWidth = width * was + spacing * dir
          if (upright) {
            const [ox, oy] = apply(m, st.x + x * st.hScale, st.y + st.rise)
            const [ex] = apply(m, st.x + (x + charWidth) * st.hScale, st.y + st.rise)
            const [wx] = apply(m, st.x + (x + width * was) * st.hScale, st.y + st.rise)
            const raw = g.unicode ?? ''
            glyphs.push({
              text: raw ? normalizeUnicode(raw) : '\ufffd',
              x: ox,
              y: oy,
              adv: ex - ox,
              w: wx - ox,
              size: fontSize * ySize,
              hScale: (st.hScale * xScale) / ySize,
              font: st.font,
              code: Number(g.originalCharCode ?? 0),
              fontChar: g.fontChar ?? '',
              isSpace: !!g.isSpace || /^\s+$/.test(raw),
              color: fillColor,
              renderMode: mode,
              strokeWidth: st.lineWidth * ctmScale,
              strokeColor: st.strokeColor,
              invisible: (mode & 3) === 3,
              seq: seq++,
            })
          } else {
            seq++
          }
          x += charWidth
        }
        st.x += x * st.hScale
        break
      }
      default:
        break
    }
  }
  if (covers.length) {
    for (const g of glyphs) {
      if (g.invisible) continue
      const cx = g.x + Math.max(g.w, 0) / 2
      const cy = g.y + g.size * 0.3
      for (const c of covers) {
        if (c.seq > g.seq && cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) {
          g.invisible = true
          break
        }
      }
    }
  }
  return { glyphs, fonts, images }
}
