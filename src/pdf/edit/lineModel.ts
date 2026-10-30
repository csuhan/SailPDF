/**
 * Line editing on top of the exact glyph model:
 *  - recognise the visual line around a point (glyphs sharing a baseline)
 *  - build its text (with inferred word spaces) and a per-character style map
 *  - after an edit, diff old/new text and produce styled runs: unchanged
 *    characters keep their own font/color/position, inserted characters
 *    inherit the style of the character they were typed next to.
 * Pure geometry/text logic; no DOM access.
 */
import type { FontInfo, GlyphModel, PageGlyph } from './glyphModel'

export interface CharStyle {
  font: string
  size: number
  hScale: number
  color: string
  renderMode: number
  strokeWidth: number
  strokeColor: string | null
}

export interface LineChar {
  /** visible text of this cell (glyph unicode or an inferred space) */
  ch: string
  /** null for inferred spaces */
  glyph: PageGlyph | null
  x: number
  /** advance to the next cell start */
  adv: number
  style: CharStyle
}

export interface EditableLine {
  chars: LineChar[]
  text: string
  baselineY: number
  /** pdf user-space box of the line's ink */
  box: { x0: number; y0: number; x1: number; y1: number }
  /** dominant (most frequent) size on the line */
  size: number
  /** x where the next block on the same baseline starts (tab stop, column) */
  rightLimit: number
}

export function styleOf(g: PageGlyph): CharStyle {
  return {
    font: g.font,
    size: g.size,
    hScale: g.hScale,
    color: g.color ?? '#000000',
    renderMode: g.renderMode,
    strokeWidth: g.strokeWidth,
    strokeColor: g.strokeColor,
  }
}

export function sameStyle(a: CharStyle, b: CharStyle): boolean {
  return (
    a.font === b.font &&
    Math.abs(a.size - b.size) < 0.01 &&
    Math.abs(a.hScale - b.hScale) < 0.005 &&
    a.color === b.color &&
    a.renderMode === b.renderMode
  )
}

/** vertical ink extents of a glyph from its font metrics */
function extents(g: PageGlyph, fonts: Map<string, FontInfo>): [number, number] {
  const f = fonts.get(g.font)
  const asc = Math.max(f?.ascent ?? 0.8, Math.min(1.1, f?.bboxTop ?? 0))
  const desc = Math.max(f?.descent ?? 0.2, Math.min(0.35, Math.abs(f?.bboxBottom ?? 0)))
  return [g.y - desc * g.size, g.y + asc * g.size]
}

/**
 * Glyphs forming the visual line at a pdf point (or around an anchor glyph).
 * Same-baseline glyphs are chained left/right while gaps stay word-sized.
 */
export function findLine(model: GlyphModel, px: number, py: number): EditableLine | null {
  const visible = model.glyphs.filter((g) => !g.invisible && g.size > 0)
  // anchor: glyph whose box contains the point (else the nearest on that row)
  let anchor: PageGlyph | null = null
  let best = Infinity
  for (const g of visible) {
    if (g.isSpace) continue
    const [b, t] = extents(g, model.fonts)
    const slack = g.size * 0.15
    if (py < b - slack || py > t + slack) continue
    const x1 = g.x + Math.max(g.w, g.adv)
    const dx = px < g.x ? g.x - px : px > x1 ? px - x1 : 0
    if (dx > g.size * 0.6) continue
    const dy = py < b ? b - py : py > t ? py - t : 0
    const d = dx + dy
    if (d < best) {
      best = d
      anchor = g
    }
  }
  if (!anchor) return null
  return lineAround(model, visible, anchor)
}

/**
 * Text drawn as separate "strands" in content order (a strand continues while
 * each glyph starts at/after the previous one). When strands overlap
 * horizontally they are different texts printed over each other; keep only
 * strands that don't collide with the anchor's strand.
 */
function withoutOverprint(row: PageGlyph[], anchor: PageGlyph): PageGlyph[] {
  const bySeq = row.slice().sort((a, b) => a.seq - b.seq)
  const strands: PageGlyph[][] = []
  for (const g of bySeq) {
    const cur = strands[strands.length - 1]
    const prev = cur?.[cur.length - 1]
    if (cur && prev && g.x >= prev.x - g.size * 0.05 && g.x - (prev.x + prev.adv) < g.size * 4) cur.push(g)
    else strands.push([g])
  }
  if (strands.length < 2) return row
  const span = (s: PageGlyph[]) => [s[0].x, s[s.length - 1].x + Math.max(s[s.length - 1].w, 0)] as const
  const mine = strands.find((s) => s.includes(anchor))
  if (!mine) return row
  const [a0, a1] = span(mine)
  return strands
    .filter((s) => {
      if (s === mine) return true
      const [b0, b1] = span(s)
      const overlap = Math.min(a1, b1) - Math.max(a0, b0)
      return overlap < Math.min(a1 - a0, b1 - b0) * 0.25
    })
    .flat()
}

