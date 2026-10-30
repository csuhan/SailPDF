/**
 * Resolve the *original* font of a text-layer span so that replacement text
 * looks like the text it replaces — in the overlay preview AND in the baked PDF.
 */
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { buildFontEncoder, effectiveSpaceEm, type FontEncoder, type PdfJsFontLike } from './edit/fontEncoder'

/** fully styled run of a merged line, ready for run-preserving reconstruction */
export interface LineRunData {
  text: string
  x: number
  width: number
  cssFont: string
  baseFamily: string
  bold: boolean
  italic: boolean
  color: string
  fontFallback: 'serif' | 'sans-serif' | 'monospace'
  fontSizePt: number
  /** the original PDF font, when its embedded program can re-encode text */
  pdfFont?: { loadedName: string; baseFont: string }
  /** css font of the fallback face (for characters the subset lacks) */
  fallbackCssFont: string
  /** horizontal text scaling of the original (Tz / non-uniform matrix), 1 = none */
  hScale?: number
}

export interface LineRuns {
  runs: LineRunData[]
  /** index of the run containing the clicked span */
  anchorRunIdx: number
  /** assembled line text (gap-insert rule) */
  text: string
  rect: { x: number; y: number; width: number; height: number }
  baselineCss: number
  /** the gap threshold used when assembling; reconstruction must reuse it */
  gapCss: number
  /** exact baseline (css px) taken from the anchor's PDF text matrix, when known */
  exactBaselineCss?: number
}

/**
 * Merge a clicked span's visual line and resolve PER-FRAGMENT fonts/colors —
 * the basis for style-preserving editing of mixed-style lines.
 */
