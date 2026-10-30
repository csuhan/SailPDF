import { tr } from '../i18n/locale'
/**
 * 书签: personal bookmarks per document (kept locally, the file is not
 * changed) with optional names; plus the reading history of the document.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/stores'
import { IconBookmark, IconTrash } from './icons'

interface Bookmark {
  page: number
  title: string
  t: number
}

const KEY = 'pdfpro.bookmarks'

function docKey(): string {
  const s = useAppStore.getState()
  return s.filePath ?? `${s.fileName}#${s.fileBytes?.length ?? 0}`
}

function load(): Record<string, Bookmark[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function getBookmarks(): Bookmark[] {
  return load()[docKey()] ?? []
}

function store(list: Bookmark[]) {
  const all = load()
  if (list.length) all[docKey()] = list
  else delete all[docKey()]
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(new Event('pdfpro:bookmarks'))
}

/** toggle a bookmark on a page (⌘D) */
export function toggleBookmark(page: number): boolean {
  const list = getBookmarks()
  const i = list.findIndex((b) => b.page === page)
  if (i >= 0) {
    list.splice(i, 1)
    store(list)
    return false
  }
  list.push({ page, title: tr('第 {0} 页', page), t: Date.now() })
  list.sort((a, b) => a.page - b.page)
  store(list)
  return true
}

export function useBookmarks(): Bookmark[] {
  const fileName = useAppStore((s) => s.fileName)
  const [list, setList] = useState<Bookmark[]>(getBookmarks)
  useEffect(() => {
    setList(getBookmarks())
    const on = () => setList(getBookmarks())
    window.addEventListener('pdfpro:bookmarks', on)
    return () => window.removeEventListener('pdfpro:bookmarks', on)
  }, [fileName])
  return list
}

export function BookmarksPanel() {
  const list = useBookmarks()
  const currentPage = useAppStore((s) => s.currentPage)
  const [editing, setEditing] = useState<number | null>(null)
  const marked = list.some((b) => b.page === currentPage)
  return (
    <div className="bookmarks">
      <button className={`btn small bm-add ${marked ? 'active' : ''}`} onClick={() => toggleBookmark(currentPage)}>
        <IconBookmark size={13} />{' '}
        {marked ? tr('取消第 {0} 页书签', currentPage) : tr('为第 {0} 页添加书签', currentPage)}
      </button>
      {list.length === 0 ? (
        <div className="sidebar-empty">{tr('还没有书签。按 ⌘D 为当前页添加。')}</div>
      ) : (
        <ul className="annots-list">
          {list.map((b) => (
            <li key={b.page} className={`annot-row ${b.page === currentPage ? 'current' : ''}`}>
              {editing === b.page ? (
                <input
                  className="form-input bm-input"
                  autoFocus
                  defaultValue={b.title}
                  aria-label={tr('书签名称')}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={(e) => {
                    const all = getBookmarks().map((x) =>
                      x.page === b.page ? { ...x, title: e.target.value.trim() || x.title } : x,
                    )
                    store(all)
                    setEditing(null)
                  }}
                />
              ) : (
                <button
                  className="annot-main"
                  onClick={() => useAppStore.getState().goToPage(b.page)}
                  onDoubleClick={() => setEditing(b.page)}
                  title={tr('双击重命名')}
                >
                  <IconBookmark size={13} />
                  <span className="annot-text">
                    <span className="annot-label">{b.title}</span>
                    <span className="annot-meta">
                      {tr('第 ')}
                      {b.page}
                      {tr(' 页')}
                    </span>
                  </span>
                </button>
              )}
              <button
                className="change-del"
                title={tr('删除书签')}
                aria-label={tr('删除书签')}
                onClick={() => store(getBookmarks().filter((x) => x.page !== b.page))}
              >
                <IconTrash size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
