import { tr, onLocaleChange } from '../i18n/locale'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PageViewport } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { loadFileAnnotations, type FileAnnot } from '../pdf/annotations'
import { newOpId } from '../pdf/edit/ops'
import { docPermissions } from '../utils/secureOpen'
import { IconTrash, IconClose } from './icons'
import { usePagePopup } from './usePagePopup'

type Target = { id: string; label: string; embedded: boolean }
function createLabels() {
  return { highlight: tr('高亮'), underline: tr('下划线'), strikeout: tr('删除线') }
}

let labels = createLabels()
export function AnnotationActions({ pageRef, viewport }: { pageRef: number; viewport: PageViewport }) {
  const marker = useRef<HTMLSpanElement>(null)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const ops = useEditStore((s) => s.ops)
  const [files, setFiles] = useState<FileAnnot[]>([])
  const [selected, setSelected] = useState<Target | null>(null)
  const popup = usePagePopup(() => marker.current, selected?.id ?? '')
  useEffect(() => {
    let cancelled = false
    if (pdfDoc && pageRef > 0)
      void loadFileAnnotations(pdfDoc, pageRef).then((list) => {
        if (!cancelled) setFiles(list)
      })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageRef])
  const remove = () => {
    if (!selected || !docPermissions().annotate) return
    const edits = useEditStore.getState()
    if (selected.embedded) edits.pushOp({ kind: 'annot-delete', id: newOpId(), page: pageRef, annotId: selected.id })
    else edits.removeOp(selected.id)
    setSelected(null)
  }
  useEffect(() => {
    const page = marker.current?.closest<HTMLElement>('.page-box')
    if (!page) return
    let down = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onClick = (e: MouseEvent) => {
      if (
        useToolStore.getState().activeTool !== 'select' ||
        (e.target as HTMLElement).closest('button,input,textarea,select,a')
      )
        return
      if (
        e.type === 'click' &&
        (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || window.getSelection()?.toString())
      )
        return
      const rect = page.getBoundingClientRect()
      const [x, y] = viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top)
      const inside = (q: { x: number; y: number; width: number; height: number }) =>
        x >= q.x - 3 && x <= q.x + q.width + 3 && y >= q.y - 3 && y <= q.y + q.height + 3
      const edits = useEditStore.getState().ops
      const op = [...edits].reverse().find((o) => o.kind === 'markup' && o.page === pageRef && o.quads.some(inside))
      const file = files.find(
        (a) =>
          !edits.some((o) => o.kind === 'annot-delete' && o.page === pageRef && o.annotId === a.id) &&
          (a.quads ?? [{ x: a.box.x0, y: a.box.y0, width: a.box.x1 - a.box.x0, height: a.box.y1 - a.box.y0 }]).some(
            inside,
          ),
      )
      const target =
        op?.kind === 'markup'
          ? { id: op.id, label: labels[op.markup], embedded: false }
          : file
            ? { id: file.id, label: file.label, embedded: true }
            : null
      if (marker.current) {
        marker.current.style.left = `${e.clientX - rect.left}px`
        marker.current.style.top = `${e.clientY - rect.top}px`
      }
      setSelected(target)
      if (target) {
        e.preventDefault()
        useEditStore.getState().setSelectedOp(null)
      }
    }
    page.addEventListener('pointerdown', onDown, true)
    page.addEventListener('click', onClick, true)
    page.addEventListener('contextmenu', onClick, true)
    return () => {
      page.removeEventListener('pointerdown', onDown, true)
      page.removeEventListener('click', onClick, true)
      page.removeEventListener('contextmenu', onClick, true)
    }
  }, [files, pageRef, viewport])
  useEffect(() => {
    if (!selected) return
    const stillExists = selected.embedded
      ? !ops.some((o) => o.kind === 'annot-delete' && o.page === pageRef && o.annotId === selected.id)
      : ops.some((o) => o.id === selected.id)
    if (!stillExists) setSelected(null)
  }, [ops, selected, pageRef])
  useEffect(() => {
    if (!selected) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return
      if (e.key === 'Escape') setSelected(null)
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopImmediatePropagation()
        remove()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [selected])
  return (
    <>
      <span ref={marker} style={{ position: 'absolute', width: 1, height: 1, pointerEvents: 'none' }} />
      {selected &&
        createPortal(
          <div
            ref={popup.ref}
            style={popup.style}
            className="annotation-actions"
            role="dialog"
            aria-label={tr('批注操作')}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <strong>{selected.label}</strong>
            <button className="btn small" disabled={!docPermissions().annotate} onClick={remove}>
              <IconTrash size={14} />
              {tr('删除批注')}
            </button>
            <button className="tb-btn" aria-label={tr('关闭批注操作')} onClick={() => setSelected(null)}>
              <IconClose size={14} />
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  labels = createLabels()
})
