import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type PageSize } from '../state/stores'
import { useEditStore } from '../state/editStore'
import type { EditOp } from '../pdf/edit/ops'
import { computePageMap, computePageState } from '../pdf/edit/pageOrder'
import { PageCanvas } from './PageCanvas'
import { initViewportController, type ViewportController } from './viewportController'

const GAP = 24
const PAD = 32
const BUFFER_PAGES = 2
const SPREAD_GAP = 12

interface Layout {
  /** display size (css px) per view page (1-based index i-1) */
  sizes: { width: number; height: number }[]
  /** top offset (css px) per view page */
  tops: number[]
  /** x of each page relative to the column center */
  lefts: number[]
  totalHeight: number
  maxWidth: number
}

function viewPageSizes(
  numPages: number,
  pageMap: number[],
  baseSizes: Map<number, PageSize>,
  ops: EditOp[],
  displayRotation: number, // 0|90|180|270 combined
  originalCount: number,
): { width: number; height: number }[] {
  const fallback: PageSize = baseSizes.get(1) ?? { width: 612, height: 792 }
  const out: { width: number; height: number }[] = []
  const state = computePageState(originalCount, ops)
  for (let v = 1; v <= numPages; v++) {
    const o = pageMap[v - 1] ?? v
    let size: PageSize
    let extraRot = 0
    if (o < 0) {
      size = state.blankSizes.get(o) ?? fallback
    } else {
      size = baseSizes.get(o) ?? fallback
    }
    extraRot = state.rotations.get(o) ?? 0
    // view rotation + per-page rotation together decide the orientation
    const sw = (((displayRotation + extraRot) % 180) + 180) % 180 !== 0
    out.push(sw ? { width: size.height, height: size.width } : { width: size.width, height: size.height })
  }
  return out
}

