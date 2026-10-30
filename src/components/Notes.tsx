import { tr, getLocale } from '../i18n/locale'
/**
 * Sticky notes (Acrobat "注释"): icons on the page; click to read / edit.
 * Baked as real PDF /Text annotations, so other readers show them too.
 */
import { createPortal } from 'react-dom'
import { usePagePopup } from './usePagePopup'
import { registerPendingCommit } from '../utils/save'
import { useEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import { useEditStore } from '../state/editStore'
import type { NoteOp } from '../pdf/edit/ops'
import { IconTrash } from './icons'

export function NotesLayer({
  pageRef,
  viewport,
  openId,
  setOpenId,
}: {
  pageRef: number
  viewport: PageViewport
  openId: string | null
  setOpenId: (id: string | null) => void
}) {
  const ops = useEditStore((s) => s.ops)
  const notes = ops.filter((o): o is NoteOp => o.kind === 'note' && o.page === pageRef)
  return (
    <>
      {notes.map((n) => {
        const [x, y] = viewport.convertToViewportPoint(n.x, n.y)
        return (
          <div key={n.id}>
            <button
              data-note-id={n.id}
              className={`note-icon ${openId === n.id ? 'open' : ''}`}
              style={{ left: x, top: y, color: n.color }}
              title={n.text || tr('注释')}
              aria-label={tr('注释')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpenId(openId === n.id ? null : n.id)
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v12H9l-5 4z" fill="currentColor" stroke="rgba(0,0,0,.35)" strokeWidth="1" />
                <path d="M8 8.5h8M8 12h5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            {openId === n.id && <NotePopup note={n} onClose={() => setOpenId(null)} />}
          </div>
        )
      })}
    </>
  )
}

function NotePopup({ note, onClose }: { note: NoteOp; onClose: () => void }) {
  const [text, setText] = useState(note.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  const draft = useRef(text)
  draft.current = text
  const popup = usePagePopup(() => document.querySelector(`[data-note-id="${note.id}"]`), note.id)
  useEffect(() => {
    ref.current?.focus()
    const len = ref.current?.value.length ?? 0
    ref.current?.setSelectionRange(len, len)
  }, [])
  const commit = () => {
    const s = useEditStore.getState()
    const t = draft.current.replace(/\s+$/, '')
    if (!t) s.removeOp(note.id)
    else if (t !== note.text) s.updateOp(note.id, { text: t, modified: new Date().toISOString() } as Partial<NoteOp>)
    onClose()
  }
  useEffect(() => registerPendingCommit(commit), [note.id])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!popup.ref.current?.contains(event.target as Node)) commit()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [note.id])
  return createPortal(
    <div
      ref={popup.ref}
      className="note-popup"
      style={popup.style}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={tr('注释')}
    >
      <div className="note-head">
        <span>{note.author || tr('注释')}</span>
        <span className="note-time">
          {new Date(note.modified).toLocaleString(getLocale(), {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <textarea
        ref={ref}
        value={text}
        placeholder={tr('输入注释…')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
      />
      <div className="note-actions">
        <button
          className="note-del"
          title={tr('删除注释')}
          aria-label={tr('删除注释')}
          onClick={() => {
            useEditStore.getState().removeOp(note.id)
            onClose()
          }}
        >
          <IconTrash size={14} />
        </button>
        <span className="note-hint">{tr('⌘↵ 完成')}</span>
        <button className="btn primary small" onClick={commit}>
          {tr('完成')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