function lineAround(model: GlyphModel, visible: PageGlyph[], anchor: PageGlyph): EditableLine {
  const tolY = anchor.size * 0.3
  let row = visible.filter(
    (g) =>
      Math.abs(g.y - anchor.y) <= Math.max(tolY, g.size * 0.3) &&
      g.size > anchor.size * 0.35 &&
      g.size < anchor.size * 2.8,
  )
  row = withoutOverprint(row, anchor)
  row.sort((a, b) => a.x - b.x || a.seq - b.seq)
  // drop duplicated glyphs (fake bold / shadows drawn twice at ~same spot)
  const dedup: PageGlyph[] = []
  for (const g of row) {
    const prev = dedup[dedup.length - 1]
    if (
      prev &&
      prev.text === g.text &&
      Math.abs(prev.x - g.x) < g.size * 0.05 &&
      Math.abs(prev.y - g.y) < g.size * 0.05
    )
      continue
    dedup.push(g)
  }
  const ai = Math.max(0, dedup.indexOf(anchor))
  // chain outwards while gaps stay below a column break
  const maxGap = (a: PageGlyph, b: PageGlyph) => Math.max(a.size, b.size) * 1.6
  let lo = ai
  let hi = ai
  const endOf = (g: PageGlyph) => g.x + Math.max(g.w, 0)
  while (lo > 0 && dedup[lo].x - endOf(dedup[lo - 1]) <= maxGap(dedup[lo - 1], dedup[lo])) lo--
  while (hi < dedup.length - 1 && dedup[hi + 1].x - endOf(dedup[hi]) <= maxGap(dedup[hi], dedup[hi + 1])) hi++
  const glyphs = dedup.slice(lo, hi + 1)
  // the next block to the right (e.g. a right-aligned date) bounds the line
  const nextBlock = dedup.slice(hi + 1).find((g) => !g.isSpace)
  const rightLimit = nextBlock ? nextBlock.x - nextBlock.size * 0.5 : Infinity

  // cells: glyphs + inferred spaces for visible gaps
  const chars: LineChar[] = []
  let prevEnd: number | null = null
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    if (prevEnd !== null) {
      const gap = g.x - prevEnd
      const last = chars[chars.length - 1]
      if (gap > g.size * 0.15 && last && !/\s/.test(last.ch) && !g.isSpace) {
        chars.push({ ch: ' ', glyph: null, x: prevEnd, adv: gap, style: last.style })
        prevEnd = g.x
      } else if (last) {
        // absorb tiny gaps/overlaps (kerning) into the previous advance
        last.adv = g.x - last.x
      }
    }
    const ch = g.isSpace ? ' ' : g.text
    if (g.isSpace && chars.length && /\s/.test(chars[chars.length - 1].ch)) {
      // merge consecutive spaces into one cell
      const last = chars[chars.length - 1]
      last.adv = g.x + g.adv - last.x
      prevEnd = g.x + g.adv
      continue
    }
    chars.push({ ch, glyph: g, x: g.x, adv: g.adv, style: styleOf(g) })
    prevEnd = g.x + (g.isSpace ? g.adv : Math.max(g.w, g.adv))
  }
  // trim leading/trailing spaces
  while (chars.length && /^\s+$/.test(chars[0].ch)) chars.shift()
  while (chars.length && /^\s+$/.test(chars[chars.length - 1].ch)) chars.pop()

  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  const sizes = new Map<number, number>()
  for (const c of chars) {
    if (!c.glyph) continue
    const g = c.glyph
    const [b, t] = extents(g, model.fonts)
    x0 = Math.min(x0, g.x)
    x1 = Math.max(x1, g.x + Math.max(g.w, g.adv))
    y0 = Math.min(y0, b)
    y1 = Math.max(y1, t)
    const k = Math.round(g.size * 100) / 100
    sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? anchor.size
  return {
    chars,
    text: chars.map((c) => c.ch).join(''),
    baselineY: anchor.y,
    box: { x0, y0, x1, y1 },
    size,
    rightLimit,
  }
}

// ── diff & run reconstruction ───────────────────────────────────

export interface PlannedRun {
  text: string
  /** pdf x of the run start */
  x: number
  style: CharStyle
  /** run is an untouched copy of original glyphs */
  original: boolean
  /** original glyphs, when original */
  glyphs?: PageGlyph[]
}

export interface EditPlan {
  /** first changed x: everything left of it stays in the content stream */
  coverFromX: number
  runs: PlannedRun[]
  /** horizontal squeeze applied so the line fits before `rightLimit` (1 = none) */
  squeeze: number
}

export interface StyleMetrics {
  /** advance width (pdf units) of `text` in `style`, incl. word spacing */
  width: (text: string, style: CharStyle) => number
  /** advance of a word space in `style` */
  space: (style: CharStyle) => number
  /**
   * style able to draw `ch` with an original font: `style` itself when its
   * font has the glyph, else a sibling font of the same family/size used on
   * the page (web/office PDFs often split one face over several subsets)
   */
  coverStyle?: (ch: string, style: CharStyle) => CharStyle
}

