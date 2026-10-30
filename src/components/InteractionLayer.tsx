import { tr } from '../i18n/locale'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import { useEditStore } from '../state/editStore'
import { useToolStore, type ToolId } from '../state/toolStore'
import {
  newOpId,
  type DrawOp,
  type EditOp,
  type HighlightOp,
  type LinkOp,
  type ImageOp,
  type MarkupKind,
  type NoteOp,
  type OverlayTextOp,
  type RedactOp,
  type ShapeOp,
  type TextEditOp,
} from '../pdf/edit/ops'
import { opDisplayRect, resizeOp, translateOp, type DisplayRect } from '../pdf/edit/opGeometry'
import { cssFontFamily, cssFontVariant } from '../pdf/edit/overlayDraw'
import { cleanFontName, findLineRuns, sampleInkColor } from '../pdf/fontMatch'
import { getPageRuntime } from '../pdf/registry'
import { reconstructRuns, type LineRun } from '../pdf/edit/textRuns'
import { createRunLayoutContext, standardNameForFallback, toEditRun } from '../pdf/edit/runLayout'
import { buildLineEditOp, editorSegments, openLineEdit, type LineEditContext } from '../pdf/edit/lineEdit'
import { getGlyphModel, type PageImage } from '../pdf/edit/glyphModel'
import { ImageActions, type SelectedPageImage } from './ImageActions'
import { registerPendingCommit } from '../utils/save'
import { AnnotationActions } from './AnnotationActions'
import { NotesLayer } from './Notes'
import { savedSignature } from './SignatureDialog'
import { STAMPS, renderStamp } from '../pdf/edit/stamps'

interface Props {
  viewPage: number
  pageRef: number
  viewport: PageViewport
  width: number
  height: number
  textLayerHost: React.RefObject<HTMLDivElement | null>
}

type EditSpanState = {
  mode: 'edit-span'
  rect: DisplayRect
  text: string
  fontSizePt: number
  fontCss: string
  color: string
  baselineCss: number
  family: string
  bold: boolean
  italic: boolean
  fontFallback: 'serif' | 'sans-serif' | 'monospace'
  /** style-resolved fragments of the recognized line (for run-preserving edits) */
  lineRuns: import('../pdf/fontMatch').LineRuns | null
}

type EditorState =
  | { mode: 'add'; cssX: number; cssY: number }
  | EditSpanState
  | EditLineState
  | { mode: 'edit-op'; opId: string; rect: DisplayRect; text: string; fontSizePt: number }
  | null

type EditLineState = {
  mode: 'edit-line'
  ctx: LineEditContext
  /** css rect of the editor box */
  rect: DisplayRect
  text: string
  fontCss: string
  color: string
  /** css y of the line's baseline (editor text is aligned to it) */
  baselineCss: number
  /** css x where the line's first glyph starts */
  startCss: number
}

/** editor box for a glyph-model line: placed exactly over the line */
function lineEditorState(ctx: LineEditContext, viewport: PageViewport): EditLineState {
  const { line, previous } = ctx
  const box = previous?.hitRect
    ? {
        x0: previous.hitRect.x,
        x1: previous.hitRect.x + previous.hitRect.width,
        y0: line.box.y0,
        y1: line.box.y1,
      }
    : line.box
  const [ax, ay] = viewport.convertToViewportPoint(box.x0, box.y1)
  const [bx, by] = viewport.convertToViewportPoint(box.x1, box.y0)
  // the editor uses the style of the line's first glyph
  const first = line.chars.find((c) => c.glyph)?.style
  const sizeCss = (first?.size ?? line.size) * viewport.scale
  const loaded = first ? first.font : ''
  const fontInfo = loaded ? ctx.model.fonts.get(loaded) : undefined
  const fam = cleanFontName(fontInfo?.name ?? '').family
  return {
    mode: 'edit-line',
    ctx,
    rect: {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
    },
    text: ctx.currentText,
    fontCss: `${sizeCss}px "${fontInfo?.loadedName ?? loaded}", ${fam ? `"${fam}", ` : ''}serif`,
    color: first?.color ?? '#000000',
    baselineCss: viewport.convertToViewportPoint(line.chars[0]?.x ?? box.x0, line.baselineY)[1],
    startCss: viewport.convertToViewportPoint(line.chars[0]?.x ?? box.x0, line.baselineY)[0],
  }
}

const MARKUP_TOOLS: ToolId[] = ['highlight', 'underline', 'strikeout']

