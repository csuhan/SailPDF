import { tr, onLocaleChange } from '../../i18n/locale'
/**
 * "优化 PDF / 压缩" (Acrobat: Optimize PDF → Reduce file size).
 *
 * - images: large RGB / gray images are downsampled to a target resolution
 *   (by their placed size) and re-encoded as JPEG when that is smaller;
 *   images with masks / transparency, CMYK, 1-bit or tiny images are left as is
 * - fonts embedded in full have their unused glyph outlines removed
 * - uncompressed streams get Flate compression
 * - unreferenced objects are dropped, object streams pack the rest
 * - optionally: metadata (XMP, page thumbnails, piece info) removed
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFObject,
} from 'pdf-lib'
import pako from 'pako'
import { walkImagePaints } from './imageOps'
import { slimEmbeddedFonts } from './fontSlim'

export interface OptimizeOptions {
  /** target resolution for images (pixels per inch at placed size) */
  dpi: number
  /** JPEG quality 0..1 */
  quality: number
  /** drop XMP metadata, thumbnails, application data */
  stripMetadata: boolean
}

function createOptimizePresets(): { id: string; label: string; desc: string; opts: OptimizeOptions }[] {
  return [
    {
      id: 'high',
      label: tr('高质量'),
      desc: tr('图片 220 dpi，适合打印'),
      opts: { dpi: 220, quality: 0.85, stripMetadata: false },
    },
    {
      id: 'standard',
      label: tr('标准'),
      desc: tr('图片 150 dpi，适合屏幕阅读'),
      opts: { dpi: 150, quality: 0.75, stripMetadata: true },
    },
    {
      id: 'small',
      label: tr('最小'),
      desc: tr('图片 96 dpi，适合邮件发送'),
      opts: { dpi: 96, quality: 0.6, stripMetadata: true },
    },
  ]
}

export let OPTIMIZE_PRESETS: { id: string; label: string; desc: string; opts: OptimizeOptions }[] =
  createOptimizePresets()

export interface OptimizeResult {
  bytes: Uint8Array
  before: number
  after: number
  images: number
}

type Progress = (done: number, total: number) => void

function filters(s: PDFStream): string[] {
  const f = s.dict.lookup(PDFName.of('Filter'))
  if (f instanceof PDFName) return [f.toString()]
  if (f instanceof PDFArray) {
    const out: string[] = []
    for (let i = 0; i < f.size(); i++) {
      const v = f.lookup(i)
      if (v instanceof PDFName) out.push(v.toString())
    }
    return out
  }
  return []
}

const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : 0)

/** decode an image XObject to RGBA pixels, or null if unsupported */
async function decodeImage(s: PDFRawStream, w: number, h: number): Promise<ImageData | null> {
  const fs = filters(s)
  const cs = s.dict.lookup(PDFName.of('ColorSpace'))
  const csName =
    cs instanceof PDFName
      ? cs.toString()
      : cs instanceof PDFArray && cs.lookup(0) === PDFName.of('ICCBased')
        ? 'ICC'
        : ''
  const bpc = numOf(s.dict.lookup(PDFName.of('BitsPerComponent')))
  if (fs.length === 1 && fs[0] === '/DCTDecode') {
    if (csName === '/DeviceCMYK') return null
    // browsers decode JPEG natively
    try {
      const bmp = await createImageBitmap(new Blob([s.contents.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }))
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      return ctx.getImageData(0, 0, c.width, c.height)
    } catch {
      return null
    }
  }
  if (fs.some((f) => f !== '/FlateDecode') || bpc !== 8) return null
  let comps = 0
  if (csName === '/DeviceRGB') comps = 3
  else if (csName === '/DeviceGray') comps = 1
  else if (csName === 'ICC') {
    const icc = (cs as PDFArray).lookup(1)
    const n = icc instanceof PDFStream ? numOf(icc.dict.lookup(PDFName.of('N'))) : 0
    if (n === 1 || n === 3) comps = n
  }
  if (!comps) return null
  let raw: Uint8Array
  try {
    raw = decodePDFRawStream(s).decode()
  } catch {
    return null
  }
  if (raw.length < w * h * comps) return null
  const out = new ImageData(w, h)
  const d = out.data
  for (let i = 0, j = 0; i < w * h; i++, j += comps) {
    if (comps === 3) {
      d[i * 4] = raw[j]
      d[i * 4 + 1] = raw[j + 1]
      d[i * 4 + 2] = raw[j + 2]
    } else {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = raw[j]
    }
    d[i * 4 + 3] = 255
  }
  return out
}

