import { tr } from '../i18n/locale'
import { PDFDocument, PDFRef } from 'pdf-lib'
import { pdfjs } from './document'

/** Validate a detached output, without changing the reader's active document. */
export async function validatePdfOutput(
  bytes: Uint8Array,
  expectedPages?: number,
  current: () => boolean = () => true,
): Promise<{ pageCount: number }> {
  const assertCurrent = () => {
    if (!current()) throw new Error(tr('文档已变化，请重新保存'))
  }
  assertCurrent()
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)))
  if (!header.includes('%PDF-') || !/%%EOF\s*$/.test(tail)) throw new Error(tr('导出的 PDF 不完整，未写入文件'))
  const parsed = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
  assertCurrent()
  const pages = parsed.getPages()
  if (!pages.length || (expectedPages !== undefined && pages.length !== expectedPages)) {
    throw new Error(
      tr('导出的 PDF 页数不正确（预期 {0} 页，实际 {1} 页），未写入文件', expectedPages ?? tr('至少 1'), pages.length),
    )
  }
  // Unresolved references must not be hidden by the reader's repair behavior.
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    const visited = new Set<unknown>()
    const visit = (value: unknown): void => {
      if (value instanceof PDFRef) {
        if (!parsed.context.lookup(value)) throw new Error(tr('导出的 PDF 含有缺失对象，未写入文件'))
        return
      }
      if (!value || typeof value !== 'object' || visited.has(value)) return
      visited.add(value)
      const container = value as {
        entries?: () => Iterable<[unknown, unknown]>
        asArray?: () => unknown[]
        dict?: unknown
      }
      if (typeof container.entries === 'function') for (const [, child] of container.entries()) visit(child)
      else if (typeof container.asArray === 'function') for (const child of container.asArray()) visit(child)
      if (container.dict) visit(container.dict)
    }
    visit(object)
  }
  for (const value of Object.values(parsed.context.trailerInfo)) {
    if (value instanceof PDFRef && !parsed.context.lookup(value))
      throw new Error(tr('导出的 PDF 文件尾含有缺失对象，未写入文件'))
  }
  const base = import.meta.env.BASE_URL ?? '/'
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
    stopAtErrors: true,
  })
  try {
    const doc = await task.promise
    assertCurrent()
    if (doc.numPages !== pages.length) throw new Error(tr('两个解析器报告的页数不一致，未写入文件'))
    for (let n = 1; n <= doc.numPages; n++) {
      assertCurrent()
      const page = await doc.getPage(n)
      try {
        const view = page.getViewport({ scale: 1 })
        if (![view.width, view.height].every((v) => Number.isFinite(v) && v > 0))
          throw new Error(tr('第 {0} 页尺寸无效', n))
        await page.getOperatorList()
        await page.getAnnotations({ intent: 'display' })
      } finally {
        page.cleanup()
      }
    }
    assertCurrent()
    return { pageCount: pages.length }
  } finally {
    await task.destroy().catch(() => {})
  }
}
