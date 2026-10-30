import { PDFDocument } from 'pdf-lib'

/** Merge several PDFs (in order) into one document. */
export async function mergePdfBuffers(buffers: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { updateMetadata: false })
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  return out.save({ useObjectStreams: true })
}

export interface PageRange {
  from: number // 1-based inclusive
  to: number // 1-based inclusive
}

/** Split a PDF into multiple files, one per range. */
export async function splitPdfBuffer(bytes: Uint8Array, ranges: PageRange[]): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false })
  const n = src.getPageCount()
  const results: Uint8Array[] = []
  for (const r of ranges) {
    const from = Math.max(1, Math.min(n, r.from))
    const to = Math.max(from, Math.min(n, r.to))
    const out = await PDFDocument.create()
    const idx: number[] = []
    for (let i = from - 1; i < to; i++) idx.push(i)
    const pages = await out.copyPages(src, idx)
    for (const p of pages) out.addPage(p)
    results.push(await out.save({ useObjectStreams: true }))
  }
  return results
}

/** Extract specific pages (1-based, order preserved) into a new PDF. */
export async function extractPagesFromBuffer(bytes: Uint8Array, pages1Based: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false })
  const n = src.getPageCount()
  const idx = pages1Based.map((p) => p - 1).filter((p) => p >= 0 && p < n)
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, idx)
  for (const p of pages) out.addPage(p)
  return out.save({ useObjectStreams: true })
}

/** every N pages → contiguous ranges */
export function rangesEveryN(numPages: number, n: number): PageRange[] {
  const out: PageRange[] = []
  for (let from = 1; from <= numPages; from += n) {
    out.push({ from, to: Math.min(numPages, from + n - 1) })
  }
  return out
}

/** parse "1-3, 5, 7-9" into ranges (clamped later) */
export function parseRanges(text: string, numPages: number): PageRange[] | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const ranges: PageRange[] = []
  for (const p of parts) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(p)
    if (!m) return null
    const from = parseInt(m[1], 10)
    const to = m[2] ? parseInt(m[2], 10) : from
    if (from < 1 || to < from || from > numPages) return null
    ranges.push({ from, to: Math.min(to, numPages) })
  }
  return ranges
}
