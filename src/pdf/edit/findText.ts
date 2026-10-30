/**
 * Find text on a page with exact glyph geometry (for "查找并标记密文").
 * Lines are rebuilt from the glyph model so matches can span text runs.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import { getGlyphModel, type PageGlyph } from './glyphModel'

export interface TextHit {
  /** union box of the matched glyphs, pdf user space */
  x0: number
  y0: number
  x1: number
  y1: number
  text: string
}

interface LineText {
  text: string
  /** glyph for each char of `text` (null for inserted spaces) */
  map: (PageGlyph | null)[]
}

function buildLines(glyphs: PageGlyph[]): LineText[] {
  const vis = glyphs.filter((g) => !g.invisible && g.text)
  vis.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PageGlyph[][] = []
  for (const g of vis) {
    const line = lines.find((l) => Math.abs(l[0].y - g.y) < Math.max(1, l[0].size * 0.3))
    if (line) line.push(g)
    else lines.push([g])
  }
  return lines.map((l) => {
    l.sort((a, b) => a.x - b.x)
    let text = ''
    const map: (PageGlyph | null)[] = []
    let prev: PageGlyph | null = null
    for (const g of l) {
      if (prev && !prev.isSpace && !g.isSpace && g.x - (prev.x + prev.adv) > g.size * 0.22) {
        text += ' '
        map.push(null)
      }
      for (const ch of g.text) {
        text += ch
        map.push(g)
      }
      prev = g
    }
    return { text, map }
  })
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')

export async function findTextOnPage(page: PDFPageProxy, query: string): Promise<TextHit[]> {
  const q = norm(query.trim())
  if (!q) return []
  const model = await getGlyphModel(page)
  const hits: TextHit[] = []
  for (const line of buildLines(model.glyphs)) {
    const t = norm(line.text)
    // norm keeps the length when the line has no runs of whitespace; guard anyway
    if (t.length !== line.text.length) continue
    for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
      const gs = line.map.slice(i, i + q.length).filter((g): g is PageGlyph => !!g)
      if (!gs.length) continue
      const asc = (g: PageGlyph) => g.size * 0.82
      const desc = (g: PageGlyph) => g.size * 0.24
      hits.push({
        x0: Math.min(...gs.map((g) => g.x)),
        x1: Math.max(...gs.map((g) => g.x + Math.max(g.w, g.adv))),
        y0: Math.min(...gs.map((g) => g.y - desc(g))),
        y1: Math.max(...gs.map((g) => g.y + asc(g))),
        text: line.text.slice(i, i + q.length),
      })
    }
  }
  return hits
}
