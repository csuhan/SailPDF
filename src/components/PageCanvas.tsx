import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { PageViewport, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { AnnotationLayer, TextLayer } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { acquireRenderSlot } from '../pdf/document'
import { cacheKey, getAnyBitmapForPage, getBitmap, putBitmap } from '../pdf/bitmapCache'
import { computePageMap, pageExtraRotation } from '../pdf/edit/pageOrder'
import { renderSearchHighlights } from '../pdf/textHighlight'
import { setPageRuntime } from '../pdf/registry'
import { pageImageSignature, previewPage } from '../pdf/edit/imagePreview'

function hashSig(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
import { createLinkService, type LinkService } from '../pdf/linkService'
import { OverlayLayer } from './OverlayLayer'
import { InteractionLayer } from './InteractionLayer'

interface Props {
  /** 1-based view page number */
  page: number
  /** layout width/height in CSS px at current scale (unknown pages get placeholder size) */
  width: number
  height: number
}

const MAX_DPR = 2
const MAX_DEVICE_DIM = 8192

export const PageCanvas = memo(function PageCanvas({ page, width, height }: Props) {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const scale = useAppStore((s) => s.scale)
  const rotation = useAppStore((s) => s.rotation)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const searchVersion = useAppStore((s) => s.searchVersion)
  const searchMatches = useAppStore((s) => s.searchMatches)
  const activeMatchGlobal = useAppStore((s) => s.activeMatchGlobal)
  const setPageSize = useAppStore((s) => s.setPageSize)
  const ops = useEditStore((s) => s.ops)
  const mode = useToolStore((s) => s.mode)
  const fileBytes = useAppStore((s) => s.fileBytes)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const highlightsRef = useRef<HTMLDivElement>(null)
  const annotationRef = useRef<HTMLDivElement>(null)
  const linkServiceRef = useRef<LinkService | null>(null)
  const [runtime, setRuntime] = useState<{
    page: PDFPageProxy
    viewport: PageViewport
    glyphDeg: number
  } | null>(null)

  const pageMap = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops) : []), [pdfDoc, ops])
  const originalPage = pageMap[page - 1] ?? page // <0 → blank page
  const extraRotation = pageExtraRotation(page, ops, pdfDoc?.numPages ?? 0)
  const isBlank = originalPage < 0
  // edits of original images change the page content itself: render a
  // preview page with them baked in (signature changes => re-render)
  const imageSig = useMemo(() => pageImageSignature(ops, originalPage), [ops, originalPage])

  // ── canvas render ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdfDoc || width <= 0 || height <= 0) return
    if (isBlank) {
      const dprBlank = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * dprBlank)
      canvas.height = Math.round(height * dprBlank)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(dprBlank, 0, 0, dprBlank, 0, 0)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
      }
      return
    }

    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    let effDpr = dpr
    if (width * effDpr > MAX_DEVICE_DIM || height * effDpr > MAX_DEVICE_DIM) {
      effDpr = Math.max(0.5, Math.min(MAX_DEVICE_DIM / width, MAX_DEVICE_DIM / height))
    }
    const devW = Math.max(2, Math.round(width * effDpr))
    const devH = Math.max(2, Math.round(height * effDpr))
    canvas.width = devW
    canvas.height = devH
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    let cancelled = false
    let renderTask: RenderTask | null = null
    let release: (() => void) | null = null

    // instant placeholder: upscale any cached zoom of this page
    const bmpPage = imageSig ? `${originalPage}~${imageSig.length}~${hashSig(imageSig)}` : String(originalPage)
    const ph = getAnyBitmapForPage(bmpPage) ?? getAnyBitmapForPage(originalPage)
    if (ph) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'low'
      ctx.drawImage(ph, 0, 0, devW, devH)
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, devW, devH)
    }

    ;(async () => {
      try {
        let pdfPage = await pdfDoc.getPage(originalPage)
        if (imageSig && fileBytes) {
          const prev = await previewPage(fileBytes, useEditStore.getState().ops, originalPage)
          if (prev) pdfPage = prev.page
        }
        if (cancelled) return
        const totalRotation = (rotation + extraRotation + pdfPage.rotate) % 360
        const key = cacheKey(bmpPage, devW, totalRotation)
        const cached = getBitmap(key)
        if (cached) {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.drawImage(cached, 0, 0, devW, devH)
          return
        }
        const viewport = pdfPage.getViewport({ scale: scale * effDpr, rotation: totalRotation })
        release = await acquireRenderSlot()
        if (cancelled) return
        const off = document.createElement('canvas')
        off.width = Math.max(2, Math.round(viewport.width))
        off.height = Math.max(2, Math.round(viewport.height))
        const offCtx = off.getContext('2d')!
        renderTask = pdfPage.render({ canvasContext: offCtx, viewport })
        await renderTask.promise
        renderTask = null
        if (cancelled) return
        const bitmap = await createImageBitmap(off)
        off.width = 0
        off.height = 0
        putBitmap(key, bitmap)
        if (!cancelled) {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.drawImage(bitmap, 0, 0, devW, devH)
        }
      } catch (e) {
        if (
          !(e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'RenderingCancelledException')
        ) {
          // eslint-disable-next-line no-console
          console.error('render error page', page, e)
        }
      } finally {
        release?.()
      }
    })()

    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {
        /* noop */
      }
      release?.()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, originalPage, scale, rotation, extraRotation, width, height, isBlank, imageSig])

  // ── text layer + search highlights + runtime registry ─────
  useEffect(() => {
    if (!pdfDoc || isBlank || width <= 0 || height <= 0) {
      setRuntime(null)
      return
    }
    let cancelled = false
    let textLayer: TextLayer | null = null
    ;(async () => {
      try {
        const pdfPage = await pdfDoc.getPage(originalPage)
        if (cancelled) return
        // natural size (own rotation) for layout bookkeeping
        const nat = pdfPage.getViewport({ scale: 1 })
        const existing = useAppStore.getState().pageSizes.get(originalPage)
        if (!existing || existing.width !== nat.width || existing.height !== nat.height) {
          setPageSize(originalPage, { width: nat.width, height: nat.height })
        }
        const totalRotation = (rotation + extraRotation + pdfPage.rotate) % 360
        const viewport = pdfPage.getViewport({ scale, rotation: totalRotation })
        const glyphDeg = (((rotation + extraRotation + pdfPage.rotate) % 360) + 360) % 360
        setRuntime({ page: pdfPage, viewport, glyphDeg })
        setPageRuntime(page, {
          page: pdfPage,
          viewport,
          cssScale: scale,
          totalRotation,
        })
        const host = textLayerRef.current
        if (!host || cancelled) return
        host.innerHTML = ''
        host.style.width = `${width}px`
        host.style.height = `${height}px`
        host.style.setProperty('--scale-factor', `${scale}`)
        textLayer = new TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container: host,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return
        const hl = highlightsRef.current
        if (hl) {
          const active = searchMatches[activeMatchGlobal]
          renderSearchHighlights(host, hl, {
            query: searchQuery,
            activeIndexOnPage: active && active.page === page ? active.indexOnPage : -1,
          })
        }
        // annotation layer (links, popups)
        const ann = annotationRef.current
        if (ann && !cancelled) {
          ann.innerHTML = ''
          ann.style.width = `${width}px`
          ann.style.height = `${height}px`
          ann.style.setProperty('--scale-factor', `${scale}`)
          try {
            const annotations = await pdfPage.getAnnotations({ intent: 'display' })
            if (!cancelled && annotations.length > 0) {
              if (!linkServiceRef.current) linkServiceRef.current = createLinkService(pdfDoc)
              const layer = new AnnotationLayer({
                div: ann,
                page: pdfPage,
                viewport,
                annotationCanvasMap: undefined,
                accessibilityManager: undefined,
                annotationEditorUIManager: undefined,
                structTreeLayer: undefined,
              })
              await layer.render({
                viewport,
                div: ann,
                annotations: annotations.filter(
                  (a) =>
                    !useEditStore
                      .getState()
                      .ops.some((op) => op.kind === 'annot-delete' && op.page === originalPage && op.annotId === a.id),
                ),
                page: pdfPage,
                linkService: linkServiceRef.current as never,
                // fillable AcroForm fields (Acrobat "填写和签名"); values live
                // in the document's annotationStorage and are saved with it
                renderForms: true,
                annotationStorage: pdfDoc.annotationStorage,
                // icons for /Text (sticky note) annotations etc.
                imageResourcesPath: `${import.meta.env.BASE_URL ?? '/'}pdfjs-images/`,
              } as never)
            }
          } catch {
            /* annotation render best-effort */
          }
        }
      } catch {
        /* page may be gone */
      }
    })()
    return () => {
      cancelled = true
      try {
        ;(textLayer as unknown as { cancel?: () => void } | null)?.cancel?.()
      } catch {
        /* noop */
      }
      if (textLayerRef.current) textLayerRef.current.innerHTML = ''
      if (highlightsRef.current) highlightsRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pdfDoc,
    originalPage,
    scale,
    rotation,
    extraRotation,
    width,
    height,
    isBlank,
    searchQuery,
    searchVersion,
    activeMatchGlobal,
    imageSig,
  ])

  if (!pdfDoc) return null

  return (
    <div
      className={`page-box ${mode === 'edit' || mode === 'annotate' ? 'editing' : ''}`}
      style={{ width, height }}
      data-page={page}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      <div ref={highlightsRef} className="highlight-layer" />
      {runtime && (
        <OverlayLayer
          pageRef={originalPage}
          viewport={runtime.viewport}
          glyphDeg={runtime.glyphDeg}
          width={width}
          height={height}
          dpr={Math.min(MAX_DPR, window.devicePixelRatio || 1)}
          viewPage={page}
          viewCount={pageMap.length}
        />
      )}
      <div ref={textLayerRef} className="textLayer" />
      <div ref={annotationRef} className="annotationLayer" />
      {runtime && (
        <InteractionLayer
          viewPage={page}
          pageRef={originalPage}
          viewport={runtime.viewport}
          width={width}
          height={height}
          textLayerHost={textLayerRef}
        />
      )}
    </div>
  )
})
