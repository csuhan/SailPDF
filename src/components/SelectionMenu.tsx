import { tr } from '../i18n/locale'
/**
 * Quick actions on a text selection while reading (Acrobat-style popup):
 * copy, highlight, underline, strikethrough — no mode switch needed.
 */
import { useEffect, useState } from 'react'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { getPageRuntime } from '../pdf/registry'
import { computePageMap } from '../pdf/edit/pageOrder'
import { useAppStore } from '../state/stores'
import { newOpId, type MarkupKind } from '../pdf/edit/ops'
import { notify } from '../utils/save'
import { IconAI, IconFiles, IconHighlight, IconNote, IconStrike, IconUnderline } from './icons'
import { useAiStore } from '../ai/aiStore'
import { SELECTION_ACTIONS } from '../ai/agent'

interface SelInfo {
  x: number
  y: number
  text: string
  /** per text layer: page box + client rects */
  parts: { viewPage: number; rects: DOMRect[] }[]
}

function readSelection(): SelInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = sel.toString()
  if (!text.trim()) return null
  const range = sel.getRangeAt(0)
  const startEl = (range.startContainer as Element).parentElement ?? (range.startContainer as Element)
  if (!startEl?.closest?.('.textLayer')) return null
  const byPage = new Map<number, DOMRect[]>()
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue
    const el = document
      .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      .find((e) => e.classList.contains('page-box'))
    const vp = Number((el as HTMLElement | undefined)?.dataset.page)
    if (!vp) continue
    const list = byPage.get(vp) ?? []
    list.push(r)
    byPage.set(vp, list)
  }
  if (byPage.size === 0) return null
  const all = Array.from(byPage.values()).flat()
  const top = Math.min(...all.map((r) => r.top))
  const left = Math.min(...all.map((r) => r.left))
  const right = Math.max(...all.map((r) => r.right))
  return {
    x: (left + right) / 2,
    y: top,
    text,
    parts: Array.from(byPage.entries()).map(([viewPage, rects]) => ({ viewPage, rects })),
  }
}

