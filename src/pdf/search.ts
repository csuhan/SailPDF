import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export interface PageText {
  /** concatenated plain text of the page */
  text: string
}

// A page number is only unique inside one document. Keeping the proxy as the
// key also prevents an old, cancelled scan from populating a new file's cache.
let pageTextCache = new WeakMap<PDFPageProxy, Promise<PageText>>()

export function clearTextCache(): void {
  pageTextCache = new WeakMap()
}

export async function getPageText(page: PDFPageProxy): Promise<PageText> {
  const cache = pageTextCache
  const cached = cache.get(page)
  if (cached) return cached
  const pending = page.getTextContent().then((content) => {
    let text = ''
    for (const item of content.items) {
      if ('str' in item) text += item.str
      if ('hasEOL' in item && item.hasEOL) text += '\n'
      else text += ' '
    }
    return { text }
  })
  cache.set(page, pending)
  try {
    return await pending
  } catch (e) {
    cache.delete(page)
    throw e
  }
}

export interface SearchMatch {
  /** global match index */
  index: number
  /** 1-based view page number (after page reordering / deletion) */
  page: number
  /** match index within its page */
  indexOnPage: number
}

export interface SearchResult {
  matches: SearchMatch[]
  pageMatchCounts: Map<number, number>
}

export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  onProgress?: (scannedPages: number) => void,
  shouldCancel?: () => boolean,
  /** View page -> original page. Negative references represent blank pages. */
  pageMap?: readonly number[],
): Promise<SearchResult> {
  const q = query.trim().toLowerCase()
  const matches: SearchMatch[] = []
  const pageMatchCounts = new Map<number, number>()
  if (!q) return { matches, pageMatchCounts }

  let globalIndex = 0
  const pages = pageMap ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
  for (let i = 0; i < pages.length; i++) {
    if (shouldCancel?.()) break
    const p = i + 1
    const ref = pages[i]
    if (ref <= 0) {
      onProgress?.(p)
      continue
    }
    const page = await doc.getPage(ref)
    if (shouldCancel?.()) break
    const { text } = await getPageText(page)
    if (shouldCancel?.()) break
    const lower = text.toLowerCase()
    let idx = lower.indexOf(q)
    let indexOnPage = 0
    while (idx >= 0) {
      matches.push({ index: globalIndex++, page: p, indexOnPage: indexOnPage++ })
      idx = lower.indexOf(q, idx + 1)
    }
    if (indexOnPage > 0) pageMatchCounts.set(p, indexOnPage)
    onProgress?.(p)
  }
  return { matches, pageMatchCounts }
}
