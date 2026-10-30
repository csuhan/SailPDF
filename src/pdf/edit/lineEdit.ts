/**
 * Glue between the glyph/line model and EditOps: measures text with the
 * original fonts, turns an edit plan into bake-ready TextEditRuns and
 * supports re-editing an already edited line.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import { cleanFontName, encoderFor } from '../fontMatch'
import type { FontEncoder } from './fontEncoder'
import { getGlyphModel, type GlyphModel } from './glyphModel'
import { findLine, planEdit, type CharStyle, type EditableLine, type PlannedRun, type StyleMetrics } from './lineModel'
import type { EditOp, TextEditOp, TextEditPiece, TextEditRun } from './ops'
import { standardNameForFallback } from './runLayout'

export interface LineEditContext {
  page: PDFPageProxy
  model: GlyphModel
  line: EditableLine
  /** op this line already carries (re-edit), if any */
  previous: TextEditOp | null
  /** text to show in the editor (current state of the line) */
  currentText: string
}

/** a styled piece of the editor content (visual only; commit uses plain text) */
export interface EditorSegment {
  text: string
  color: string
  bold: boolean
  italic: boolean
  /** css font-family list */
  family: string
  /** font size in pdf points */
  size: number
  /** horizontal scale of the glyphs (Tz / squeezed text), 1 = none */
  hScale?: number
  /**
   * target pdf x of each character (absolute), when known. The editor uses
   * it to place characters exactly where the page draws them, so opening a
   * line never shifts the text (justified word gaps, tracking, kerning).
   */
  xs?: (number | null)[]
}

/**
 * Styled segments of the line as it currently reads (original, or the last
 * edit of it), so the inline editor shows bold/colors/links in place.
 */
export function editorSegments(ctx: LineEditContext): EditorSegment[] {
  const { line, page, model, previous } = ctx
  const metrics = createMetrics(page, model, line)
  const seg = (text: string, style: CharStyle): EditorSegment => {
    const f = metrics.font(style.font)
    // pdf.js' face for the embedded program renders the exact glyphs (it maps
    // unicode for every glyph in the subset); it is already bold/italic, so
    // no synthesis on it. Type3 fonts have no face: use the matched family.
    const face = f.enc && !f.enc.type3 ? f.enc.loadedName : null
    const named = f.family ? `"${f.family}", ${f.generic}` : f.generic
    return {
      text,
      color: style.color,
      bold: face ? false : f.bold,
      italic: face ? false : f.italic,
      family: face ? `"${face}", ${named}` : named,
      size: style.size,
    }
  }
  const out: EditorSegment[] = []
  const push = (text: string, style: CharStyle, x: number | null) => {
    const s = seg(text, style)
    const hs = style.hScale && Math.abs(style.hScale - 1) > 0.005 ? style.hScale : undefined
    const last = out[out.length - 1]
    if (
      last &&
      last.color === s.color &&
      last.bold === s.bold &&
      last.italic === s.italic &&
      last.family === s.family &&
      Math.abs(last.size - s.size) < 0.01 &&
      Math.abs((last.hScale ?? 1) - (hs ?? 1)) < 0.005
    ) {
      last.text += text
      last.xs!.push(...Array.from(text).map((_, i) => (i === 0 ? x : null)))
    } else {
      out.push({ ...s, hScale: hs, xs: Array.from(text).map((_, i) => (i === 0 ? x : null)) })
    }
  }
  if (!previous) {
    for (const c of line.chars) push(c.ch, c.style, c.x)
    return out
  }
  const plan = planEdit(line, previous.newText, metrics)
  if (!plan || plan.runs.length === 0) {
    for (const c of line.chars) push(c.ch, c.style, c.x)
    return out
  }
  // untouched prefix (left of the redrawn part), then the planned runs
  for (const c of line.chars) {
    if (c.x >= plan.coverFromX - 1e-3) break
    push(c.ch, c.style, c.x)
  }
  for (const r of plan.runs) {
    // exact x per char for runs drawn from original glyphs, else run start
    if (r.original && r.glyphs && r.glyphs.length) {
      const shift = r.x - r.glyphs[0].x
      const sq = r.glyphs[0].hScale > 0 ? r.style.hScale / r.glyphs[0].hScale : 1
      let gi = 0
      for (const ch of Array.from(r.text)) {
        if (/\s/.test(ch)) {
          push(ch, r.style, null)
          continue
        }
        const g = r.glyphs[gi++]
        push(ch, r.style, g ? r.x + (g.x - r.glyphs[0].x) * sq : null)
        void shift
      }
    } else {
      Array.from(r.text).forEach((ch, i) => push(ch, r.style, i === 0 ? r.x : null))
    }
  }
  // sanity: fall back to one plain segment if texts drifted apart
  if (out.map((s) => s.text).join('') !== previous.newText) {
    const first = line.chars.find((c) => c.glyph)?.style ?? line.chars[0].style
    return [{ ...seg(previous.newText, first), xs: undefined }]
  }
  return out
}

