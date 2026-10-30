import { tr } from '../i18n/locale'
import { useEffect, useRef } from 'react'
import { useTabStore, switchDocumentTab } from '../state/tabStore'
import { closeDocument, pickAndOpen } from '../utils/docSession'
import { IconClose, IconFileText, IconPlus } from './icons'
import '../styles/document-tabs.css'

export function DocumentTabs() {
  const { tabs, activeId } = useTabStore()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  if (!tabs.length) return null
  return (
    <div className="document-tabs-bar">
      <div ref={list} className="document-tabs" role="tablist" aria-label={tr('打开的 PDF')}>
        {tabs.map((tab) => (
          <div key={tab.id} className={`document-tab ${tab.id === activeId ? 'active' : ''}`}>
            <button
              role="tab"
              aria-selected={tab.id === activeId}
              title={tab.path ?? tab.name}
              onClick={() => void switchDocumentTab(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const index = tabs.findIndex((t) => t.id === tab.id)
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                void switchDocumentTab(tabs[next].id)
                list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
              }}
            >
              <IconFileText size={14} />
              <span>{tab.name}</span>
              {tab.dirty && <i aria-label={tr('未保存')}>●</i>}
            </button>
            <button
              className="tab-close"
              aria-label={tr('关闭 {0}', tab.name)}
              title={tr('关闭此 PDF')}
              onClick={() => void closeDocument(tab.id)}
            >
              <IconClose size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="tb-btn"
        aria-label={tr('打开更多 PDF')}
        title={tr('打开更多 PDF (⌘O)')}
        onClick={() => void pickAndOpen()}
      >
        <IconPlus size={16} />
      </button>
    </div>
  )
}
