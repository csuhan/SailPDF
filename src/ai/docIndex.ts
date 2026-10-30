/**
 * Document index for AI reading: the text of every page split into
 * numbered passages ("p3#2") with their geometry, so answers can cite
 * passages and the viewer can jump to + highlight the quoted text.
 *
 * Retrieval is local (BM25 over passages, CJK bigrams + latin words).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface Passage {
  id: string
  page: number
  text: string
  /** union box in pdf user space (for highlight) */
  box: { x0: number; y0: number; x1: number; y1: number }
}

export interface DocIndex {
  passages: Passage[]
  pages: number
  /** total characters */
  chars: number
  outline: { title: string; page: number }[]
  search: (query: string, k: number) => Passage[]
}

interface Line {
  text: string
  x0: number
  x1: number
  y: number
  h: number
}

/** text lines of a page (items merged by baseline) */
async function pageLines(doc: PDFDocumentProxy, p: number): Promise<Line[]> {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  const lines: Line[] = []
  let cur: Line | null = null
  for (const it of tc.items) {
    if (!('str' in it)) continue
    const [, , , d, e, f] = it.transform as number[]
    const h = Math.abs(d) || it.height || 10
    const s = it.str
    if (cur && Math.abs(cur.y - f) < h * 0.5 && e >= cur.x0 - h) {
      // same line: add a space when there is a visible gap
      if (s && cur.text && e - cur.x1 > h * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(s)) cur.text += ' '
      cur.text += s
      cur.x1 = Math.max(cur.x1, e + it.width)
      cur.h = Math.max(cur.h, h)
    } else {
      if (cur && cur.text.trim()) lines.push(cur)
      cur = { text: s, x0: e, x1: e + it.width, y: f, h }
    }
    if (it.hasEOL && cur) {
      if (cur.text.trim()) lines.push(cur)
      cur = null
    }
  }
  if (cur && cur.text.trim()) lines.push(cur)
  return lines
}

/** group lines into paragraphs: vertical gap or indentation breaks them */
function paragraphs(lines: Line[], page: number): Passage[] {
  const out: Passage[] = []
  let buf: Line[] = []
  const flush = () => {
    if (!buf.length) return
    let text = ''
    for (const l of buf) {
      const t = l.text.trim()
      if (!text) text = t
      else if (/-$/.test(text) && /^[a-z]/.test(t))
        text = text.slice(0, -1) + t // hyphenation
      else if (/[\u3400-\u9fff]$/.test(text) && /^[\u3400-\u9fff]/.test(t)) text += t
      else text += ' ' + t
    }
    out.push({
      id: `p${page}#${out.length + 1}`,
      page,
      text,
      box: {
        x0: Math.min(...buf.map((l) => l.x0)),
        x1: Math.max(...buf.map((l) => l.x1)),
        y0: Math.min(...buf.map((l) => l.y - l.h * 0.25)),
        y1: Math.max(...buf.map((l) => l.y + l.h * 0.85)),
      },
    })
    buf = []
  }
  for (const l of lines) {
    const prev = buf[buf.length - 1]
    if (prev) {
      const gap = prev.y - l.y
      const bigGap = gap > prev.h * 1.75 || gap < -prev.h * 0.5
      const sizeChange = Math.abs(l.h - prev.h) > prev.h * 0.25
      const len = buf.reduce((a, x) => a + x.text.length, 0)
      if (bigGap || sizeChange || len > 900) flush()
    }
    buf.push(l)
  }
  flush()
  // merge tiny fragments (page numbers, single words) into neighbours
  const merged: Passage[] = []
  for (const p of out) {
    const last = merged[merged.length - 1]
    if (last && p.text.length < 25 && last.text.length < 600) {
      last.text += ' ' + p.text
      last.box = {
        x0: Math.min(last.box.x0, p.box.x0),
        x1: Math.max(last.box.x1, p.box.x1),
        y0: Math.min(last.box.y0, p.box.y0),
        y1: Math.max(last.box.y1, p.box.y1),
      }
    } else merged.push({ ...p })
  }
  return merged.map((p, i) => ({ ...p, id: `p${page}#${i + 1}` }))
}

