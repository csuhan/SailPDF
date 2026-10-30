import type { PDFDocumentProxy } from 'pdfjs-dist'
import { safeExternalUrl } from '../utils/externalLinks'
import { useAppStore } from '../state/stores'

/** Minimal IPDFLinkService: internal destinations + external links. */
export function createLinkService(doc: PDFDocumentProxy) {
  return {
    externalLinkTarget: 2, // _blank
    externalLinkRel: 'noopener noreferrer nofollow',
    isInPresentationMode: false,

    async goToDestination(dest: unknown): Promise<void> {
      try {
        let resolved = dest
        if (typeof resolved === 'string') {
          resolved = await doc.getDestination(resolved)
        }
        if (Array.isArray(resolved) && resolved[0]) {
          const pageIndex = await doc.getPageIndex(resolved[0] as never)
          useAppStore.getState().goToPage(pageIndex + 1)
        }
      } catch {
        /* unsupported destination */
      }
    },

    goToPage(val: number | string): void {
      const n = typeof val === 'number' ? val : parseInt(val, 10)
      if (Number.isFinite(n)) useAppStore.getState().goToPage(n)
    },

    getDestinationHash(): string {
      return '#'
    },

    getAnchorUrl(hash: unknown): string {
      return String(hash ?? '#')
    },

    addLinkAttributes(link: HTMLAnchorElement, url: string): void {
      const safe = safeExternalUrl(url)
      if (!safe) {
        link.removeAttribute('href')
        link.setAttribute('aria-disabled', 'true')
        return
      }
      link.href = safe
      link.target = '_blank'
      link.rel = 'noopener noreferrer nofollow'
    },

    setHash(): void {
      /* not implemented (we don't use location hash navigation) */
    },

    executeNamedAction(action: string): void {
      const app = useAppStore.getState()
      switch (action) {
        case 'NextPage':
          app.goToPage(app.currentPage + 1)
          break
        case 'PrevPage':
          app.goToPage(app.currentPage - 1)
          break
        case 'FirstPage':
          app.goToPage(1)
          break
        case 'LastPage':
          app.goToPage(app.numPages)
          break
        default:
          break
      }
    },
  }
}

export type LinkService = ReturnType<typeof createLinkService>