async function toJpeg(img: ImageData, tw: number, th: number, quality: number, gray: boolean): Promise<Uint8Array> {
  const src = new OffscreenCanvas(img.width, img.height)
  src.getContext('2d')!.putImageData(img, 0, 0)
  const dst = new OffscreenCanvas(tw, th)
  const ctx = dst.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, tw, th)
  ctx.drawImage(src, 0, 0, tw, th)
  if (gray) {
    // keep gray images gray (smaller and no color cast)
    const px = ctx.getImageData(0, 0, tw, th)
    for (let i = 0; i < px.data.length; i += 4) {
      const v = px.data[i]
      px.data[i + 1] = v
      px.data[i + 2] = v
    }
    ctx.putImageData(px, 0, 0)
  }
  const blob = await dst.convertToBlob({ type: 'image/jpeg', quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** largest placed size (points) of each image XObject across all pages */
function placedSizes(doc: PDFDocument): Map<PDFStream, { w: number; h: number }> {
  const sizes = new Map<PDFStream, { w: number; h: number }>()
  for (const page of doc.getPages()) {
    try {
      walkImagePaints(doc, page, (site) => {
        if (!site.xobject) return
        const m = site.matrix
        const w = Math.hypot(m[0], m[1])
        const h = Math.hypot(m[2], m[3])
        const cur = sizes.get(site.xobject)
        if (!cur || w * h > cur.w * cur.h) sizes.set(site.xobject, { w, h })
      })
    } catch {
      /* unreadable page content: leave its images alone */
    }
  }
  return sizes
}

export async function optimizePdf(
  bytes: Uint8Array,
  opts: OptimizeOptions,
  progress?: Progress,
): Promise<OptimizeResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = doc.context
  const sizes = placedSizes(doc)
  let images = 0

  // 1. images
  const imageRefs: [PDFRef, PDFRawStream][] = []
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))
      imageRefs.push([ref, obj])
  }
  for (let k = 0; k < imageRefs.length; k++) {
    progress?.(k, imageRefs.length)
    const [ref, s] = imageRefs[k]
    const placed = sizes.get(s)
    if (!placed) continue
    const d = s.dict
    if (d.has(PDFName.of('SMask')) || d.has(PDFName.of('Mask')) || d.has(PDFName.of('Decode'))) continue
    if (d.lookup(PDFName.of('ImageMask'))?.toString() === 'true') continue
    const w = numOf(d.lookup(PDFName.of('Width')))
    const h = numOf(d.lookup(PDFName.of('Height')))
    if (w * h < 64 * 64) continue
    // target pixels for the placed size at the wanted resolution
    const scale = Math.min(1, (opts.dpi * placed.w) / 72 / w, (opts.dpi * placed.h) / 72 / h)
    const isJpeg = filters(s).length === 1 && filters(s)[0] === '/DCTDecode'
    // already-JPEG images that are not oversized are kept bit-exact
    if (isJpeg && scale > 0.9) continue
    const img = await decodeImage(s, w, h)
    if (!img) continue
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const cs = d.lookup(PDFName.of('ColorSpace'))
    const gray = cs === PDFName.of('DeviceGray')
    const jpg = await toJpeg(img, tw, th, opts.quality, gray)
    if (jpg.length >= s.contents.length * 0.95) continue
    const nd = ctx.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Width: tw,
      Height: th,
      // canvas JPEGs are always 3-channel (gray images stay neutral gray)
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
    }) as PDFDict
    const intent = d.lookup(PDFName.of('Intent'))
    if (intent) nd.set(PDFName.of('Intent'), intent)
    ctx.assign(ref, PDFRawStream.of(nd, jpg))
    images++
  }
  progress?.(imageRefs.length, imageRefs.length)

  // 2. metadata clean-up
  if (opts.stripMetadata) {
    doc.catalog.delete(PDFName.of('Metadata'))
    doc.catalog.delete(PDFName.of('PieceInfo'))
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of('Thumb'))
      page.node.delete(PDFName.of('PieceInfo'))
      page.node.delete(PDFName.of('Metadata'))
    }
  }

  // 3. fonts embedded in full although only a few glyphs are used
  try {
    slimEmbeddedFonts(doc)
  } catch {
    /* keep fonts as they are */
  }

  // 4. compress uncompressed streams
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.has(PDFName.of('Filter'))) continue
    const t = obj.dict.lookup(PDFName.of('Type'))
    if (t === PDFName.of('XRef') || t === PDFName.of('Metadata')) continue
    if (obj.contents.length < 64) continue
    const z = pako.deflate(obj.contents)
    if (z.length >= obj.contents.length) continue
    obj.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    ctx.assign(ref, PDFRawStream.of(obj.dict, z))
  }

  // 5. drop everything unreachable from the trailer (old image versions,
  //    orphaned objects of earlier incremental saves...)
  collectGarbage(doc)
  const result = await doc.save({ useObjectStreams: true })
  // never make a file bigger
  const best = result.length < bytes.length ? result : bytes
  return { bytes: best, before: bytes.length, after: best.length, images }
}

function collectGarbage(doc: PDFDocument): void {
  const ctx = doc.context
  const seen = new Set<string>()
  const stack: PDFObject[] = []
  const t = ctx.trailerInfo as Record<string, PDFObject | undefined>
  for (const k of ['Root', 'Info', 'ID']) if (t[k]) stack.push(t[k]!)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      const key = o.toString()
      if (seen.has(key)) continue
      seen.add(key)
      const v = ctx.lookup(o)
      if (v) stack.push(v)
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) ctx.delete(ref)
  }
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  OPTIMIZE_PRESETS = createOptimizePresets()
})
