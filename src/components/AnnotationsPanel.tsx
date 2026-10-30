import { tr, onLocaleChange, interfaceLabel } from '../i18n/locale'
import { useLocale } from '../i18n/react'
/**
 * 批注列表 (Acrobat "注释" pane): every annotation of the document — the ones
 * already in the file and the ones added in this session — filterable by
 * type and colour, with jump-to, reply-free editing of note text, delete,
 * plus import / export (XFDF-like JSON) and "flatten / clean copy".
 */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { computePageMap } from '../pdf/edit/pageOrder'
import { newOpId, type EditOp } from '../pdf/edit/ops'
import { jumpToPassage, viewPageOf } from '../ai/flash'
import { notify, saveBlobFile } from '../utils/save'
import { exportAnnotations, importAnnotations, loadFileAnnotations, type FileAnnot } from '../pdf/annotations'
import { docPermissions } from '../utils/secureOpen'
import { IconDownload, IconImport, IconTrash } from './icons'

type Kind = 'all' | 'note' | 'markup' | 'draw' | 'shape' | 'text' | 'stamp'
function createKindLabel(): Record<Exclude<Kind, 'all'>, string> {
  return {
    note: tr('注释'),
    markup: tr('标记'),
    draw: tr('画笔'),
    shape: tr('图形'),
    text: tr('文本'),
    stamp: tr('图章/图片'),
  }
}

let KIND_LABEL: Record<Exclude<Kind, 'all'>, string> = createKindLabel()

interface Row {
  key: string
  kind: Exclude<Kind, 'all'>
  label: string
  detail: string
  color: string
  /** original page ref */
  ref: number
  box: { x0: number; y0: number; x1: number; y1: number } | null
  /** session op (deletable) */
  op?: EditOp
  /** existing annotation in the file */
  file?: FileAnnot
  author?: string
  date?: string
}

function createMarkupLabel(): Record<string, string> {
  return { highlight: tr('高亮'), underline: tr('下划线'), strikeout: tr('删除线') }
}

let MARKUP_LABEL: Record<string, string> = createMarkupLabel()

function rowOfOp(op: EditOp): Row | null {
  switch (op.kind) {
    case 'note':
      return {
        key: op.id,
        kind: 'note',
        label: tr('便签'),
        detail: op.text,
        color: op.color,
        ref: op.page,
        box: { x0: op.x, y0: op.y - 20, x1: op.x + 20, y1: op.y },
        op,
        author: op.author,
        date: op.modified,
      }
    case 'markup': {
      const xs = op.quads
      const box = xs.length
        ? {
            x0: Math.min(...xs.map((q) => q.x)),
            y0: Math.min(...xs.map((q) => q.y)),
            x1: Math.max(...xs.map((q) => q.x + q.width)),
            y1: Math.max(...xs.map((q) => q.y + q.height)),
          }
        : null
      return {
        key: op.id,
        kind: 'markup',
        label: MARKUP_LABEL[op.markup] ?? tr('标记'),
        detail: '',
        color: op.color,
        ref: op.page,
        box,
        op,
      }
    }
    case 'draw': {
      const ps = op.points
      const box = ps.length
        ? {
            x0: Math.min(...ps.map((p) => p.x)),
            y0: Math.min(...ps.map((p) => p.y)),
            x1: Math.max(...ps.map((p) => p.x)),
            y1: Math.max(...ps.map((p) => p.y)),
          }
        : null
      return { key: op.id, kind: 'draw', label: tr('画笔'), detail: '', color: op.color, ref: op.page, box, op }
    }
    case 'shape':
      return {
        key: op.id,
        kind: 'shape',
        label: { rect: tr('矩形'), ellipse: tr('椭圆'), line: tr('直线'), arrow: tr('箭头') }[op.shape],
        detail: '',
        color: op.color,
        ref: op.page,
        box: { x0: op.x, y0: op.y, x1: op.x + op.width, y1: op.y + op.height },
        op,
      }
    case 'overlay-text':
      return {
        key: op.id,
        kind: 'text',
        label: tr('文本框'),
        detail: op.text,
        color: op.color,
        ref: op.page,
        box: { x0: op.x, y0: op.y, x1: op.x + op.text.length * op.fontSize * 0.5, y1: op.y + op.fontSize },
        op,
      }
    case 'image':
      return {
        key: op.id,
        kind: 'stamp',
        label: tr('图章/图片'),
        detail: '',
        color: '#888888',
        ref: op.page,
        box: { x0: op.x, y0: op.y, x1: op.x + op.width, y1: op.y + op.height },
        op,
      }
    default:
      return null
  }
}

