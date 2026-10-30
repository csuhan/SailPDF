import { tr } from '../../i18n/locale'
/**
 * "导出 PDF" equivalents: pages as PNG/JPEG, plain text, all embedded images.
 * Everything works from the current output (form values + edits included).
 */
import { pdfjs } from '../document'
import { getGlyphModel } from './glyphModel'
import { exportPageImage } from './imageExport'
import { makeZip, type ZipEntry } from '../../utils/zip'

async function openCopy(bytes: Uint8Array) {
  const base = import.meta.env.BASE_URL ?? '/'
  return pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
  }).promise
}

export type Progress = (done: number, total: number) => void

/** each page rendered at `dpi` → zip of images (or the single image) */
export async function exportPagesAsImages(
  bytes: Uint8Array,
  opts: { format: 'png' | 'jpg'; dpi: number; pages?: number[]; stem: string },
  progress?: Progress,
): Promise<{ data: Uint8Array; ext: string; mime: string }> {
  const doc = await openCopy(bytes)
  try {
    const pages = opts.pages?.length ? opts.pages : Array.from({ length: doc.numPages }, (_, i) => i + 1)
    const entries: ZipEntry[] = []
    const pad = String(doc.numPages).length
    for (let k = 0; k < pages.length; k++) {
      const page = await doc.getPage(pages[k])
      const vp = page.getViewport({ scale: Math.min(opts.dpi / 72, 8000 / Math.max(page.view[2], page.view[3])) })
      const c = document.createElement('canvas')
      c.width = Math.ceil(vp.width)
      c.height = Math.ceil(vp.height)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      const blob: Blob = await new Promise((res, rej) =>
        c.toBlob(
          (b) => (b ? res(b) : rej(new Error('encode failed'))),
          opts.format === 'png' ? 'image/png' : 'image/jpeg',
          0.92,
        ),
      )
      entries.push({
        name: tr('{0}_第{1}页.{2}', opts.stem, String(pages[k]).padStart(pad, '0'), opts.format),
        data: new Uint8Array(await blob.arrayBuffer()),
      })
      c.width = c.height = 0
      page.cleanup()
      progress?.(k + 1, pages.length)
    }
    if (entries.length === 1) {
      return { data: entries[0].data, ext: opts.format, mime: opts.format === 'png' ? 'image/png' : 'image/jpeg' }
    }
    return { data: makeZip(entries), ext: 'zip', mime: 'application/zip' }
  } finally {
    await doc.destroy()
  }
}

/** plain text, page by page, with line breaks reconstructed from positions */
export async function exportText(bytes: Uint8Array, progress?: Progress): Promise<string> {
  const doc = await openCopy(bytes)
  try {
    const out: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      let line = ''
      let lastY: number | null = null
      const lines: string[] = []
      for (const raw of tc.items) {
        const it = raw as { str?: string; transform?: number[]; hasEOL?: boolean }
        if (typeof it.str !== 'string') continue
        const y = it.transform?.[5] ?? 0
        if (lastY !== null && Math.abs(y - lastY) > 2 && line) {
          lines.push(line.trimEnd())
          line = ''
        }
        line += it.str
        if (it.hasEOL) {
          lines.push(line.trimEnd())
          line = ''
        }
        lastY = y
      }
      if (line) lines.push(line.trimEnd())
      out.push(tr('── 第 {0} 页 ──\n', i) + lines.filter((l, k, a) => l || (k > 0 && a[k - 1])).join('\n'))
      page.cleanup()
      progress?.(i, doc.numPages)
    }
    return out.join('\n\n') + '\n'
  } finally {
    await doc.destroy()
  }
}

/** every embedded image (original bytes when possible) → zip */
export async function extractAllImages(
  bytes: Uint8Array,
  stem: string,
  progress?: Progress,
): Promise<{ data: Uint8Array; count: number }> {
  const doc = await openCopy(bytes)
  try {
    const entries: ZipEntry[] = []
    const seen = new Set<string>()
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      // images resolve while rendering
      await page.render({
        canvasContext: document.createElement('canvas').getContext('2d')!,
        viewport: page.getViewport({ scale: 0.25 }),
      }).promise
      const model = await getGlyphModel(page)
      let n = 0
      for (const img of model.images) {
        if (img.isMask || img.width * img.height < 64 * 64) continue
        const key = img.objId ?? `inline-${i}-${img.index}`
        if (seen.has(key)) continue
        seen.add(key)
        try {
          const ex = await exportPageImage(page, bytes, img)
          entries.push({ name: `${stem}_p${i}_${++n}.${ex.ext}`, data: ex.bytes })
        } catch {
          /* skip undecodable image */
        }
      }
      page.cleanup()
      progress?.(i, doc.numPages)
    }
    return { data: makeZip(entries), count: entries.length }
  } finally {
    await doc.destroy()
  }
}
