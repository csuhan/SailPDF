/**
 * Draw EditOps onto a 2D canvas as the live preview layer.
 * All op coordinates are PDF user units (origin bottom-left); the supplied
 * convert function maps them to canvas CSS-px display space. The canvas
 * context must already be scaled so that drawing units are CSS pixels
 * (i.e. ctx.setTransform(dpr,0,0,dpr,0,0)).
 */
import type { EditOp, StandardFontName } from './ops'

export type ToViewport = (x: number, y: number) => [number, number]

export function cssFontFamily(font: StandardFontName): string {
  if (font.startsWith('Helvetica')) return 'Helvetica, Arial, sans-serif'
  if (font.startsWith('Times')) return '"Times New Roman", Times, serif'
  return '"Courier New", Courier, monospace'
}

export function cssFontVariant(font: StandardFontName): { weight: string; style: string } {
  return {
    weight: font.includes('Bold') ? 'bold' : 'normal',
    style: /Oblique|Italic/.test(font) ? 'italic' : 'normal',
  }
}

const imageBitmapCache = new Map<string, Promise<ImageBitmap>>()

async function bitmapFor(data: Uint8Array, type: string): Promise<ImageBitmap> {
  let hash = 0
  for (let i = 0; i < Math.min(data.length, 4096); i++) hash = (hash * 31 + data[i]) | 0
  const key = `${type}-${data.length}-${hash}`
  let p = imageBitmapCache.get(key)
  if (!p) {
    p = createImageBitmap(new Blob([data.buffer as ArrayBuffer], { type }))
    imageBitmapCache.set(key, p)
  }
  return p
}

/**
 * @param cssPxPerPoint how many css px 1 PDF point spans (== viewport scale
 *                      for the unrotated axis). Used for font sizes & line widths.
 */