export function InteractionLayer({ viewPage, pageRef, viewport, width, height, textLayerHost }: Props) {
  const activeTool = useToolStore((s) => s.activeTool)
  const ops = useEditStore((s) => s.ops)
  const selectedOpId = useEditStore((s) => s.selectedOpId)
  const hostRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [imageSel, setImageSel] = useState<SelectedPageImage | null>(null)
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
  const [linkEdit, setLinkEdit] = useState<string | null>(null)
  const pendingSigAt = useRef<{ x: number; y: number } | null>(null)

  /** place a signature PNG centered on a pdf point, then select it */
  const placeSignature = async (dataUrl: string, at: { x: number; y: number }) => {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const wPt = 150
    const hPt = (bmp.height / bmp.width) * wPt
    bmp.close()
    const op: ImageOp = {
      kind: 'image',
      id: newOpId(),
      page: pageRef,
      x: at.x - wPt / 2,
      y: at.y - hPt / 2,
      width: wPt,
      height: hPt,
      rotation: 0,
      imageType: 'png',
      imageData: bytes,
    }
    const es = useEditStore.getState()
    es.pushOp(op)
    es.setSelectedOp(op.id)
    useToolStore.getState().setTool('select')
  }

  // a signature created from the dialog lands where the user clicked
  useEffect(() => {
    const onSig = (e: Event) => {
      const at = pendingSigAt.current
      if (!at) return
      pendingSigAt.current = null
      void placeSignature((e as CustomEvent<string>).detail, at)
    }
    window.addEventListener('pdfpro:signature-created', onSig)
    return () => window.removeEventListener('pdfpro:signature-created', onSig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRef])
  // a note created elsewhere (selection menu) opens for typing on its page
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (useEditStore.getState().ops.some((o) => o.id === id && o.page === pageRef)) setOpenNoteId(id)
    }
    window.addEventListener('pdfpro:open-note', onOpen)
    return () => window.removeEventListener('pdfpro:open-note', onOpen)
  }, [pageRef])
  const lineOpenSeq = useRef(0)

  const myOps = ops.filter((o) => o.page === pageRef && !isPageOp(o))

  const toPdf = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = hostRef.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      const p = viewport.convertToPdfPoint(clientX - r.left, clientY - r.top)
      return { x: p[0], y: p[1] }
    },
    [viewport],
  )

  const toCss = useCallback(
    (pdfX: number, pdfY: number): { x: number; y: number } => {
      const p = viewport.convertToViewportPoint(pdfX, pdfY)
      return { x: p[0], y: p[1] }
    },
    [viewport],
  )

  // close editor only when tool changes or page changes — NOT on viewport
  // identity change (runtime objects are recreated on unrelated re-renders,
  // and killing in-flight gestures/editors on them destroys user input)
  useEffect(() => {
    setEditor(null)
    setImageSel(null)
  }, [activeTool, viewPage])

  // ── text markup via DOM selection ─────────────────────────
  useEffect(() => {
    if (!MARKUP_TOOLS.includes(activeTool)) return
    const onUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const host = textLayerHost.current
      if (!host) return
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) return
      const hostRect = host.getBoundingClientRect()
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({
          left: r.left - hostRect.left,
          top: r.top - hostRect.top,
          right: r.right - hostRect.left,
          bottom: r.bottom - hostRect.top,
        }))
      if (rects.length === 0) return
      // merge rect fragments that share a visual line
      rects.sort((a, b) => a.top - b.top || a.left - b.left)
      const lines: (typeof rects)[number][] = []
      for (const r of rects) {
        const last = lines[lines.length - 1]
        if (last && Math.abs(last.top - r.top) < Math.max(2, r.bottom - r.top) * 0.5) {
          last.left = Math.min(last.left, r.left)
          last.right = Math.max(last.right, r.right)
          last.top = Math.min(last.top, r.top)
          last.bottom = Math.max(last.bottom, r.bottom)
        } else {
          lines.push({ ...r })
        }
      }
      const quads = lines.map((l) => {
        // pdf space: convert top-left & bottom-right both ways
        const [ax, ay] = viewport.convertToPdfPoint(l.left, l.top)
        const [bx, by] = viewport.convertToPdfPoint(l.right, l.bottom)
        const x = Math.min(ax, bx)
        const y = Math.min(ay, by)
        return { x, y, width: Math.abs(bx - ax), height: Math.abs(by - ay) }
      })
      const colors = useToolStore.getState().markupColors
      const kind = activeTool as MarkupKind
      const op: HighlightOp = {
        kind: 'markup',
        id: newOpId(),
        page: pageRef,
        markup: kind,
        quads,
        color: colors[kind],
        opacity: kind === 'highlight' ? 0.42 : 1,
      }
      useEditStore.getState().pushOp(op)
      sel.removeAllRanges()
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [activeTool, pageRef, viewport, textLayerHost])

  // ── shape / draw / redact gesture state ───────────────────
  const gestureRef = useRef<{
    opId: string
    startPdf: { x: number; y: number }
    lastCss: { x: number; y: number }
  } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // suppress default click focus behavior so inline editors keep focus,
    // and prevent accidental text selection while drawing
    e.preventDefault()
    const tool = activeTool
    const pdf = toPdf(e.clientX, e.clientY)

    if (tool === 'draw') {
      const st = useToolStore.getState().drawStyle
      const op: DrawOp = {
        kind: 'draw',
        id: newOpId(),
        page: pageRef,
        points: [pdf],
        color: st.color,
        thickness: st.thickness,
        opacity: st.opacity,
      }
      useEditStore.getState().pushOp(op)
      gestureRef.current = { opId: op.id, startPdf: pdf, lastCss: { x: e.clientX, y: e.clientY } }
      hostRef.current?.setPointerCapture(e.pointerId)
      return
    }

    if (tool === 'link') {
      const op: LinkOp = { kind: 'link', id: newOpId(), page: pageRef, x: pdf.x, y: pdf.y, width: 0, height: 0 }
      useEditStore.getState().pushOp(op)
      gestureRef.current = { opId: op.id, startPdf: pdf, lastCss: { x: e.clientX, y: e.clientY } }
      hostRef.current?.setPointerCapture(e.pointerId)
      return
    }

    if (tool === 'shape' || tool === 'redact') {
      const st = useToolStore.getState()
      if (tool === 'shape') {
        const op: ShapeOp = {
          kind: 'shape',
          id: newOpId(),
          page: pageRef,
          shape: st.shapeKind,
          x: pdf.x,
          y: pdf.y,
          width: 0,
          height: 0,
          color: st.drawStyle.color,
          thickness: st.drawStyle.thickness,
          fill: st.shapeFill,
        }
        useEditStore.getState().pushOp(op)
        gestureRef.current = { opId: op.id, startPdf: pdf, lastCss: { x: e.clientX, y: e.clientY } }
      } else {
        const op: RedactOp = {
          kind: 'redact',
          id: newOpId(),
          page: pageRef,
          x: pdf.x,
          y: pdf.y,
          width: 0,
          height: 0,
        }
        useEditStore.getState().pushOp(op)
        gestureRef.current = { opId: op.id, startPdf: pdf, lastCss: { x: e.clientX, y: e.clientY } }
      }
      hostRef.current?.setPointerCapture(e.pointerId)
      return
    }

    if (tool === 'signature') {
      const sig = savedSignature()
      if (!sig) {
        pendingSigAt.current = pdf
        useToolStore.getState().requestSignature()
        return
      }
      void placeSignature(sig, pdf)
      return
    }

    if (tool === 'stamp') {
      const def = STAMPS.find((d) => d.id === useToolStore.getState().stampId) ?? STAMPS[0]
      void renderStamp(def).then(({ png, wPt, hPt }) => {
        const op: ImageOp = {
          kind: 'image',
          id: newOpId(),
          page: pageRef,
          x: pdf.x - wPt / 2,
          y: pdf.y - hPt / 2,
          width: wPt,
          height: hPt,
          rotation: 0,
          imageType: 'png',
          imageData: png,
        }
        const es = useEditStore.getState()
        es.pushOp(op)
        es.setSelectedOp(op.id)
        useToolStore.getState().setTool('select')
      })
      return
    }

    if (tool === 'note') {
      // place a sticky note and open it for typing
      if (openNoteId) {
        setOpenNoteId(null)
        return
      }
      const color = useToolStore.getState().noteColor
      const op: NoteOp = {
        kind: 'note',
        id: newOpId(),
        page: pageRef,
        x: pdf.x - 4,
        y: pdf.y + 4,
        text: '',
        color,
        modified: new Date().toISOString(),
      }
      useEditStore.getState().pushOp(op)
      setOpenNoteId(op.id)
      return
    }

    if (tool === 'add-text') {
      const r = hostRef.current!.getBoundingClientRect()
      setEditor({ mode: 'add', cssX: e.clientX - r.left, cssY: e.clientY - r.top })
      return
    }

    if (tool === 'edit-text') {
      const host = hostRef.current
      if (!host) return
      const textHost = textLayerHost.current
      if (!textHost) return
      const rt = getPageRuntime(viewPage)
      // primary path: exact glyph model from the page content. Works through
      // link annotations and on lines that were already edited (including
      // text typed in an earlier edit, which has no text-layer span).
      if (rt) {
        const seq = ++lineOpenSeq.current
        setImageSel(null)
        void (async () => {
          let ctx: LineEditContext | null = null
          try {
            ctx = await openLineEdit(rt.page, pageRef, useEditStore.getState().ops, pdf.x, pdf.y)
          } catch (err) {
            console.warn('[pdf-pro] line model failed, falling back', err)
          }
          if (seq !== lineOpenSeq.current) return
          if (ctx) {
            setEditor(lineEditorState(ctx, viewport))
            return
          }
          // no text here: an original page image under the pointer?
          try {
            const model = await getGlyphModel(rt.page)
            if (seq !== lineOpenSeq.current) return
            const img = imageAt(model.images, pdf.x, pdf.y)
            if (img) {
              setImageSel({ image: img, page: rt.page })
              return
            }
          } catch {
            /* fall through */
          }
          openSpanEditor(e.clientX, e.clientY)
        })()
        return
      }
      openSpanEditor(e.clientX, e.clientY)
      return
    }
  }

  // legacy text-layer based editing (used only when the glyph model can't
  // resolve a line, e.g. rotated/vertical text)
  const openSpanEditor = (clientX: number, clientY: number) => {
    {
      const host = hostRef.current
      if (!host) return
      const textHost = textLayerHost.current
      if (!textHost) return
      const span = textSpanAt(textHost, clientX, clientY)
      if (!span) return
      if ((span.textContent ?? '').trim().length === 0) return
      const cs = getComputedStyle(span)
      const fontSizeCss = parseFloat(cs.fontSize) || 12
      const fontSizePt = fontSizeCss / viewport.scale
      // recognize the whole visual line around the clicked fragment and
      // resolve the original font/color/baseline (async; editor pops in)
      void (async () => {
        const rt = getPageRuntime(viewPage)
        const pageBox = host.closest('.page-box')
        const pageCanvas = (pageBox?.querySelector('canvas.page-canvas') as HTMLCanvasElement) ?? null
        let blockText = span.textContent ?? ''
        let blockRect: DisplayRect | null = null
        let baselineCss = 0
        let lineRuns: import('../pdf/fontMatch').LineRuns | null = null
        if (rt) {
          lineRuns = await findLineRuns(rt.page, rt.viewport, textHost, pageCanvas, span)
        }
        let color = '#000000'
        let fontCss = `${fontSizeCss}px Helvetica, Arial, sans-serif`
        let family = ''
        let bold = /bold|[6-9]00/.test(cs.fontWeight)
        let italic = cs.fontStyle === 'italic'
        let fontFallback: 'serif' | 'sans-serif' | 'monospace' = 'sans-serif'
        if (lineRuns && lineRuns.runs.length > 0) {
          blockText = lineRuns.text
          blockRect = lineRuns.rect
          baselineCss = lineRuns.exactBaselineCss ?? lineRuns.baselineCss
          const anchor = lineRuns.runs[Math.max(0, lineRuns.anchorRunIdx)]
          if (anchor) {
            fontCss = anchor.cssFont
            family = anchor.baseFamily
            bold = anchor.bold
            italic = anchor.italic
            fontFallback = anchor.fontFallback
            color = anchor.color
          }
        } else {
          // fallback: single-span edit (shouldn't normally happen)
          const r = span.getBoundingClientRect()
          const hostRectBox = textHost.getBoundingClientRect()
          blockRect = {
            x: r.left - hostRectBox.left,
            y: r.top - hostRectBox.top,
            width: r.width,
            height: r.height,
          }
          baselineCss = r.bottom - hostRectBox.top
          if (pageCanvas) color = sampleInkColor(pageCanvas, blockRect)
          if (/serif/i.test(cs.fontFamily)) fontFallback = 'serif'
          if (/mono/i.test(cs.fontFamily)) fontFallback = 'monospace'
        }
        if (!blockRect) return
        setEditor({
          mode: 'edit-span',
          rect: blockRect,
          text: blockText,
          fontSizePt,
          fontCss,
          color,
          baselineCss,
          family,
          bold,
          italic,
          fontFallback,
          lineRuns,
        })
      })()
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const pdf = toPdf(e.clientX, e.clientY)
    const store = useEditStore.getState()
    const op = store.ops.find((o) => o.id === g.opId)
    if (!op) {
      gestureRef.current = null
      return
    }
    if (op.kind === 'draw') {
      const last = op.points[op.points.length - 1]
      const dxCss = e.clientX - g.lastCss.x
      const dyCss = e.clientY - g.lastCss.y
      if (Math.hypot(dxCss, dyCss) > 1.2) {
        store.updateOp(g.opId, { points: [...op.points, pdf] } as Partial<EditOp>)
        g.lastCss = { x: e.clientX, y: e.clientY }
      }
      void last
    } else if (op.kind === 'shape' || op.kind === 'redact' || op.kind === 'link') {
      const x = Math.min(g.startPdf.x, pdf.x)
      const y = Math.min(g.startPdf.y, pdf.y)
      store.updateOp(g.opId, {
        x,
        y,
        width: Math.abs(pdf.x - g.startPdf.x),
        height: Math.abs(pdf.y - g.startPdf.y),
      } as Partial<EditOp>)
    }
  }

  const onPointerUp = () => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    const store = useEditStore.getState()
    const op = store.ops.find((o) => o.id === g.opId)
    if (op && (op.kind === 'shape' || op.kind === 'redact')) {
      if (op.width < 2 || op.height < 2) store.removeOp(op.id)
    }
    if (op && op.kind === 'link') {
      if (op.width < 4 || op.height < 4) store.removeOp(op.id)
      else setLinkEdit(op.id)
    }
  }

  // ── add image: click → file picker ────────────────────────
  useEffect(() => {
    if (activeTool !== 'add-image') return
    const host = hostRef.current
    if (!host) return
    const onClick = (e: PointerEvent) => {
      const pdf = toPdf(e.clientX, e.clientY)
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const buf = new Uint8Array(await file.arrayBuffer())
        const bmp = await createImageBitmap(file)
        const naturalW = bmp.width
        const naturalH = bmp.height
        bmp.close()
        const maxW = 240
        const scaleD = Math.min(1, maxW / naturalW)
        const wPt = naturalW * scaleD * 0.75
        const hPt = naturalH * scaleD * 0.75
        const op: ImageOp = {
          kind: 'image',
          id: newOpId(),
          page: pageRef,
          x: pdf.x,
          y: pdf.y - hPt,
          width: wPt,
          height: hPt,
          rotation: 0,
          imageType: file.type.includes('png') ? 'png' : 'jpg',
          imageData: buf,
        }
        const es = useEditStore.getState()
        es.pushOp(op)
        es.setSelectedOp(op.id)
        useToolStore.getState().setTool('select')
      }
      input.click()
    }
    host.addEventListener('pointerdown', onClick)
    return () => host.removeEventListener('pointerdown', onClick)
  }, [activeTool, pageRef, toPdf])

  // ── commit/cancel inline text editors ─────────────────────
  // ── commit/cancel inline text editors ─────────────────────
  const commitEditor = (text: string) => {
    const t = text.replace(/\s+$/g, '')
    const store = useEditStore.getState()
    if (editor?.mode === 'add') {
      if (t.trim()) {
        const st = useToolStore.getState().textStyle
        const fontSizeCss = st.fontSize * viewport.scale
        const p = viewport.convertToPdfPoint(editor.cssX, editor.cssY + fontSizeCss * 0.8)
        const op: OverlayTextOp = {
          kind: 'overlay-text',
          id: newOpId(),
          page: pageRef,
          x: p[0],
          y: p[1],
          text: t,
          fontSize: st.fontSize,
          fontName: st.fontName,
          color: st.color,
        }
        store.pushOp(op)
      }
    } else if (editor?.mode === 'edit-line') {
      const { ctx } = editor
      const unchanged = t === ctx.currentText.replace(/\s+$/g, '')
      if (!unchanged) {
        // empty text clears the line; text equal to the original reverts it
        const op = buildLineEditOp(ctx, pageRef, t, newOpId())
        if (op) {
          store.pushOp(op)
        } else if (ctx.previous) {
          // back to the original: an op that only whites nothing out
          store.pushOp({
            ...ctx.previous,
            id: newOpId(),
            rect: { x: 0, y: 0, width: 0, height: 0 },
            runs: [],
            newText: ctx.line.text,
            replaces: ctx.previous.id,
          })
        }
      }
    } else if (editor?.mode === 'edit-span') {
      if (t.trim() && t !== editor.text.replace(/\s+$/g, '')) {
        const [ax, ay] = viewport.convertToPdfPoint(editor.rect.x, editor.rect.y)
        const [bx, by] = viewport.convertToPdfPoint(
          editor.rect.x + editor.rect.width,
          editor.rect.y + editor.rect.height,
        )
        const [x0, baselineY] = viewport.convertToPdfPoint(editor.rect.x, editor.baselineCss)
        const pad = 0.6
        let rect = {
          x: Math.min(ax, bx) - pad,
          y: Math.min(ay, by) - pad,
          width: Math.abs(bx - ax) + pad * 2,
          height: Math.abs(by - ay) + pad * 2,
        }
        // style-preserving reconstruction: unchanged runs keep their font,
        // edited text uses the clicked run's ORIGINAL embedded font
        let runs: import('../pdf/edit/ops').TextEditRun[] | undefined
        const LR = editor.lineRuns
        if (LR && LR.runs.length > 0) {
          const layoutCtx = createRunLayoutContext(getPageRuntime(viewPage)?.page ?? null, LR.runs)
          // the committed text is right-trimmed; restore the original trailing
          // whitespace so the unchanged tail is still recognised as a suffix
          const trailing = /\s+$/.exec(editor.text)?.[0] ?? ''
          const outRuns = reconstructRuns(
            editor.text,
            t + trailing,
            LR.runs as LineRun[],
            LR.anchorRunIdx,
            layoutCtx.positioner,
            LR.gapCss * 0.4,
          )
          if (outRuns.length > 0) {
            // the unchanged prefix stays in the original content stream
            // untouched; only the rest of the line is whited out and redrawn
            const kept = outRuns.filter((r) => r.verbatim)
            const redraw = outRuns.filter((r) => !r.verbatim && r.text.trim())
            const isUpright = Math.abs(viewport.rotation % 360) === 0
            if (kept.length > 0 && isUpright) {
              const last = kept[kept.length - 1]
              const [keepEndX] = viewport.convertToPdfPoint(last.x + last.width, editor.baselineCss)
              const startX = Math.max(rect.x, keepEndX - editor.fontSizePt * 0.06)
              rect = { ...rect, x: startX, width: rect.x + rect.width - startX }
            }
            const toRedraw = kept.length > 0 && isUpright ? redraw : outRuns
            runs = toRedraw.map((r) =>
              toEditRun(
                layoutCtx,
                r as unknown as import('../pdf/fontMatch').LineRunData,
                viewport,
                editor.baselineCss,
                editor.fontSizePt,
              ),
            )
          }
        }
        const op: TextEditOp = {
          kind: 'text-edit',
          id: newOpId(),
          page: pageRef,
          rect,
          newText: t,
          fontSize: editor.fontSizePt,
          fontName: standardNameForFallback(editor.fontFallback, editor.bold, editor.italic),
          color: editor.color,
          x: x0,
          baselineY,
          baseFamily: editor.family || undefined,
          bold: editor.bold,
          italic: editor.italic,
          fontFallback: editor.fontFallback,
          runs,
        }
        store.pushOp(op)
      }
    } else if (editor?.mode === 'edit-op') {
      if (t.trim()) {
        store.updateOp(editor.opId, { text: t } as Partial<EditOp>)
      } else {
        store.removeOp(editor.opId)
      }
    }
    setEditor(null)
  }

  const isMarkup = MARKUP_TOOLS.includes(activeTool)
  const capture = activeTool !== 'select' && !isMarkup

  return (
    <>
      <div
        ref={hostRef}
        className={`interaction-layer tool-${activeTool}`}
        style={{ pointerEvents: capture ? 'auto' : 'none', width, height }}
        onPointerDown={capture ? onPointerDown : undefined}
        onPointerMove={capture ? onPointerMove : undefined}
        onPointerUp={capture ? onPointerUp : undefined}
      />
      {/* object hotspots & selection (select tool) */}
      {activeTool === 'select' && (
        <ObjectHotspots
          ops={myOps}
          viewport={viewport}
          selectedOpId={selectedOpId}
          onEditText={(op) => {
            if (op.kind !== 'overlay-text') return
            const rect = opDisplayRect(viewport, op)
            if (!rect) return
            setEditor({
              mode: 'edit-op',
              opId: op.id,
              rect,
              text: op.text,
              fontSizePt: op.fontSize,
            })
          }}
        />
      )}
      {editor && (
        <InlineTextEditor
          editor={editor}
          viewport={viewport}
          onCommit={commitEditor}
          onCancel={() => setEditor(null)}
        />
      )}
      <AnnotationActions pageRef={pageRef} viewport={viewport} />
      <NotesLayer pageRef={pageRef} viewport={viewport} openId={openNoteId} setOpenId={setOpenNoteId} />
      {linkEdit && <LinkPopup opId={linkEdit} viewport={viewport} onClose={() => setLinkEdit(null)} />}
      {imageSel && activeTool === 'edit-text' && (
        <ImageActions sel={imageSel} pageRef={pageRef} viewport={viewport} onClose={() => setImageSel(null)} />
      )}
    </>
  )
}

