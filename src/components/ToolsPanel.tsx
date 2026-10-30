import { tr, onLocaleChange } from '../i18n/locale'
/** Shared tool catalog, favorites, capability hints and tool dialogs. */
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { newOpId, type DocInfoOp, type EditOp, type PageNumbersOp, type WatermarkOp } from '../pdf/edit/ops'
import { currentOutputBytes } from '../utils/output'
import { saveBlobFile } from '../utils/save'
import { exportPagesAsImages } from '../pdf/edit/exportDoc'
import { ProtectDialog } from './ProtectDialog'
import { RedactDialog } from './RedactDialog'
import { OptimizeDialog } from './OptimizeDialog'
import { CompareDialog } from './CompareDialog'
import { CropDialog } from './CropDialog'
import { ConvertDialog } from './ConvertDialog'
import { OcrDialog } from './OcrDialog'
import { ExportPdfDialog } from './ExportPdfDialog'
import { IconClose, IconSearch, IconStar } from './icons'
import { ToolIcon } from './ToolIcon'
import { getToolAvailability, searchTools, TOOL_GROUPS, type ToolDefinition, type ToolDialog } from '../tools/registry'
import { useToolContext } from '../tools/useToolContext'
import { runBusy, runTool } from '../tools/runTool'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { docPermissions } from '../utils/secureOpen'

