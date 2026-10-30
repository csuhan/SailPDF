/**
 * "创建 PDF" from images: one page per image, either sized to the image or
 * fitted on A4 / Letter with margins. Formats the browser can decode but
 * PDF cannot embed directly (WebP, GIF, HEIC on macOS...) go through a canvas.
 */
import { PDFDocument } from 'pdf-lib'

export type PageFit = 'image' | 'a4' | 'letter'

const SIZES: Record<Exclude<PageFit, 'image'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

async function asEmbeddable(file: Blob): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg'; w: number; h: number }> {
  const bmp = await createImageBitmap(file)
  const w = bmp.width
  const h = bmp.height
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    bmp.close()
    return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type === 'image/png' ? 'png' : 'jpg', w, h }
  }
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const blob = await c.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', w, h }
}

export async function pdfFromImages(
  files: Blob[],
  fit: PageFit,
  progress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setProducer('Sail PDF')
  doc.setCreator('Sail PDF')
  for (let i = 0; i < files.length; i++) {
    progress?.(i, files.length)
    const im = await asEmbeddable(files[i])
    const img = im.type === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes)
    // images at 96 dpi by default (screen captures / photos look natural)
    const natW = (im.w * 72) / 96
    const natH = (im.h * 72) / 96
    if (fit === 'image') {
      const page = doc.addPage([natW, natH])
      page.drawImage(img, { x: 0, y: 0, width: natW, height: natH })
    } else {
      let [pw, ph] = SIZES[fit]
      // landscape images get a landscape page
      if (im.w > im.h) [pw, ph] = [ph, pw]
      const margin = 28
      const s = Math.min((pw - 2 * margin) / natW, (ph - 2 * margin) / natH, 1)
      const w = natW * s
      const h = natH * s
      const page = doc.addPage([pw, ph])
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
    }
  }
  progress?.(files.length, files.length)
  return doc.save({ useObjectStreams: true })
}
