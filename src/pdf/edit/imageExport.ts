/**
 * Export an image of the current page: original encoded bytes when the
 * image is a pass-through JPEG/JPEG2000, else a lossless PNG of the decoded
 * pixels (pdf.js' decoded image object, incl. soft masks).
 */
import { PDFDocument } from 'pdf-lib'
import type { PDFPageProxy } from 'pdfjs-dist'
import { closeMatrix, originalImageBytes, walkImagePaints, type Mat } from './imageOps'
import type { PageImage } from './glyphModel'

export interface ExportedImage {
  bytes: Uint8Array
  ext: 'jpg' | 'jp2' | 'png'
  mime: string
  width: number
  height: number
}

interface PdfJsImage {
  width: number
  height: number
  kind?: number
  data?: Uint8ClampedArray | Uint8Array | null
  bitmap?: ImageBitmap | null
}

function getImageObj(page: PDFPageProxy, objId: string): Promise<PdfJsImage | null> {
  return new Promise((resolve) => {
    const store = (objId.startsWith('g_') ? page.commonObjs : page.objs) as unknown as {
      has: (id: string) => boolean
      get: (id: string, cb?: (d: unknown) => void) => unknown
    }
    try {
      if (store.has(objId)) {
        resolve(store.get(objId) as PdfJsImage)
        return
      }
      store.get(objId, (d) => resolve(d as PdfJsImage))
    } catch {
      resolve(null)
    }
    setTimeout(() => resolve(null), 5000)
  })
}

/** pdf.js ImageKind: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP */
function toRgba(img: PdfJsImage): ImageData | null {
  const { width: w, height: h, data, kind } = img
  if (!data || !w || !h) return null
  const out = new ImageData(w, h)
  const d = out.data
  if (kind === 3) {
    d.set(data.subarray(0, w * h * 4))
  } else if (kind === 2) {
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      d[i * 4] = data[j]
      d[i * 4 + 1] = data[j + 1]
      d[i * 4 + 2] = data[j + 2]
      d[i * 4 + 3] = 255
    }
  } else if (kind === 1) {
    const rowBytes = (w + 7) >> 3
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const v = bit ? 255 : 0
        const o = (y * w + x) * 4
        d[o] = d[o + 1] = d[o + 2] = v
        d[o + 3] = 255
      }
    }
  } else {
    return null
  }
  return out
}

async function canvasPng(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

/** encoded original bytes of the paint site matching `img`, if pass-through */
async function originalBytes(fileBytes: Uint8Array, pageIndex: number, img: PageImage): Promise<ExportedImage | null> {
  const doc = await PDFDocument.load(fileBytes, { updateMetadata: false })
  const page = doc.getPage(pageIndex)
  let found: ExportedImage | null = null
  let fallback: ExportedImage | null = null
  walkImagePaints(doc, page, (site) => {
    if (found || !site.xobject || !closeMatrix(site.matrix, img.matrix as Mat)) return
    const ex = originalImageBytes(site.xobject)
    if (!ex.bytes || ex.kind === 'raw') return
    const r: ExportedImage = {
      bytes: ex.bytes,
      ext: ex.kind,
      mime: ex.kind === 'jpg' ? 'image/jpeg' : 'image/jp2',
      width: img.width,
      height: img.height,
    }
    if (site.index === img.index) found = r
    else fallback ??= r
  })
  return found ?? fallback
}

export async function exportPageImage(
  page: PDFPageProxy,
  fileBytes: Uint8Array | null,
  img: PageImage,
): Promise<ExportedImage> {
  if (fileBytes && !img.inline) {
    try {
      const orig = await originalBytes(fileBytes, page.pageNumber - 1, img)
      if (orig) return orig
    } catch {
      /* fall back to decoded pixels */
    }
  }
  if (img.objId) {
    const obj = await getImageObj(page, img.objId)
    if (obj) {
      const w = obj.width
      const h = obj.height
      if (obj.bitmap) {
        const bmp = obj.bitmap
        return {
          bytes: await canvasPng((ctx) => ctx.drawImage(bmp, 0, 0), w, h),
          ext: 'png',
          mime: 'image/png',
          width: w,
          height: h,
        }
      }
      const rgba = toRgba(obj)
      if (rgba) {
        return {
          bytes: await canvasPng((ctx) => ctx.putImageData(rgba, 0, 0), w, h),
          ext: 'png',
          mime: 'image/png',
          width: w,
          height: h,
        }
      }
    }
  }
  // last resort: render the page region the image covers
  return renderRegion(page, img)
}

async function renderRegion(page: PDFPageProxy, img: PageImage): Promise<ExportedImage> {
  const { x0, y0, x1, y1 } = img.box
  const pxPerPt = Math.min(4, Math.max(1, img.width / Math.max(1, x1 - x0)))
  const vp = page.getViewport({ scale: pxPerPt })
  const c = document.createElement('canvas')
  c.width = Math.ceil(vp.width)
  c.height = Math.ceil(vp.height)
  await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
  const [ax, ay] = vp.convertToViewportPoint(x0, y1)
  const [bx, by] = vp.convertToViewportPoint(x1, y0)
  const sx = Math.floor(Math.min(ax, bx))
  const sy = Math.floor(Math.min(ay, by))
  const w = Math.max(1, Math.ceil(Math.abs(bx - ax)))
  const h = Math.max(1, Math.ceil(Math.abs(by - ay)))
  const bytes = await canvasPng((ctx) => ctx.drawImage(c, sx, sy, w, h, 0, 0, w, h), w, h)
  return { bytes, ext: 'png', mime: 'image/png', width: w, height: h }
}