export function ToolsPanel() {
  const mode = useToolStore((s) => s.mode)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const epoch = useAppStore((s) => s.docEpoch)
  const storedDialog = useToolDiscoveryStore((s) => s.dialog)
  const dialogEpoch = useToolDiscoveryStore((s) => s.dialogEpoch)
  const dialog = dialogEpoch === epoch ? storedDialog : null
  const busy = useToolDiscoveryStore((s) => s.busy)
  const favorites = useToolDiscoveryStore((s) => s.favorites)
  const context = useToolContext()
  const [query, setQuery] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const setDialog = (next: ToolDialog | null) => useToolDiscoveryStore.getState().setDialog(next, epoch)
  useEffect(() => {
    if (!dialog) return
    const modal = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    if (modal && !modal.contains(document.activeElement))
      modal
        .querySelector<HTMLElement>(
          'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
        )
        ?.focus()
  }, [dialog])
  if (!pdfDoc) return null
  const stem = (useAppStore.getState().fileName ?? 'document').replace(/\.pdf$/i, '')
  const matching = searchTools(query).filter((tool) => !onlyFavorites || favorites.includes(tool.id))
  const groups = TOOL_GROUPS.map((title) => ({ title, cards: matching.filter((tool) => tool.group === title) })).filter(
    (group) => group.cards.length,
  )

  const card = (tool: ToolDefinition) => {
    const available = getToolAvailability(tool, context)
    return (
      <div className="tool-card-wrap" key={tool.id} data-tool-id={tool.id}>
        <button
          className="tool-card"
          onClick={() => void runTool(tool.id)}
          disabled={!available.available}
          title={available.reason || tool.description}
        >
          <span className="tool-card-icon" style={{ background: tool.tint }}>
            <ToolIcon name={tool.icon} />
          </span>
          <span className="tool-card-text">
            <span className="tool-card-title">{tool.title}</span>
            <span className="tool-card-desc">{tool.description}</span>
            {!available.available && <span className="tool-unavailable">{available.reason}</span>}
            {available.available && available.reason && <span className="tool-capability">{available.reason}</span>}
          </span>
        </button>
        <button
          className={`tool-favorite ${favorites.includes(tool.id) ? 'active' : ''}`}
          aria-label={`${favorites.includes(tool.id) ? tr('取消收藏') : tr('收藏')}${tool.title}`}
          aria-pressed={favorites.includes(tool.id)}
          onClick={() => useToolDiscoveryStore.getState().toggleFavorite(tool.id)}
        >
          <IconStar size={15} />
        </button>
      </div>
    )
  }

  return (
    <>
      {mode === 'tools' && (
        <div className="tools-view">
          <div className="tools-inner">
            <div className="tools-search-row">
              <label className="tools-search">
                <IconSearch size={17} />
                <input
                  aria-label={tr('搜索工具')}
                  placeholder={tr('搜索工具或用途，例如：减小附件')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                className={`btn ${onlyFavorites ? 'primary' : ''}`}
                aria-pressed={onlyFavorites}
                onClick={() => setOnlyFavorites(!onlyFavorites)}
              >
                {tr('我的收藏 ')}
                {favorites.length || ''}
              </button>
            </div>
            {!matching.length && (
              <p className="tools-empty" role="status">
                {onlyFavorites && !favorites.length
                  ? tr('点工具旁的星标，即可收藏常用工具。')
                  : tr('没有找到工具，试试“压缩”“扫描识字”或“页码”。')}
              </p>
            )}
            {groups.map((group) => (
              <section key={group.title} className="tools-group">
                <h2>{group.title}</h2>
                <div className="tools-grid">{group.cards.map(card)}</div>
              </section>
            ))}
          </div>
        </div>
      )}
      {busy && (
        <div className="tools-busy" role="status">
          <div className="spinner" />
          <span>{busy}</span>
        </div>
      )}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setDialog(null)} />}
      {dialog === 'page-numbers' && <PageNumbersDialog onClose={() => setDialog(null)} />}
      {dialog === 'properties' && <PropertiesDialog onClose={() => setDialog(null)} />}
      {dialog === 'protect' && <ProtectDialog onClose={() => setDialog(null)} />}
      {dialog === 'redact' && <RedactDialog onClose={() => setDialog(null)} />}
      {dialog === 'optimize' && <OptimizeDialog onClose={() => setDialog(null)} />}
      {dialog === 'compare' && <CompareDialog onClose={() => setDialog(null)} />}
      {dialog === 'crop' && <CropDialog onClose={() => setDialog(null)} />}
      {dialog === 'convert' && <ConvertDialog onClose={() => setDialog(null)} />}
      {dialog === 'ocr' && <OcrDialog onClose={() => setDialog(null)} />}
      {dialog === 'export-pdf' && <ExportPdfDialog onClose={() => setDialog(null)} />}
      {dialog === 'export-images' && (
        <ExportImagesDialog
          onClose={() => setDialog(null)}
          onRun={(fmt, dpi) => {
            setDialog(null)
            void runBusy(tr('导出图片'), async (p) => {
              const bytes = await currentOutputBytes()
              if (!bytes) return
              const r = await exportPagesAsImages(bytes, { format: fmt, dpi, stem }, p)
              await saveBlobFile(
                r.ext === 'zip' ? tr('{0}_页面图片.zip', stem) : `${stem}.${r.ext}`,
                r.data,
                r.mime,
                r.ext === 'zip' ? tr('ZIP 压缩包') : tr('图片'),
                [r.ext],
              )
            })
          }}
        />
      )}
    </>
  )
}

// ── dialogs ──────────────────────────────────────────────────────

function latestOp<K extends EditOp['kind']>(kind: K): Extract<EditOp, { kind: K }> | null {
  const ops = useEditStore.getState().ops
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === kind) return ops[i] as Extract<EditOp, { kind: K }>
  return null
}

function Modal({
  title,
  onClose,
  children,
  actions,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  actions: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal form-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="form-modal-head">
          <h2>{title}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
    </label>
  )
}

const WM_COLORS = ['#9e9e9e', '#d32f2f', '#1565c0', '#2e7d32', '#111111']

