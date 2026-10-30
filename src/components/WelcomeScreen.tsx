import { tr, onLocaleChange } from '../i18n/locale'
import { useCallback, useEffect, useState } from 'react'
import { openDocument, pickAndOpen } from '../utils/docSession'
import { getDesktop, type RecentItem } from '../desktop/bridge'
import {
  IconAI,
  IconArrow,
  IconBook,
  IconClose,
  IconFileImage,
  IconFileText,
  IconMarker,
  IconOpen,
  IconPages,
  IconPenLine,
  IconPin,
  IconStar,
  IconSearch,
} from './icons'
import { startAiTask } from '../utils/aiEntry'
import { BrandMark } from './BrandMark'
import { useAppStore } from '../state/stores'
import { useToolStore, type AppMode } from '../state/toolStore'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function createCapabilities() {
  return [
    { icon: <IconBook size={18} />, mode: 'read', title: tr('阅读'), text: tr('缩略图、大纲、全文搜索') },
    { icon: <IconPenLine size={18} />, mode: 'edit', title: tr('编辑'), text: tr('修改文本、替换图片') },
    { icon: <IconMarker size={18} />, mode: 'annotate', title: tr('批注'), text: tr('高亮、画笔、图形、涂黑') },
    { icon: <IconPages size={18} />, mode: 'pages', title: tr('页面'), text: tr('排序、旋转、拆分、合并') },
  ]
}

let CAPABILITIES = createCapabilities()

const PIN_KEY = 'pdfpro.pinned'
const STAR_KEY = 'pdfpro.starred'
const HIDE_KEY = 'pdfpro.hiddenRecent'
const readSet = (k: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(k) ?? '[]'))
  } catch {
    return new Set()
  }
}
const writeSet = (k: string, s: Set<string>) => localStorage.setItem(k, JSON.stringify(Array.from(s)))

