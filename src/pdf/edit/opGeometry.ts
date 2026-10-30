import type { PageViewport } from 'pdfjs-dist'
import type { EditOp } from './ops'
import { cssFontFamily, cssFontVariant } from './overlayDraw'

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!
  }
  return measureCtx
}

export function measureOverlayText(
  text: string,
  fontName: Parameters<typeof cssFontFamily>[0],
  fontSizePt: number,
): number {
  const ctx = getMeasureCtx()
  const { weight, style } = cssFontVariant(fontName)
  ctx.font = `${style} ${weight} ${fontSizePt}px ${cssFontFamily(fontName)}`
  return ctx.measureText(text).width // in pt → caller multiplies by scale
}

function normRect(
  toVp: (x: number, y: number) => [number, number],
  x: number,
  y: number,
  w: number,
  h: number,
): DisplayRect {
  const [ax, ay] = toVp(x, y)
  const [bx, by] = toVp(x + w, y + h)
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  }
}

/** display-space (css px) rect for hit-testing / selection handles */
export function opDisplayRect(viewport: PageViewport, op: EditOp): DisplayRect | null {
  const toVp = (x: number, y: number): [number, number] => {
    const p = viewport.convertToViewportPoint(x, y)
    return [p[0], p[1]]
  }
  switch (op.kind) {
    case 'text-edit':
      return normRect(toVp, op.rect.x, op.rect.y, op.rect.width, op.rect.height)
    case 'overlay-text': {
      const wPt = measureOverlayText(op.text, op.fontName, op.fontSize)
      const hPt = op.fontSize * 1.25
      // anchor is the alphabetic baseline start
      const [ax, ay] = toVp(op.x, op.y)
      const [bx, by] = toVp(op.x + wPt, op.y + hPt)
      return {
        x: Math.min(ax, bx),
        y: Math.min(ay, by),
        width: Math.abs(bx - ax),
        height: Math.abs(by - ay),
      }
    }
    case 'image':
    case 'shape':
    case 'redact':
    case 'link':
      return normRect(toVp, op.x, op.y, op.width, op.height)
    case 'draw': {
      if (op.points.length === 0) return null
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of op.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      return normRect(toVp, minX, minY, maxX - minX, maxY - minY)
    }
    case 'markup': {
      if (op.quads.length === 0) return null
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const q of op.quads) {
        minX = Math.min(minX, q.x)
        minY = Math.min(minY, q.y)
        maxX = Math.max(maxX, q.x + q.width)
        maxY = Math.max(maxY, q.y + q.height)
      }
      return normRect(toVp, minX, minY, maxX - minX, maxY - minY)
    }
    default:
      return null
  }
}

/** move an op by a delta in PDF user units */
export function translateOp(op: EditOp, dx: number, dy: number): EditOp {
  switch (op.kind) {
    case 'text-edit':
      return { ...op, rect: { ...op.rect, x: op.rect.x + dx, y: op.rect.y + dy } }
    case 'overlay-text':
      return { ...op, x: op.x + dx, y: op.y + dy }
    case 'image':
    case 'shape':
    case 'redact':
    case 'link':
      return { ...op, x: op.x + dx, y: op.y + dy }
    case 'draw':
      return { ...op, points: op.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'markup':
      return { ...op, quads: op.quads.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) }
    default:
      return op
  }
}

/** resize an op (right/bottom corner semantics in user space) */
export function resizeOp(op: EditOp, newWidthPt: number, newHeightPt: number): EditOp {
  const w = Math.max(2, newWidthPt)
  const h = Math.max(2, newHeightPt)
  switch (op.kind) {
    case 'image':
    case 'shape':
    case 'redact':
    case 'link':
      return { ...op, width: w, height: h }
    case 'text-edit':
      return { ...op, rect: { ...op.rect, width: w, height: h } }
    default:
      return op
  }
}