function WatermarkDialog({ onClose }: { onClose: () => void }) {
  const cur = latestOp('watermark')
  const [text, setText] = useState(cur?.text ?? tr('内部资料'))
  const [size, setSize] = useState(cur?.fontSize ?? 60)
  const [opacity, setOpacity] = useState(Math.round((cur?.opacity ?? 0.18) * 100))
  const [angle, setAngle] = useState(cur?.angle ?? 45)
  const [color, setColor] = useState(cur?.color ?? '#9e9e9e')
  const apply = () => {
    const op: WatermarkOp = {
      kind: 'watermark',
      id: newOpId(),
      page: 0,
      text: text.trim(),
      fontSize: size,
      color,
      opacity: opacity / 100,
      angle,
    }
    useEditStore.getState().pushOp(op)
    onClose()
  }
  return (
    <Modal
      title={tr('水印')}
      onClose={onClose}
      actions={
        <>
          {cur && cur.text && (
            <button
              className="btn"
              onClick={() => {
                useEditStore.getState().pushOp({ ...cur, id: newOpId(), text: '' })
                onClose()
              }}
            >
              {tr('移除水印')}
            </button>
          )}
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button className="btn primary" onClick={apply} disabled={!text.trim()}>
            {tr('应用到全部页面')}
          </button>
        </>
      }
    >
      <Field label={tr('文字')}>
        <input className="form-input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <div className="form-row">
        <Field label={tr('字号 {0}pt', size)}>
          <input type="range" min={16} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </Field>
        <Field label={tr('不透明度 {0}%', opacity)}>
          <input type="range" min={5} max={80} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
        </Field>
      </div>
      <div className="form-row">
        <Field label={tr('角度')}>
          <div className="seg">
            {[0, 30, 45, 90].map((a) => (
              <button key={a} className={angle === a ? 'active' : ''} onClick={() => setAngle(a)} type="button">
                {a}°
              </button>
            ))}
          </div>
        </Field>
        <Field label={tr('颜色')}>
          <div className="mt-swatches">
            {WM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`mt-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Field>
      </div>
      <div className="wm-preview" aria-hidden="true">
        <span
          style={{ color, opacity: opacity / 100, transform: `rotate(${-angle}deg)`, fontSize: Math.max(12, size / 4) }}
        >
          {text}
        </span>
      </div>
    </Modal>
  )
}

function createPositions(): [PageNumbersOp['position'], string][] {
  return [
    ['bottom-center', tr('底部居中')],
    ['bottom-right', tr('底部右侧')],
    ['bottom-left', tr('底部左侧')],
    ['top-center', tr('顶部居中')],
    ['top-right', tr('顶部右侧')],
    ['top-left', tr('顶部左侧')],
  ]
}

let POSITIONS: [PageNumbersOp['position'], string][] = createPositions()
function createFormats() {
  return ['{n}', '{n} / {total}', tr('第 {n} 页'), tr('第 {n} 页，共 {total} 页'), '- {n} -']
}

let FORMATS = createFormats()

function PageNumbersDialog({ onClose }: { onClose: () => void }) {
  const cur = latestOp('page-numbers')
  const numPages = useAppStore((s) => s.numPages)
  const [format, setFormat] = useState(cur?.format || '{n} / {total}')
  const [position, setPosition] = useState<PageNumbersOp['position']>(cur?.position ?? 'bottom-center')
  const [size, setSize] = useState(cur?.fontSize ?? 10)
  const [startPage, setStartPage] = useState(cur?.startPage ?? 1)
  const [startNumber, setStartNumber] = useState(cur?.startNumber ?? 1)
  const apply = () => {
    const op: PageNumbersOp = {
      kind: 'page-numbers',
      id: newOpId(),
      page: 0,
      format,
      position,
      fontSize: size,
      color: '#333333',
      startPage: Math.max(1, Math.min(numPages, startPage)),
      startNumber,
    }
    useEditStore.getState().pushOp(op)
    onClose()
  }
  const example = format
    .replace(/\{n\}/g, String(startNumber))
    .replace(/\{total\}/g, String(startNumber + numPages - startPage))
  return (
    <Modal
      title={tr('页码')}
      onClose={onClose}
      actions={
        <>
          {cur && cur.format && (
            <button
              className="btn"
              onClick={() => {
                useEditStore.getState().pushOp({ ...cur, id: newOpId(), format: '' })
                onClose()
              }}
            >
              {tr('移除页码')}
            </button>
          )}
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button className="btn primary" onClick={apply} disabled={!format.trim()}>
            {tr('应用')}
          </button>
        </>
      }
    >
      <Field label={tr('格式')}>
        <select
          className="form-input"
          value={FORMATS.includes(format) ? format : 'custom'}
          onChange={(e) => e.target.value !== 'custom' && setFormat(e.target.value)}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.replace(/\{n\}/g, '1').replace(/\{total\}/g, String(numPages))}
            </option>
          ))}
          <option value="custom">{tr('自定义…')}</option>
        </select>
      </Field>
      <Field label={tr('自定义（{n} 页码，{total} 总页数）')}>
        <input className="form-input" value={format} onChange={(e) => setFormat(e.target.value)} />
      </Field>
      <Field label={tr('位置')}>
        <div className="pos-grid">
          {POSITIONS.map(([p, l]) => (
            <button key={p} type="button" className={position === p ? 'active' : ''} onClick={() => setPosition(p)}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <div className="form-row">
        <Field label={tr('从第几页开始')}>
          <input
            className="form-input"
            type="number"
            min={1}
            max={numPages}
            value={startPage}
            onChange={(e) => setStartPage(Number(e.target.value) || 1)}
          />
        </Field>
        <Field label={tr('起始编号')}>
          <input
            className="form-input"
            type="number"
            min={0}
            value={startNumber}
            onChange={(e) => setStartNumber(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label={tr('字号')}>
          <input
            className="form-input"
            type="number"
            min={6}
            max={36}
            value={size}
            onChange={(e) => setSize(Number(e.target.value) || 10)}
          />
        </Field>
      </div>
      <p className="form-note">
        {tr('预览：第 ')}
        {startPage}
        {tr(' 页显示 “')}
        {example}”
      </p>
    </Modal>
  )
}

function PropertiesDialog({ onClose }: { onClose: () => void }) {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const fileName = useAppStore((s) => s.fileName)
  const filePath = useAppStore((s) => s.filePath)
  const fileBytes = useAppStore((s) => s.fileBytes)
  const pageSizes = useAppStore((s) => s.pageSizes)
  const encryption = useAppStore((s) => s.encryption)
  const canModify = docPermissions(encryption).modify
  const cur = latestOp('doc-info')
  const [meta, setMeta] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ title: '', author: '', subject: '', keywords: '' })
  useEffect(() => {
    void pdfDoc?.getMetadata().then((m) => {
      const info = (m.info ?? {}) as Record<string, unknown>
      const s = (k: string) => (typeof info[k] === 'string' ? (info[k] as string) : '')
      setMeta({
        Producer: s('Producer'),
        Creator: s('Creator'),
        CreationDate: s('CreationDate'),
        ModDate: s('ModDate'),
        PDFFormatVersion: s('PDFFormatVersion'),
        IsAcroFormPresent: info.IsAcroFormPresent ? tr('是') : tr('否'),
        Encrypted: info.EncryptFilterName ? String(info.EncryptFilterName) : tr('否'),
      })
      setForm(
        cur
          ? { title: cur.title, author: cur.author, subject: cur.subject, keywords: cur.keywords }
          : { title: s('Title'), author: s('Author'), subject: s('Subject'), keywords: s('Keywords') },
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc])
  const fmtDate = (d: string) => {
    const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(d)
    return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5] ?? '00'}` : ''}` : d || '—'
  }
  const size = fileBytes
    ? fileBytes.length > 1048576
      ? `${(fileBytes.length / 1048576).toFixed(1)} MB`
      : `${Math.round(fileBytes.length / 1024)} KB`
    : '—'
  const first = pageSizes.get(1)
  const pageSize = first
    ? `${Math.round((first.width / 72) * 25.4)} × ${Math.round((first.height / 72) * 25.4)} mm`
    : '—'
  const save = () => {
    if (!canModify) return
    const op: DocInfoOp = { kind: 'doc-info', id: newOpId(), page: 0, ...form }
    useEditStore.getState().pushOp(op)
    onClose()
  }
  return (
    <Modal
      title={tr('文档属性')}
      onClose={onClose}
      actions={
        <>
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button
            className="btn primary"
            disabled={!canModify}
            title={canModify ? undefined : tr('文档权限不允许修改属性')}
            onClick={save}
          >
            {tr('保存属性')}
          </button>
        </>
      }
    >
      <div className="form-row">
        <Field label={tr('标题')}>
          <input
            className="form-input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={tr('作者')}>
          <input
            className="form-input"
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
          />
        </Field>
      </div>
      <Field label={tr('主题')}>
        <input
          className="form-input"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
      </Field>
      <Field label={tr('关键词（用逗号分隔）')}>
        <input
          className="form-input"
          value={form.keywords}
          onChange={(e) => setForm({ ...form, keywords: e.target.value })}
        />
      </Field>
      <dl className="props-list">
        <dt>{tr('文件')}</dt>
        <dd title={filePath ?? ''}>{fileName}</dd>
        <dt>{tr('大小')}</dt>
        <dd>{size}</dd>
        <dt>{tr('页数')}</dt>
        <dd>{pdfDoc?.numPages}</dd>
        <dt>{tr('页面尺寸')}</dt>
        <dd>{pageSize}</dd>
        <dt>{tr('PDF 版本')}</dt>
        <dd>{meta.PDFFormatVersion || '—'}</dd>
        <dt>{tr('创建工具')}</dt>
        <dd>{meta.Creator || '—'}</dd>
        <dt>{tr('生成程序')}</dt>
        <dd>{meta.Producer || '—'}</dd>
        <dt>{tr('创建时间')}</dt>
        <dd>{fmtDate(meta.CreationDate ?? '')}</dd>
        <dt>{tr('修改时间')}</dt>
        <dd>{fmtDate(meta.ModDate ?? '')}</dd>
        <dt>{tr('表单')}</dt>
        <dd>{meta.IsAcroFormPresent ?? '—'}</dd>
      </dl>
    </Modal>
  )
}

function ExportImagesDialog({
  onClose,
  onRun,
}: {
  onClose: () => void
  onRun: (fmt: 'png' | 'jpg', dpi: number) => void
}) {
  const [fmt, setFmt] = useState<'png' | 'jpg'>('png')
  const [dpi, setDpi] = useState(150)
  const numPages = useAppStore((s) => s.numPages)
  return (
    <Modal
      title={tr('导出为图片')}
      onClose={onClose}
      actions={
        <>
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button className="btn primary" onClick={() => onRun(fmt, dpi)}>
            {tr('导出 ')}
            {numPages}
            {tr(' 页')}
          </button>
        </>
      }
    >
      <Field label={tr('格式')}>
        <div className="seg">
          {(['png', 'jpg'] as const).map((f) => (
            <button key={f} type="button" className={fmt === f ? 'active' : ''} onClick={() => setFmt(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>
      <Field label={tr('分辨率')}>
        <div className="seg">
          {[72, 150, 300].map((d) => (
            <button key={d} type="button" className={dpi === d ? 'active' : ''} onClick={() => setDpi(d)}>
              {d} dpi
            </button>
          ))}
        </div>
      </Field>
      <p className="form-note">
        {numPages > 1 ? tr('多页会打包为一个 .zip 文件。') : tr('导出为单张图片。')}
        {tr('包含当前所有修改。')}
      </p>
    </Modal>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  POSITIONS = createPositions()
  FORMATS = createFormats()
})
