/**
 * Live preview for edits of ORIGINAL page images (delete / replace).
 *
 * Image ops change the page content itself, so the preview renders a
 * one-page PDF in which those ops are already baked — identical to what
 * "save" produces. Previews are cached per (page, ops) signature.
 */
import { deleteFileAnnotations } from '../annotations'
import { PDFDocument } from 'pdf-lib'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { pdfjs } from '../document'
import { applyPageImageOps, pageImageOpsByPage } from './applyOps'
import type { EditOp } from './ops'

interface Entry {
  sig: string
  promise: Promise<{ doc: PDFDocumentProxy; page: PDFPageProxy } | null>
}

const cache = new Map<number, Entry>()
let srcCache: { bytes: Uint8Array; doc: Promise<PDFDocument> } | null = null

function sigOf(list: Extract<EditOp, { kind: 'page-image' }>[]): string {
  return list.map((o) => `${o.id}:${o.action}:${o.index}:${o.imageData?.length ?? 0}:${o.fit ?? ''}`).join('|')
}

/** ops-signature for a page, '' when it has no image edits */
export function pageImageSignature(ops: EditOp[], pageRef: number): string {
  const list = pageImageOpsByPage(ops).get(pageRef)
  return [
    list?.length ? sigOf(list) : '',
    ...ops.filter((o) => o.kind === 'annot-delete' && o.page === pageRef).map((o) => o.id),
  ]
    .filter(Boolean)
    .join('|')
}

/** a pdf.js page with this page's image edits applied, or null if none */
export function previewPage(
  fileBytes: Uint8Array,
  ops: EditOp[],
  pageRef: number,
): Promise<{ doc: PDFDocumentProxy; page: PDFPageProxy } | null> {
  const list = pageImageOpsByPage(ops).get(pageRef)
  const deleted = ops.filter((o) => o.kind === 'annot-delete' && o.page === pageRef) as Extract<
    EditOp,
    { kind: 'annot-delete' }
  >[]
  if ((!list?.length && !deleted.length) || pageRef <= 0) return Promise.resolve(null)
  if (srcCache?.bytes !== fileBytes) clearImagePreviews()
  const sig = pageImageSignature(ops, pageRef)
  const hit = cache.get(pageRef)
  if (hit && hit.sig === sig) return hit.promise
  if (hit) void hit.promise.then((r) => r?.doc.destroy()).catch(() => undefined)
  const promise = (async () => {
    if (!srcCache || srcCache.bytes !== fileBytes) {
      srcCache = { bytes: fileBytes, doc: PDFDocument.load(fileBytes, { updateMetadata: false }) }
    }
    const src = await srcCache.doc
    // Delete before copying, while annotation IDs still match the source PDF.
    const editable = await PDFDocument.load(await src.save(), { updateMetadata: false })
    if (deleted.length)
      deleteFileAnnotations(
        editable,
        pageRef - 1,
        deleted.map((o) => o.annotId),
      )
    const out = await PDFDocument.create()
    const [copied] = await out.copyPages(editable, [pageRef - 1])
    out.addPage(copied)
    if (list?.length) await applyPageImageOps(out, out.getPage(0), list)
    const bytes = await out.save({ useObjectStreams: false })
    const base = import.meta.env.BASE_URL ?? '/'
    const doc = await pdfjs.getDocument({
      data: bytes,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      isEvalSupported: false,
    }).promise
    return { doc, page: await doc.getPage(1) }
  })().catch((e) => {
    console.warn('[pdf-pro] image preview failed', e)
    return null
  })
  cache.set(pageRef, { sig, promise })
  return promise
}

export function clearImagePreviews(): void {
  for (const e of cache.values()) void e.promise.then((r) => r?.doc.destroy()).catch(() => undefined)
  cache.clear()
  srcCache = null
}
