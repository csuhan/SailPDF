/**
 * Turn reconstructed line runs (css px space) into TextEditRuns whose text is
 * laid out glyph-by-glyph with the ORIGINAL embedded font where possible.
 */
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { encoderFor, type LineRunData } from '../fontMatch'
import { effectiveSpaceEm, type FontEncoder } from './fontEncoder'
import type { StandardFontName, TextEditPiece, TextEditRun } from './ops'
import type { TextPositioner } from './textRuns'

interface FontMetrics {
  enc: FontEncoder
  sizeCss: number
  spaceEm: number
  fallbackEm: (t: string) => number
  /** horizontal scaling of the original text */
  k: number
}

let scratch: CanvasRenderingContext2D | null = null
function measureCss(cssFont: string, text: string): number {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d')!
  scratch.font = cssFont
  return scratch.measureText(text).width
}

function sizeOf(cssFont: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(cssFont)
  return m ? parseFloat(m[1]) : 12
}

export interface RunLayoutContext {
  positioner: TextPositioner
  metricsFor: (run: LineRunData) => FontMetrics | null
}

/**
 * A positioner that measures runs with the original font's real advance
 * widths (and the line's effective word spacing) instead of a browser font.
 */
export function createRunLayoutContext(page: PDFPageProxy | null, runs: LineRunData[]): RunLayoutContext {
  const byCss = new Map<string, FontMetrics | null>()
  const metricsFor = (run: LineRunData): FontMetrics | null => {
    if (!page || !run.pdfFont) return null
    if (byCss.has(run.cssFont)) return byCss.get(run.cssFont)!
    const enc = encoderFor(page, run.pdfFont.loadedName)
    let m: FontMetrics | null = null
    if (enc) {
      const sizeCss = sizeOf(run.cssFont)
      const k = run.hScale && run.hScale > 0 ? run.hScale : 1
      const fallbackEm = (t: string) => measureCss(run.fallbackCssFont, t) / sizeCss
      // word spacing: learn it from the longest run of this font on the line
      const sample = runs
        .filter((r) => r.cssFont === run.cssFont && /\S\s+\S/.test(r.text))
        .sort((a, b) => b.text.length - a.text.length)[0]
      const spaceEm = sample
        ? effectiveSpaceEm(enc, sample.text, sample.width / (sizeCss * k), fallbackEm)
        : enc.spaceGlyphEm && enc.spaceGlyphEm > 0.05
          ? enc.spaceGlyphEm
          : 0.3
      m = { enc, sizeCss, spaceEm, fallbackEm, k }
    }
    byCss.set(run.cssFont, m)
    return m
  }
  for (const r of runs) metricsFor(r)
  const positioner: TextPositioner = {
    measure: (cssFont, text) => {
      const m = byCss.get(cssFont)
      if (m) return m.enc.layout(text, m.spaceEm, m.fallbackEm).width * m.sizeCss * m.k
      return measureCss(cssFont, text)
    },
  }
  return { positioner, metricsFor }
}

export function standardNameForFallback(
  fallback: 'serif' | 'sans-serif' | 'monospace',
  bold: boolean,
  italic: boolean,
): StandardFontName {
  if (fallback === 'monospace') return bold ? 'Courier-Bold' : 'Courier'
  if (fallback === 'serif') {
    if (bold && italic) return 'Times-BoldItalic'
    if (bold) return 'Times-Bold'
    if (italic) return 'Times-Italic'
    return 'Times-Roman'
  }
  if (bold && italic) return 'Helvetica-BoldOblique'
  if (bold) return 'Helvetica-Bold'
  if (italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

/** convert a reconstructed run (css px) into a bake-ready TextEditRun (pdf pt) */
export function toEditRun(
  ctx: RunLayoutContext,
  run: LineRunData,
  viewport: PageViewport,
  baselineCss: number,
  defaultSizePt: number,
): TextEditRun {
  const [px] = viewport.convertToPdfPoint(run.x, baselineCss)
  const fontSize = run.fontSizePt ?? defaultSizePt
  const hScale = run.hScale && Math.abs(run.hScale - 1) > 0.01 ? run.hScale : undefined
  const out: TextEditRun = {
    text: run.text,
    x: px,
    fontSize,
    color: run.color,
    baseFamily: run.baseFamily || undefined,
    bold: run.bold,
    italic: run.italic,
    fontFallback: run.fontFallback,
    fontName: standardNameForFallback(run.fontFallback, run.bold, run.italic),
    hScale,
  }
  const m = ctx.metricsFor(run)
  if (m && run.pdfFont) {
    const k = hScale ?? 1
    // word spacing that reproduces this run's known width (verbatim runs keep
    // their original justification; measured runs map back to the line's)
    const spaceEm =
      /\S\s+\S/.test(run.text) && run.width > 0
        ? effectiveSpaceEm(m.enc, run.text, run.width / (m.sizeCss * k), m.fallbackEm)
        : m.spaceEm
    const laid = m.enc.layout(run.text, spaceEm, m.fallbackEm)
    const pieces: TextEditPiece[] = laid.pieces.map((p) =>
      p.kind === 'glyphs'
        ? { text: p.text, x: px + p.x * fontSize * k, hex: p.hex, pua: p.pua }
        : { text: p.text, x: px + p.x * fontSize * k },
    )
    out.pdfFont = { ...run.pdfFont }
    out.pieces = pieces
  }
  return out
}
