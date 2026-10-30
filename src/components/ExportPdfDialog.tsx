import { tr, onLocaleChange } from '../i18n/locale'
/**
 * 导出 PDF 副本: with annotations / flattened / clean (no comments).
 * The open document is not changed.
 */
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { exportVariant, type ExportVariant } from '../pdf/edit/exportVariants'
import { notify, saveBlobFile } from '../utils/save'
import { IconClose } from './icons'
import { docPermissions } from '../utils/secureOpen'
import { savedFileBytes } from '../utils/output'

function createVariants(): { id: ExportVariant; label: string; desc: string; suffix: string }[] {
  return [
    { id: 'normal', label: tr('包含批注'), desc: tr('与保存的文件相同，批注在其它阅读器里仍可编辑'), suffix: '' },
    {
      id: 'flatten',
      label: tr('拼合批注'),
      desc: tr('批注和表单变成页面内容，别人无法修改或删除'),
      suffix: tr('_拼合'),
    },
    {
      id: 'clean',
      label: tr('干净版本'),
      desc: tr('去掉高亮、便签、画笔等所有批注，只保留正文修改'),
      suffix: tr('_干净版'),
    },
  ]
}

let VARIANTS: { id: ExportVariant; label: string; desc: string; suffix: string }[] = createVariants()

export function ExportPdfDialog({ onClose }: { onClose: () => void }) {
  const encryption = useAppStore((s) => s.encryption)
  const canModify = docPermissions(encryption).modify
  const [v, setV] = useState<ExportVariant>(() => (canModify ? 'clean' : 'normal'))
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const app = useAppStore.getState()
    if (!app.fileBytes) return
    if (v !== 'normal' && !docPermissions(app.encryption).modify) {
      notify(tr('文档权限不允许拼合或删除批注，请选择“包含批注”导出'), 'error')
      return
    }
    const edits = useEditStore.getState()
    const current = () =>
      useAppStore.getState().pdfDoc === app.pdfDoc &&
      useAppStore.getState().docEpoch === app.docEpoch &&
      useEditStore.getState().revision === edits.revision
    setBusy(true)
    try {
      const plain = await exportVariant(app.fileBytes, edits.ops, v)
      if (!current()) throw new Error(tr('文档已变化，请重新导出'))
      const out = await savedFileBytes(plain)
      if (!out || !current()) throw new Error(tr('文档已变化，请重新导出'))
      const stem = (app.fileName ?? 'document').replace(/\.pdf$/i, '')
      const def = VARIANTS.find((x) => x.id === v)!
      if (await saveBlobFile(`${stem}${def.suffix}.pdf`, out, 'application/pdf', tr('PDF 文档'), ['pdf'])) {
        notify(tr('已导出{0}', def.label))
        onClose()
      }
    } catch (e) {
      notify(tr('导出失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('导出 PDF 副本')}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('导出 PDF 副本')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose} disabled={busy}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="preset-list" role="radiogroup">
            {VARIANTS.map((x) => (
              <label key={x.id} className={`preset wide ${v === x.id ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="exp-variant"
                  checked={v === x.id}
                  disabled={busy || (x.id !== 'normal' && !canModify)}
                  onChange={() => setV(x.id)}
                />
                <span className="preset-title">{x.label}</span>
                <span className="preset-desc">
                  {x.id !== 'normal' && !canModify ? tr('文档权限不允许此操作') : x.desc}
                </span>
              </label>
            ))}
          </div>
          <p className="form-note">
            {tr('当前打开的文档不会改变。')}
            {encryption ? tr('导出副本保留当前密码保护。') : ''}
          </p>
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {tr('取消')}
          </button>
          <button className="btn primary" disabled={busy || (v !== 'normal' && !canModify)} onClick={() => void run()}>
            {busy ? tr('导出中…') : tr('导出')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  VARIANTS = createVariants()
})