export function AnnotationsPanel() {
  const locale = useLocale()
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const ops = useEditStore((s) => s.ops)
  const [fileAnnots, setFileAnnots] = useState<FileAnnot[]>([])
  const [kind, setKind] = useState<Kind>('all')
  const [color, setColor] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    void loadFileAnnotations(pdfDoc).then((a) => !cancelled && setFileAnnots(a))
    return () => {
      cancelled = true
    }
  }, [pdfDoc])

  const pageMap = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops) : []), [pdfDoc, ops])
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const a of fileAnnots) {
      if (ops.some((op) => op.kind === 'annot-delete' && op.page === a.page && op.annotId === a.id)) continue
      out.push({
        key: `f${a.id}`,
        kind: a.kind,
        label: interfaceLabel(a.label),
        detail: a.contents,
        color: a.color,
        ref: a.page,
        box: a.box,
        file: a,
        author: a.author,
        date: a.date,
      })
    }
    for (const op of ops) {
      const r = rowOfOp(op)
      if (r) out.push(r)
    }
    return out
      .filter((r) => pageMap.includes(r.ref))
      .sort((a, b) => pageMap.indexOf(a.ref) - pageMap.indexOf(b.ref) || (b.box?.y1 ?? 0) - (a.box?.y1 ?? 0))
  }, [fileAnnots, ops, pageMap, locale])

  const colors = Array.from(new Set(rows.map((r) => r.color.toLowerCase())))
  const shown = rows.filter(
    (r) =>
      (kind === 'all' || r.kind === kind) &&
      (!color || r.color.toLowerCase() === color) &&
      (!query || `${r.label} ${r.detail} ${r.author ?? ''}`.toLowerCase().includes(query.toLowerCase())),
  )
  const kinds = (Object.keys(KIND_LABEL) as Exclude<Kind, 'all'>[]).filter((k) => rows.some((r) => r.kind === k))

  const doExport = async () => {
    const data = exportAnnotations(
      useEditStore.getState().ops,
      fileAnnots.filter(
        (a) => !ops.some((op) => op.kind === 'annot-delete' && op.page === a.page && op.annotId === a.id),
      ),
    )
    const stem = (useAppStore.getState().fileName ?? 'document').replace(/\.pdf$/i, '')
    await saveBlobFile(tr('{0}_批注.json', stem), new TextEncoder().encode(data), 'application/json', tr('批注数据'), [
      'json',
    ])
  }
  const doImport = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const list = importAnnotations(await f.text(), pageMap)
        if (!list.length) {
          notify(tr('文件中没有可导入的批注'), 'error')
          return
        }
        useEditStore.getState().pushOps(list)
        notify(tr('已导入 {0} 条批注', list.length))
      } catch (e) {
        notify(tr('导入失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
      }
    }
    input.click()
  }

  const remove = (r: Row) => {
    if (!docPermissions().annotate) return
    if (r.op) useEditStore.getState().removeOp(r.op.id)
    else if (r.file) {
      useEditStore.getState().pushOp({ kind: 'annot-delete', id: newOpId(), page: r.ref, annotId: r.file.id } as EditOp)
    }
  }

  return (
    <div className="annots">
      <div className="annots-tools">
        <input
          className="form-input"
          placeholder={tr('搜索批注')}
          aria-label={tr('搜索批注')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button className="tb-btn" title={tr('导入批注')} aria-label={tr('导入批注')} onClick={() => void doImport()}>
          <IconImport size={14} />
        </button>
        <button
          className="tb-btn"
          title={tr('导出批注')}
          aria-label={tr('导出批注')}
          disabled={!rows.length}
          onClick={() => void doExport()}
        >
          <IconDownload size={14} />
        </button>
      </div>
      {rows.length > 0 && (
        <div className="annots-filters">
          <button className={`chip ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>
            {tr('全部 ')}
            {rows.length}
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              className={`chip ${kind === k ? 'active' : ''}`}
              onClick={() => setKind(kind === k ? 'all' : k)}
            >
              {KIND_LABEL[k]} {rows.filter((r) => r.kind === k).length}
            </button>
          ))}
          {colors.length > 1 &&
            colors.map((c) => (
              <button
                key={c}
                className={`annot-color ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                title={tr('按颜色筛选')}
                aria-label={tr('颜色 {0}', c)}
                onClick={() => setColor(color === c ? null : c)}
              />
            ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="sidebar-empty">
          {rows.length ? tr('没有符合条件的批注') : tr('还没有批注。高亮、便签、画笔等都会列在这里。')}
        </div>
      ) : (
        <ul className="annots-list">
          {shown.map((r) => (
            <li key={r.key} className="annot-row">
              <button
                className="annot-main"
                onClick={() =>
                  r.box ? jumpToPassage(r.ref, r.box) : useAppStore.getState().goToPage(viewPageOf(r.ref))
                }
              >
                <span className="annot-swatch" style={{ background: r.color }} />
                <span className="annot-text">
                  <span className="annot-label">
                    {r.label}
                    <span className="annot-page">
                      {tr('第 ')}
                      {pageMap.indexOf(r.ref) + 1}
                      {tr(' 页')}
                    </span>
                    {r.file && <span className="annot-src">{tr('文件中')}</span>}
                  </span>
                  {r.detail && <span className="annot-detail">{r.detail}</span>}
                  {(r.author || r.date) && (
                    <span className="annot-meta">
                      {r.author}
                      {r.author && r.date ? ' · ' : ''}
                      {r.date ? fmtDate(r.date) : ''}
                    </span>
                  )}
                </span>
              </button>
              <button
                disabled={!docPermissions().annotate}
                className="change-del"
                title={tr('删除批注')}
                aria-label={tr('删除批注')}
                onClick={() => remove(r)}
              >
                <IconTrash size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fmtDate(d: string): string {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(d)
  if (m) return `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5] ?? '00'}` : ''}`
  const t = new Date(d)
  return Number.isNaN(t.getTime())
    ? d
    : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  KIND_LABEL = createKindLabel()
  MARKUP_LABEL = createMarkupLabel()
})
