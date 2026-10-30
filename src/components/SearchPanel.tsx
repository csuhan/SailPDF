import { tr } from '../i18n/locale'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { searchDocument } from '../pdf/search'
import { computePageMap } from '../pdf/edit/pageOrder'
import { IconClose, IconNextPage, IconPrevPage } from './icons'

export function SearchPanel() {
  const searchOpen = useAppStore((s) => s.searchOpen)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const searchTotal = useAppStore((s) => s.searchTotal)
  const activeMatchGlobal = useAppStore((s) => s.activeMatchGlobal)
  const ops = useEditStore((s) => s.ops)
  const [input, setInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [searchError, setSearchError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Only page-map changes need another scan; changing an unrelated overlay
  // must not restart a long search or reset its active result.
  const pageMapKey = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops).join(',') : ''), [pdfDoc, ops])

  useEffect(() => {
    if (searchOpen) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [searchOpen, pdfDoc])

  useEffect(() => {
    let cancelled = false
    const s = useAppStore.getState()
    const q = input.trim()
    s.setSearchQuery(searchOpen && pdfDoc ? q : '')
    s.setSearchResults([], new Map())
    s.setActiveMatchGlobal(0)
    s.bumpSearchVersion()
    setSearchError('')
    setScanning(!!(searchOpen && pdfDoc && q))
    if (!searchOpen || !pdfDoc || !q) return
    const timer = window.setTimeout(async () => {
      try {
        const { matches, pageMatchCounts } = await searchDocument(
          pdfDoc,
          q,
          undefined,
          () => cancelled,
          pageMapKey ? pageMapKey.split(',').map(Number) : [],
        )
        if (cancelled) return
        setScanning(false)
        const st2 = useAppStore.getState()
        st2.setSearchResults(matches, pageMatchCounts)
        st2.setActiveMatchGlobal(0)
        st2.bumpSearchVersion()
        if (matches.length > 0) st2.goToPage(matches[0].page)
      } catch (e) {
        if (cancelled) return
        setScanning(false)
        setSearchError(e instanceof Error ? e.message : String(e))
      }
    }, 260)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [input, pdfDoc, searchOpen, pageMapKey])

  const stepMatch = (dir: 1 | -1) => {
    const s = useAppStore.getState()
    const total = s.searchTotal
    if (total === 0) return
    const next = (s.activeMatchGlobal + dir + total) % total
    s.setActiveMatchGlobal(next)
    const m = s.searchMatches[next]
    if (m) s.goToPage(m.page)
    s.bumpSearchVersion()
  }

  if (!searchOpen || !pdfDoc) return null

  return (
    <div className="search-panel" role="search">
      <input
        ref={inputRef}
        value={input}
        placeholder={tr('在文档中查找…')}
        aria-label={tr('查找文本')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
          if (e.key === 'Escape') useAppStore.getState().setSearchOpen(false)
        }}
      />
      <span className="search-count" title={searchError || undefined}>
        {scanning
          ? tr('搜索中…')
          : searchError
            ? tr('搜索失败')
            : searchTotal > 0
              ? `${activeMatchGlobal + 1} / ${searchTotal}`
              : input.trim()
                ? tr('无结果')
                : ''}
      </span>
      <button className="tb-btn" title={tr('上一个 (⇧↵)')} onClick={() => stepMatch(-1)}>
        <IconPrevPage size={16} />
      </button>
      <button className="tb-btn" title={tr('下一个 (↵)')} onClick={() => stepMatch(1)}>
        <IconNextPage size={16} />
      </button>
      <button className="tb-btn" title={tr('关闭 (Esc)')} onClick={() => useAppStore.getState().setSearchOpen(false)}>
        <IconClose size={16} />
      </button>
    </div>
  )
}