/**
 * Plan the redraw of an edited line.
 * - common prefix: left untouched in the page (not redrawn)
 * - changed middle: each inserted char takes the style of its left
 *   neighbour (or right neighbour at line start); replaced chars keep the
 *   style of the char they replace when the counts match position-wise
 * - common suffix: original glyphs/styles, shifted by the width delta
 */
export function planEdit(line: EditableLine, newText: string, metrics: StyleMetrics): EditPlan | null {
  const oldChars = line.chars
  const oldText = oldChars.map((c) => c.ch)
  const nw = Array.from(newText)
  if (oldChars.length === 0) return null
  let pre = 0
  while (pre < oldText.length && pre < nw.length && oldText[pre] === nw[pre]) pre++
  let suf = 0
  while (
    suf < oldText.length - pre &&
    suf < nw.length - pre &&
    oldText[oldText.length - 1 - suf] === nw[nw.length - 1 - suf]
  ) {
    suf++
  }
  if (pre === oldText.length && pre === nw.length) return { coverFromX: Infinity, runs: [], squeeze: 1 }

  // start redrawing at a word boundary inside the prefix so the white-out
  // edge falls into a gap (never through a glyph)
  let start = pre
  while (start > 0 && !/\s/.test(oldText[start - 1])) start--
  const lastChar = oldChars[oldChars.length - 1]
  const coverFromX = start < oldChars.length ? oldChars[start].x : lastChar.x + lastChar.adv

  // styles for the new middle
  const oldMid = oldChars.slice(pre, oldChars.length - suf)
  const newMid = nw.slice(pre, nw.length - suf)
  const leftStyle = pre > 0 ? oldChars[pre - 1].style : null
  const rightStyle = suf > 0 ? oldChars[oldChars.length - suf].style : null
  const midStyles: CharStyle[] = newMid.map((ch, i) => {
    // replacement in place keeps the replaced char's style
    if (oldMid.length > 0) {
      const k = Math.min(oldMid.length - 1, Math.floor((i * oldMid.length) / Math.max(1, newMid.length)))
      const src = oldMid[k]
      if (!/\s/.test(ch) || !src.glyph) return src.style
    }
    // pure insertion: inherit from the neighbouring visible text. A space
    // typed right after a styled word (e.g. a link) takes the next style.
    if (/\s/.test(ch) && rightStyle) return leftStyle && i > 0 ? leftStyle : rightStyle
    return leftStyle ?? rightStyle ?? oldChars[0].style
  })
  // an insertion at a style boundary sticks to the left (typing continues a
  // word), except when the left side is whitespace-separated
  if (oldMid.length === 0 && leftStyle && rightStyle && !sameStyle(leftStyle, rightStyle)) {
    const leftIsSpace = /\s/.test(oldText[pre - 1] ?? '')
    for (let i = 0; i < midStyles.length; i++) midStyles[i] = leftIsSpace ? rightStyle : leftStyle
  }

  // assemble cells to draw: [start..pre) original, middle new, suffix original
  interface Cell {
    ch: string
    style: CharStyle
    orig: LineChar | null
  }
  const cells: Cell[] = []
  for (let i = start; i < pre; i++) cells.push({ ch: oldText[i], style: oldChars[i].style, orig: oldChars[i] })
  newMid.forEach((ch, i) =>
    cells.push({
      ch,
      style: !/\s/.test(ch) && metrics.coverStyle ? metrics.coverStyle(ch, midStyles[i]) : midStyles[i],
      orig: null,
    }),
  )
  for (let i = oldChars.length - suf; i < oldChars.length; i++) {
    cells.push({ ch: oldText[i], style: oldChars[i].style, orig: oldChars[i] })
  }

  // lay out: kept cells reuse their original advance, new cells are measured
  const runs: PlannedRun[] = []
  let x = coverFromX
  let cur: PlannedRun | null = null
  for (const c of cells) {
    const isOrig = !!c.orig
    const adv = c.orig ? c.orig.adv : /\s/.test(c.ch) ? metrics.space(c.style) : metrics.width(c.ch, c.style)
    if (!cur || !sameStyle(cur.style, c.style) || cur.original !== isOrig) {
      cur = { text: '', x, style: c.style, original: isOrig, glyphs: isOrig ? [] : undefined }
      runs.push(cur)
    }
    cur.text += c.ch
    if (c.orig?.glyph) {
      // original runs are placed by their first real glyph
      if (cur.glyphs!.length === 0) cur.x = x
      cur.glyphs!.push(c.orig.glyph)
    }
    x += adv
  }
  // keep clear of the next block on the baseline (right-aligned dates etc.):
  // compress the redrawn part horizontally, like Acrobat does, down to 70%
  let squeeze = 1
  if (Number.isFinite(line.rightLimit) && x > line.rightLimit && x > coverFromX) {
    squeeze = Math.max(0.7, (line.rightLimit - coverFromX) / (x - coverFromX))
    for (const r of runs) {
      r.x = coverFromX + (r.x - coverFromX) * squeeze
      r.style = { ...r.style, hScale: r.style.hScale * squeeze }
    }
  }
  return { coverFromX, runs: runs.filter((r) => r.text.length > 0), squeeze }
}