export async function findLineRuns(
  page: PDFPageProxy,
  viewport: PageViewport,
  textLayerHost: HTMLElement,
  pageCanvas: HTMLCanvasElement | null,
  clicked: HTMLElement,
): Promise<LineRuns | null> {
  const m = mergeLinePieces(textLayerHost, clicked)
  if (!m) return null
  let exactBaselineCss: number | undefined
  // vertical ink extents (css px above/below the baseline) from real font metrics
  let inkAbove = 0
  let inkBelow = 0
  const rawRuns: LineRunData[] = await Promise.all(
    m.pieces.map(async (p) => {
      const el = p.el
      const text = el.textContent ?? ''
      const cs = getComputedStyle(el)
      let fontSizeCss = parseFloat(cs.fontSize) || 12
      let fontSizePt = fontSizeCss / viewport.scale
      let hScale: number | undefined
      let baseFamily = ''
      let bold = /bold|[6-9]00/.test(cs.fontWeight)
      let italic = cs.fontStyle === 'italic'
      let fontFallback: LineRunData['fontFallback'] = /serif/i.test(cs.fontFamily)
        ? 'serif'
        : /mono/i.test(cs.fontFamily)
          ? 'monospace'
          : 'sans-serif'
      let familyList: string = fontFallback
      let pdfFont: LineRunData['pdfFont']
      if ((el.textContent ?? '').trim().length > 0) {
        try {
          const resolved = await resolveSpanFont(page, viewport, el, fontSizePt)
          const t = resolved.item?.transform
          if (t) {
            // exact size/scaling/baseline from the PDF text matrix
            const h = Math.hypot(t[2], t[3])
            if (h > 0) {
              fontSizePt = h
              fontSizeCss = h * viewport.scale
              const hs = Math.hypot(t[0], t[1]) / h
              if (Math.abs(hs - 1) > 0.01) hScale = hs
            }
            if (el === clicked && viewport.rotation % 360 === 0 && Math.abs(t[1]) < 1e-3 && Math.abs(t[2]) < 1e-3) {
              exactBaselineCss = viewport.convertToViewportPoint(t[4], t[5])[1]
            }
          }
          if (resolved.vMetrics) {
            inkAbove = Math.max(inkAbove, Math.min(1.05, resolved.vMetrics.ascent) * fontSizeCss)
            inkBelow = Math.max(inkBelow, Math.min(0.32, resolved.vMetrics.descent) * fontSizeCss)
          }
          baseFamily = resolved.family
          familyList = resolved.familyList
          bold = resolved.bold
          italic = resolved.italic
          fontFallback = resolved.generic
          if (resolved.encoder) {
            pdfFont = { loadedName: resolved.encoder.loadedName, baseFont: resolved.encoder.baseFont }
          }
        } catch {
          /* keep heuristics */
        }
      }
      const rectCss = {
        x: p.left - (textLayerHost.getBoundingClientRect().left ?? 0),
        y: p.top - (textLayerHost.getBoundingClientRect().top ?? 0),
        width: p.right - p.left,
        height: p.bottom - p.top,
      }
      let color = '#000000'
      if (pageCanvas && text.trim()) {
        color = sampleInkColor(pageCanvas, rectCss)
      }
      const style = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`
      const fallbackCssFont = `${style}${fontSizeCss}px ${familyList}`
      // the face pdf.js loaded from the embedded program renders the exact
      // original glyphs; it is unstyled, so no bold/italic synthesis on it
      const cssFont = pdfFont ? `${fontSizeCss}px "${pdfFont.loadedName}", ${familyList}` : fallbackCssFont
      return {
        text,
        x: rectCss.x,
        width: rectCss.width,
        cssFont,
        fallbackCssFont,
        baseFamily,
        bold,
        italic,
        color,
        fontFallback,
        fontSizePt,
        pdfFont,
        hScale,
      }
    }),
  )
  // pdf.js merges differently colored glyphs into one span (e.g. a pink link
  // inside a black line); split spans into same-colored sub-runs by sampling
  // the ink under each glyph, using the font's real advance widths
  const runs: LineRunData[] = []
  let anchorRunIdx = 0
  rawRuns.forEach((run, i) => {
    const parts = pageCanvas ? splitRunByColor(page, run, pageCanvas, m.rect.y, m.rect.height) : [run]
    if (i === m.anchorIndex) {
      // the edited text takes the clicked span's dominant style
      let best = 0
      parts.forEach((p, j) => {
        if (p.text.trim().length > parts[best].text.trim().length) best = j
      })
      anchorRunIdx = runs.length + best
    }
    runs.push(...parts)
  })
  // the text-layer boxes are approximations; grow the line box to the real
  // glyph extents so the white-out fully covers the original ink
  let rect = m.rect
  if (exactBaselineCss !== undefined && (inkAbove > 0 || inkBelow > 0)) {
    const top = Math.min(rect.y, exactBaselineCss - inkAbove)
    const bottom = Math.max(rect.y + rect.height, exactBaselineCss + inkBelow)
    rect = { ...rect, y: top, height: bottom - top }
  }
  return {
    runs,
    anchorRunIdx,
    text: m.text,
    rect,
    baselineCss: m.baselineCss,
    gapCss: m.gapCss,
    exactBaselineCss,
  }
}

function hexRgb(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function colorDistance(a: string, b: string): number {
  const x = hexRgb(a)
  const y = hexRgb(b)
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])
}

function splitRunByColor(
  page: PDFPageProxy,
  run: LineRunData,
  pageCanvas: HTMLCanvasElement,
  lineTop: number,
  lineHeight: number,
): LineRunData[] {
  const chars = Array.from(run.text)
  if (!run.pdfFont || chars.length < 2 || run.width <= 0) return [run]
  const enc = encoderFor(page, run.pdfFont.loadedName)
  if (!enc) return [run]
  const sizeCss = parseFloat(/(\d+(?:\.\d+)?)px/.exec(run.cssFont)?.[1] ?? '0') || 12
  const k = run.hScale ?? 1
  const ctx = document.createElement('canvas').getContext('2d')!
  const fallbackEm = (t: string) => {
    ctx.font = run.fallbackCssFont
    return ctx.measureText(t).width / sizeCss
  }
  const spaceEm = effectiveSpaceEm(enc, run.text, run.width / (sizeCss * k), fallbackEm)
  const total = enc.layout(run.text, spaceEm, fallbackEm).width
  if (!(total > 0)) return [run]
  // map em positions onto the span's measured width (absorbs rounding/kerning)
  const pxPerEm = run.width / total
  const xs: number[] = [0]
  for (let i = 1; i <= chars.length; i++) {
    xs.push(enc.layout(chars.slice(0, i).join(''), spaceEm, fallbackEm).width)
  }
  const colors = chars.map((ch, i) => {
    if (!ch.trim()) return null
    const x0 = run.x + xs[i] * pxPerEm
    const w = (xs[i + 1] - xs[i]) * pxPerEm
    if (w < 1) return null
    return sampleInkColor(pageCanvas, { x: x0 + w * 0.1, y: lineTop, width: w * 0.8, height: lineHeight })
  })
  // group consecutive glyphs of similar color; spaces join the current group
  const groups: { start: number; end: number; color: string }[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = colors[i]
    const g = groups[groups.length - 1]
    if (!g) {
      groups.push({ start: i, end: i + 1, color: c ?? run.color })
    } else if (c === null || colorDistance(c, g.color) < 60) {
      g.end = i + 1
    } else {
      groups.push({ start: i, end: i + 1, color: c })
    }
  }
  if (groups.length < 2) return [run]
  return groups.map((g) => {
    const x0 = xs[g.start] * pxPerEm
    const x1 = xs[g.end] * pxPerEm
    return {
      ...run,
      text: chars.slice(g.start, g.end).join(''),
      x: run.x + x0,
      width: x1 - x0,
      color: g.color,
    }
  })
}

export interface LineBlock {
  /** the merged plain text of the visual line */
  text: string
  /** css-px rect (relative to the textLayer host) covering the whole line */
  rect: { x: number; y: number; width: number; height: number }
  /** css-px baseline y (relative to the textLayer host) */
  baselineCss: number
  /** the span that was clicked (used for font resolution) */
  anchor: HTMLElement
}

/**
 * Merge all spans in a text layer that sit on the same visual baseline as the
 * clicked span into one editable line (Acrobat-style content detection).
 * Adjacent fragments with different fonts/colors/links are joined; the result
 * covers the full line and never more than neighboring lines.
 */
export function findLineBlock(textLayerHost: HTMLElement, clicked: HTMLElement): LineBlock {
  const m = mergeLinePieces(textLayerHost, clicked)
  if (!m) {
    const r = clicked.getBoundingClientRect()
    const hostRect = textLayerHost.getBoundingClientRect()
    return {
      text: clicked.textContent ?? '',
      rect: { x: r.left - hostRect.left, y: r.top - hostRect.top, width: r.width, height: r.height },
      baselineCss: r.bottom - hostRect.top,
      anchor: clicked,
    }
  }
  return { text: m.text, rect: m.rect, baselineCss: m.baselineCss, anchor: clicked }
}

// ── run-level structures (shared with edit reconstruction) ──────

interface MergedPiece {
  el: HTMLElement
  left: number
  top: number
  right: number
  bottom: number
}

interface MergeResult {
  pieces: MergedPiece[]
  text: string
  rect: { x: number; y: number; width: number; height: number }
  baselineCss: number
  gapCss: number
  anchorIndex: number
}

function mergeLinePieces(textLayerHost: HTMLElement, clicked: HTMLElement): MergeResult | null {
  const hostRect = textLayerHost.getBoundingClientRect()
  const cRect = clicked.getBoundingClientRect()
  const cHeight = Math.max(1, cRect.height)
  const cMid = cRect.top + cHeight / 2
  const tol = Math.max(2, cHeight * 0.45)

  const spans = Array.from(textLayerHost.querySelectorAll('span')).filter((s) => (s.textContent ?? '').length > 0)
  const row: MergedPiece[] = []
  for (const el of spans) {
    if (el === clicked) continue
    const r = el.getBoundingClientRect()
    if (r.height < 0.5 || r.width < 0.1) continue
    const mid = r.top + r.height / 2
    if (Math.abs(mid - cMid) > tol) continue
    if (Math.abs(r.height - cHeight) > cHeight * 0.9) continue
    row.push({ el, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  const pieces: MergedPiece[] = [
    { el: clicked, left: cRect.left, top: cRect.top, right: cRect.right, bottom: cRect.bottom },
    ...row,
  ]
  pieces.sort((a, b) => a.left - b.left)
  const gap = Math.max(6, cHeight * 0.6)
  const ci = pieces.findIndex((p) => p.el === clicked)
  let lo = ci
  let hi = ci
  while (lo > 0 && pieces[lo - 1].right >= pieces[lo].left - gap) lo--
  while (hi < pieces.length - 1 && pieces[hi + 1].left <= pieces[hi].right + gap) hi++
  const merged = pieces.slice(lo, hi + 1)

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let text = ''
  for (let i = 0; i < merged.length; i++) {
    const p = merged[i]
    left = Math.min(left, p.left)
    top = Math.min(top, p.top)
    right = Math.max(right, p.right)
    bottom = Math.max(bottom, p.bottom)
    if (i > 0) {
      const prevRight = merged[i - 1].right
      if (p.left - prevRight > gap * 0.4) text += ' '
    }
    text += p.el.textContent ?? ''
  }
  return {
    pieces: merged,
    text,
    rect: {
      x: left - hostRect.left,
      y: top - hostRect.top,
      width: right - left,
      height: bottom - top,
    },
    baselineCss: cRect.bottom - hostRect.top,
    gapCss: gap,
    anchorIndex: merged.findIndex((p) => p.el === clicked),
  }
}

export interface ResolvedFont {
  /** css font shorthand usable in canvas/DOM, e.g. `bold 13px "Georgia", serif` */
  cssShorthand: string
  /** css font-family list, e.g. `"Georgia", serif` */
  familyList: string
  /** the text content item the span came from */
  item: TextItemLike | null
  /** cleaned base name from the PDF, e.g. "Georgia-Bold" */
  baseName: string
  /** family name, e.g. "Georgia" */
  family: string
  bold: boolean
  italic: boolean
  /** pdf.js internal font id (g_d0_fX) */
  pdfJsFontName: string | null
  /** generic css family that best matches the original */
  generic: 'serif' | 'sans-serif' | 'monospace'
  /** re-encoder for the original embedded font (null if unusable) */
  encoder: FontEncoder | null
  /** font ascent/descent in em (positive values), when pdf.js knows them */
  vMetrics: { ascent: number; descent: number } | null
  /** css px ascent above baseline for typical latin text at 1px font-size */
  ascentRatio: number
  /** css px descent below baseline at 1px font-size */
  descentRatio: number
}

const STYLE_PARTS = new Set([
  'bold',
  'italic',
  'oblique',
  'regular',
  'roman',
  'light',
  'medium',
  'semibold',
  'demibold',
  'black',
  'heavy',
  'thin',
  'ultralight',
  'bolditalic',
  'boldoblique',
  'extra',
  'condensed',
  'narrow',
  'plain',
  'mt',
  'psmt',
  'ital',
  'it',
  'bd',
  'bdit',
  'roma',
  'medi',
  'regu',
  'reguital',
  'mediital',
  'semibolditalic',
])

/** TeX font naming (CM / EC / SF / LM): CMBX10 = bold extended, CMTI10 = text italic */
function texStyle(name: string): { bold: boolean; italic: boolean; mono: boolean; sans: boolean } | null {
  const m = /^(cm|sf|ec|lm|tc)([a-z]+)(\d{2,4})?$/i.exec(name.replace(/[-\s]/g, ''))
  if (!m) return null
  const code = m[2].toLowerCase()
  return {
    bold: /^(bx|b|ssbx|bxsl|bxti|bi)/.test(code),
    italic: /(ti|sl|mi|it|si)$/.test(code) || /^(ti|sl|mi|bxti|bxsl)/.test(code),
    mono: /^(tt|sltt|itt|tc)/.test(code),
    sans: /^(ss)/.test(code),
  }
}

/** "Georgia-Bold-5824" -> { family:"Georgia", bold:true, italic:false, base:"Georgia-Bold" } */
export function cleanFontName(raw: string): {
  family: string
  bold: boolean
  italic: boolean
  base: string
} {
  // strip subset prefix "ABCDEF+" if present
  let name = raw.replace(/^[A-Z]{6}\+/, '')
  // strip trailing numeric tag: "-5829"
  name = name.replace(/-\d{3,}$/, '')
  const parts = name.split('-').filter(Boolean)
  const familyParts: string[] = []
  const styleParts: string[] = []
  for (const p of parts) {
    if (STYLE_PARTS.has(p.toLowerCase())) styleParts.push(p)
    else familyParts.push(p)
  }
  let family = familyParts.join(' ')
  let style = styleParts.join('-')
  if (!family) {
    family = name
  } else if (!style && parts.length > 1) {
    // "Georgia-Bold" → style Bold captured; "Myriad-Pro" → "Myriad" "Pro"? Pro is not a style part
    style = ''
  }
  const lower = style.toLowerCase()
  let bold = /bold|black|heavy|demi|^bd|-bd|^medi$|mediital/.test(lower)
  let italic = /italic|oblique|ital|^it$|-it$|bdit/.test(lower)
  // style glued to the family: "TimesNewRomanPS-BoldMT", "ArialBold", "NimbusRomNo9L-Medi"
  if (!bold && /(bold|black|heavy|semibold|demi|medi)$/i.test(familyParts.join(''))) bold = true
  if (!italic && /(italic|oblique)$/i.test(familyParts.join(''))) italic = true
  const tex = texStyle(familyParts.join(''))
  if (tex) {
    bold = bold || tex.bold
    italic = italic || tex.italic
  }
  const base = [familyParts.join('-'), ...styleParts].join('-')
  return { family, bold, italic, base: base || family }
}

const SERIF_HINTS =
  /times|georgia|garamond|palatino|palladio|minion|cambria|baskerville|bookman|century|caslon|didot|bodoni|serif|roman|song|ming|kai|fangsong|mincho|batang|nimbusrom|libertin|charter|utopia|^(cm|sf|ec|lm)(r|bx|ti|sl|cc|b|mi|u|csc)\d|lmroman|newtx|stix|txr|pxr/i
const SANS_HINTS =
  /sans|arial|helvetica|verdana|tahoma|calibri|segoe|gothic|hei|yahei|pingfang|myriad|frutiger|futura|avenir|roboto|inter|lato|openSans|source\s?sans|nimbussan|^(cm|sf|lm)ss/i
const MONO_HINTS = /mono|courier|consol|menlo|inconsolata|^(cm|sf|lm|ec)(tt|sltt|itt)|lmmono|code|typewriter/i

function genericFor(
  family: string,
  font: PdfJsFontLike & { fallbackName?: string },
): 'serif' | 'sans-serif' | 'monospace' {
  if (MONO_HINTS.test(family) || font.isMonospace) return 'monospace'
  if (SANS_HINTS.test(family)) return 'sans-serif'
  if (SERIF_HINTS.test(family) || font.isSerifFont) return 'serif'
  const f = (font.fallbackName ?? '').toLowerCase()
  if (f.includes('mono')) return 'monospace'
  if (f === 'serif') return 'serif'
  return 'sans-serif'
}

interface TextItemLike {
  str: string
  transform: number[]
  fontName: string
  width?: number
  height?: number
}

type TextContentResult = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
const textContentCache = new WeakMap<PDFPageProxy, Promise<TextContentResult>>()

function cachedTextContent(page: PDFPageProxy): Promise<TextContentResult> {
  let p = textContentCache.get(page)
  if (!p) {
    p = page.getTextContent()
    textContentCache.set(page, p)
    p.catch(() => textContentCache.delete(page))
  }
  return p
}

/** find the textContent item that produced the given span (text + geometry) */
async function findItemForSpan(
  page: PDFPageProxy,
  viewport: PageViewport,
  span: HTMLElement,
): Promise<TextItemLike | null> {
  const content = await cachedTextContent(page)
  const spanText = span.textContent ?? ''
  const spanRect = span.getBoundingClientRect()
  const hostRect = span.closest('.textLayer')?.getBoundingClientRect()
  if (!hostRect) return null
  const sx = spanRect.left - hostRect.left
  const syBottom = spanRect.bottom - hostRect.top

  let best: TextItemLike | null = null
  let bestScore = Infinity
  for (const raw of content.items as unknown[]) {
    const it = raw as TextItemLike
    if (typeof it.str !== 'string' || !it.str || !it.transform) continue
    const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5])
    let score = Math.abs(vy - syBottom) * 2 + Math.abs(vx - sx)
    // text agreement bonus
    if (spanText && it.str && spanText.startsWith(it.str.slice(0, Math.min(4, it.str.length)))) {
      score *= 0.25
    } else if (!spanText.startsWith(it.str) && !it.str.startsWith(spanText)) {
      score *= 4
    }
    // item should overlap the span horizontally
    const itemWidthCss = (it.width ?? 0) * viewport.scale
    if (itemWidthCss > 0 && (sx + spanRect.width < vx - 2 || vx + itemWidthCss < sx - 2)) {
      score += 100
    }
    if (score < bestScore) {
      bestScore = score
      best = it
    }
  }
  // tolerate imperfect matches up to a few px
  return bestScore < 40 ? best : null
}

interface PDFJsFontObject {
  name?: string
  fallbackName?: string
  loadedName?: string
  mimetype?: string
  data?: Uint8Array | null
  disabled?: boolean
}

/** pdf.js font object by its loaded name (fonts are shared document-wide) */
export function pdfJsFontObject(page: PDFPageProxy, loadedName: string): PdfJsFontLike | null {
  try {
    if (!page.commonObjs.has(loadedName)) return null
    return page.commonObjs.get(loadedName) as PdfJsFontLike
  } catch {
    return null
  }
}

export function encoderFor(page: PDFPageProxy, loadedName: string): FontEncoder | null {
  return buildFontEncoder(pdfJsFontObject(page, loadedName))
}

/** measure ascent/descent ratios with a css font (for correct baseline) */
function measureFont(fontCss: string): { ascentRatio: number; descentRatio: number } {
  const c = document.createElement('canvas').getContext('2d')!
  c.font = fontCss
  const m = c.measureText('MgpyÅq')
  const tm = m as TextMetrics & {
    fontBoundingBoxAscent?: number
    fontBoundingBoxDescent?: number
  }
  if (typeof tm.fontBoundingBoxAscent === 'number' && tm.fontBoundingBoxAscent > 0) {
    return {
      ascentRatio: tm.fontBoundingBoxAscent / 100,
      descentRatio: (tm.fontBoundingBoxDescent ?? 0) / 100,
    }
  }
  return { ascentRatio: 0.78, descentRatio: 0.22 }
}

function vMetricsOf(f: { ascent?: number; descent?: number } | null): ResolvedFont['vMetrics'] {
  const a = f?.ascent
  const d = f?.descent
  if (typeof a !== 'number' || typeof d !== 'number' || !(a > 0)) return null
  return { ascent: a, descent: Math.abs(d) }
}

export async function resolveSpanFont(
  page: PDFPageProxy,
  viewport: PageViewport,
  span: HTMLElement,
  fontSizePt: number,
): Promise<ResolvedFont> {
  const item = await findItemForSpan(page, viewport, span)
  let rawName = ''
  let pdfJsFontName: string | null = null
  let fobj: (PDFJsFontObject & PdfJsFontLike) | null = null
  if (item?.fontName) {
    pdfJsFontName = item.fontName
    try {
      fobj = page.commonObjs.get(item.fontName) as PDFJsFontObject & PdfJsFontLike
      rawName = fobj?.name ?? ''
    } catch {
      /* unresolved */
    }
  }
  const cleaned = rawName ? cleanFontName(rawName) : { family: '', bold: false, italic: false, base: '' }
  const family = cleaned.family || ''
  const generic = genericFor(family, fobj ?? {})
  const familyList = family ? `"${family}", ${generic}` : generic
  const cssShorthand = `${cleaned.italic ? 'italic ' : ''}${cleaned.bold ? 'bold ' : ''}${fontSizePt * viewport.scale}px ${familyList}`
  const { ascentRatio, descentRatio } = measureFont(`100px ${familyList}`)
  return {
    cssShorthand,
    familyList,
    item,
    baseName: cleaned.base || rawName,
    family,
    bold: cleaned.bold,
    italic: cleaned.italic,
    pdfJsFontName,
    generic,
    encoder: buildFontEncoder(fobj),
    vMetrics: vMetricsOf(fobj),
    ascentRatio,
    descentRatio,
  }
}

/** estimate the ink color of the original text by sampling the page canvas */
export function sampleInkColor(
  pageCanvas: HTMLCanvasElement,
  spanCssRect: { x: number; y: number; width: number; height: number },
): string {
  try {
    const ctx = pageCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return '#000000'
    const scaleX = pageCanvas.width / pageCanvas.clientWidth
    const scaleY = pageCanvas.height / pageCanvas.clientHeight
    const x0 = Math.max(0, Math.floor(spanCssRect.x * scaleX))
    const y0 = Math.max(0, Math.floor(spanCssRect.y * scaleY))
    const x1 = Math.min(pageCanvas.width, Math.ceil((spanCssRect.x + spanCssRect.width) * scaleX))
    const y1 = Math.min(pageCanvas.height, Math.ceil((spanCssRect.y + spanCssRect.height) * scaleY))
    if (x1 - x0 < 2 || y1 - y0 < 2) return '#000000'
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    // aggregate the darkest 15% of pixels (text ink) by luminance
    const pixels: { l: number; r: number; g: number; b: number }[] = []
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i]
      const g = img[i + 1]
      const b = img[i + 2]
      const a = img[i + 3]
      if (a < 40) continue
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      pixels.push({ l, r, g, b })
    }
    if (pixels.length === 0) return '#000000'
    pixels.sort((a, b) => a.l - b.l)
    // background luminance (the brightest pixels) vs the darkest core pixel
    const bg = pixels[Math.floor(pixels.length * 0.9)]?.l ?? 255
    const darkest = pixels[0].l
    if (bg - darkest < 24) return '#000000' // no visible ink sampled
    // fully covered stroke pixels sit within a small band of the darkest
    // value; anything lighter is antialiasing blended with the background
    const band = Math.max(6, (bg - darkest) * 0.08)
    let ink = pixels.filter((p) => p.l <= darkest + band)
    if (ink.length < 3) ink = pixels.slice(0, 3)
    let r = 0
    let g = 0
    let b = 0
    for (const p of ink) {
      r += p.r
      g += p.g
      b += p.b
    }
    r = Math.round(r / ink.length)
    g = Math.round(g / ink.length)
    b = Math.round(b / ink.length)
    const hex = (v: number) => v.toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch {
    return '#000000'
  }
}