/**
 * Topmost image whose placement contains the point (pdf user space).
 * Uses the real (possibly rotated/skewed) parallelogram, not just the bbox.
 */
function imageAt(images: PageImage[], x: number, y: number): PageImage | null {
  for (let i = images.length - 1; i >= 0; i--) {
    const im = images[i]
    const [a, b, c, d, e, f] = im.matrix
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) continue
    // invert the unit-square placement
    const u = (d * (x - e) - c * (y - f)) / det
    const v = (-b * (x - e) + a * (y - f)) / det
    // ignore hairline/tiny images (rules, bullets) and full-page backgrounds
    const area = Math.abs(det)
    if (area < 16) continue
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return im
  }
  return null
}

/**
 * Text-layer span under a point, ignoring anything stacked above it (link
 * annotations, widgets, our own layers). Falls back to a geometric search so
 * clicks between glyphs or on a link's padding still find the line.
 */
function textSpanAt(textHost: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!textHost.contains(el)) continue
    const span = el.closest('span')
    if (span && textHost.contains(span) && (span.textContent ?? '').trim()) {
      return span as HTMLElement
    }
  }
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const s of Array.from(textHost.querySelectorAll('span'))) {
    if (!(s.textContent ?? '').trim() || s.querySelector('span')) continue
    const r = s.getBoundingClientRect()
    if (r.width < 0.5 || r.height < 0.5) continue
    const slack = Math.max(2, r.height * 0.25)
    if (y < r.top - slack || y > r.bottom + slack) continue
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    const d = dx + dy
    if (d < bestDist && dx <= Math.max(3, r.height * 0.3)) {
      bestDist = d
      best = s as HTMLElement
    }
  }
  return best
}

