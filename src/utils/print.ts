import { tr } from '../i18n/locale'
import { useAppStore } from '../state/stores'
import { currentOutputBytes } from './output'
import { pdfjs } from '../pdf/document'
import { getDesktop } from '../desktop/bridge'
import { commitPendingEdits, notify } from './save'
import { docPermissions, RESTRICTED_HINT } from './secureOpen'

/**
 * Print the current document with edits baked in.
 * - desktop: pages are rendered at print resolution and handed to the main
 *   process, which prints them through the native dialog (Electron has no
 *   built-in PDF viewer to print from, so printing a PDF iframe would print
 *   the app window instead)
 * - browser: the browser's PDF viewer in a hidden iframe
 */
export async function printCurrentDocument(): Promise<void> {
  commitPendingEdits()
  const s = useAppStore.getState()
  if (!s.fileBytes) return
  if (!docPermissions().print) {
    notify(RESTRICTED_HINT, 'error')
    return
  }
  const bytes = (await currentOutputBytes()) ?? s.fileBytes
  const desktop = getDesktop()
  if (desktop?.printPages) {
    notify(tr('正在准备打印…'))
    try {
      const pages = await renderForPrint(bytes)
      await desktop.printPages(pages, s.fileName ?? 'document.pdf')
    } catch (e) {
      notify(tr('打印失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    }
    return
  }
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  // reuse one hidden iframe
  let frame = document.getElementById('pdfpro-print-frame') as HTMLIFrameElement | null
  if (!frame) {
    frame = document.createElement('iframe')
    frame.id = 'pdfpro-print-frame'
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    document.body.appendChild(frame)
  }
  frame.onload = () => {
    try {
      frame!.contentWindow?.focus()
      frame!.contentWindow?.print()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  }
  frame.src = url
}

export interface PrintPage {
  /** jpeg/png data URL of the rendered page */
  src: string
  /** page size in pt (as displayed, rotation applied) */
  widthPt: number
  heightPt: number
}

/** render every page at ~200 dpi for printing */
async function renderForPrint(bytes: Uint8Array): Promise<PrintPage[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
  const out: PrintPage[] = []
  try {
    const dpiScale = 200 / 72
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      // cap the bitmap size for very large pages
      const scale = Math.min(dpiScale, 6000 / Math.max(base.width, base.height))
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(vp.width)
      canvas.height = Math.ceil(vp.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise
      out.push({ src: canvas.toDataURL('image/jpeg', 0.92), widthPt: base.width, heightPt: base.height })
      canvas.width = canvas.height = 0
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return out
}
