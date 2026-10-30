/**
 * Run-preserving line editing: split a merged text line into styled runs,
 * diff old vs new text, and output replacement runs where UNCHANGED segments
 * keep their original font/color/position and only the edited middle uses
 * the anchor run's style. Pure functions (unit-testable).
 */

export interface LineRun<TPos = number> {
  text: string
  /** run start position (css px or pdf pt, caller space) */
  x: TPos
  /** visual width of the run in the same units as x */
  width: TPos
  cssFont: string
  baseFamily: string
  bold: boolean
  italic: boolean
  color: string
  fontFallback: 'serif' | 'sans-serif' | 'monospace'
  /** true if this piece is pure whitespace */
  isSpace?: boolean
}

export interface OutRun<TPos = number> extends LineRun<TPos> {
  /** one of the original runs (index) this output derives from, or -1 for the edited zone */
  ofOriginal: number
  /** unchanged prefix at its original position: already on the page as-is */
  verbatim?: boolean
}

/** assemble the display text of runs with the gap-insert rule */
export function assembleRunsText(runs: LineRun<number>[], gapThresholdCss: number): string {
  let text = ''
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) {
      const gap = runs[i].x - (runs[i - 1].x + runs[i - 1].width)
      if (gap > gapThresholdCss) text += ' '
    }
    text += runs[i].text
  }
  return text
}

interface Cell {
  ch: string
  runIdx: number
  /** char index within its run */
  charIdx: number
  /** implicit inserted space */
  inserted: boolean
}

function cellsOf(runs: LineRun<number>[], gapThresholdCss: number): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) {
      const gap = runs[i].x - (runs[i - 1].x + runs[i - 1].width)
      if (gap > gapThresholdCss) cells.push({ ch: ' ', runIdx: i, charIdx: 0, inserted: true })
    }
    let ci = 0
    for (const ch of runs[i].text) {
      cells.push({ ch, runIdx: i, charIdx: ci++, inserted: false })
    }
  }
  return cells
}

export interface TextPositioner {
  /** css-px width of `text` rendered in `cssFont` */
  measure: (cssFont: string, text: string) => number
}

/**
 * diff oldText/newText and rebuild styled runs.
 *
 * Rules (Acrobat-like):
 * - identical prefix & suffix segments keep their ORIGINAL runs (font, color,
 *   and position); a run split at the diff boundary is cut in two cleanly
 * - the edited middle becomes ONE run with the anchor run's style, starting
 *   where the prefix ends
 * - suffix runs shift right/left by the middle width delta so the line stays
 *   contiguous
 */
export function reconstructRuns(
  oldText: string,
  newText: string,
  runs: LineRun<number>[],
  anchorRunIdx: number,
  pos: TextPositioner,
  gapThresholdCss: number,
): OutRun<number>[] {
  if (!newText.trim() || runs.length === 0) return []
  // identical text → keep everything untouched
  if (oldText === newText) {
    return runs.map((r, i) => ({ ...r, ofOriginal: i, verbatim: true }))
  }
  // common prefix / suffix (char-wise on assembled text)
  const oldChars = Array.from(oldText)
  const newChars = Array.from(newText)
  let pre = 0
  const maxPre = Math.min(oldChars.length, newChars.length)
  while (pre < maxPre && oldChars[pre] === newChars[pre]) pre++
  // snap the change start back to a word boundary so the untouched prefix
  // ends in a gap (clean white-out edge, no clipped glyph overhangs)
  while (pre > 0 && !/\s/.test(oldChars[pre - 1])) pre--
  let suf = 0
  while (
    suf < oldChars.length - pre &&
    suf < newChars.length - pre &&
    oldChars[oldChars.length - 1 - suf] === newChars[newChars.length - 1 - suf]
  ) {
    suf++
  }
  const cells = cellsOf(runs, gapThresholdCss)
  const oldMid = oldChars.slice(pre, oldChars.length - suf).join('')
  const newMid = newChars.slice(pre, newChars.length - suf).join('')

  const out: OutRun<number>[] = []

  // ── prefix runs: unchanged text/possibly partially covered ──
  let cursor = 0 // assembled-cell index tick for prefix region
  const anchor = runs[Math.max(0, Math.min(anchorRunIdx, runs.length - 1))]
  let preEndX: number | null = null // css x where the middle should start

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    // cells of this run that are in ORIGINAL text (skip inserted spaces)
    const runCells = cells.map((c, idx) => ({ c, idx })).filter(({ c }) => !c.inserted && c.runIdx === i)
    if (runCells.length === 0) continue
    const first = runCells[0].idx
    const last = runCells[runCells.length - 1].idx
    if (last < pre) {
      // whole run survives verbatim at its original position
      out.push({ ...r, x: r.x, ofOriginal: i, verbatim: true })
      preEndX = r.x + r.width
      continue
    }
    if (first >= pre) break // fully inside the changed zone ⟹ stop prefix
    // partially covered: keep the surviving head of this run
    const keepChars = r.text.slice(0, Math.max(0, pre - first))
    if (keepChars.length > 0) {
      const keepWidth = pos.measure(r.cssFont, keepChars)
      out.push({ ...r, text: keepChars, width: keepWidth, x: r.x, ofOriginal: i, verbatim: true })
      preEndX = r.x + keepWidth
    } else {
      preEndX = r.x
    }
    void cursor
    break
  }
  if (preEndX === null) preEndX = runs[0].x

  // ── middle: edited region with the anchor run's style ──
  let midEndX = preEndX
  if (newMid.length > 0) {
    const midWidth = pos.measure(anchor.cssFont, newMid)
    out.push({
      ...anchor,
      text: newMid,
      x: preEndX,
      width: midWidth,
      ofOriginal: -1,
    })
    midEndX = preEndX + midWidth
  } else if (oldMid.length === 0 && pre === newChars.length - suf) {
    // pure insertion already handled by middle width above (empty mid)
  }

  // ── suffix runs: keep styles, shift by the delta ──
  // original x of the suffix start = x of the first run whose tail goes past old suffix boundary
  const oldSufStart = cells.length - suf
  let oldSufX: number | null = null
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    const runCells = cells.map((c, idx) => ({ c, idx })).filter(({ c }) => !c.inserted && c.runIdx === i)
    if (runCells.length === 0) continue
    const first = runCells[0].idx
    const last = runCells[runCells.length - 1].idx
    if (last < oldSufStart) continue
    if (first >= oldSufStart) {
      // entirely in suffix
      if (oldSufX === null) oldSufX = r.x
      const shift = midEndX - (oldSufX ?? r.x)
      out.push({ ...r, x: r.x + shift, ofOriginal: i })
      continue
    }
    // split at the suffix boundary
    const cut = Math.max(0, oldSufStart - first)
    const tailText = r.text.slice(cut)
    if (tailText.length > 0) {
      const tailWidth = pos.measure(r.cssFont, tailText)
      const tailX = r.x + pos.measure(r.cssFont, r.text.slice(0, cut))
      if (oldSufX === null) oldSufX = tailX
      const shift = midEndX - oldSufX
      out.push({ ...r, text: tailText, width: tailWidth, x: tailX + shift, ofOriginal: i })
    }
    continue
  }
  return out
}