export function WelcomeScreen() {
  const [task, setTask] = useState('')
  const [starting, setStarting] = useState(false)
  const start = async (prompt = task) => {
    if (starting) return
    setStarting(true)
    try {
      await startAiTask(prompt)
    } finally {
      setStarting(false)
    }
  }
  const [pinned, setPinned] = useState(() => readSet(PIN_KEY))
  const [starred, setStarred] = useState(() => readSet(STAR_KEY))
  const [hidden, setHidden] = useState(() => readSet(HIDE_KEY))
  const [filter, setFilter] = useState<'recent' | 'starred'>('recent')
  const toggle = (k: string, set: Set<string>, upd: (s: Set<string>) => void, path: string) => {
    const n = new Set(set)
    if (n.has(path)) n.delete(path)
    else n.add(path)
    writeSet(k, n)
    upd(n)
  }
  const [dragOver, setDragOver] = useState(false)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const desktop = getDesktop()

  const openDropped = useCallback(async (files: FileList | null) => {
    for (const file of Array.from(files ?? []))
      if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
        const desktop = getDesktop()
        const path = desktop?.getPathForFile
          ? desktop.getPathForFile(file)
          : (desktop && (file as File & { path?: string }).path) || null
        if (path && desktop) {
          try {
            await openDocument(await desktop.readFile(path))
          } catch (error) {
            const { notify } = await import('../utils/save')
            notify(tr('无法读取文件：{0}', error instanceof Error ? error.message : String(error)), 'error')
          }
        } else await openDocument({ data: file, name: file.name })
      }
  }, [])

  useEffect(() => {
    if (desktop) void desktop.getRecent().then(setRecent)
  }, [desktop])

  const openRecent = async (item: RecentItem) => {
    if (!desktop) return
    try {
      const f = await desktop.readFile(item.path)
      await openDocument({ ...f, path: f.path ?? item.path })
    } catch {
      setRecent((r) => r.filter((x) => x.path !== item.path))
    }
  }

  const openPicker = () => void pickAndOpen()

  const folderOf = (p: string) => {
    const parts = p.split('/')
    parts.pop()
    return parts.join('/').replace(/^\/Users\/[^/]+/, '~')
  }

  return (
    <div
      className={`home home-redesign ${dragOver ? 'dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void openDropped(e.dataTransfer.files)
      }}
    >
      <header className={`home-header ${desktop && isMac ? 'mac-titlebar' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BrandMark size={23} />
          </span>
          <span className="brand-name">Sail PDF</span>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>{tr('文档工作台')}</h1>
          <p className="home-lead">{tr('打开 PDF，或从最近使用的文件继续。')}</p>
          <div className="home-primary-actions">
            <button className="btn primary" onClick={openPicker}>
              <IconOpen size={19} />
              {tr('打开 PDF')}
              <kbd>{isMac ? '⌘O' : 'Ctrl+O'}</kbd>
            </button>
            <button className="btn" onClick={() => useToolStore.getState().setCreatePdfOpen(true)}>
              <IconFileImage size={18} />
              {tr('从图片创建 PDF')}
            </button>
          </div>
          <p className="home-file-hint">{tr('支持选择或拖入多个 PDF，各文档在独立标签页中打开。')}</p>
          <div className="home-assistant-heading">
            <IconAI size={17} />
            <h2>{tr('文档助手')}</h2>
            <span>{tr('摘要、信息查找与内容修改')}</span>
          </div>
          <form
            className="home-ai-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <label className="sr-only" htmlFor="home-ai-task">
              {tr('你想如何处理文档？')}
            </label>
            <textarea
              id="home-ai-task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              maxLength={4000}
              placeholder={tr('例如：总结这份报告，列出关键结论和待办事项…')}
              rows={2}
            />
            <div className="home-ai-compose-footer">
              <span>
                <IconFileText size={15} />
                {tr(' 选择 PDF 后开始')}
              </span>
              <button type="submit" disabled={starting}>
                <IconAI size={17} />
                {starting ? tr('正在打开…') : tr('选择文档并继续')}
                <IconArrow size={15} />
              </button>
            </div>
          </form>
          <div className="home-ai-suggestions" aria-label={tr('AI 任务建议')}>
            {[
              [tr('提炼重点'), tr('总结这份文档，列出关键结论，并给出对应页码。')],
              [tr('查找信息'), tr('找出文档中的重要日期、数字和约定，并标注来源页码。')],
              [tr('修改内容'), tr('我想修改这份文档，请先帮我了解内容并询问具体修改要求。')],
            ].map(([label, prompt]) => (
              <button key={label} disabled={starting} onClick={() => void start(prompt)}>
                {label}
                <span>↗</span>
              </button>
            ))}
          </div>
          <div className="home-manual-actions">
            <button className="home-tool-search" onClick={() => useToolDiscoveryStore.getState().setPaletteOpen(true)}>
              <IconSearch size={18} />
              <span>{tr('搜索工具与命令')}</span>
              <kbd>{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
            </button>
            <button className="home-drop" onClick={openPicker}>
              <span className="home-drop-icon">
                <IconOpen size={26} />
              </span>
              <span className="home-drop-title">{tr('选择文件')}</span>
              <span className="home-drop-sub">
                {tr('或把 PDF 拖到这里 · ')}
                {isMac ? '⌘' : 'Ctrl+'}O
              </span>
            </button>
            <button className="home-secondary" onClick={() => useToolStore.getState().setCreatePdfOpen(true)}>
              <IconFileImage size={16} />
              <span>{tr('从图片创建 PDF')}</span>
            </button>
          </div>
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>{filter === 'recent' ? tr('最近打开') : tr('收藏')}</h2>
            <div className="seg small" role="group" aria-label={tr('文件列表')}>
              <button className={filter === 'recent' ? 'active' : ''} onClick={() => setFilter('recent')}>
                {tr('最近')}
              </button>
              <button className={filter === 'starred' ? 'active' : ''} onClick={() => setFilter('starred')}>
                {tr('收藏 ')}
                {starred.size || ''}
              </button>
            </div>
          </div>
          {(() => {
            const visible = recent
              .filter((r) => !hidden.has(r.path))
              .filter((r) => filter === 'recent' || starred.has(r.path))
              .sort((a, b) => Number(pinned.has(b.path)) - Number(pinned.has(a.path)))
            if (!visible.length) {
              return (
                <p className="home-empty">
                  {filter === 'starred'
                    ? tr('点文件右侧的星标即可收藏。')
                    : desktop
                      ? tr('打开过的文件会出现在这里。')
                      : tr('桌面版会在这里列出最近打开的文件。')}
                </p>
              )
            }
            return (
              <ul className="recent-list">
                {visible.slice(0, 12).map((r) => (
                  <li key={r.path} className="recent-row">
                    <button className="recent-item" onClick={() => openRecent(r)} title={r.path}>
                      <span className="recent-icon">
                        <IconFileText size={16} />
                      </span>
                      <span className="recent-name">
                        {pinned.has(r.path) && <IconPin size={12} />}
                        {r.name.replace(/\.pdf$/i, '')}
                      </span>
                      <span className="recent-path">{folderOf(r.path)}</span>
                    </button>
                    <div className="recent-actions">
                      <button
                        className={`tb-btn ${pinned.has(r.path) ? 'on' : ''}`}
                        title={pinned.has(r.path) ? tr('取消固定') : tr('固定到顶部')}
                        aria-label={pinned.has(r.path) ? tr('取消固定') : tr('固定到顶部')}
                        onClick={() => toggle(PIN_KEY, pinned, setPinned, r.path)}
                      >
                        <IconPin size={14} />
                      </button>
                      <button
                        className={`tb-btn ${starred.has(r.path) ? 'on star' : ''}`}
                        title={starred.has(r.path) ? tr('取消收藏') : tr('收藏')}
                        aria-label={starred.has(r.path) ? tr('取消收藏') : tr('收藏')}
                        onClick={() => toggle(STAR_KEY, starred, setStarred, r.path)}
                      >
                        <IconStar size={14} />
                      </button>
                      <button
                        className="tb-btn"
                        title={tr('从列表中移除')}
                        aria-label={tr('从列表中移除')}
                        onClick={() => toggle(HIDE_KEY, hidden, setHidden, r.path)}
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          })()}
        </section>

        <section className="home-section">
          <h2>{tr('常用功能')}</h2>
          <div className="cap-grid">
            {CAPABILITIES.map((c) => (
              <button
                className="cap-item"
                key={c.title}
                onClick={async () => {
                  await pickAndOpen()
                  if (useAppStore.getState().pdfDoc) useToolStore.getState().setMode(c.mode as AppMode)
                }}
              >
                <span className="cap-icon">{c.icon}</span>
                <div>
                  <div className="cap-title">{c.title}</div>
                  <div className="cap-text">{c.text}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  CAPABILITIES = createCapabilities()
})
