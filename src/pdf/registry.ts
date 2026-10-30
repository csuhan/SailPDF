import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'

export interface PageRuntime {
  page: PDFPageProxy
  /** the CSS-scale viewport currently displayed (rotation applied) */
  viewport: PageViewport
  cssScale: number
  totalRotation: number
}

/**
 * Latest loaded page proxies & viewports, keyed by *view* page number.
 * Interactive tools use this to convert pointer ⇄ PDF coordinates.
 */
const registry = new Map<number, PageRuntime>()

export function setPageRuntime(viewPage: number, rt: PageRuntime): void {
  registry.set(viewPage, rt)
}

export function getPageRuntime(viewPage: number): PageRuntime | undefined {
  return registry.get(viewPage)
}

export function clearPageRegistry(): void {
  registry.clear()
}
