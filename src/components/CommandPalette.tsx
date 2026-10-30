import { tr } from '../i18n/locale'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { getToolAvailability, searchTools } from '../tools/registry'
import { useToolContext } from '../tools/useToolContext'
import { runTool } from '../tools/runTool'
import { ToolIcon } from './ToolIcon'
import { IconClose, IconSearch, IconStar } from './icons'

/** Available from the welcome screen as well as an open document. */
export function CommandPalette() {
  const open = useToolDiscoveryStore((s) => s.paletteOpen)
  const favorites = useToolDiscoveryStore((s) => s.favorites)
  const [query, setQuery] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const context = useToolContext()
  const results = searchTools(query).filter((tool) => !onlyFavorites || favorites.includes(tool.id))
  if (!query.trim()) results.sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)))
  const active = results[Math.min(selected, results.length - 1)]
  const close = () => useToolDiscoveryStore.getState().setPaletteOpen(false)

  useEffect(() => {
    setSelected(0)
  }, [query, onlyFavorites])
  useLayoutEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setOnlyFavorites(false)
    setSelected(0)
    input.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  useEffect(() => {
    if (open && active) document.getElementById(`palette-${active.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active?.id])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
        return
      }
      if (event.target === input.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (results.length)
          setSelected((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
      }
      if (event.target === input.current && event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        // A fast Enter can precede React's commit for the last input event.
        // Resolve from the actual input so it never runs a stale/empty result.
        const liveQuery = input.current?.value ?? query
        const liveResults = searchTools(liveQuery).filter((tool) => !onlyFavorites || favorites.includes(tool.id))
        if (!liveQuery.trim())
          liveResults.sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)))
        const chosen = liveQuery === query ? liveResults[Math.min(selected, liveResults.length - 1)] : liveResults[0]
        if (chosen) void runTool(chosen.id)
      }
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)')
        if (!focusable?.length) return
        const first = focusable[0],
          last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, results, active, context])

  if (!open) return null
  return (
    <div
      className="command-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={tr('搜索工具与命令')} ref={dialog}>
        <div className="command-search">
          <IconSearch size={20} />
          <input
            ref={input}
            aria-label={tr('搜索工具与命令')}
            placeholder={tr('搜索工具或用途，例如：减小附件')}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={active ? `palette-${active.id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="tb-btn" aria-label={tr('关闭工具搜索')} title={tr('关闭 (Esc)')} onClick={close}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="command-filter">
          <button
            className={!onlyFavorites ? 'active' : ''}
            aria-pressed={!onlyFavorites}
            onClick={() => setOnlyFavorites(false)}
          >
            {tr('全部工具')}
          </button>
          <button
            className={onlyFavorites ? 'active' : ''}
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites(true)}
          >
            {tr('我的收藏 ')}
            {favorites.length || ''}
          </button>
          <span>
            {results.length}
            {tr(' 项')}
          </span>
        </div>
        <ul id="command-results" className="command-results" role="listbox" aria-label={tr('工具搜索结果')}>
          {results.map((tool, index) => {
            const availability = getToolAvailability(tool, context)
            const starred = favorites.includes(tool.id)
            return (
              <li
                key={tool.id}
                id={`palette-${tool.id}`}
                role="option"
                aria-selected={active?.id === tool.id}
                className={`command-row ${active?.id === tool.id ? 'selected' : ''}`}
                data-tool-id={tool.id}
              >
                <button
                  className="command-run"
                  disabled={!availability.available && !availability.canOpenDocument}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => void runTool(tool.id)}
                >
                  <span className="tool-card-icon" style={{ background: tool.tint }}>
                    <ToolIcon name={tool.icon} />
                  </span>
                  <span className="command-copy">
                    <strong>{tool.title}</strong>
                    <span>{tool.description}</span>
                    <small className={availability.available ? 'tool-capability' : 'tool-unavailable'}>
                      {availability.reason || tr('可用')}
                    </small>
                  </span>
                  {tool.shortcut && <kbd>{tool.shortcut}</kbd>}
                </button>
                <button
                  className={`tool-favorite ${starred ? 'active' : ''}`}
                  aria-label={`${starred ? tr('取消收藏') : tr('收藏')}${tool.title}`}
                  aria-pressed={starred}
                  onClick={() => useToolDiscoveryStore.getState().toggleFavorite(tool.id)}
                >
                  <IconStar size={16} />
                </button>
              </li>
            )
          })}
        </ul>
        {!results.length && (
          <p className="command-empty" role="status">
            {onlyFavorites && !favorites.length
              ? tr('还没有收藏。点工具旁的星标即可添加。')
              : tr('没有找到工具，试试“压缩”“扫描识字”或“页码”。')}
          </p>
        )}
        <div className="command-footer">{tr('↑ ↓ 选择 · Enter 使用 · Esc 关闭')}</div>
      </div>
    </div>
  )
}
