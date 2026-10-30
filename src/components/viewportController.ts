/** tiny singleton so Toolbar / keyboard can drive the scroll viewport */

export interface ViewportController {
  zoomBy: (factor: number) => void
  scrollToPage: (page: number) => void
  scrollByPx: (dy: number) => void
  scrollScreen: (dir: 1 | -1) => void
  scrollToStart: () => void
  scrollToEnd: () => void
}

let current: ViewportController | null = null

export function initViewportController(c: ViewportController): () => void {
  current = c
  return () => {
    if (current === c) current = null
  }
}

export function getViewportController(): ViewportController | null {
  return current
}