export function SelectionMenu() {
  const mode = useToolStore((s) => s.mode)
  const [info, setInfo] = useState<SelInfo | null>(null)

  useEffect(() => {
    if (mode !== 'read') {
      setInfo(null)
      return
    }
    const onUp = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.selection-menu')) return
      // wait for the selection to settle
      window.setTimeout(() => setInfo(readSelection()), 0)
    }
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.selection-menu')) return
      setInfo(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfo(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    const vp = document.querySelector('.viewport')
    const onScroll = () => setInfo(null)
    vp?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      vp?.removeEventListener('scroll', onScroll)
    }
  }, [mode])

  if (!info) return null

  const mark = (kind: MarkupKind) => {
    const app = useAppStore.getState()
    const ops = useEditStore.getState().ops
    const pageMap = app.pdfDoc ? computePageMap(app.pdfDoc.numPages, ops) : []
    const color = useToolStore.getState().markupColors[kind]
    for (const part of info.parts) {
      const rt = getPageRuntime(part.viewPage)
      const box = document
        .querySelector(`.page-box[data-page="${part.viewPage}"] .interaction-layer`)
        ?.getBoundingClientRect()
      if (!rt || !box) continue
      // merge fragments on the same visual line
      const rects = part.rects.slice().sort((a, b) => a.top - b.top || a.left - b.left)
      const lines: { l: number; t: number; r: number; b: number }[] = []
      for (const r of rects) {
        const last = lines[lines.length - 1]
        if (last && Math.abs(last.t - r.top) < Math.max(2, r.height) * 0.5) {
          last.l = Math.min(last.l, r.left)
          last.r = Math.max(last.r, r.right)
          last.t = Math.min(last.t, r.top)
          last.b = Math.max(last.b, r.bottom)
        } else lines.push({ l: r.left, t: r.top, r: r.right, b: r.bottom })
      }
      const quads = lines.map((ln) => {
        const [ax, ay] = rt.viewport.convertToPdfPoint(ln.l - box.left, ln.t - box.top)
        const [bx, by] = rt.viewport.convertToPdfPoint(ln.r - box.left, ln.b - box.top)
        return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
      })
      useEditStore.getState().pushOp({
        kind: 'markup',
        id: newOpId(),
        page: pageMap[part.viewPage - 1] ?? part.viewPage,
        markup: kind,
        quads,
        color,
        opacity: kind === 'highlight' ? 0.42 : 1,
      })
    }
    window.getSelection()?.removeAllRanges()
    setInfo(null)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.text)
      notify(tr('已复制'))
    } catch {
      document.execCommand('copy')
    }
    setInfo(null)
  }

  // the original page of the first selected part (AI context / notes)
  const firstRef = () => {
    const app = useAppStore.getState()
    const map = app.pdfDoc ? computePageMap(app.pdfDoc.numPages, useEditStore.getState().ops) : []
    const vp = info.parts[0]?.viewPage ?? 1
    return { view: vp, ref: map[vp - 1] ?? vp }
  }
  const askAi = (prompt: string | null) => {
    const sel = { text: info.text.trim(), page: firstRef().view }
    if (prompt) useAiStore.getState().ask(prompt, sel)
    else {
      useAiStore.getState().setSelection(sel)
      useAiStore.getState().setOpen(true)
      window.setTimeout(
        () => (document.querySelector('.ai-compose textarea') as HTMLTextAreaElement | null)?.focus(),
        60,
      )
    }
    window.getSelection()?.removeAllRanges()
    setInfo(null)
  }
  /** sticky note next to the selection, opened for typing */
  const addNote = () => {
    const part = info.parts[0]
    const rt = part && getPageRuntime(part.viewPage)
    const box =
      part &&
      document.querySelector(`.page-box[data-page="${part.viewPage}"] .interaction-layer`)?.getBoundingClientRect()
    if (!rt || !box) return
    const r = part.rects.reduce((a, b) => (b.right > a.right ? b : a))
    const [x, y] = rt.viewport.convertToPdfPoint(r.right - box.left + 4, r.top - box.top)
    const id = newOpId()
    useEditStore.getState().pushOp({
      kind: 'note',
      id,
      page: firstRef().ref,
      x,
      y: y + 4,
      text: `“${info.text.trim().slice(0, 120)}”\n`,
      color: useToolStore.getState().noteColor,
      modified: new Date().toISOString(),
    })
    window.dispatchEvent(new CustomEvent('pdfpro:open-note', { detail: id }))
    window.getSelection()?.removeAllRanges()
    setInfo(null)
  }

  const top = info.y - 44 < 60 ? info.y + 28 : info.y - 44
  return (
    <div className="selection-menu" role="toolbar" aria-label={tr('所选文字')} style={{ left: info.x, top }}>
      <button title={tr('复制 (⌘C)')} aria-label={tr('复制')} onClick={copy}>
        <IconFiles size={15} />
      </button>
      <span className="sm-sep" />
      <button title={tr('高亮')} aria-label={tr('高亮')} onClick={() => mark('highlight')}>
        <IconHighlight size={15} />
      </button>
      <button title={tr('下划线')} aria-label={tr('下划线')} onClick={() => mark('underline')}>
        <IconUnderline size={15} />
      </button>
      <button title={tr('删除线')} aria-label={tr('删除线')} onClick={() => mark('strikeout')}>
        <IconStrike size={15} />
      </button>
      <button title={tr('添加注释')} aria-label={tr('添加注释')} onClick={addNote}>
        <IconNote size={15} />
      </button>
      <span className="sm-sep" />
      <button className="sm-ai" title={tr('问 AI')} aria-label={tr('问 AI')} onClick={() => askAi(null)}>
        <IconAI size={15} />
      </button>
      {SELECTION_ACTIONS.map((a) => (
        <button key={a.id} className="sm-text" title={`AI ${a.label}`} onClick={() => askAi(a.prompt)}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
