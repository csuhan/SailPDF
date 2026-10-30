import { tr, onLocaleChange } from '../i18n/locale'
/**
 * Sidebar list of all pending edits (like Acrobat's comments list): what
 * changed, on which page; click to jump, remove individually.
 */
import { useMemo } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { computePageMap } from '../pdf/edit/pageOrder'
import type { EditOp } from '../pdf/edit/ops'
import { IconTrash } from './icons'

function createMarkup(): Record<string, string> {
  return { highlight: tr('高亮'), underline: tr('下划线'), strikeout: tr('删除线') }
}

let MARKUP: Record<string, string> = createMarkup()
function createShape(): Record<string, string> {
  return { rect: tr('矩形'), ellipse: tr('椭圆'), line: tr('直线'), arrow: tr('箭头') }
}

let SHAPE: Record<string, string> = createShape()

function describe(op: EditOp): { kind: string; detail: string } | null {
  switch (op.kind) {
    case 'text-edit':
      return { kind: tr('修改文字'), detail: op.newText }
    case 'overlay-text':
      return { kind: tr('添加文字'), detail: op.text }
    case 'image':
      return { kind: tr('添加图片'), detail: `${Math.round(op.width)}×${Math.round(op.height)} pt` }
    case 'page-image':
      return {
        kind: op.action === 'delete' ? tr('删除图片') : op.imageData ? tr('替换图片') : tr('恢复图片'),
        detail: '',
      }
    case 'draw':
      return { kind: tr('画笔'), detail: tr('{0} 个点', op.points.length) }
    case 'shape':
      return { kind: SHAPE[op.shape] ?? tr('图形'), detail: '' }
    case 'markup':
      return { kind: MARKUP[op.markup] ?? tr('标注'), detail: '' }
    case 'redact':
      return { kind: tr('密文'), detail: tr('保存时删除') }
    case 'security':
      return { kind: op.protect ? tr('设置密码保护') : tr('移除密码保护'), detail: '' }
    case 'watermark':
      return { kind: op.text ? tr('水印') : tr('移除水印'), detail: op.text }
    case 'page-numbers':
      return {
        kind: op.format ? tr('页码') : tr('移除页码'),
        detail: op.format.replace(/\{n\}/g, '1').replace(/\{total\}/g, 'N'),
      }
    case 'page-crop': {
      const zero = !op.margins.left && !op.margins.right && !op.margins.top && !op.margins.bottom
      return {
        kind: zero ? tr('取消裁剪') : tr('裁剪页面'),
        detail: op.pages === 'all' ? tr('全部页面') : tr('{0} 页', op.pages.length),
      }
    }
    case 'link':
      return { kind: tr('链接'), detail: op.url ?? (op.toPage ? tr('跳转到第 {0} 页', op.toPage) : tr('未设置')) }
    case 'annot-delete':
      return { kind: tr('删除批注'), detail: '' }
    case 'doc-info':
      return { kind: tr('文档属性'), detail: op.title }
    case 'note':
      return op.text.trim() ? { kind: tr('注释'), detail: op.text } : null
    default:
      return null
  }
}

export function ChangesList() {
  const ops = useEditStore((s) => s.ops)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const pageMap = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops) : []), [pdfDoc, ops])

  // later re-edits of a line replace earlier ones: list only the latest
  const superseded = new Set(ops.map((o) => (o.kind === 'text-edit' ? o.replaces : undefined)).filter(Boolean))
  const pageOps = ops.filter(
    (o) =>
      o.kind === 'page-reorder' ||
      o.kind === 'page-rotate' ||
      o.kind === 'page-insert-blank' ||
      o.kind === 'page-delete',
  )
  const items = ops
    .filter((o) => !superseded.has(o.id))
    // document-wide changes (page 0) are listed first
    .map((op) => ({ op, d: describe(op), view: op.page === 0 ? 0.5 : pageMap.indexOf(op.page) + 1 }))
    .filter((x) => x.d)
    .sort((a, b) => (a.view || 1e9) - (b.view || 1e9))

  if (items.length === 0 && pageOps.length === 0) {
    return <div className="sidebar-empty">{tr('还没有修改。编辑或批注的内容会列在这里。')}</div>
  }

  let lastPage = -1
  return (
    <div className="changes">
      {pageOps.length > 0 && (
        <div className="changes-note">
          {tr('页面结构有 ')}
          {pageOps.length}
          {tr(' 处调整（排序 / 旋转 / 插入）')}
        </div>
      )}
      {items.map(({ op, d, view }) => {
        const header = view !== lastPage
        lastPage = view
        return (
          <div key={op.id}>
            {header && (
              <div className="changes-page">
                {view === 0.5 ? tr('整个文档') : view > 0 ? tr('第 {0} 页', view) : tr('已删除的页面')}
              </div>
            )}
            <div className="change-row">
              <button
                className="change-main"
                title={tr('跳转到此处')}
                disabled={view <= 0 || view === 0.5}
                onClick={() => {
                  useAppStore.getState().goToPage(view)
                  useEditStore.getState().setSelectedOp(op.id)
                }}
              >
                <span className="change-kind">{d!.kind}</span>
                {d!.detail && <span className="change-detail">{d!.detail}</span>}
              </button>
              <button
                className="change-del"
                title={tr('撤销这处修改')}
                aria-label={tr('撤销这处修改')}
                onClick={() => {
                  const s = useEditStore.getState()
                  s.removeOp(op.id)
                  // a removed re-edit falls back to the edit it replaced
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  MARKUP = createMarkup()
  SHAPE = createShape()
})
