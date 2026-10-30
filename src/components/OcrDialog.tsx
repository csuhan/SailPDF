import { tr } from '../i18n/locale'
/**
 * 扫描件识别: recognise text on image-only pages (on device) and make the
 * PDF searchable. The result replaces the open document (unsaved), with all
 * edits made so far already included.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { pdfjs } from '../pdf/document'
import { ocrAvailable, ocrDocument, pagesNeedingOcr } from '../pdf/ocr'
import { currentOutputBytes } from '../utils/output'
import { notify } from '../utils/save'
import { IconClose } from './icons'

export function OcrDialog({ onClose }: { onClose: () => void }) {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const [avail, setAvail] = useState<boolean | null>(null)
  const [need, setNeed] = useState<number[] | null>(null)
  const [scope, setScope] = useState<'need' | 'all'>('need')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void ocrAvailable().then(setAvail)
    if (pdfDoc) void pagesNeedingOcr(pdfDoc).then(setNeed)
  }, [pdfDoc])

  const run = async () => {
    if (!pdfDoc || !need) return
    setBusy(tr('正在准备…'))
    try {
      const bytes = await currentOutputBytes()
      if (!bytes) return
      const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
      const pages = scope === 'all' ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : need
      const r = await ocrDocument(doc, bytes, pages, (d, t) =>
        setBusy(tr('正在识别第 {0} / {1} 页', Math.min(t, d + 1), t)),
      )
      void doc.destroy()
      const app = useAppStore.getState()
      const keep = {
        page: app.currentPage,
        path: app.filePath,
        savePath: app.savePath,
        enc: app.encryption,
        name: app.fileName ?? 'document.pdf',
      }
      if (!(await app.openFile(r.bytes, keep.name, keep.path, keep.enc)))
        throw new Error(useAppStore.getState().error ?? tr('无法打开识别结果'))
      useAppStore.getState().setSavePath(keep.savePath)
      useAppStore.getState().goToPage(keep.page)
      useEditStore.getState().setFormDirty(true)
      notify(tr('已识别 {0} 页、{1} 行文字，现在可以搜索和复制（保存后写入文件）', r.pages, r.lines))
      onClose()
    } catch (e) {
      notify(tr('识别失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(null)
    }
  }

  const count = scope === 'all' ? (pdfDoc?.numPages ?? 0) : (need?.length ?? 0)
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('识别文字')}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('识别文字（OCR）')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose} disabled={!!busy}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          {avail === false ? (
            <p className="form-note">{tr('文字识别使用 macOS 系统内置的识别引擎，请在桌面版 Sail PDF 中使用。')}</p>
          ) : (
            <>
              <p className="form-note">
                {need === null
                  ? tr('正在检查哪些页面是扫描图片…')
                  : need.length
                    ? tr('{0} 页没有可选中的文字（扫描件或图片）。', need.length)
                    : tr('所有页面都已经有文字层。')}
              </p>
              <div className="seg" role="group" aria-label={tr('识别范围')}>
                <button type="button" className={scope === 'need' ? 'active' : ''} onClick={() => setScope('need')}>
                  {tr('仅扫描页（')}
                  {need?.length ?? '…'}）
                </button>
                <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
                  {tr('全部页面（')}
                  {pdfDoc?.numPages}）
                </button>
              </div>
              <p className="form-note">
                {tr(
                  '在本机识别中文、英文、日文，不上传任何内容。识别出的文字以隐藏文字层写入，页面外观不变，之后可以搜索、复制、转换为 Word，并交给 AI 阅读。',
                )}
              </p>
              {busy && <p className="form-note">{busy}</p>}
            </>
          )}
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose} disabled={!!busy}>
            {tr('取消')}
          </button>
          <button className="btn primary" disabled={!avail || !count || !!busy} onClick={() => void run()}>
            {busy ? tr('识别中…') : tr('识别 {0} 页', count)}
          </button>
        </div>
      </div>
    </div>
  )
}
