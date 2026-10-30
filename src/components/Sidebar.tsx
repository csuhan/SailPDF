import { tr, onLocaleChange } from '../i18n/locale'
import { useLocale } from '../i18n/react'
import { memo, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { acquireRenderSlot } from '../pdf/document'
import { IconBookmark, IconComments, IconGrid, IconList, IconPenLine } from './icons'
import { AnnotationsPanel } from './AnnotationsPanel'
import { BookmarksPanel } from './BookmarksPanel'
import type { SidebarTab } from '../state/stores'

function createTabs(): [SidebarTab, string, React.ReactNode][] {
  return [
    ['thumbs', tr('页面缩略图'), <IconGrid size={15} />],
    ['outline', tr('目录'), <IconList size={15} />],
    ['bookmarks', tr('书签'), <IconBookmark size={15} />],
    ['annots', tr('批注列表'), <IconComments size={15} />],
    ['changes', tr('本次的所有修改'), <IconPenLine size={15} />],
  ]
}

let TABS: [SidebarTab, string, React.ReactNode][] = createTabs()
import { ChangesList } from './ChangesList'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>> extends (infer T)[] | null ? T : never

export function Sidebar() {
  const sidebar = useAppStore((s) => s.sidebar)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const setSidebar = useAppStore((s) => s.setSidebar)
  // the page organizer is itself a page grid: no thumbnail rail next to it
  const mode = useToolStore((s) => s.mode)
  const changeCount = useEditStore((s) => s.ops.length)
  if (!pdfDoc || sidebar === 'none' || mode === 'pages' || mode === 'tools') return null
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={sidebar === id}
            aria-label={label}
            className={sidebar === id ? 'active' : ''}
            onClick={() => setSidebar(id)}
            title={label}
          >
            {icon}
            {id === 'changes' && changeCount > 0 && <span className="tab-count">{changeCount}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {sidebar === 'thumbs' ? (
          <Thumbnails doc={pdfDoc} />
        ) : sidebar === 'outline' ? (
          <Outline doc={pdfDoc} />
        ) : sidebar === 'annots' ? (
          <AnnotationsPanel />
        ) : sidebar === 'bookmarks' ? (
          <BookmarksPanel />
        ) : (
          <ChangesList />
        )}
      </div>
    </aside>
  )
}

const THUMB_WIDTH = 112

const Thumb = memo(function Thumb({ page, doc }: { page: number; doc: PDFDocumentProxy }) {
  useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const currentPage = useAppStore((s) => s.currentPage)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setVisible(true)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let release: (() => void) | null = null
    ;(async () => {
      try {
        const page1 = await doc.getPage(page)
        if (cancelled) return
        const vp0 = page1.getViewport({ scale: 1 })
        const scale = THUMB_WIDTH / vp0.width
        const vp = page1.getViewport({ scale: scale * 1.6 })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)
        canvas.style.width = `${Math.round(vp0.width * scale)}px`
        canvas.style.height = `${Math.round(vp0.height * scale)}px`
        release = await acquireRenderSlot()
        if (cancelled) return
        const t = page1.render({ canvasContext: canvas.getContext('2d')!, viewport: vp })
        await t.promise
      } catch {
        /* cancelled / gone */
      } finally {
        release?.()
      }
    })()
    return () => {
      cancelled = true
      release?.()
    }
  }, [visible, page, doc])

  return (
    <div
      ref={boxRef}
      className={`thumb ${currentPage === page ? 'current' : ''}`}
      onClick={() => useAppStore.getState().goToPage(page)}
      role="button"
      aria-label={tr('第 {0} 页', page)}
    >
      <div className="thumb-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div className="thumb-label">{page}</div>
    </div>
  )
})

function Thumbnails({ doc }: { doc: PDFDocumentProxy }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const currentPage = useAppStore((s) => s.currentPage)

  // keep current page thumbnail in view
  const lastUserNavPage = useRef(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (currentPage === lastUserNavPage.current) return
    lastUserNavPage.current = currentPage
    const target = el.querySelector<HTMLElement>(`.thumb:nth-child(${currentPage})`)
    if (target) {
      const t = target.offsetTop
      if (t < el.scrollTop || t > el.scrollTop + el.clientHeight - 60) {
        el.scrollTop = Math.max(0, t - 40)
      }
    }
  }, [currentPage])

  return (
    <div className="thumbs" ref={bodyRef}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <Thumb key={i + 1} page={i + 1} doc={doc} />
      ))}
    </div>
  )
}

function Outline({ doc }: { doc: PDFDocumentProxy }) {
  const [outline, setOutline] = useState<OutlineItem[] | null>(null)
  useEffect(() => {
    let cancelled = false
    doc.getOutline().then((o) => {
      if (!cancelled) setOutline(o)
    })
    return () => {
      cancelled = true
    }
  }, [doc])

  if (outline === null) return <div className="sidebar-empty">{tr('正在读取大纲…')}</div>
  if (outline.length === 0) return <div className="sidebar-empty">{tr('此文档没有大纲')}</div>
  return (
    <div className="outline">
      {outline.map((item, i) => (
        <OutlineNode key={i} item={item} doc={doc} depth={0} />
      ))}
    </div>
  )
}

function OutlineNode({ item, doc, depth }: { item: OutlineItem; doc: PDFDocumentProxy; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = item.items && item.items.length > 0
  const onClick = async () => {
    try {
      let dest = item.dest
      if (typeof dest === 'string') {
        dest = await doc.getDestination(dest)
      }
      const arr = dest as unknown as unknown[]
      if (!Array.isArray(arr) || !arr[0]) return
      const pageIndex = await doc.getPageIndex(arr[0] as never)
      useAppStore.getState().goToPage(pageIndex + 1)
    } catch {
      /* unsupported dest */
    }
  }
  return (
    <div>
      <div className="outline-row" style={{ paddingLeft: 8 + depth * 14 }}>
        {hasChildren ? (
          <button className="outline-toggle" onClick={() => setOpen(!open)} aria-label={tr('展开/折叠')}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="outline-toggle-placeholder" />
        )}
        <button className="outline-title" onClick={onClick} title={item.title}>
          {item.title}
        </button>
      </div>
      {open &&
        hasChildren &&
        item.items.map((child, i) => <OutlineNode key={i} item={child} doc={doc} depth={depth + 1} />)}
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  TABS = createTabs()
})
