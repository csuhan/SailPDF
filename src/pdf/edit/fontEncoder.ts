/**
 * Re-encode replacement text with the ORIGINAL font of the document.
 *
 * pdf.js (with `fontExtraProperties`) exposes, per loaded font, the
 * charCode -> unicode map (ToUnicode / encoding), which char codes actually
 * have a glyph in the embedded (usually subset) program (`toFontChar`) and the
 * advance widths. Inverting that lets us write new text with the very same
 * font resource the PDF already uses (Type1, TrueType and Identity-encoded CID
 * fonts alike), so edited text is visually identical to the original.
 * Characters missing from the subset are emitted as "fallback" pieces.
 */

export interface PdfJsFontLike {
  name?: string
  loadedName?: string
  composite?: boolean
  vertical?: boolean
  isType3Font?: boolean
  /** Type3 glyph programs keyed by glyph name (toFontChar maps code -> name) */
  charProcOperatorList?: Record<string, unknown>
  missingFile?: boolean
  defaultWidth?: number
  widths?: Record<number, number>
  toFontChar?: (number | undefined)[]
  toUnicode?: { _map?: (string | undefined)[]; firstChar?: number; lastChar?: number }
  cMap?: { _map?: unknown[]; codespaceRanges?: number[][] }
  isSerifFont?: boolean
  isMonospace?: boolean
  fontMatrix?: number[]
  ascent?: number
  descent?: number
}

/** a positioned piece of a laid-out run; x/width in em (multiply by font size) */
export type TextPiece =
  | {
      kind: 'glyphs'
      text: string
      /** hex char codes for the original PDF font */
      hex: string
      /** private-use string that renders these glyphs with pdf.js' loaded font face */
      pua: string
      x: number
      width: number
      /** per-glyph detail (x relative to the piece start, em) */
      items: { hex: string; pua: string; x: number; w: number }[]
    }
  | { kind: 'fallback'; text: string; x: number; width: number }

export interface LaidOutText {
  pieces: TextPiece[]
  width: number
}

export interface FontEncoder {
  /** font name as reported by pdf.js (BaseFont/FontName incl. subset tag) */
  baseFont: string
  /** pdf.js css font-face family */
  loadedName: string
  /** bytes per char code (1 for simple fonts, 2 for Identity CID fonts) */
  codeBytes: number
  /** Type3 font: glyphs are drawn from content programs, there is no css face */
  type3: boolean
  /** raw glyph-space width of a char code (as in the font dict /Widths) */
  rawWidth: (code: number) => number | undefined
  /** em width of a real space glyph, when the font has one */
  spaceGlyphEm: number | null
  /** em advance of a character, or null when the subset can't draw it */
  charEm: (ch: string) => number | null
  /**
   * lay out text: glyphs the font can encode become `glyphs` pieces, the rest
   * `fallback` pieces; spaces are emitted as gaps of `spaceEm`.
   */
  layout: (text: string, spaceEm: number, fallbackEm: (text: string) => number) => LaidOutText
}

interface Glyph {
  code: number
  bytes: number
  pua: number
  em: number
}

const encoderCache = new WeakMap<object, FontEncoder | null>()

export function buildFontEncoder(font: PdfJsFontLike | null | undefined): FontEncoder | null {
  if (!font || typeof font !== 'object') return null
  const cached = encoderCache.get(font)
  if (cached !== undefined) return cached
  let enc: FontEncoder | null = null
  try {
    enc = buildInner(font)
  } catch {
    enc = null
  }
  encoderCache.set(font, enc)
  return enc
}

const isSpace = (ch: string) => ch === ' ' || ch === '\u00a0' || ch === '\t'

