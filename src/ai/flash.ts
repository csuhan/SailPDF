/**
 * Jump to a cited passage and flash a highlight over it (AI citations).
 * The flash box is drawn in the page's highlight layer, in pdf coordinates
 * converted through the page's live viewport.
 */
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { computePageMap } from '../pdf/edit/pageOrder'
import { getPageRuntime } from '../pdf/registry'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** view page showing an original page (pages may be reordered) */
export function viewPageOf(originalPage: number): number {
  const app = useAppStore.getState()
  const map = app.pdfDoc ? computePageMap(app.pdfDoc.numPages, useEditStore.getState().ops) : []
  const i = map.indexOf(originalPage)
  return i >= 0 ? i + 1 : originalPage
}

export function jumpToPassage(originalPage: number, box?: Box | null, boxes?: Box[]): void {
  const view = viewPageOf(originalPage)
  useAppStore.getState().goToPage(view)
  const list = boxes?.length ? boxes : box ? [box] : []
  if (!list.length) return
  // the page may need a moment to mount / render after scrolling
  let tries = 0
  const draw = () => {
    const rt = getPageRuntime(view)
    const host = document.querySelector(`.page-box[data-page="${view}"] .highlight-layer`) as HTMLElement | null
    if (!rt || !host) {
      if (tries++ < 30) window.setTimeout(draw, 80)
      return
    }
    host.querySelectorAll('.ai-flash').forEach((e) => e.remove())
    let first: HTMLElement | null = null
    for (const b of list) {
      const [ax, ay] = rt.viewport.convertToViewportPoint(b.x0, b.y1)
      const [bx, by] = rt.viewport.convertToViewportPoint(b.x1, b.y0)
      const el = document.createElement('div')
      el.className = 'ai-flash'
      el.style.left = `${Math.min(ax, bx) - 3}px`
      el.style.top = `${Math.min(ay, by) - 2}px`
      el.style.width = `${Math.abs(bx - ax) + 6}px`
      el.style.height = `${Math.abs(by - ay) + 4}px`
      host.appendChild(el)
      first ??= el
      window.setTimeout(() => el.remove(), 4200)
    }
    // bring the passage itself into view (not just the page top)
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  window.setTimeout(draw, 120)
}
