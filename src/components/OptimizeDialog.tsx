import { tr } from '../i18n/locale'
/**
 * "优化 PDF" (Acrobat: 优化 PDF → 缩小文件大小): pick a preset, see the
 * resulting size, then save the smaller copy or keep working with it.
 */
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { OPTIMIZE_PRESETS, optimizePdf, type OptimizeResult } from '../pdf/edit/optimize'
import { currentOutputBytes } from '../utils/output'
import { notify, saveBlobFile } from '../utils/save'
import { IconClose } from './icons'

const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export function OptimizeDialog({ onClose }: { onClose: () => void }) {
  const fileName = useAppStore((s) => s.fileName)
  const [preset, setPreset] = useState(OPTIMIZE_PRESETS[1].id)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<(OptimizeResult & { preset: string }) | null>(null)

  const run = async () => {
    const p = OPTIMIZE_PRESETS.find((x) => x.id === preset)!
    setBusy(tr('正在优化…'))
    try {
      const bytes = await currentOutputBytes()
      if (!bytes) return
      const r = await optimizePdf(bytes, p.opts, (d, t) => setBusy(tr('正在处理图片 {0}/{1}', d, t)))
      setResult({ ...r, preset })
    } catch (e) {
      notify(tr('优化失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(null)
    }
  }

  const stem = (fileName ?? 'document').replace(/\.pdf$/i, '')
  const saveCopy = async () => {
    if (!result) return
    if (await saveBlobFile(tr('{0}_压缩.pdf', stem), result.bytes, 'application/pdf', tr('PDF 文档'), ['pdf'])) {
      notify(tr('已保存压缩后的副本'))
      onClose()
    }
  }
  /** continue editing the optimized document (all edits are already in it) */
  const useIt = async () => {
    if (!result) return
    const app = useAppStore.getState()
    const keep = { page: app.currentPage, path: app.filePath, savePath: app.savePath, enc: app.encryption }
    if (!(await app.openFile(result.bytes, app.fileName ?? 'document.pdf', keep.path, keep.enc))) {
      notify(useAppStore.getState().error ?? tr('无法打开优化结果'), 'error')
      return
    }
    const a = useAppStore.getState()
    a.setSavePath(keep.savePath)
    a.goToPage(keep.page)
    // the optimized content differs from what is on disk
    useEditStore.getState().setFormDirty(true)
    notify(tr('已优化，文件从 {0} 减小到 {1}，保存后生效', fmtSize(result.before), fmtSize(result.after)))
    onClose()
  }

  const saved = result ? Math.max(0, 1 - result.after / result.before) : 0
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('压缩 PDF')}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('压缩 PDF')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose} disabled={!!busy}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="preset-list" role="radiogroup" aria-label={tr('压缩级别')}>
            {OPTIMIZE_PRESETS.map((p) => (
              <label key={p.id} className={`preset ${preset === p.id ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="opt-preset"
                  checked={preset === p.id}
                  onChange={() => {
                    setPreset(p.id)
                    setResult(null)
                  }}
                />
                <span className="preset-title">{p.label}</span>
                <span className="preset-desc">{p.desc}</span>
              </label>
            ))}
          </div>
          {result && (
            <div className="opt-result" role="status">
              <div className="opt-sizes">
                <span>{fmtSize(result.before)}</span>
                <span className="opt-arrow">→</span>
                <strong>{fmtSize(result.after)}</strong>
                <span className="opt-pct">
                  {saved > 0.005 ? tr('减小 {0}%', Math.round(saved * 100)) : tr('已是最优')}
                </span>
              </div>
              <div className="opt-bar">
                <span style={{ width: `${Math.max(2, (result.after / result.before) * 100)}%` }} />
              </div>
              <p className="form-note">
                {result.images > 0 ? tr('重新压缩了 {0} 张图片；', result.images) : ''}
                {tr('文字、字体和链接保持不变。')}
              </p>
            </div>
          )}
          {busy && <p className="form-note">{busy}</p>}
        </div>
        <div className="modal-actions">
          {result && result.after < result.before && (
            <button className="btn" onClick={() => void useIt()}>
              {tr('替换当前文档')}
            </button>
          )}
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose} disabled={!!busy}>
            {tr('取消')}
          </button>
          {result ? (
            <button className="btn primary" onClick={() => void saveCopy()} disabled={result.after >= result.before}>
              {tr('另存副本')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void run()} disabled={!!busy}>
              {busy ? tr('处理中…') : tr('开始压缩')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
