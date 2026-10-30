import { tr } from '../i18n/locale'
/**
 * "比较文件": choose another PDF, list page-by-page text differences of the
 * current document (with its unsaved edits) against it.
 */
import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { pdfjs } from '../pdf/document'
import { compareDocuments, type PageDiff } from '../pdf/compare'
import { currentOutputBytes } from '../utils/output'
import { pickPdfFile } from '../utils/fileOpen'
import { getDesktop } from '../desktop/bridge'
import { decryptPdf, inspectEncryption } from '../pdf/security/standardSecurity'
import { notify } from '../utils/save'
import { IconClose, IconFilePlus } from './icons'

async function openCopy(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const base = import.meta.env.BASE_URL ?? '/'
  return pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
  }).promise
}

export function CompareDialog({ onClose }: { onClose: () => void }) {
  const fileName = useAppStore((s) => s.fileName)
  const [other, setOther] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [diffs, setDiffs] = useState<PageDiff[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [onlyChanged, setOnlyChanged] = useState(true)

  const pick = async () => {
    const desktop = getDesktop()
    if (desktop) {
      const files = await desktop.openDialog()
      if (files?.[0]) setOther({ name: files[0].name, bytes: files[0].data })
    } else {
      const f = await pickPdfFile()
      if (f instanceof File) setOther({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
    }
  }

  useEffect(() => {
    if (!other) return
    let cancelled = false
    ;(async () => {
      setBusy(tr('正在比较…'))
      setDiffs(null)
      try {
        let ob = other.bytes
        const enc = await inspectEncryption(ob).catch(() => null)
        if (enc?.needsPassword) {
          const pw = window.prompt(tr('“{0}”受密码保护，请输入密码', other.name))
          if (pw === null) return
          ob = (await decryptPdf(ob, pw)).bytes
        }
        const mine = await currentOutputBytes()
        if (!mine) return
        // a = the other (older) file, b = the current document
        const [a, b] = await Promise.all([openCopy(ob), openCopy(mine)])
        const r = await compareDocuments(a, b, (d, t) => !cancelled && setBusy(tr('正在比较第 {0} / {1} 页', d, t)))
        void a.destroy()
        void b.destroy()
        if (!cancelled) setDiffs(r)
      } catch (e) {
        notify(tr('比较失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [other])

  const changed = diffs?.filter((d) => d.added || d.removed) ?? []
  const shown = onlyChanged ? changed : (diffs ?? [])
  const totalAdd = changed.reduce((a, d) => a + d.added, 0)
  const totalDel = changed.reduce((a, d) => a + d.removed, 0)

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal form-modal compare-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('比较文件')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('比较文件')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="compare-files">
            <div className="compare-file">
              <span className="compare-tag old">{tr('旧')}</span>
              <span className="compare-name">{other?.name ?? tr('选择要对比的文件')}</span>
              <button className="btn small" onClick={() => void pick()}>
                <IconFilePlus size={14} /> {other ? tr('更换') : tr('选择')}
              </button>
            </div>
            <div className="compare-file">
              <span className="compare-tag new">{tr('新')}</span>
              <span className="compare-name">
                {fileName}
                {tr('（当前文档）')}
              </span>
            </div>
          </div>
          {busy && <p className="form-note">{busy}</p>}
          {diffs && (
            <>
              <div className="compare-summary">
                {changed.length === 0 ? (
                  <span>{tr('两个文件的文字内容完全相同。')}</span>
                ) : (
                  <span>
                    {changed.length}
                    {tr(' 页有差异：')}
                    <b className="d-add">+{totalAdd}</b>
                    {tr(' 处新增，')}
                    <b className="d-del">−{totalDel}</b>
                    {tr(' 处删除')}
                  </span>
                )}
                <label className="check-row small">
                  <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                  <span>{tr('只看有差异的页')}</span>
                </label>
              </div>
              <div className="compare-list">
                {shown.map((d) => (
                  <section key={`${d.a}-${d.b}`} className="compare-page">
                    <header>
                      <button
                        className="link-btn"
                        disabled={!d.b}
                        title={tr('在当前文档中跳到此页')}
                        onClick={() => {
                          useAppStore.getState().goToPage(d.b)
                          onClose()
                        }}
                      >
                        {tr('第 ')}
                        {d.b || d.a}
                        {tr(' 页')}
                      </button>
                      {!d.a && <span className="compare-badge">{tr('仅当前文档')}</span>}
                      {!d.b && <span className="compare-badge">{tr('仅旧文件')}</span>}
                      <span className="compare-counts">
                        {d.added > 0 && <span className="d-add">+{d.added}</span>}
                        {d.removed > 0 && <span className="d-del">−{d.removed}</span>}
                      </span>
                    </header>
                    <p className="compare-text">{renderTokens(d)}</p>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('关闭')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** show changed tokens with a little context around them */
function renderTokens(d: PageDiff) {
  const toks = d.tokens
  if (!toks.some((t) => t.op !== 'same'))
    return (
      <span className="d-same">
        {toks
          .slice(0, 60)
          .map((t) => t.text)
          .join(' ')}
        …
      </span>
    )
  const CONTEXT = 6
  const keep = new Array(toks.length).fill(false)
  toks.forEach((t, i) => {
    if (t.op === 'same') return
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(toks.length - 1, i + CONTEXT); k++) keep[k] = true
  })
  const out: React.ReactNode[] = []
  let gap = false
  toks.forEach((t, i) => {
    if (!keep[i]) {
      if (!gap)
        out.push(
          <span key={`g${i}`} className="d-gap">
            {' '}
            …{' '}
          </span>,
        )
      gap = true
      return
    }
    gap = false
    const sep = /^[\u3400-\u9fff]$/.test(t.text) ? '' : ' '
    out.push(
      <span key={i} className={t.op === 'same' ? 'd-same' : t.op === 'add' ? 'd-add' : 'd-del'}>
        {t.text}
        {sep}
      </span>,
    )
  })
  return out
}
