import { tr } from '../i18n/locale'
/**
 * "裁剪页面" (Acrobat: 编辑 PDF → 裁剪页面): margins per edge, applied to the
 * current page or all pages; "自动" removes white margins around the content.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { newOpId, type PageCropOp } from '../pdf/edit/ops'
import { computePageMap } from '../pdf/edit/pageOrder'
import { notify } from '../utils/save'
import { IconClose } from './icons'

type Margins = PageCropOp['margins']
const ZERO: Margins = { left: 0, right: 0, top: 0, bottom: 0 }
const MM = 72 / 25.4

/** content bounds of a page from a low-res render: white margins in pt */
async function detectMargins(pageNo: number): Promise<Margins | null> {
  const doc = useAppStore.getState().pdfDoc
  if (!doc) return null
  const page = await doc.getPage(pageNo)
  const vp = page.getViewport({ scale: 1, rotation: 0 })
  const scale = Math.min(2, 900 / Math.max(vp.width, vp.height))
  const v = page.getViewport({ scale, rotation: 0 })
  const c = document.createElement('canvas')
  c.width = Math.ceil(v.width)
  c.height = Math.ceil(v.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  await page.render({ canvasContext: ctx, viewport: v }).promise
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = 6 // keep a little breathing room (pt)
  const k = 1 / scale
  return {
    left: Math.max(0, x0 * k - pad),
    right: Math.max(0, (width - 1 - x1) * k - pad),
    top: Math.max(0, y0 * k - pad),
    bottom: Math.max(0, (height - 1 - y1) * k - pad),
  }
}

export function CropDialog({ onClose }: { onClose: () => void }) {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const currentPage = useAppStore((s) => s.currentPage)
  const [scope, setScope] = useState<'current' | 'all'>('all')
  const [m, setM] = useState<Margins>(ZERO)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const pageRef = () => {
    const map = computePageMap(pdfDoc?.numPages ?? 0, useEditStore.getState().ops)
    return map[currentPage - 1] ?? 1
  }

  useEffect(() => {
    const ref = pageRef()
    if (!pdfDoc || ref <= 0) return
    void pdfDoc.getPage(ref).then((p) => {
      const v = p.getViewport({ scale: 1, rotation: 0 })
      setSize({ w: v.width, h: v.height })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, currentPage])

  const auto = async () => {
    setBusy(true)
    try {
      const ref = pageRef()
      const r = ref > 0 ? await detectMargins(ref) : null
      if (r) setM(r)
      else notify(tr('页面是空白的，无法自动检测'))
    } finally {
      setBusy(false)
    }
  }

  const apply = (margins: Margins) => {
    const op: PageCropOp = {
      kind: 'page-crop',
      id: newOpId(),
      page: 0,
      pages: scope === 'all' ? 'all' : [pageRef()],
      margins,
    }
    useEditStore.getState().pushOp(op)
    useToolStore.getState().setMode('read')
    onClose()
  }

  const tooBig = size ? m.left + m.right > size.w - 20 || m.top + m.bottom > size.h - 20 : false
  const field = (k: keyof Margins, label: string) => (
    <label className="form-field">
      <span className="form-label">{label}（mm）</span>
      <input
        className="form-input"
        type="number"
        min={0}
        step={1}
        value={Math.round((m[k] / MM) * 10) / 10}
        onChange={(e) => setM({ ...m, [k]: Math.max(0, Number(e.target.value) || 0) * MM })}
      />
    </label>
  )
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('裁剪页面')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('裁剪页面')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="form-row">
            {field('top', tr('上'))}
            {field('bottom', tr('下'))}
            {field('left', tr('左'))}
            {field('right', tr('右'))}
          </div>
          <div className="form-row align-center">
            <button className="btn" disabled={busy} onClick={() => void auto()}>
              {busy ? tr('检测中…') : tr('自动去除白边')}
            </button>
            <div className="seg" role="group" aria-label={tr('应用范围')}>
              <button type="button" className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')}>
                {tr('当前页（第 ')}
                {currentPage}
                {tr(' 页）')}
              </button>
              <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
                {tr('全部页面')}
              </button>
            </div>
          </div>
          {size && (
            <p className="form-note">
              {tr('页面 ')}
              {Math.round(size.w / MM)} × {Math.round(size.h / MM)}
              {tr(' mm，裁剪后 ')}
              {Math.max(0, Math.round((size.w - m.left - m.right) / MM))} ×{' '}
              {Math.max(0, Math.round((size.h - m.top - m.bottom) / MM))}
              {tr(' mm。裁剪只隐藏页边内容，不会删除它。')}
            </p>
          )}
          {tooBig && <p className="pw-error">{tr('裁剪量超过了页面大小。')}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => apply(ZERO)}>
            {tr('取消裁剪')}
          </button>
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button
            className="btn primary"
            disabled={tooBig || (!m.left && !m.right && !m.top && !m.bottom)}
            onClick={() => apply(m)}
          >
            {tr('应用')}
          </button>
        </div>
      </div>
    </div>
  )
}
