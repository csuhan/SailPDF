import { tr, onLocaleChange } from '../i18n/locale'
/**
 * "标记密文" (Acrobat: Redact → Find text & redact): search the document and
 * mark every match for redaction; on save the content below is removed.
 */
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { newOpId, type RedactOp } from '../pdf/edit/ops'
import { computePageMap } from '../pdf/edit/pageOrder'
import { findTextOnPage, type TextHit } from '../pdf/edit/findText'
import { notify } from '../utils/save'
import { IconClose, IconSearch } from './icons'

function createPresets(): { label: string; re: RegExp }[] {
  return [
    { label: tr('电子邮箱'), re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
    { label: tr('手机号'), re: /(?<!\d)(\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g },
    { label: tr('身份证号'), re: /(?<![\dXx])\d{17}[\dXx](?![\dXx])/g },
    { label: tr('银行卡号'), re: /(?<!\d)\d{16,19}(?!\d)/g },
  ]
}

let PRESETS: { label: string; re: RegExp }[] = createPresets()

export function RedactDialog({ onClose }: { onClose: () => void }) {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const [query, setQuery] = useState('')
  const [preset, setPreset] = useState<number | null>(null)
  const [results, setResults] = useState<{ page: number; hit: TextHit }[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const search = async () => {
    if (!pdfDoc) return
    setBusy(true)
    try {
      const out: { page: number; hit: TextHit }[] = []
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const page = await pdfDoc.getPage(p)
        let terms: string[] = []
        if (preset !== null) {
          const tc = await page.getTextContent()
          const text = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ')
          terms = Array.from(new Set(Array.from(text.matchAll(PRESETS[preset].re), (m) => m[0])))
        } else if (query.trim()) {
          terms = [query]
        }
        for (const t of terms) for (const hit of await findTextOnPage(page, t)) out.push({ page: p, hit })
      }
      setResults(out)
      setPicked(new Set(out.map((_, i) => i)))
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!results || !pdfDoc) return
    const es = useEditStore.getState()
    const map = computePageMap(pdfDoc.numPages, es.ops)
    let n = 0
    results.forEach((r, i) => {
      if (!picked.has(i) || !map.includes(r.page)) return
      const pad = 0.6
      const op: RedactOp = {
        kind: 'redact',
        id: newOpId(),
        page: r.page,
        x: r.hit.x0 - pad,
        y: r.hit.y0 - pad,
        width: r.hit.x1 - r.hit.x0 + 2 * pad,
        height: r.hit.y1 - r.hit.y0 + 2 * pad,
      }
      es.pushOp(op)
      n++
    })
    notify(tr('已标记 {0} 处密文，保存时将永久删除其内容', n))
    useToolStore.getState().setMode('read')
    onClose()
  }

  const canSearch = preset !== null || !!query.trim()
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal form-modal redact-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('标记密文')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('查找并标记密文')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="form-row">
            <input
              className="form-input"
              placeholder={tr('要删除的文字')}
              aria-label={tr('要删除的文字')}
              value={query}
              autoFocus
              onChange={(e) => {
                setQuery(e.target.value)
                setPreset(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && canSearch && void search()}
            />
            <button className="btn icon-text" disabled={!canSearch || busy} onClick={() => void search()}>
              <IconSearch size={15} />
              <span>{busy ? tr('查找中…') : tr('查找')}</span>
            </button>
          </div>
          <div className="chip-row" role="group" aria-label={tr('常见敏感信息')}>
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                className={`chip ${preset === i ? 'active' : ''}`}
                aria-pressed={preset === i}
                onClick={() => {
                  setPreset(preset === i ? null : i)
                  setQuery('')
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {results && (
            <div className="redact-results">
              {results.length === 0 ? (
                <p className="form-note">{tr('没有找到匹配的内容。')}</p>
              ) : (
                <>
                  <label className="check-row small redact-all">
                    <input
                      type="checkbox"
                      checked={picked.size === results.length}
                      onChange={(e) => setPicked(e.target.checked ? new Set(results.map((_, i) => i)) : new Set())}
                    />
                    <span>
                      {tr('找到 ')}
                      {results.length}
                      {tr(' 处，全选')}
                    </span>
                  </label>
                  <ul>
                    {results.map((r, i) => (
                      <li key={i}>
                        <label className="check-row small">
                          <input
                            type="checkbox"
                            checked={picked.has(i)}
                            onChange={(e) => {
                              const s = new Set(picked)
                              if (e.target.checked) s.add(i)
                              else s.delete(i)
                              setPicked(s)
                            }}
                          />
                          <span className="redact-hit">{r.hit.text}</span>
                          <span className="redact-page">
                            {tr('第 ')}
                            {r.page}
                            {tr(' 页')}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <p className="form-note">
            {tr('保存时，标记区域内的文字、图片和图形会从文件中彻底删除，无法通过复制或搜索恢复。')}
          </p>
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button className="btn primary danger" disabled={!results || picked.size === 0} onClick={apply}>
            {tr('标记 ')}
            {picked.size || ''}
            {tr(' 处')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  PRESETS = createPresets()
})