export async function drawOp(
  ctx: CanvasRenderingContext2D,
  op: EditOp,
  toViewport: ToViewport,
  cssPxPerPoint: number,
  glyphDeg = 0,
): Promise<void> {
  ctx.save()
  switch (op.kind) {
    case 'text-edit': {
      const [x0, yTop] = toViewport(op.rect.x, op.rect.y + op.rect.height)
      const [x1, yBot] = toViewport(op.rect.x + op.rect.width, op.rect.y)
      const x = Math.min(x0, x1)
      const y = Math.min(yTop, yBot)
      const w = Math.abs(x1 - x0)
      const h = Math.abs(yBot - yTop)
      ctx.fillStyle = '#ffffff'
      if (w > 0 && h > 0) ctx.fillRect(x, y, w, h)
      // faithful preview: original family/weight/style and baseline when known
      if (op.runs && op.baselineY !== undefined) {
        // run-preserving preview: each run keeps its own style/color
        for (const run of op.runs) {
          const sizeCss = run.fontSize * cssPxPerPoint
          const fam = run.baseFamily
            ? `"${run.baseFamily}", ${run.fontFallback ?? 'serif'}`
            : (run.fontFallback ?? 'serif')
          const fallbackFont = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${sizeCss}px ${fam}`
          ctx.fillStyle = run.color
          ctx.textBaseline = 'alphabetic'
          const pieces =
            // Type3 glyphs are content programs (no css face): preview them
            // with the fallback face; the bake still writes the real glyphs
            run.pieces && run.pdfFont && !run.pdfFont.type3 && document.fonts.check(`12px "${run.pdfFont.loadedName}"`)
              ? run.pieces
              : [{ text: run.text, x: run.x }]
          for (const piece of pieces) {
            if (!piece.text.trim()) continue
            const p = piece as import('./ops').TextEditPiece
            const usesOrig = !!run.pdfFont && (!!p.pua || !!p.glyphs?.length)
            // the face pdf.js loaded from the embedded program draws the
            // exact original glyphs via its private-use code points
            ctx.font = usesOrig ? `${sizeCss}px "${run.pdfFont!.loadedName}"` : fallbackFont
            const mode = run.renderMode ?? 0
            const paint = (text: string, x: number) => {
              const [rx, ry] = toViewport(x, op.baselineY!)
              ctx.save()
              ctx.translate(rx, ry)
              if (glyphDeg) ctx.rotate((glyphDeg * Math.PI) / 180)
              if (run.hScale) ctx.scale(run.hScale, 1)
              if (mode !== 1) ctx.fillText(text, 0, 0)
              if (mode === 1 || mode === 2) {
                ctx.strokeStyle = run.strokeColor ?? run.color
                ctx.lineWidth = Math.max(0.3, (run.strokeWidth ?? 1) * cssPxPerPoint) / (run.hScale ?? 1)
                ctx.strokeText(text, 0, 0)
              }
              ctx.restore()
            }
            if (usesOrig && p.glyphs?.length) {
              for (const g of p.glyphs) paint(g.pua, p.x + g.dx)
            } else {
              paint(usesOrig ? p.pua! : p.text, p.x)
            }
          }
        }
        break
      }
      const cssSize = op.fontSize * cssPxPerPoint
      let fontFamilyCss: string | null = null
      if (op.baseFamily) {
        const generic = op.fontFallback ?? 'serif'
        fontFamilyCss = `"${op.baseFamily}", ${generic}`
      } else if (op.fontFallback) {
        fontFamilyCss = op.fontFallback
      }
      if (fontFamilyCss) {
        ctx.font = `${op.italic ? 'italic ' : ''}${op.bold ? 'bold ' : ''}${cssSize}px ${fontFamilyCss}`
      } else {
        const { weight, style } = cssFontVariant(op.fontName)
        ctx.font = `${style} ${weight} ${cssSize}px ${cssFontFamily(op.fontName)}`
      }
      ctx.fillStyle = op.color
      let dx = x
      let dy = y + h - Math.max(0, (h - cssSize) / 2)
      if (op.x !== undefined && op.baselineY !== undefined) {
        ;[dx, dy] = toViewport(op.x, op.baselineY)
      }
      ctx.textBaseline = op.baselineY !== undefined ? 'alphabetic' : 'bottom'
      if (glyphDeg) {
        ctx.translate(dx, dy)
        ctx.rotate((glyphDeg * Math.PI) / 180)
        ctx.fillText(op.newText, 0, 0)
      } else {
        ctx.fillText(op.newText, dx, dy)
      }
      break
    }
    case 'overlay-text': {
      const [x, yBase] = toViewport(op.x, op.y)
      const { weight, style } = cssFontVariant(op.fontName)
      const cssSize = op.fontSize * cssPxPerPoint
      ctx.font = `${style} ${weight} ${cssSize}px ${cssFontFamily(op.fontName)}`
      ctx.fillStyle = op.color
      ctx.textBaseline = 'alphabetic'
      if (glyphDeg) {
        ctx.translate(x, yBase)
        ctx.rotate((glyphDeg * Math.PI) / 180)
        ctx.fillText(op.text, 0, 0)
      } else {
        ctx.fillText(op.text, x, yBase)
      }
      break
    }
    case 'draw': {
      if (op.points.length < 2) break
      ctx.strokeStyle = op.color
      ctx.globalAlpha = op.opacity
      ctx.lineWidth = Math.max(0.5, op.thickness * cssPxPerPoint)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const [sx, sy] = toViewport(op.points[0].x, op.points[0].y)
      ctx.moveTo(sx, sy)
      for (let i = 1; i < op.points.length; i++) {
        const [px, py] = toViewport(op.points[i].x, op.points[i].y)
        ctx.lineTo(px, py)
      }
      ctx.stroke()
      break
    }
    case 'shape': {
      const [ax, ay] = toViewport(op.x, op.y + op.height)
      const [bx, by] = toViewport(op.x + op.width, op.y)
      const x = Math.min(ax, bx)
      const y = Math.min(ay, by)
      const w = Math.abs(bx - ax)
      const h = Math.abs(by - ay)
      ctx.strokeStyle = op.color
      ctx.fillStyle = op.color
      ctx.lineWidth = Math.max(0.5, op.thickness * cssPxPerPoint)
      if (op.shape === 'rect') {
        if (op.fill) ctx.fillRect(x, y, w, h)
        else ctx.strokeRect(x, y, w, h)
      } else if (op.shape === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        if (op.fill) ctx.fill()
        else ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        if (op.shape === 'arrow') {
          const ang = Math.atan2(by - ay, bx - ax)
          const head = 6 + ctx.lineWidth * 2
          ctx.beginPath()
          ctx.moveTo(bx, by)
          ctx.lineTo(bx - head * Math.cos(ang - 0.5), by - head * Math.sin(ang - 0.5))
          ctx.moveTo(bx, by)
          ctx.lineTo(bx - head * Math.cos(ang + 0.5), by - head * Math.sin(ang + 0.5))
          ctx.stroke()
        }
      }
      break
    }
    case 'markup': {
      ctx.globalAlpha = op.markup === 'highlight' ? op.opacity : 1
      for (const q of op.quads) {
        const [ax, ay] = toViewport(q.x, q.y + q.height)
        const [bx, by] = toViewport(q.x + q.width, q.y)
        const x = Math.min(ax, bx)
        const y = Math.min(ay, by)
        const w = Math.abs(bx - ax)
        const h = Math.abs(by - ay)
        if (op.markup === 'highlight') {
          ctx.fillStyle = op.color
          ctx.fillRect(x, y, w, h)
        } else {
          ctx.strokeStyle = op.color
          ctx.lineWidth = Math.max(1, h * 0.07)
          ctx.beginPath()
          const lineY = op.markup === 'underline' ? y + h : y + h / 2
          ctx.moveTo(x, lineY)
          ctx.lineTo(x + w, lineY)
          ctx.stroke()
        }
      }
      break
    }
    case 'link': {
      const [ax, ay] = toViewport(op.x, op.y + op.height)
      const [bx, by] = toViewport(op.x + op.width, op.y)
      ctx.fillStyle = 'rgba(30, 136, 229, 0.10)'
      ctx.strokeStyle = '#1e88e5'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax) - 1, Math.abs(by - ay) - 1)
      break
    }
    case 'redact': {
      const [ax, ay] = toViewport(op.x, op.y + op.height)
      const [bx, by] = toViewport(op.x + op.width, op.y)
      // marked but not yet applied (Acrobat shows a red outline until the
      // redaction is applied on save); the content below stays readable
      const x = Math.min(ax, bx)
      const y = Math.min(ay, by)
      const w = Math.abs(bx - ax)
      const h = Math.abs(by - ay)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = '#e53935'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 0.75, y + 0.75, Math.max(0, w - 1.5), Math.max(0, h - 1.5))
      break
    }
    case 'image': {
      const bmp = await bitmapFor(op.imageData, op.imageType === 'png' ? 'image/png' : 'image/jpeg')
      const [ax, ay] = toViewport(op.x, op.y + op.height)
      const [bx, by] = toViewport(op.x + op.width, op.y)
      const x = Math.min(ax, bx)
      const y = Math.min(ay, by)
      const w = Math.abs(bx - ax)
      const h = Math.abs(by - ay)
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(((op.rotation + glyphDeg) * Math.PI) / 180)
      ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
      break
    }
    default:
      break
  }
  ctx.restore()
}

// ── document-wide decorations (preview) ──────────────────────────

type Vp = {
  convertToViewportPoint: (x: number, y: number) => number[]
  scale: number
  rotation: number
  viewBox: number[]
}

/** the page center + rotation as drawn on the canvas */
function pageFrame(vp: Vp) {
  const [x0, y0, x1, y1] = vp.viewBox
  const [cx, cy] = vp.convertToViewportPoint((x0 + x1) / 2, (y0 + y1) / 2)
  return { cx, cy, rot: (vp.rotation * Math.PI) / 180, w: x1 - x0, h: y1 - y0, x0, y0 }
}

export function drawWatermark(ctx: CanvasRenderingContext2D, op: import('./ops').WatermarkOp, vp: Vp): void {
  const f = pageFrame(vp)
  ctx.save()
  ctx.translate(f.cx, f.cy)
  ctx.rotate(f.rot - (op.angle * Math.PI) / 180)
  ctx.globalAlpha = op.opacity
  ctx.fillStyle = op.color
  ctx.font = `bold ${op.fontSize * vp.scale}px Helvetica, Arial, "PingFang SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(op.text, 0, 0)
  ctx.restore()
}

export function drawPageNumber(
  ctx: CanvasRenderingContext2D,
  op: import('./ops').PageNumbersOp,
  vp: Vp,
  viewPage: number,
  viewCount: number,
): void {
  if (viewPage < op.startPage) return
  const n = op.startNumber + (viewPage - op.startPage)
  const total = op.startNumber + (viewCount - op.startPage)
  const label = op.format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total))
  const margin = 28
  const [v, h] = op.position.split('-')
  const f = pageFrame(vp)
  ctx.save()
  ctx.font = `${op.fontSize * vp.scale}px Helvetica, Arial, "PingFang SC", sans-serif`
  const tw = ctx.measureText(label).width / vp.scale
  const x = h === 'left' ? f.x0 + margin : h === 'right' ? f.x0 + f.w - margin - tw : f.x0 + (f.w - tw) / 2
  const y = v === 'top' ? f.y0 + f.h - margin - op.fontSize * 0.75 : f.y0 + margin
  const [px, py] = vp.convertToViewportPoint(x, y)
  ctx.translate(px, py)
  ctx.rotate(f.rot)
  ctx.fillStyle = op.color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

/** dim the area outside a pending crop (margins in points of the page box) */
export function drawCropMask(
  ctx: CanvasRenderingContext2D,
  m: { left: number; right: number; top: number; bottom: number },
  viewport: { viewBox: number[]; convertToViewportPoint: (x: number, y: number) => number[] },
  width: number,
  height: number,
): void {
  if (!m.left && !m.right && !m.top && !m.bottom) return
  const [x0, y0, x1, y1] = viewport.viewBox
  const [ax, ay] = viewport.convertToViewportPoint(x0 + m.left, y1 - m.top)
  const [bx, by] = viewport.convertToViewportPoint(x1 - m.right, y0 + m.bottom)
  const rx = Math.min(ax, bx)
  const ry = Math.min(ay, by)
  const rw = Math.abs(bx - ax)
  const rh = Math.abs(by - ay)
  ctx.save()
  ctx.fillStyle = 'rgba(40, 44, 52, 0.45)'
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.rect(rx, ry, rw, rh)
  ctx.fill('evenodd')
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = '#0f7b6c'
  ctx.lineWidth = 1.5
  ctx.strokeRect(rx, ry, rw, rh)
  ctx.restore()
}
