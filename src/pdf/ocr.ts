import { tr } from '../i18n/locale'
/**
 * 扫描件识别 (OCR) → 可搜索 PDF.
 *
 * Pages are rendered at ~200 dpi and recognised ON DEVICE with Apple's
 * Vision framework (desktop app, macOS). The recognised lines are written
 * back as an INVISIBLE text layer (render mode 3) exactly over the scanned
 * text — the page looks unchanged, but text can be searched, selected,
 * copied and read by the AI. Pages that already contain text are skipped.
 */
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  type PDFFont,
} from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDesktop, type OcrPage } from '../desktop/bridge'
import { fontForText } from './edit/cjkFont'
import { loadFontkit } from './edit/extractFonts'

export async function ocrAvailable(): Promise<boolean> {
  const d = getDesktop()
  return !!(d?.ocr && (await d.ocrAvailable?.()))
}

/** pages without (meaningful) text: candidates for OCR */
export async function pagesNeedingOcr(doc: PDFDocumentProxy): Promise<number[]> {
  const out: number[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    const chars = tc.items.reduce((a, i) => a + ('str' in i ? i.str.trim().length : 0), 0)
    if (chars < 20) out.push(p)
  }
  return out
}

async function renderPng(
  doc: PDFDocumentProxy,
  p: number,
  dpi: number,
): Promise<{ png: Uint8Array; w: number; h: number }> {
  const page = await doc.getPage(p)
  const vp = page.getViewport({ scale: Math.min(dpi / 72, 6000 / Math.max(page.view[2], page.view[3])) })
  const c = document.createElement('canvas')
  c.width = Math.ceil(vp.width)
  c.height = Math.ceil(vp.height)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/png'),
  )
  return { png: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height }
}

export interface OcrResult {
  bytes: Uint8Array
  pages: number
  lines: number
  /** plain text per page (1-based page -> text) */
  text: Map<number, string>
}

export async function ocrDocument(
  doc: PDFDocumentProxy,
  bytes: Uint8Array,
  pages: number[],
  progress?: (done: number, total: number) => void,
): Promise<OcrResult> {
  const desktop = getDesktop()
  if (!desktop?.ocr) throw new Error(tr('文字识别需要桌面版（macOS）'))
  const results = new Map<number, OcrPage>()
  // small batches: steady progress, bounded memory
  for (let i = 0; i < pages.length; i += 4) {
    progress?.(i, pages.length)
    const batch = pages.slice(i, i + 4)
    const imgs = await Promise.all(batch.map((p) => renderPng(doc, p, 200)))
    const r = await desktop.ocr(imgs.map((x) => x.png))
    batch.forEach((p, k) => results.set(p, r[k]))
  }
  progress?.(pages.length, pages.length)

  const out = await PDFDocument.load(bytes, { updateMetadata: false })
  out.registerFontkit((await loadFontkit()) as never)
  const all = Array.from(results.values())
    .flatMap((r) => r.lines.map((l) => l.text))
    .join('')
  // one font that can encode every recognised character (system CJK font if needed)
  const font: PDFFont = await fontForText(out, all || 'a')
  let lineCount = 0
  const text = new Map<number, string>()
  for (const [p, r] of results) {
    if (r.error || !r.lines.length) continue
    const page = out.getPage(p - 1)
    const { x: bx, y: by, width: pw, height: ph } = page.getCropBox()
    const rot = page.getRotation().angle % 360
    const key = page.node.newFontDictionary('OcrF', font.ref)
    const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(3)]
    for (const l of r.lines) {
      const t = l.text.trim()
      if (!t) continue
      // normalised (top-left) box -> page user space of the rendered view
      let [nx, ny, nw, nh] = l.box
      // pdf.js rendered the page with its /Rotate applied: undo it
      let x0: number, y0: number, w: number, h: number
      if (rot === 90) {
        ;[x0, y0, w, h] = [bx + ny * pw, by + nx * ph, nh * pw, nw * ph]
      } else if (rot === 180) {
        ;[x0, y0, w, h] = [bx + (1 - nx - nw) * pw, by + ny * ph, nw * pw, nh * ph]
      } else if (rot === 270) {
        ;[x0, y0, w, h] = [bx + (1 - ny - nh) * pw, by + (1 - nx - nw) * ph, nh * pw, nw * ph]
      } else {
        ;[x0, y0, w, h] = [bx + nx * pw, by + (1 - ny - nh) * ph, nw * pw, nh * ph]
      }
      void nx
      void ny
      const size = Math.max(4, h * 0.82)
      const natural = font.widthOfTextAtSize(t, size)
      // horizontal scaling makes the invisible line exactly as wide as the ink
      const hs = natural > 0 ? Math.max(10, Math.min(1000, (w / natural) * 100)) : 100
      const enc = font.encodeText(t)
      ops.push(
        setFontAndSize(key, size),
        PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(Math.round(hs * 100) / 100)]),
        setTextMatrix(1, 0, 0, 1, x0, y0 + h * 0.2),
        PDFOperator.of(PDFOperatorNames.ShowText, [enc as PDFHexString]),
      )
      lineCount++
    }
    ops.push(endText(), popGraphicsState())
    page.pushOperators(...ops)
    text.set(p, r.lines.map((l) => l.text).join('\n'))
  }
  out.catalog.set(PDFName.of('MarkInfo'), out.context.obj({ Marked: true }))
  return { bytes: await out.save({ useObjectStreams: true }), pages: results.size, lines: lineCount, text }
}
