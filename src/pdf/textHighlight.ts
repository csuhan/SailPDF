/**
 * Find text matches inside a rendered PDF.js text layer and draw
 * absolutely positioned highlight rectangles (Acrobat-style search marks).
 */

export interface HighlightSpec {
  /** substring to highlight (case-insensitive) */
  query: string
  /** which match-on-page should be styled as the "active" one */
  activeIndexOnPage: number
}

interface TextNodeInfo {
  node: Text
  start: number // global char offset
}

export function renderSearchHighlights(
  textLayer: HTMLElement,
  highlightRoot: HTMLElement,
  spec: HighlightSpec | null,
): void {
  highlightRoot.innerHTML = ''
  if (!spec || !spec.query.trim()) return
  const q = spec.query.trim().toLowerCase()

  // gather text nodes in document order
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  const infos: TextNodeInfo[] = []
  let combined = ''
  let n = walker.nextNode()
  while (n) {
    infos.push({ node: n as Text, start: combined.length })
    combined += (n as Text).data
    n = walker.nextNode()
  }
  if (!combined) return

  const lower = combined.toLowerCase()
  let matchIdx = lower.indexOf(q)
  let indexOnPage = 0
  while (matchIdx >= 0) {
    const end = matchIdx + q.length
    const isActive = indexOnPage === spec.activeIndexOnPage
    // gather rects from each node that overlaps [matchIdx, end)
    for (const info of infos) {
      const nodeStart = info.start
      const nodeEnd = info.start + info.node.data.length
      const from = Math.max(matchIdx, nodeStart)
      const to = Math.min(end, nodeEnd)
      if (from >= to) continue
      const range = document.createRange()
      range.setStart(info.node, from - nodeStart)
      range.setEnd(info.node, to - nodeStart)
      for (const rect of range.getClientRects()) {
        addRect(highlightRoot, rect, isActive)
      }
      range.detach()
    }
    indexOnPage++
    matchIdx = lower.indexOf(q, matchIdx + 1)
  }
}

function addRect(root: HTMLElement, clientRect: DOMRect, active: boolean): void {
  const rootRect = root.getBoundingClientRect()
  const div = document.createElement('div')
  div.className = active ? 'search-highlight active' : 'search-highlight'
  const x = clientRect.left - rootRect.left
  const y = clientRect.top - rootRect.top
  div.style.transform = `translate(${x}px, ${y}px)`
  div.style.width = `${clientRect.width}px`
  div.style.height = `${clientRect.height}px`
  root.appendChild(div)
}
