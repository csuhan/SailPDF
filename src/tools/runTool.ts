import { tr } from '../i18n/locale'
import { findTool, getToolAvailability, type ToolContext } from './registry'
import { useAppStore } from '../state/stores'
import { useToolStore } from '../state/toolStore'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { docPermissions } from '../utils/secureOpen'
import { pickAndOpen } from '../utils/docSession'
import { currentOutputBytes, savedFileBytes } from '../utils/output'
import { notify, saveBlobFile, saveCurrentDocument } from '../utils/save'
import { exportText, extractAllImages } from '../pdf/edit/exportDoc'
import { getDesktop } from '../desktop/bridge'

async function contextNow(checkOcr = false): Promise<ToolContext> {
  const d = getDesktop()
  const ocr =
    checkOcr && d?.ocr && d.ocrAvailable && (await d.ocrAvailable().catch(() => false)) ? 'available' : 'unavailable'
  const s = useAppStore.getState()
  return {
    hasDocument: !!s.pdfDoc,
    loading: s.loading,
    permissions: docPermissions(s.encryption),
    ocr,
    busy: !!useToolDiscoveryStore.getState().busy,
  }
}

export async function runTool(id: string): Promise<void> {
  const tool = findTool(id)
  if (!tool) return
  const requestedEpoch = useAppStore.getState().docEpoch
  const requestedDoc = useAppStore.getState().pdfDoc
  const stillRequestedDocument = () =>
    useAppStore.getState().docEpoch === requestedEpoch && useAppStore.getState().pdfDoc === requestedDoc
  try {
    let availability = getToolAvailability(tool, await contextNow(tool.capability === 'ocr'))
    if (!stillRequestedDocument()) return
    if (availability.canOpenDocument) {
      useToolDiscoveryStore.getState().setPaletteOpen(false)
      await pickAndOpen()
      const selectedEpoch = useAppStore.getState().docEpoch
      const selectedDoc = useAppStore.getState().pdfDoc
      availability = getToolAvailability(tool, await contextNow(tool.capability === 'ocr'))
      if (useAppStore.getState().docEpoch !== selectedEpoch || useAppStore.getState().pdfDoc !== selectedDoc) return
      if (availability.canOpenDocument) return // picker cancelled
    }
    if (!availability.available) {
      notify(availability.reason, 'error')
      return
    }
    useToolDiscoveryStore.getState().setPaletteOpen(false)
    const action = tool.action
    if (action.kind === 'mode') {
      useToolDiscoveryStore.getState().setDialog(null)
      useToolStore.getState().setMode(action.mode)
      if (action.tool) useToolStore.getState().setTool(action.tool)
      return
    }
    if (action.kind === 'dialog') {
      useToolDiscoveryStore.getState().setDialog(action.dialog, useAppStore.getState().docEpoch)
      return
    }
    switch (action.command) {
      case 'open':
        await pickAndOpen()
        break
      case 'create':
        useToolStore.getState().setCreatePdfOpen(true)
        break
      case 'save':
        await saveCurrentDocument()
        break
      case 'save-as':
        await saveCurrentDocument({ saveAs: true })
        break
      case 'form':
        useToolStore.getState().setMode('read')
        notify(tr('点击页面中的表单字段即可填写，保存时一并写入'))
        break
      case 'share':
        await shareCurrent()
        break
      case 'export-text':
      case 'extract-images': {
        const app = useAppStore.getState()
        const stem = (app.fileName ?? 'document').replace(/\.pdf$/i, '')
        const current = () =>
          useAppStore.getState().pdfDoc === app.pdfDoc && useAppStore.getState().docEpoch === app.docEpoch
        await runBusy(tool.title, async (progress) => {
          const bytes = await currentOutputBytes()
          if (!bytes || !current()) return
          if (action.command === 'export-text') {
            const text = await exportText(bytes, progress)
            if (current())
              await saveBlobFile(`${stem}.txt`, new TextEncoder().encode(text), 'text/plain', tr('文本'), ['txt'])
          } else {
            const { data, count } = await extractAllImages(bytes, stem, progress)
            if (!current()) return
            if (count === 0) {
              notify(tr('文档中没有可提取的图片'))
              return
            }
            await saveBlobFile(tr('{0}_图片.zip', stem), data, 'application/zip', tr('ZIP 压缩包'), ['zip'])
          }
        })
        break
      }
    }
  } catch (error) {
    notify(tr('{0}失败：{1}', tool.title, error instanceof Error ? error.message : String(error)), 'error')
  }
}

export async function runBusy(
  label: string,
  fn: (progress: (done: number, total: number) => void) => Promise<void>,
): Promise<void> {
  const store = useToolDiscoveryStore.getState()
  if (store.busy) {
    notify(tr('另一项工具正在处理，请稍候'))
    return
  }
  store.setBusy(label)
  try {
    await fn((done, total) => store.setBusy(`${label} ${done}/${total}`))
  } catch (error) {
    notify(tr('{0}失败：{1}', label, error instanceof Error ? error.message : String(error)), 'error')
  } finally {
    store.setBusy(null)
  }
}

async function shareCurrent(): Promise<void> {
  const s = useAppStore.getState()
  const bytes = await savedFileBytes()
  if (!bytes || s.pdfDoc !== useAppStore.getState().pdfDoc || s.docEpoch !== useAppStore.getState().docEpoch) return
  const name = s.fileName ?? 'document.pdf'
  const desktop = getDesktop()
  if (desktop?.share && (await desktop.share(name, bytes))) return
  const file = new File([bytes.slice().buffer as ArrayBuffer], name, { type: 'application/pdf' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
    } catch {
      /* cancelled */
    }
    return
  }
  await saveBlobFile(name, bytes, 'application/pdf', tr('PDF 文档'), ['pdf'])
  notify(tr('此环境不支持系统分享，已改为另存一份'))
}