function isPageOp(op: EditOp): boolean {
  return (
    op.kind === 'page-rotate' ||
    op.kind === 'page-delete' ||
    op.kind === 'page-insert-blank' ||
    op.kind === 'page-reorder'
  )
}

// ── overlay object selection / move / resize ─────────────────

function ObjectHotspots({
  ops,
  viewport,
  selectedOpId,
  onEditText,
}: {
  ops: EditOp[]
  viewport: PageViewport
  selectedOpId: string | null
  onEditText: (op: EditOp) => void
}) {
  return (
    <>
      {ops.map((op) => (
        <Hotspot key={op.id} op={op} viewport={viewport} selected={op.id === selectedOpId} onEditText={onEditText} />
      ))}
    </>
  )
}

function Hotspot({
  op,
  viewport,
  selected,
  onEditText,
}: {
  op: EditOp
  viewport: PageViewport
  selected: boolean
  onEditText: (op: EditOp) => void
}) {
  const rect = opDisplayRect(viewport, op)
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startClient: { x: number; y: number }
    startRect: DisplayRect
    op: EditOp
  } | null>(null)
  if (!rect) return null

  const toPdfDelta = (dxCss: number, dyCss: number): { dx: number; dy: number } => {
    const a = viewport.convertToPdfPoint(0, 0)
    const b = viewport.convertToPdfPoint(dxCss, dyCss)
    return { dx: b[0] - a[0], dy: b[1] - a[1] }
  }

  const startDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    useEditStore.getState().setSelectedOp(op.id)
    dragRef.current = {
      mode,
      startClient: { x: e.clientX, y: e.clientY },
      startRect: rect,
      op,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dxCss = e.clientX - d.startClient.x
    const dyCss = e.clientY - d.startClient.y
    const store = useEditStore.getState()
    const current = store.ops.find((o) => o.id === op.id)
    if (!current) {
      dragRef.current = null
      return
    }
    if (d.mode === 'move') {
      const { dx, dy } = toPdfDelta(dxCss, dyCss)
      const moved = translateOp(d.op, dx, dy)
      store.updateOp(op.id, moved as Partial<EditOp>)
    } else {
      const wPt = (d.startRect.width + dxCss) / viewport.scale
      const hPt = (d.startRect.height + dyCss) / viewport.scale
      store.updateOp(op.id, resizeOp(d.op, wPt, hPt) as Partial<EditOp>)
    }
  }

  const onUp = () => {
    dragRef.current = null
  }

  return (
    <div
      className={`op-hotspot ${selected ? 'selected' : ''} ${op.kind}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDown={(e) => startDrag(e, 'move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={() => onEditText(op)}
      title={
        op.kind === 'overlay-text'
          ? tr('双击编辑文本；拖动移动')
          : op.kind === 'redact'
            ? tr('红色框：导出时涂黑')
            : undefined
      }
    >
      {selected && canResize(op) && (
        <div
          className="op-resize-handle"
          onPointerDown={(e) => startDrag(e, 'resize')}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      )}
    </div>
  )
}

function canResize(op: EditOp): boolean {
  return op.kind === 'image' || op.kind === 'shape' || op.kind === 'redact' || op.kind === 'text-edit'
}

// ── inline text editor ───────────────────────────────────────

function InlineTextEditor({
  editor,
  viewport,
  onCommit,
  onCancel,
}: {
  editor: NonNullable<EditorState>
  viewport: PageViewport
  onCommit: (text: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const st = useToolStore.getState().textStyle
  // styled editor content for glyph-model lines (bold / colors / links shown
  // in place); built once so React never re-renders the user's typing
  const segments = useRef(editor.mode === 'edit-line' ? editorSegments(editor.ctx) : null).current
  // plain text of the editor, independent of styled spans and <br>s
  const readText = (el: HTMLElement) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

  // line editor: shift the box so its text sits exactly on the original
  // baseline / start x (fonts differ in ascent, so measure the real layout)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || editor.mode !== 'edit-line') return
    const rot = ((viewport.rotation % 360) + 360) % 360
    if (rot !== 0) {
      // rotated view: the editor is laid out unrotated, then turned about the
      // line's start point so it lies along the rotated line
      el.style.transformOrigin = '0 0'
      el.style.left = `${editor.startCss}px`
      el.style.top = `${editor.baselineCss}px`
      el.style.minWidth = '0'
      const probeR = document.createElement('span')
      probeR.style.display = 'inline-block'
      probeR.style.width = '0'
      probeR.style.height = '0'
      el.querySelector('span')?.prepend(probeR)
      const baseFromTop = probeR.offsetTop + probeR.offsetHeight
      const leftInset = probeR.offsetLeft
      probeR.remove()
      el.style.transform = `rotate(${rot}deg) translate(${-leftInset}px, ${-baseFromTop}px)`
      return
    }
    const probe = document.createElement('span')
    probe.style.display = 'inline-block'
    probe.style.width = '0'
    probe.style.height = '0'
    probe.style.verticalAlign = 'baseline'
    const firstSpan = el.querySelector('span')
    if (!firstSpan) return
    firstSpan.prepend(probe)
    const host = el.offsetParent as HTMLElement | null
    const hostRect = host?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const p = probe.getBoundingClientRect()
    probe.remove()
    const dy = editor.baselineCss - (p.bottom - hostRect.top)
    const dx = editor.startCss - (p.left - hostRect.left)
    if (Math.abs(dy) > 0.25 || Math.abs(dx) > 0.25) {
      el.style.top = `${el.offsetTop + dy}px`
      el.style.left = `${el.offsetLeft + dx}px`
    }
    if (segments) alignToPdf(el, segments, viewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const focusEdit = () => {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    focusEdit()
    const t = window.setTimeout(focusEdit, 60)
    return () => window.clearTimeout(t)
  }, [])

  // save / close / quit commit the open editor first
  useEffect(
    () =>
      registerPendingCommit(() => {
        const el = ref.current
        if (!el || committedRef.current) return
        committedRef.current = true
        onCommit(segments ? readText(el) : el.innerText)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // commit when the user clicks anywhere outside the editor
  useEffect(() => {
    const onDocDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node) && !committedRef.current) {
        committedRef.current = true
        onCommit(segments ? readText(el) : el.innerText)
      }
    }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  let style: React.CSSProperties
  let initial = ''
  let fontSizeCss: number
  let fontFamilyCss = cssFontFamily(st.fontName)
  let fontCss = cssFontVariant(st.fontName)
  let fontShorthand: string | null = null
  let colorCss: string | null = null

  if (editor.mode === 'add') {
    fontSizeCss = st.fontSize * viewport.scale
    style = { left: editor.cssX, top: editor.cssY, minWidth: 40 }
    initial = ''
  } else if (editor.mode === 'edit-span' || editor.mode === 'edit-line') {
    const sizePt = editor.mode === 'edit-span' ? editor.fontSizePt : editor.ctx.line.size
    fontSizeCss = sizePt * viewport.scale
    style = { left: editor.rect.x, top: editor.rect.y, minWidth: editor.rect.width }
    initial = editor.text
    fontShorthand = editor.fontCss
    colorCss = editor.color
  } else {
    const store = useEditStore.getState()
    const op = store.ops.find((o) => o.id === editor.opId)
    fontSizeCss = editor.fontSizePt * viewport.scale
    style = { left: editor.rect.x, top: editor.rect.y, minWidth: editor.rect.width }
    initial = editor.text
    if (op && op.kind === 'overlay-text') {
      fontFamilyCss = cssFontFamily(op.fontName)
      fontCss = cssFontVariant(op.fontName)
    }
  }

  return (
    <div
      ref={ref}
      className="inline-text-editor"
      contentEditable
      suppressContentEditableWarning
      style={
        fontShorthand
          ? { ...style, font: fontShorthand, color: colorCss ?? '#111' }
          : {
              ...style,
              fontSize: fontSizeCss,
              fontFamily: fontFamilyCss,
              fontWeight: fontCss.weight,
              fontStyle: fontCss.style,
            }
      }
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          committedRef.current = true
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          if (!committedRef.current) {
            committedRef.current = true
            const el = e.currentTarget as HTMLElement
            onCommit(segments ? readText(el) : el.innerText)
          }
        } else if (e.key === 'Enter' && segments) {
          // a line editor holds exactly one line
          e.preventDefault()
        }
        // app commands (save / save as / open / print / close) still work
        // while typing: let them bubble to the global shortcut handler
        if ((e.metaKey || e.ctrlKey) && /^[sopw]$/i.test(e.key)) return
        e.stopPropagation()
      }}
      onPaste={
        segments
          ? (e) => {
              // paste as plain single-line text (no foreign styling/markup)
              e.preventDefault()
              const text = e.clipboardData.getData('text/plain').replace(/\s*[\r\n]+\s*/g, ' ')
              document.execCommand('insertText', false, text)
            }
          : undefined
      }
    >
      {segments
        ? segments.map((s, i) => (
            <span
              key={i}
              data-seg={i}
              style={{
                color: s.color,
                fontWeight: s.bold ? 'bold' : 'normal',
                fontStyle: s.italic ? 'italic' : 'normal',
                fontFamily: s.family,
                fontSize: s.size * viewport.scale,
                // Tz / squeezed text: match the glyph width via font-stretch-free scaling
                ...(s.hScale
                  ? { display: 'inline-block', transform: `scaleX(${s.hScale})`, transformOrigin: '0 0' }
                  : {}),
              }}
            >
              {s.text}
            </span>
          ))
        : initial}
    </div>
  )
}

/**
 * Place every character of the line editor at the x where the PDF draws it.
 *
 * Browser text layout uses the font's natural advances, while PDFs position
 * words explicitly (justified spacing, TJ kerning, Tc/Tw). Without this the
 * text visibly jumps when a line is opened. Characters that have a known
 * target x are matched by giving the character before them a letter-spacing
 * correction (its own tiny span), measured left to right so earlier fixes are
 * taken into account. Typing afterwards stays natural.
 */
function alignToPdf(el: HTMLElement, segments: import('../pdf/edit/lineEdit').EditorSegment[], viewport: PageViewport) {
  if (((viewport.rotation % 360) + 360) % 360 !== 0) return
  const host = el.offsetParent as HTMLElement | null
  if (!host) return
  const hostLeft = host.getBoundingClientRect().left
  // one span per character, in document order
  const chars: { span: HTMLElement; target: number | null }[] = []
  segments.forEach((seg, si) => {
    const segSpan = el.querySelector<HTMLElement>(`span[data-seg="${si}"]`)
    if (!segSpan) return
    const list = Array.from(seg.text)
    segSpan.textContent = ''
    list.forEach((ch, ci) => {
      const c = document.createElement('span')
      c.className = 'ed-ch'
      c.textContent = ch
      segSpan.appendChild(c)
      const x = seg.xs?.[ci]
      chars.push({ span: c, target: x == null ? null : viewport.convertToViewportPoint(x, 0)[0] })
    })
  })
  for (let i = 1; i < chars.length; i++) {
    const t = chars[i].target
    if (t == null) continue
    const dx = t - (chars[i].span.getBoundingClientRect().left - hostLeft)
    if (Math.abs(dx) < 0.15) continue
    const prev = chars[i - 1].span
    const cur = parseFloat(prev.style.letterSpacing || '0') || 0
    prev.style.letterSpacing = `${cur + dx}px`
  }
  // a character typed next to a corrected one lands inside its span and would
  // inherit the extra spacing: move such text out into a plain sibling
  const fix = () => {
    for (const c of Array.from(el.querySelectorAll<HTMLElement>('.ed-ch'))) {
      const txt = c.textContent ?? ''
      if (Array.from(txt).length <= 1) {
        if (!txt) c.remove()
        continue
      }
      const sel = window.getSelection()
      const caretInside = sel?.anchorNode && c.contains(sel.anchorNode)
      const caretOffset = caretInside ? sel!.anchorOffset : -1
      const orig = c.dataset.ch ?? ''
      // keep the original char in the corrected span, the rest goes outside
      const at = orig ? txt.indexOf(orig) : 0
      const before = at > 0 ? txt.slice(0, at) : ''
      const after = txt.slice(Math.max(0, at) + (orig ? orig.length : 1))
      c.textContent = orig || Array.from(txt)[0]
      const parent = c.parentNode!
      let caretNode: Text | null = null
      let caretPos = 0
      if (before) {
        const tn = document.createTextNode(before)
        parent.insertBefore(tn, c)
        if (caretInside && caretOffset <= before.length) {
          caretNode = tn
          caretPos = caretOffset
        }
      }
      if (after) {
        const tn = document.createTextNode(after)
        parent.insertBefore(tn, c.nextSibling)
        if (caretInside && !caretNode) {
          caretNode = tn
          caretPos = Math.max(0, Math.min(after.length, caretOffset - before.length - c.textContent!.length))
        }
      }
      if (caretNode && sel) {
        const r = document.createRange()
        r.setStart(caretNode, caretPos)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
  }
  for (const c of chars) c.span.dataset.ch = c.span.textContent ?? ''
  el.addEventListener('input', fix)
}

/** URL / page target for a link area just drawn */
function LinkPopup({ opId, viewport, onClose }: { opId: string; viewport: PageViewport; onClose: () => void }) {
  const op = useEditStore((s) => s.ops.find((o) => o.id === opId)) as LinkOp | undefined
  const [kind, setKind] = useState<'url' | 'page'>(op?.toPage ? 'page' : 'url')
  const [value, setValue] = useState(op?.url ?? (op?.toPage ? String(op.toPage) : 'https://'))
  if (!op) return null
  const r = opDisplayRect(viewport, op)
  if (!r) return null
  const commit = () => {
    const v = value.trim()
    if (kind === 'url') {
      if (!v || v === 'https://') {
        useEditStore.getState().removeOp(op.id)
        return onClose()
      }
      const url = /^[a-z]+:/i.test(v) ? v : /@/.test(v) ? `mailto:${v}` : `https://${v}`
      useEditStore.getState().updateOp(op.id, { url, toPage: undefined } as Partial<EditOp>)
    } else {
      const n = parseInt(v, 10)
      if (!n) return
      useEditStore.getState().updateOp(op.id, { toPage: n, url: undefined } as Partial<EditOp>)
    }
    useToolStore.getState().setTool('select')
    onClose()
  }
  return (
    <div
      className="link-popup"
      style={{ left: r.x, top: r.y + r.height + 6 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="seg small">
        <button
          type="button"
          className={kind === 'url' ? 'active' : ''}
          onClick={() => {
            setKind('url')
            setValue('https://')
          }}
        >
          {tr('网址')}
        </button>
        <button
          type="button"
          className={kind === 'page' ? 'active' : ''}
          onClick={() => {
            setKind('page')
            setValue('1')
          }}
        >
          {tr('页面')}
        </button>
      </div>
      <input
        className="form-input"
        autoFocus
        value={value}
        aria-label={kind === 'url' ? tr('链接网址') : tr('跳转页码')}
        inputMode={kind === 'page' ? 'numeric' : 'url'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            useEditStore.getState().removeOp(op.id)
            onClose()
          }
        }}
      />
      <button className="btn small primary-solid" onClick={commit}>
        {tr('确定')}
      </button>
    </div>
  )
}
