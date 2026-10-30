import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy }
export { pdfjs }

let currentDoc: PDFDocumentProxy | null = null

const formListeners = new Set<(modified: boolean) => void>()
/** notified when form fields are changed / reset */
export function onFormModified(fn: (modified: boolean) => void): () => void {
  formListeners.add(fn)
  return () => formListeners.delete(fn)
}

/** does the open document have filled-in form values not yet saved? */
export function hasFormChanges(): boolean {
  return (currentDoc?.annotationStorage.size ?? 0) > 0
}

/**
 * bytes of the open document with the current form values written in
 * (pdf.js serializes field values + appearance streams); null when no
 * field was touched
 */
export async function bytesWithFormValues(): Promise<Uint8Array | null> {
  if (!currentDoc || currentDoc.annotationStorage.size === 0) return null
  return await currentDoc.saveDocument()
}

export function getCurrentDoc(): PDFDocumentProxy | null {
  return currentDoc
}

export async function openPdf(
  data: Uint8Array,
  accept: () => boolean = () => true,
  keepPrevious = false,
  beforeActivate: () => void | Promise<void> = () => {},
): Promise<PDFDocumentProxy | null> {
  const base = import.meta.env.BASE_URL ?? '/'
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    // performance / robustness flags
    isEvalSupported: false,
    disableFontFace: false,
    // keep per-font encoding/width/glyph tables so edits can re-encode text
    // with the document's own embedded fonts (see pdf/edit/fontEncoder.ts)
    fontExtraProperties: true,
  })
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (error) {
    await task.destroy().catch(() => {})
    throw error
  }
  if (!accept()) {
    await doc.destroy()
    return null
  }
  const previous = currentDoc
  try {
    await beforeActivate()
  } catch (error) {
    await doc.destroy()
    throw error
  }
  if (!accept()) {
    await doc.destroy()
    return null
  }
  activatePdf(doc)
  if (previous) {
    if (!keepPrevious) void previous.destroy().catch(() => {})
  }
  return doc
}

/** Switch the active form store without destroying background tabs. */
export function activatePdf(doc: PDFDocumentProxy | null): void {
  if (currentDoc) {
    currentDoc.annotationStorage.onSetModified = null
    currentDoc.annotationStorage.onResetModified = null
  }
  currentDoc = doc
  if (!doc) return
  // form field edits count as unsaved changes
  doc.annotationStorage.onSetModified = () => formListeners.forEach((f) => f(true))
  // PDF.js resets this flag when merely serializing a form (print/export).
  // Only a successful app save or document replacement may mark it clean.
  doc.annotationStorage.onResetModified = () => {}
}

export async function closePdf(): Promise<void> {
  const previous = currentDoc
  currentDoc = null
  if (previous) {
    previous.annotationStorage.onSetModified = null
    previous.annotationStorage.onResetModified = null
    try {
      await previous.destroy()
    } catch {
      /* ignore */
    }
  }
}

/** page render concurrency limiter */
let running = 0
const MAX_CONCURRENT = 4
const waiters: Array<() => void> = []

export async function acquireRenderSlot(): Promise<() => void> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((res) => waiters.push(res))
  }
  running++
  let released = false
  return () => {
    if (released) return
    released = true
    running--
    const next = waiters.shift()
    if (next) next()
  }
}