type Generic = 'serif' | 'sans-serif' | 'monospace'

interface ResolvedStyleFont {
  enc: FontEncoder | null
  family: string
  bold: boolean
  italic: boolean
  generic: Generic
  /** css font for fallback measuring at 1px */
  css1: string
}

const SERIF =
  /times|georgia|garamond|palatino|palladio|minion|cambria|baskerville|bookman|century|caslon|didot|bodoni|serif|roman|song|ming|kai|mincho|nimbusrom|libertin|charter|utopia|^(cm|sf|ec|lm)(r|bx|ti|sl|cc|b|mi|u|csc)\d|lmroman|newtx|stix|txr|pxr/i
const MONO = /mono|courier|consol|menlo|inconsolata|^(cm|sf|lm|ec)(tt|sltt|itt)|lmmono|typewriter/i

function resolveFont(page: PDFPageProxy, model: GlyphModel, fontId: string): ResolvedStyleFont {
  const info = model.fonts.get(fontId)
  const cleaned = cleanFontName(info?.name ?? '')
  const fam = cleaned.family
  const generic: Generic = MONO.test(fam) ? 'monospace' : SERIF.test(fam) ? 'serif' : 'sans-serif'
  const bold = cleaned.bold || !!info?.bold
  const italic = cleaned.italic || !!info?.italic
  const familyList = fam ? `"${fam}", ${generic}` : generic
  return {
    enc: encoderFor(page, fontId),
    family: fam,
    bold,
    italic,
    generic,
    css1: `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${familyList}`,
  }
}

let scratch: CanvasRenderingContext2D | null = null
function cssWidth100(css: string, text: string): number {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d')!
  scratch.font = css
  return scratch.measureText(text).width / 100
}