function buildInner(font: PdfJsFontLike): FontEncoder | null {
  if (!font.name || !font.loadedName || font.vertical || font.missingFile) {
    return null
  }
  const type3 = !!font.isType3Font
  // Type3: char codes map to glyph procedure names; only codes whose
  // procedure exists can be re-used
  const procs = type3 ? (font.charProcOperatorList ?? null) : null
  if (type3 && !procs) return null
  const tfc = font.toFontChar
  const tu = font.toUnicode
  if (!tfc || !tu) return null
  let codeBytes = 1
  if (font.composite) {
    // only Identity-style CMaps (char code == CID) are safely invertible
    const cmapLen = Array.isArray(font.cMap?._map) ? font.cMap!._map!.length : 0
    if (!font.cMap || cmapLen > 0) return null
    const ranges = font.cMap.codespaceRanges ?? []
    codeBytes = 0
    for (let n = 0; n < ranges.length; n++) if (ranges[n]?.length) codeBytes = n + 1
    if (codeBytes < 1 || codeBytes > 2) return null
  }
  const widths = font.widths ?? {}
  const dw = font.defaultWidth ?? 0
  // glyph-space -> text-space scale (1/1000 for normal fonts, FontMatrix for Type3)
  const wScale = type3 && Array.isArray(font.fontMatrix) ? Math.abs(font.fontMatrix[0]) || 0.001 : 0.001
  const byText = new Map<string, Glyph>()
  let maxLen = 1
  const add = (code: number, uni: string | undefined) => {
    if (!uni || /^[\u0000-\u001f]$/.test(uni)) return
    const pua = tfc[code] as unknown
    if (pua === undefined || pua === null) return // glyph not in the (subset) program
    if (type3 && (typeof pua !== 'string' || !procs![pua])) return
    if (byText.has(uni)) return
    const w = widths[code] ?? dw
    byText.set(uni, {
      code,
      bytes: codeBytes,
      // Type3 has no css face to preview with; keep the code as a marker
      pua: typeof pua === 'number' ? pua : 0,
      em: (typeof w === 'number' ? w : 0) * wScale,
    })
    maxLen = Math.max(maxLen, Array.from(uni).length)
  }
  if (Array.isArray(tu._map)) {
    tu._map.forEach((uni, code) => add(code, uni))
  } else if (typeof tu.firstChar === 'number' && typeof tu.lastChar === 'number') {
    for (let c = tu.firstChar; c <= tu.lastChar; c++) add(c, String.fromCharCode(c))
  }
  if (byText.size === 0) return null

  // greedy longest match (ligatures such as "fi" map one code to several chars)
  const match = (chars: string[], i: number): { glyph: Glyph; len: number } | null => {
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const g = byText.get(chars.slice(i, i + len).join(''))
      if (g) return { glyph: g, len }
    }
    return null
  }
  const hexOf = (g: Glyph) => g.code.toString(16).padStart(g.bytes * 2, '0')
  const space = byText.get(' ') ?? null

  return {
    baseFont: font.name,
    loadedName: font.loadedName,
    codeBytes,
    type3,
    rawWidth: (code) => {
      const w = widths[code]
      return typeof w === 'number' ? w : undefined
    },
    spaceGlyphEm: space ? space.em : null,
    charEm: (ch) => byText.get(ch)?.em ?? null,
    layout(text, spaceEm, fallbackEm) {
      const chars = Array.from(text)
      const pieces: TextPiece[] = []
      let x = 0
      let cur: Extract<TextPiece, { kind: 'glyphs' }> | null = null
      let fb: Extract<TextPiece, { kind: 'fallback' }> | null = null
      const flushFb = () => {
        if (!fb) return
        fb.width = fallbackEm(fb.text)
        x = fb.x + fb.width
        pieces.push(fb)
        fb = null
      }
      let i = 0
      while (i < chars.length) {
        const ch = chars[i]
        if (isSpace(ch)) {
          // explicit gap so word spacing follows the original line
          flushFb()
          cur = null
          x += spaceEm
          i++
          continue
        }
        const m = match(chars, i)
        if (m) {
          flushFb()
          if (!cur) {
            cur = { kind: 'glyphs', text: '', hex: '', pua: '', x, width: 0, items: [] }
            pieces.push(cur)
          }
          const h = hexOf(m.glyph)
          const p = String.fromCharCode(m.glyph.pua)
          cur.items.push({ hex: h, pua: p, x: cur.width, w: m.glyph.em })
          cur.text += chars.slice(i, i + m.len).join('')
          cur.hex += h
          cur.pua += p
          cur.width += m.glyph.em
          x += m.glyph.em
          i += m.len
        } else {
          cur = null
          if (!fb) fb = { kind: 'fallback', text: '', x, width: 0 }
          fb.text += ch
          i++
        }
      }
      flushFb()
      return { pieces, width: x }
    },
  }
}

/**
 * Effective word space (em) of an original run: the run's real width minus its
 * glyph advances, spread over its spaces. Absorbs justification, Tw and TJ
 * kerning gaps (TeX output has no space glyphs at all).
 */
export function effectiveSpaceEm(
  enc: FontEncoder,
  text: string,
  widthEm: number,
  fallbackEm: (t: string) => number,
): number {
  const base = enc.spaceGlyphEm && enc.spaceGlyphEm > 0.05 ? enc.spaceGlyphEm : 0.3
  const n = Array.from(text).filter(isSpace).length
  if (n === 0 || !(widthEm > 0)) return base
  const natural = enc.layout(text, 0, fallbackEm).width
  const s = (widthEm - natural) / n
  return Number.isFinite(s) ? Math.min(1, Math.max(0.12, s)) : base
}