export function PageViewport() {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const numPages = useAppStore((s) => s.numPages)
  const pageSizes = useAppStore((s) => s.pageSizes)
  const scale = useAppStore((s) => s.scale)
  const fitMode = useAppStore((s) => s.fitMode)
  const viewMode = useAppStore((s) => s.viewMode)
  const rotation = useAppStore((s) => s.rotation)
  const currentPage = useAppStore((s) => s.currentPage)
  const sidebar = useAppStore((s) => s.sidebar)
  const navRequest = useAppStore((s) => s.navRequest)
  const ops = useEditStore((s) => s.ops)

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [range, setRange] = useState<[number, number]>([1, 1])
  const rafRef = useRef(0)
  const anchorRef = useRef<{ page: number; fracY: number } | null>(null)

  const pageMap = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops) : []), [pdfDoc, ops])
  const viewPageCount = pageMap.length || numPages

  const layout: Layout = useMemo(() => {
    const sizes = viewPageSizes(viewPageCount, pageMap, pageSizes, ops, rotation % 360, pdfDoc?.numPages ?? 0).map(
      (s) => ({ width: s.width * scale, height: s.height * scale }),
    )
    const tops: number[] = []
    const lefts: number[] = []
    let acc = GAP
    let maxWidth = 0
    if (viewMode === 'spread') {
      // two pages side by side (cover alone, like a printed book)
      for (let i = 0; i < sizes.length; ) {
        const pair = i === 0 ? [i] : [i, i + 1].filter((k) => k < sizes.length)
        const h = Math.max(...pair.map((k) => sizes[k].height))
        const w = pair.reduce((a, k) => a + sizes[k].width, 0) + (pair.length - 1) * SPREAD_GAP
        let x = -w / 2
        for (const k of pair) {
          tops.push(acc + (h - sizes[k].height) / 2)
          lefts.push(x)
          x += sizes[k].width + SPREAD_GAP
        }
        maxWidth = Math.max(maxWidth, i === 0 ? sizes[0].width * 2 + SPREAD_GAP : w)
        acc += h + GAP
        i += pair.length
      }
    } else {
      for (const s of sizes) {
        tops.push(acc)
        lefts.push(-s.width / 2)
        acc += s.height + GAP
        maxWidth = Math.max(maxWidth, s.width)
      }
    }
    // extra room at the end so the floating view controls never cover the last page
    return { sizes, tops, lefts, totalHeight: acc + 56, maxWidth }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPageCount, pageMap, pageSizes, ops, rotation, scale, viewMode])

  // ── container resize ─────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [pdfDoc])

  // ── fit-to-width / fit-to-page scaling ───────────────────
  useEffect(() => {
    if (!pdfDoc || fitMode === 'custom' || containerSize.w <= 0) return
    const idx = Math.min(currentPage, viewPageCount) - 1
    const page = layout.sizes[idx]
    if (!page) return
    const w1 = page.width / scale
    const h1 = page.height / scale
    // leave room around the page and cap the reading width on wide screens
    const availW = Math.max(50, Math.min(containerSize.w - 96, 1040))
    const availH = Math.max(50, containerSize.h - PAD * 2 - 72)
    const across = viewMode === 'spread' ? 2 : 1
    const sW = (availW - (across - 1) * SPREAD_GAP) / (w1 * across)
    const sP = Math.min((availW - (across - 1) * SPREAD_GAP) / (w1 * across), availH / h1)
    const target = fitMode === 'fit-width' ? sW : sP
    const s = useAppStore.getState()
    if (Math.abs(target - s.scale) > 0.005) {
      s.setScale(target, fitMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, containerSize, pdfDoc, viewMode, sidebar, currentPage])

  // ── scroll bookkeeping (current page + visible range) ────
  const recomputeFromScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const st = el.scrollTop
    const ch = el.clientHeight
    const { tops, sizes } = layout
    if (tops.length === 0) return
    // binary search page containing viewport top
    let lo = 0
    let hi = tops.length - 1
    let first = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const bottom = tops[mid] + sizes[mid].height
      if (bottom < st) lo = mid + 1
      else {
        first = mid
        hi = mid - 1
      }
    }
    let last = first
    const limit = st + ch
    while (last + 1 < tops.length && tops[last + 1] < limit) last++
    setRange([Math.max(1, first + 1 - BUFFER_PAGES), Math.min(tops.length, last + 1 + BUFFER_PAGES)])

    // current page: page containing viewport center, else the most visible
    const center = st + ch * 0.4
    let cur = 0
    if (center < tops[0]) cur = 0
    else {
      let l = 0
      let h = tops.length - 1
      while (l <= h) {
        const mid = (l + h) >> 1
        if (tops[mid] <= center) {
          cur = mid
          l = mid + 1
        } else h = mid - 1
      }
    }
    const st8 = useAppStore.getState()
    if (st8.viewMode !== 'single') st8.setCurrentPage(cur + 1)
  }, [layout])

  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      recomputeFromScroll()
    })
  }, [recomputeFromScroll])

  useEffect(() => {
    recomputeFromScroll()
  }, [recomputeFromScroll])

  // ── navigation requests (go to page) ─────────────────────
  useEffect(() => {
    if (!navRequest) return
    const el = containerRef.current
    if (!el || viewMode === 'single') return
    const idx = Math.min(navRequest.page, viewPageCount) - 1
    const top = layout.tops[idx]
    if (typeof top === 'number') {
      el.scrollTop = Math.max(0, top - GAP)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.seq])

  // ── anchor-preserving helper for zoom/rotate ─────────────
  const captureAnchor = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { tops, sizes } = layout
    const center = el.scrollTop + el.clientHeight / 2
    let i = 0
    if (tops.length) {
      let lo = 0
      let hi = tops.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (tops[mid] <= center) {
          i = mid
          lo = mid + 1
        } else hi = mid - 1
      }
    }
    anchorRef.current = {
      page: i + 1,
      fracY: sizes[i] ? (center - tops[i]) / sizes[i].height : 0,
    }
  }, [layout])

  const restoreAnchor = useCallback(() => {
    const a = anchorRef.current
    const el = containerRef.current
    if (!a || !el) return
    const idx = Math.min(a.page, layout.tops.length) - 1
    const top = layout.tops[idx]
    const size = layout.sizes[idx]
    if (top === undefined || !size) return
    el.scrollTop = Math.max(0, top + a.fracY * size.height - el.clientHeight / 2)
  }, [layout])

  useLayoutEffectAnchor(restoreAnchor, [scale, rotation, viewMode])

  // ── zoom controller for toolbar/shortcuts ────────────────
  useEffect(() => {
    const controller: ViewportController = {
      zoomBy: (factor: number) => {
        const s = useAppStore.getState()
        captureAnchor()
        s.setScale(s.scale * factor, 'custom')
      },
      scrollToPage: (page: number) => {
        const el = containerRef.current
        const st = useAppStore.getState()
        if (!el || st.viewMode === 'single') return
        const idx = Math.min(page, layout.tops.length) - 1
        const top = layout.tops[idx]
        if (typeof top === 'number') el.scrollTop = Math.max(0, top - GAP)
      },
      scrollByPx: (dy: number) => {
        containerRef.current?.scrollBy({ top: dy, behavior: 'smooth' })
      },
      scrollScreen: (dir: 1 | -1) => {
        const el = containerRef.current
        if (el) el.scrollBy({ top: dir * el.clientHeight * 0.92, behavior: 'smooth' })
      },
      scrollToStart: () => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      },
      scrollToEnd: () => {
        const el = containerRef.current
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      },
    }
    return initViewportController(controller)
  }, [captureAnchor, layout])

  // ctrl/cmd + wheel zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const s = useAppStore.getState()
      captureAnchor()
      s.setScale(s.scale * factor, 'custom')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [captureAnchor])

  if (!pdfDoc) return null

  if (viewMode === 'single') {
    const idx = Math.min(currentPage, viewPageCount) - 1
    const size = layout.sizes[idx]
    return (
      <div className="viewport single" ref={containerRef}>
        {size && (
          <div
            className="single-page-center"
            style={{ minWidth: size.width + PAD * 2, minHeight: size.height + PAD * 2 }}
          >
            <PageCanvas page={idx + 1} width={size.width} height={size.height} />
          </div>
        )}
      </div>
    )
  }

  const { totalHeight, maxWidth } = layout
  const innerWidth = Math.max(containerSize.w, maxWidth + PAD * 2)

  return (
    <div className="viewport" ref={containerRef} onScroll={onScroll}>
      <div className="pages-inner" style={{ height: totalHeight, width: innerWidth }}>
        {Array.from({ length: range[1] - range[0] + 1 }, (_, k) => {
          const p = range[0] + k
          const size = layout.sizes[p - 1]
          const top = layout.tops[p - 1]
          if (!size) return null
          return (
            <div
              key={`${p}-${size.width}x${size.height}`}
              className="page-slot"
              style={{
                top,
                left: Math.max(PAD, innerWidth / 2 + layout.lefts[p - 1]),
                width: size.width,
                height: size.height,
              }}
            >
              <PageCanvas page={p} width={size.width} height={size.height} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** run effect after layout changes finish painting scroll positions */
import { useLayoutEffect } from 'react'
function useLayoutEffectAnchor(cb: () => void, deps: unknown[]) {
  const first = useRef(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    cb()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
