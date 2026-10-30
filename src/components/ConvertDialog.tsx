import { tr, onLocaleChange } from '../i18n/locale'
/**
 * 导出 / 转换: PDF → Word / Markdown / LaTeX / HTML / 纯文本.
 * Structure (headings, paragraphs, lists, tables, links, images) is rebuilt
 * locally from the page content; nothing is uploaded.
 */
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { pdfjs } from '../pdf/document'
import { extractStructure } from '../pdf/convert/structure'
import { writeFormat, type Format } from '../pdf/convert/writers'
import { currentOutputBytes } from '../utils/output'
import { notify, saveBlobFile } from '../utils/save'
import { IconClose } from './icons'

function createFormats(): { id: Format; label: string; desc: string }[] {
  return [
    { id: 'docx', label: 'Word', desc: tr('.docx，可在 Word / WPS / Pages 中继续编辑') },
    { id: 'md', label: 'Markdown', desc: tr('.md，适合笔记、知识库、喂给 AI') },
    { id: 'tex', label: 'LaTeX', desc: tr('.tex，适合论文二次排版（ctex 支持中文）') },
    { id: 'html', label: 'HTML', desc: tr('单个网页文件，图片内嵌') },
    { id: 'txt', label: tr('纯文本'), desc: tr('.txt，只保留文字') },
  ]
}

let FORMATS: { id: Format; label: string; desc: string }[] = createFormats()

export function ConvertDialog({ onClose }: { onClose: () => void }) {
  const fileName = useAppStore((s) => s.fileName)
  const numPages = useAppStore((s) => s.numPages)
  const [fmt, setFmt] = useState<Format>('docx')
  const [images, setImages] = useState(true)
  const [breaks, setBreaks] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async () => {
    setBusy(tr('正在分析版面…'))
    try {
      const bytes = await currentOutputBytes()
      if (!bytes) return
      const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
      const s = await extractStructure(doc, bytes, {
        images: images && fmt !== 'txt',
        pageBreaks: breaks,
        progress: (d, t) => setBusy(tr('正在分析版面 {0}%', Math.min(100, Math.round((d / t) * 100)))),
      })
      void doc.destroy()
      const stem = (fileName ?? 'document').replace(/\.pdf$/i, '')
      const out = writeFormat(s, fmt, stem)
      if (await saveBlobFile(`${stem}.${out.ext}`, out.data, out.mime, out.filterName, [out.ext])) {
        notify(
          tr(
            '已导出 {0}{1}',
            FORMATS.find((f) => f.id === fmt)!.label,
            out.ext === 'zip' ? tr('（含图片，已打包为 zip）') : '',
          ),
        )
        onClose()
      }
    } catch (e) {
      notify(tr('转换失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('转换 PDF')}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('转换 PDF')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose} disabled={!!busy}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="preset-list" role="radiogroup" aria-label={tr('格式')}>
            {FORMATS.map((f) => (
              <label key={f.id} className={`preset ${fmt === f.id ? 'active' : ''}`}>
                <input type="radio" name="conv-fmt" checked={fmt === f.id} onChange={() => setFmt(f.id)} />
                <span className="preset-title">{f.label}</span>
                <span className="preset-desc">{f.desc}</span>
              </label>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={images}
              disabled={fmt === 'txt'}
              onChange={(e) => setImages(e.target.checked)}
            />
            <span>{tr('包含图片')}</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={breaks} onChange={(e) => setBreaks(e.target.checked)} />
            <span>{tr('保留分页')}</span>
          </label>
          <p className="form-note">
            {tr('在本机识别标题、段落、列表、表格、链接和图片（共 ')}
            {numPages}
            {tr(' 页）。复杂排版（公式、多栏混排、图文环绕）会尽量还原，但可能需要手动调整；扫描件需要先做文字识别。')}
          </p>
          {busy && <p className="form-note">{busy}</p>}
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose} disabled={!!busy}>
            {tr('取消')}
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={!!busy}>
            {busy ? tr('转换中…') : tr('转换并保存')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  FORMATS = createFormats()
})