/** word-space width that the original line actually uses for this style */
function learnedSpace(line: EditableLine, style: CharStyle): number | null {
  const gaps: number[] = []
  for (const c of line.chars) {
    if (/\s/.test(c.ch) && c.style.font === style.font && Math.abs(c.style.size - style.size) < 0.01) gaps.push(c.adv)
  }
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

export function createMetrics(
  page: PDFPageProxy,
  model: GlyphModel,
  line: EditableLine,
): StyleMetrics & {
  font: (id: string) => ResolvedStyleFont
} {
  const cache = new Map<string, ResolvedStyleFont>()
  const font = (id: string) => {
    let f = cache.get(id)
    if (!f) {
      f = resolveFont(page, model, id)
      cache.set(id, f)
    }
    return f
  }
  const em = (text: string, style: CharStyle): number => {
    const f = font(style.font)
    const fb = (t: string) => cssWidth100(f.css1, t)
    if (f.enc) return f.enc.layout(text, 0, fb).width
    return fb(text)
  }
  return {
    font,
    width: (text, style) => em(text, style) * style.size * style.hScale,
    space: (style) => {
      const learned = learnedSpace(line, style)
      if (learned !== null) return learned
      const f = font(style.font)
      const s = f.enc?.spaceGlyphEm
      return (s && s > 0.05 ? s : 0.25) * style.size * style.hScale
    },
    coverStyle: (ch, style) => {
      if (font(style.font).enc?.charEm(ch) != null) return style
      // same PostScript name (subset tag aside) = same face, split encodings
      const base = (id: string) => (model.fonts.get(id)?.name ?? '').replace(/^[A-Z]{6}\+/, '')
      const want = base(style.font)
      if (!want) return style
      for (const id of model.fonts.keys()) {
        if (id === style.font || base(id) !== want) continue
        if (font(id).enc?.charEm(ch) != null) return { ...style, font: id }
      }
      return style
    },
  }
}

/** css px of the stroke for faux-bold text (render mode 2) */
function runFromPlan(plan: PlannedRun, metrics: ReturnType<typeof createMetrics>, baselineY: number): TextEditRun {
  void baselineY
  const st = plan.style
  const f = metrics.font(st.font)
  const run: TextEditRun = {
    text: plan.text,
    x: plan.x,
    fontSize: st.size,
    color: st.color,
    baseFamily: f.family || undefined,
    bold: f.bold,
    italic: f.italic,
    fontFallback: f.generic,
    fontName: standardNameForFallback(f.generic, f.bold, f.italic),
    hScale: Math.abs(st.hScale - 1) > 0.005 ? st.hScale : undefined,
    renderMode: st.renderMode || undefined,
    strokeColor: st.strokeColor ?? undefined,
    strokeWidth: st.renderMode ? st.strokeWidth : undefined,
  }
  if (!f.enc) return run
  const enc = f.enc
  run.pdfFont = { baseFont: enc.baseFont, loadedName: enc.loadedName, type3: enc.type3 || undefined }
  const k = st.size * st.hScale
  const pieces: TextEditPiece[] = []
  if (plan.original && plan.glyphs && plan.glyphs.length > 0) {
    // untouched glyphs: exact original codes and relative spacing, moved as
    // a block to the run's (possibly shifted) start
    // relative glyph offsets scale with any squeeze applied to the style
    const orig = plan.glyphs[0]
    const sq = orig.hScale > 0 ? st.hScale / orig.hScale : 1
    const at = (g: { x: number }) => plan.x + (g.x - orig.x) * sq
    let piece: TextEditPiece | null = null
    for (const g of plan.glyphs) {
      if (g.isSpace) {
        piece = null
        continue
      }
      const hex = g.code.toString(16).padStart(enc.codeBytes * 2, '0')
      if (!piece) {
        piece = { text: '', x: at(g), glyphs: [] }
        pieces.push(piece)
      }
      piece.text += g.text
      piece.glyphs!.push({ hex, pua: g.fontChar, dx: at(g) - piece.x, w: g.w * sq })
    }
  } else {
    const fb = (t: string) => cssWidth100(f.css1, t)
    let x = plan.x
    for (const word of plan.text.split(/(\s+)/)) {
      if (!word) continue
      if (/^\s+$/.test(word)) {
        x += metrics.space(st) * Array.from(word).length
        continue
      }
      const laid = enc.layout(word, 0, fb)
      for (const p of laid.pieces) {
        if (p.kind === 'glyphs') {
          pieces.push({
            text: p.text,
            x: x + p.x * k,
            hex: p.hex,
            pua: p.pua,
            glyphs: p.items.map((it) => ({ hex: it.hex, pua: it.pua, dx: it.x * k, w: it.w * k })),
          })
        } else {
          pieces.push({ text: p.text, x: x + p.x * k })
        }
      }
      x += laid.width * k
    }
  }
  run.pieces = pieces
  // width fingerprint of the codes used, to tell same-named fonts apart
  const sig = new Map<number, number>()
  for (const p of pieces) {
    for (const g of p.glyphs ?? []) {
      const code = parseInt(g.hex, 16)
      const w = enc.rawWidth(code)
      if (w !== undefined && sig.size < 24) sig.set(code, w)
    }
  }
  if (sig.size) run.pdfFont.widthSig = [...sig.entries()]
  return run
}

function rectOfRuns(runs: TextEditRun[], metrics: StyleMetrics): { x0: number; x1: number } {
  let x0 = Infinity
  let x1 = -Infinity
  for (const r of runs) {
    x0 = Math.min(x0, r.x)
    const style: CharStyle = {
      font: '',
      size: r.fontSize,
      hScale: r.hScale ?? 1,
      color: r.color,
      renderMode: 0,
      strokeWidth: 0,
      strokeColor: null,
    }
    let end = r.x
    for (const p of r.pieces ?? []) {
      const last = p.glyphs?.[p.glyphs.length - 1]
      end = Math.max(end, last ? p.x + last.dx + last.w : p.x + metrics.width(p.text, style))
    }
    if (!r.pieces) end = r.x + metrics.width(r.text, style)
    x1 = Math.max(x1, end)
  }
  return { x0, x1 }
}

/** locate the editable line under a pdf point; reuse an existing edit of it */
export async function openLineEdit(
  page: PDFPageProxy,
  pageRef: number,
  ops: EditOp[],
  px: number,
  py: number,
): Promise<LineEditContext | null> {
  // clicks on an already edited line (incl. its newly typed text) re-open it
  const previous = latestTextEditAt(ops, pageRef, px, py)
  const model = await getGlyphModel(page)
  const probe = previous?.anchor ?? { x: px, y: py }
  const line = findLine(model, probe.x, probe.y)
  if (!line) return null
  return {
    page,
    model,
    line,
    previous,
    currentText: previous ? previous.newText : line.text,
  }
}

export function latestTextEditAt(ops: EditOp[], pageRef: number, px: number, py: number): TextEditOp | null {
  const superseded = new Set(ops.map((o) => (o.kind === 'text-edit' ? o.replaces : undefined)).filter(Boolean))
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i]
    if (o.kind !== 'text-edit' || o.page !== pageRef || !o.anchor || superseded.has(o.id)) continue
    const r = o.hitRect ?? o.rect
    if (px >= r.x - 1 && px <= r.x + r.width + 1 && py >= r.y - 1 && py <= r.y + r.height + 1) return o
  }
  return null
}