/** tokens for retrieval: latin words + CJK bigrams */
export function terms(s: string): string[] {
  const out: string[] = []
  const lower = s.toLowerCase()
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9_.-]*/g)) if (m[0].length > 1) out.push(m[0])
  for (const m of lower.matchAll(/[\u3400-\u9fff]+/g)) {
    const t = m[0]
    if (t.length === 1) out.push(t)
    for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2))
  }
  return out
}

const STOP = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'is',
  'for',
  'on',
  'that',
  'with',
  'as',
  'by',
  'are',
  'be',
  'this',
  'an',
  'it',
  'at',
  'or',
  'from',
  'we',
  'our',
  'what',
  'which',
  'how',
])

function bm25(passages: Passage[]) {
  const docs = passages.map((p) => terms(p.text))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length)
  const N = docs.length
  const tf = docs.map((d) => {
    const m = new Map<string, number>()
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  })
  return (query: string, k: number): Passage[] => {
    const q = Array.from(new Set(terms(query))).filter((t) => !STOP.has(t))
    if (!q.length) return []
    const scored = passages.map((p, i) => {
      let s = 0
      const len = docs[i].length
      for (const t of q) {
        const f = tf[i].get(t)
        if (!f) continue
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / avg)))
      }
      return { p, s }
    })
    return scored
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.p)
  }
}

async function flatOutline(doc: PDFDocumentProxy): Promise<{ title: string; page: number }[]> {
  const out: { title: string; page: number }[] = []
  try {
    const ol = await doc.getOutline()
    const walk = async (items: typeof ol, depth: number) => {
      for (const it of items ?? []) {
        let page = 0
        try {
          const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
          if (dest && dest[0]) page = (await doc.getPageIndex(dest[0] as never)) + 1
        } catch {
          /* unresolved */
        }
        out.push({ title: '  '.repeat(depth) + it.title, page })
        if (depth < 2) await walk(it.items, depth + 1)
      }
    }
    await walk(ol, 0)
  } catch {
    /* no outline */
  }
  return out
}

const cache = new WeakMap<PDFDocumentProxy, Promise<DocIndex>>()

export function getDocIndex(
  doc: PDFDocumentProxy,
  progress?: (done: number, total: number) => void,
): Promise<DocIndex> {
  let p = cache.get(doc)
  if (!p) {
    p = (async () => {
      const passages: Passage[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        progress?.(i - 1, doc.numPages)
        passages.push(...paragraphs(await pageLines(doc, i), i))
      }
      progress?.(doc.numPages, doc.numPages)
      const outline = await flatOutline(doc)
      return {
        passages,
        pages: doc.numPages,
        chars: passages.reduce((a, x) => a + x.text.length, 0),
        outline,
        search: bm25(passages),
      }
    })()
    cache.set(doc, p)
    p.catch(() => cache.delete(doc))
  }
  return p
}

/** passages as prompt context: "[p3#2] text" lines */
export function formatPassages(ps: Passage[], maxChars: number): string {
  let out = ''
  for (const p of ps) {
    const line = `[${p.id}] ${p.text}\n`
    if (out.length + line.length > maxChars) {
      if (!out) out = line.slice(0, maxChars)
      break
    }
    out += line
  }
  return out
}

/**
 * context for a whole-document task within a character budget: everything
 * when it fits, otherwise an even sample (start of each page first)
 */
export function documentContext(idx: DocIndex, budget: number): string {
  if (idx.chars + idx.passages.length * 8 <= budget) return formatPassages(idx.passages, budget)
  const perPage = Math.max(200, Math.floor(budget / idx.pages))
  const byPage = new Map<number, Passage[]>()
  for (const p of idx.passages) (byPage.get(p.page) ?? byPage.set(p.page, []).get(p.page)!).push(p)
  let out = ''
  for (const [, ps] of byPage) {
    let used = 0
    for (const p of ps) {
      const t = p.text.length + used > perPage ? p.text.slice(0, Math.max(0, perPage - used)) : p.text
      if (!t) break
      out += `[${p.id}] ${t}\n`
      used += t.length
      if (used >= perPage) break
    }
  }
  return out.slice(0, budget)
}
