/**
 * "比较文件" (Acrobat: Compare Files): word-level text diff of two PDFs,
 * page by page, plus a pixel diff overview of each page pair.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface DiffToken {
  text: string
  op: 'same' | 'add' | 'del'
}

export interface PageDiff {
  /** 1-based page numbers (0 = page missing on that side) */
  a: number
  b: number
  tokens: DiffToken[]
  added: number
  removed: number
}

/** split into words; CJK characters are tokens on their own */
export function tokenize(text: string): string[] {
  return text.match(/[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9_\u00c0-\u024f'’.-]+|[^\sA-Za-z0-9_\u3400-\u9fff]/g) ?? []
}

/** Myers-style LCS diff on token arrays (O(ND), fine for page-sized input) */
export function diffTokens(a: string[], b: string[]): DiffToken[] {
  const n = a.length
  const m = b.length
  const max = n + m
  const v = new Map<number, number>([[1, 0]])
  const trace: Map<number, number>[] = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))
          ? (v.get(k + 1) ?? 0)
          : (v.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v.set(k, x)
      if (x >= n && y >= m) break outer
    }
    // give up on pathological input: report a full replace
    if (d > 4000) {
      return [
        ...a.map((t): DiffToken => ({ text: t, op: 'del' })),
        ...b.map((t): DiffToken => ({ text: t, op: 'add' })),
      ]
    }
  }
  // backtrack
  const out: DiffToken[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1
    const prevX = vv.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ text: a[x - 1], op: 'same' })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) out.push({ text: b[y - 1], op: 'add' })
      else out.push({ text: a[x - 1], op: 'del' })
    }
    x = prevX
    y = prevY
  }
  return out.reverse()
}

async function pageText(doc: PDFDocumentProxy, p: number): Promise<string> {
  const tc = await (await doc.getPage(p)).getTextContent()
  let s = ''
  for (const it of tc.items) {
    if (!('str' in it)) continue
    s += it.str
    s += it.hasEOL ? '\n' : ''
  }
  return s
}

export async function compareDocuments(
  a: PDFDocumentProxy,
  b: PDFDocumentProxy,
  progress?: (done: number, total: number) => void,
): Promise<PageDiff[]> {
  const pages = Math.max(a.numPages, b.numPages)
  const out: PageDiff[] = []
  for (let i = 1; i <= pages; i++) {
    progress?.(i - 1, pages)
    const ta = i <= a.numPages ? tokenize(await pageText(a, i)) : []
    const tb = i <= b.numPages ? tokenize(await pageText(b, i)) : []
    const tokens = diffTokens(ta, tb)
    out.push({
      a: i <= a.numPages ? i : 0,
      b: i <= b.numPages ? i : 0,
      tokens,
      added: tokens.filter((t) => t.op === 'add').length,
      removed: tokens.filter((t) => t.op === 'del').length,
    })
  }
  progress?.(pages, pages)
  return out
}