/** build the text-edit op for the edited line (null when nothing changed) */
export function buildLineEditOp(ctx: LineEditContext, pageRef: number, newText: string, id: string): TextEditOp | null {
  const { line, page, model, previous } = ctx
  const metrics = createMetrics(page, model, line)
  const plan = planEdit(line, newText, metrics)
  if (!plan) return null
  if (plan.runs.length === 0 && plan.coverFromX === Infinity) {
    // back to the original text: drop the edit entirely
    return null
  }
  const runs = plan.runs.map((r) => runFromPlan(r, metrics, line.baselineY))
  const pad = line.size * 0.04
  const cover = {
    x: Math.max(line.box.x0, plan.coverFromX) - pad,
    y: line.box.y0 - pad,
    width: line.box.x1 - Math.max(line.box.x0, plan.coverFromX) + pad * 2,
    height: line.box.y1 - line.box.y0 + pad * 2,
  }
  const drawn = runs.length ? rectOfRuns(runs, metrics) : { x0: cover.x, x1: cover.x }
  const hx0 = Math.min(line.box.x0, drawn.x0)
  const hx1 = Math.max(line.box.x1, drawn.x1)
  const first = runs[0]
  const anchorChar = line.chars.find((c) => c.glyph) ?? line.chars[0]
  return {
    kind: 'text-edit',
    id,
    page: pageRef,
    rect: cover,
    newText,
    fontSize: line.size,
    fontName: first?.fontName ?? 'Helvetica',
    color: first?.color ?? '#000000',
    x: first?.x ?? cover.x,
    baselineY: line.baselineY,
    baseFamily: first?.baseFamily,
    bold: first?.bold,
    italic: first?.italic,
    fontFallback: first?.fontFallback,
    runs,
    anchor: {
      x: anchorChar.x + Math.max(0.5, anchorChar.adv / 2),
      y: line.baselineY + line.size * 0.3,
    },
    originalText: line.text,
    replaces: previous?.id,
    hitRect: { x: hx0, y: cover.y, width: hx1 - hx0, height: cover.height },
  }
}
