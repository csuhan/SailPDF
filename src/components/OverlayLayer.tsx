import { memo, useEffect, useRef } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import { useEditStore } from '../state/editStore'
import { drawCropMask, drawOp, drawPageNumber, drawWatermark } from '../pdf/edit/overlayDraw'
import type { EditOp } from '../pdf/edit/ops'

interface Props {
  /** stable page ref (original page number or negative blank id) */
  pageRef: number
  viewport: PageViewport
  /** total clockwise display rotation of the page (view + page ops + own) */
  glyphDeg: number
  width: number
  height: number
  dpr: number
  /** 1-based page index in the current view order + page count (page numbers) */
  viewPage: number
  viewCount: number
}

/**
 * Draws the not-yet-baked edit ops for one page in a canvas stacked above
 * the page render, below the text layer.
 */
export const OverlayLayer = memo(function OverlayLayer({
  pageRef,
  viewport,
  glyphDeg,
  width,
  height,
  dpr,
  viewPage,
  viewCount,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ops = useEditStore((s) => s.ops)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dprV = Math.max(1, dpr)
    canvas.width = Math.round(width * dprV)
    canvas.height = Math.round(height * dprV)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dprV, 0, 0, dprV, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const toViewport = (x: number, y: number): [number, number] => {
      const p = viewport.convertToViewportPoint(x, y)
      return [p[0], p[1]]
    }
    const cssPxPerPoint = viewport.scale
    let cancelled = false
    // a re-edit of a line supersedes the earlier op for that line
    const superseded = new Set<string>()
    for (const o of ops) if (o.kind === 'text-edit' && o.replaces) superseded.add(o.replaces)
    ;(async () => {
      for (const op of ops) {
        if (cancelled) return
        if (op.page !== pageRef || superseded.has(op.id)) continue
        await drawOp(ctx, op, toViewport, cssPxPerPoint, glyphDeg)
      }
      // document-wide decorations (latest op of each kind)
      if (cancelled) return
      const last = <K extends EditOp['kind']>(k: K) => {
        for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === k) return ops[i] as Extract<EditOp, { kind: K }>
        return null
      }
      const wm = last('watermark')
      if (wm) drawWatermark(ctx, wm, viewport)
      const pn = last('page-numbers')
      if (pn) drawPageNumber(ctx, pn, viewport, viewPage, viewCount)
      // pending crop: dim what will be cut away
      let crop: Extract<EditOp, { kind: 'page-crop' }> | null = null
      for (const o of ops) if (o.kind === 'page-crop' && (o.pages === 'all' || o.pages.includes(pageRef))) crop = o
      if (crop) drawCropMask(ctx, crop.margins, viewport, width, height)
    })()
    return () => {
      cancelled = true
    }
  }, [ops, pageRef, viewport, glyphDeg, width, height, dpr, viewPage, viewCount])

  return <canvas ref={canvasRef} className="overlay-layer" aria-hidden="true" />
})
