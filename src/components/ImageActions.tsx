import { tr } from '../i18n/locale'
/**
 * Selection box + action bar for an ORIGINAL page image (edit-text tool):
 * export, replace, delete, restore.
 */
import { useEffect, useRef, useState } from 'react'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { newOpId, type EditOp, type PageImageOp } from '../pdf/edit/ops'
import type { PageImage } from '../pdf/edit/glyphModel'
import { closeMatrix } from '../pdf/edit/imageOps'
import { exportPageImage } from '../pdf/edit/imageExport'
import { saveBlobFile } from '../utils/save'
import { IconClose, IconDownload, IconImageReplace, IconRestore, IconTrash } from './icons'

export interface SelectedPageImage {
  image: PageImage
  page: PDFPageProxy
}

/** latest page-image op for this image (null = untouched) */
export function imageStateOf(ops: EditOp[], pageRef: number, img: PageImage): PageImageOp | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i]
    if (o.kind === 'page-image' && o.page === pageRef && o.index === img.index && closeMatrix(o.matrix, img.matrix)) {
      return o
    }
  }
  return null
}

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

export function ImageActions({
  sel,
  pageRef,
  viewport,
  onClose,
}: {
  sel: SelectedPageImage
  pageRef: number
  viewport: PageViewport
  onClose: () => void
}) {
  const ops = useEditStore((s) => s.ops)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const { image } = sel
  const state = imageStateOf(ops, pageRef, image)
  const deleted = state?.action === 'delete'
  const replaced = state?.action === 'replace'

  // display box
  const [ax, ay] = viewport.convertToViewportPoint(image.box.x0, image.box.y1)
  const [bx, by] = viewport.convertToViewportPoint(image.box.x1, image.box.y0)
  const left = Math.min(ax, bx)
  const top = Math.min(ay, by)
  const width = Math.abs(bx - ax)
  const height = Math.abs(by - ay)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.tagName === 'INPUT')) return
      // handled here only: keep global shortcuts (Esc = select tool) out
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !deleted) {
        e.preventDefault()
        e.stopPropagation()
        doDelete()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted])

  const base = (): Omit<PageImageOp, 'action'> => ({
    kind: 'page-image',
    id: newOpId(),
    page: pageRef,
    matrix: image.matrix,
    index: image.index,
    box: image.box,
  })

  const doDelete = () => {
    useEditStore.getState().pushOp({ ...base(), action: 'delete' })
  }

  const doRestore = () => {
    // a "replace" without data restores the original (the newest op wins)
    useEditStore.getState().pushOp({ ...base(), action: 'replace' })
  }

  const doReplace = async () => {
    setError(null)
    const file = await pickImageFile()
    if (!file) return
    const data = new Uint8Array(await file.arrayBuffer())
    const type = file.type.includes('png') || /\.png$/i.test(file.name) ? 'png' : 'jpg'
    useEditStore.getState().pushOp({ ...base(), action: 'replace', imageType: type, imageData: data, fit: 'contain' })
  }

  const doExport = async () => {
    setError(null)
    setBusy('export')
    try {
      const app = useAppStore.getState()
      const ex = await exportPageImage(sel.page, app.fileBytes, image)
      const stem = (app.fileName ?? 'document').replace(/\.pdf$/i, '')
      const name = `${stem}_p${sel.page.pageNumber}_image${image.index + 1}.${ex.ext}`
      await saveBlobFile(name, ex.bytes, ex.mime, tr('图片'), [ex.ext])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // keep the bar inside the page: below the box, or above when no room
  const pageH = viewport.height
  const barBelow = top + height + 44 < pageH
  return (
    <>
      <div
        className={`page-image-sel ${deleted ? 'deleted' : ''}`}
        style={{ left, top, width, height }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <div
        ref={barRef}
        className="image-action-bar"
        style={{
          left: Math.max(4, Math.min(left, viewport.width - 220)),
          top: barBelow ? top + height + 6 : Math.max(4, top - 40),
        }}
        onPointerDown={(e) => e.stopPropagation()}
        role="toolbar"
        aria-label={tr('图片操作')}
      >
        <span className="iab-info">
          {image.width > 0 ? `${image.width}×${image.height}` : tr('图片')}
          {deleted ? tr(' · 已删除') : replaced && state?.imageData ? tr(' · 已替换') : ''}
        </span>
        <button
          className="iab-btn"
          title={tr('导出图片')}
          aria-label={tr('导出图片')}
          disabled={!!busy || deleted}
          onClick={doExport}
        >
          <IconDownload size={16} />
        </button>
        <button
          className="iab-btn"
          title={tr('替换图片')}
          aria-label={tr('替换图片')}
          disabled={!!busy || deleted}
          onClick={doReplace}
        >
          <IconImageReplace size={16} />
        </button>
        {deleted || (replaced && state?.imageData) ? (
          <button className="iab-btn" title={tr('恢复原图')} aria-label={tr('恢复原图')} onClick={doRestore}>
            <IconRestore size={16} />
          </button>
        ) : (
          <button
            className="iab-btn danger"
            title={tr('删除图片 (Delete)')}
            aria-label={tr('删除图片')}
            disabled={!!busy}
            onClick={doDelete}
          >
            <IconTrash size={16} />
          </button>
        )}
        <span className="iab-sep" />
        <button className="iab-btn" title={tr('关闭 (Esc)')} aria-label={tr('关闭')} onClick={onClose}>
          <IconClose size={14} />
        </button>
        {error && <span className="iab-error">{error}</span>}
      </div>
    </>
  )
}
