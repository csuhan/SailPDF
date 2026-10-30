import { tr } from '../i18n/locale'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { getDesktop } from '../desktop/bridge'
import { downloadBytes } from '../pdf/edit/applyOps'
import { currentOutputBytes, hasUnsavedOutput, latestSecurityOp, savedFileBytes } from './output'
import { decryptPdf, decryptWithPreservedSecurity, inspectEncryption } from '../pdf/security/standardSecurity'
import { clearDraft } from './autosave'
import { validatePdfOutput } from '../pdf/validateOutput'
import { computePageMap } from '../pdf/edit/pageOrder'
import { otherDocumentPaths } from '../desktop/bridge'
import type { DiskFingerprint, PdfWriteResult } from '../desktop/bridge'
import { suggestedPdfName, usePreferences } from '../state/preferences'

let saving = false

/** save an arbitrary file: native dialog on desktop, download in the browser */
export async function saveBlobFile(
  name: string,
  bytes: Uint8Array,
  mime: string,
  filterName: string,
  extensions: string[],
): Promise<boolean> {
  if (mime === 'application/pdf') {
    const s = useAppStore.getState()
    const revision = useEditStore.getState().revision
    const current = () =>
      useAppStore.getState().docEpoch === s.docEpoch && useEditStore.getState().revision === revision
    try {
      let readable = bytes
      if (await inspectEncryption(bytes)) {
        const sec = latestSecurityOp()
        if (sec?.protect)
          readable = (await decryptPdf(bytes, sec.protect.ownerPassword ?? sec.protect.userPassword)).bytes
        else if (s.encryption) readable = await decryptWithPreservedSecurity(bytes, s.encryption.preserved)
        else throw new Error(tr('无法验证此加密文件'))
      }
      await validatePdfOutput(readable, undefined, current)
      const desktop = getDesktop()
      if (desktop?.savePdfAs) {
        const guard = {
          ...(s.filePath && s.diskFingerprint ? { path: s.filePath, fingerprint: s.diskFingerprint } : {}),
          otherOpenPaths: otherDocumentPaths(),
        }
        const result = await desktop.savePdfAs(name, bytes, guard)
        if (!result.ok && result.reason !== 'cancelled')
          notify(result.message ?? tr('文件未保存，请选择新的保存位置'), 'error')
        return result.ok
      }
    } catch (error) {
      notify(tr('未保存 PDF：{0}', error instanceof Error ? error.message : String(error)), 'error')
      return false
    }
  }
  const desktop = getDesktop()
  if (desktop?.saveFile) {
    return (await desktop.saveFile(name, bytes, filterName, extensions)) !== null
  }
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: mime,
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

function editedName(fileName: string, edited: boolean): string {
  return suggestedPdfName(fileName, edited, usePreferences.getState().copySuffix)
}

// an open inline editor registers how to commit itself, so saving / closing
// never loses text that is still being typed
const pendingCommits = new Set<() => void>()
export function registerPendingCommit(fn: () => void): () => void {
  pendingCommits.add(fn)
  return () => pendingCommits.delete(fn)
}
export function commitPendingEdits(): void {
  for (const fn of Array.from(pendingCommits)) fn()
}

let toast: ((msg: string, kind?: 'ok' | 'error') => void) | null = null
/** registered by the toast host component */
export function setToast(fn: typeof toast): void {
  toast = fn
}
export function notify(msg: string, kind: 'ok' | 'error' = 'ok'): void {
  if (toast) toast(msg, kind)
}

/**
 * protection state of a file we just wrote: the in-app document stays the
 * decrypted one, later saves keep the protection
 */
async function encryptionAfterSave(written: Uint8Array) {
  const sec = latestSecurityOp()
  const app = useAppStore.getState()
  if (!sec) return app.encryption
  if (!sec.protect) return null
  // unlock our own output once to capture its key for the next saves
  const pw = sec.protect.ownerPassword ?? sec.protect.userPassword
  const r = await decryptPdf(written, pw)
  return { info: r.info, preserved: r.preserved, owner: r.owner, userPassword: sec.protect.userPassword }
}

/**
 * Save the document.
 * - desktop: the first save of a document shows the save dialog (suggesting
 *   the original folder); the chosen location is remembered and later ⌘S
 *   writes there directly. ⇧⌘S always asks again. After saving, the
 *   document continues from the saved file so further edits start clean.
 * - browser: a download
 * Returns true when the document was written.
 */
export async function saveCurrentDocument(opts: { saveAs?: boolean } = {}): Promise<boolean> {
  if (saving) return false
  commitPendingEdits()
  const s = useAppStore.getState()
  if (!s.fileBytes || !s.fileName) return false
  saving = true
  try {
    const { ops, revision } = useEditStore.getState()
    const sameDocument = () =>
      useAppStore.getState().pdfDoc === s.pdfDoc && useAppStore.getState().docEpoch === s.docEpoch
    const unchanged = () => sameDocument() && useEditStore.getState().revision === revision
    const edited = hasUnsavedOutput()
    const desktop = getDesktop()
    // Validate the exact detached export before any disk write or download.
    // Reuse one plain export so forms and operations cannot diverge between passes.
    const plain = (await currentOutputBytes()) ?? s.fileBytes
    const expectedPages = computePageMap(s.pdfDoc?.numPages ?? s.numPages, ops).length
    await validatePdfOutput(plain, expectedPages, unchanged)
    const bytes = (await savedFileBytes(plain)) ?? plain
    const encryption = await encryptionAfterSave(bytes)
    if (encryption) {
      const reopened = await decryptWithPreservedSecurity(bytes, encryption.preserved)
      await validatePdfOutput(reopened, expectedPages, unchanged)
    }
    if (!unchanged()) throw new Error(tr('文档已变化，请重新保存'))
    // the autosave draft belongs to the file as it was opened
    const draftKey = `${s.filePath ?? s.fileName}#${s.fileBytes.length}`
    if (desktop) {
      let savedPath: string | null = null
      let fingerprint: DiskFingerprint | null = null
      const copy = opts.saveAs || s.diskDetached || !!s.externalFile
      const suggested = s.filePath
        ? s.filePath.replace(/[^/]+$/, editedName(s.fileName, edited || !!s.externalFile || s.diskDetached))
        : editedName(s.fileName, edited)
      if (desktop.savePdfAs && desktop.writePdf) {
        const guard = {
          ...(s.filePath && s.diskFingerprint ? { path: s.filePath, fingerprint: s.diskFingerprint } : {}),
          otherOpenPaths: otherDocumentPaths(),
        }
        const result: PdfWriteResult =
          !copy && s.savePath && s.diskFingerprint
            ? await desktop.writePdf(s.savePath, bytes, s.diskFingerprint)
            : await desktop.savePdfAs(suggested, bytes, guard)
        if (!result.ok) {
          if (result.reason !== 'cancelled') {
            if (sameDocument())
              useAppStore.getState().setExternalFile({
                status: result.reason === 'conflict' ? 'changed' : result.reason,
                message: result.message,
              })
            notify(result.message ?? tr('磁盘文件已变化，未覆盖。请重新载入或另存副本。'), 'error')
          }
          return false
        }
        savedPath = result.path
        fingerprint = result.fingerprint
      } else if (!copy && s.savePath && desktop.writeFile) {
        savedPath = await desktop.writeFile(s.savePath, bytes)
      } else {
        savedPath = await desktop.saveAs(suggested, bytes)
      }
      if (!savedPath) return false
      const name = savedPath.split('/').pop() ?? s.fileName
      const keepLaterEdits = () => {
        if (sameDocument()) {
          useAppStore.getState().setDocumentLocation(name, savedPath)
          useAppStore.getState().setSavePath(savedPath)
          useAppStore.setState({ diskFingerprint: fingerprint, externalFile: null, diskDetached: false })
          useEditStore.getState().setFormDirty(true)
        }
        notify(tr('已保存操作开始时的版本；之后的修改仍待保存'))
      }
      if (!unchanged()) {
        keepLaterEdits()
        return true
      }
      if (edited) {
        // continue from the saved file: edits are now part of the document
        const keep = { page: s.currentPage, scale: s.scale, fitMode: s.fitMode, viewMode: s.viewMode }
        const reopened = await useAppStore
          .getState()
          .openFile(plain, name, savedPath, encryption, unchanged, fingerprint)
        if (!reopened) {
          keepLaterEdits()
          return true
        }
        useAppStore.getState().setSavePath(savedPath)
        useAppStore.setState({ diskFingerprint: fingerprint, externalFile: null, diskDetached: false })
        const app = useAppStore.getState()
        app.setViewMode(keep.viewMode)
        if (keep.fitMode === 'custom') app.setScale(keep.scale, 'custom')
        else app.setFitMode(keep.fitMode)
        app.goToPage(keep.page)
      } else {
        useAppStore.getState().setDocumentLocation(name, savedPath)
        useAppStore.getState().setSavePath(savedPath)
        useAppStore.setState({ diskFingerprint: fingerprint, externalFile: null, diskDetached: false })
        useEditStore.getState().markSaved()
      }
      void clearDraft(draftKey)
      notify(tr('已保存到 {0}', savedPath.replace(/^\/Users\/[^/]+/, '~')))
      return true
    }
    if (!unchanged()) throw new Error(tr('文档已变化，请重新保存'))
    downloadBytes(editedName(s.fileName, edited), bytes)
    useEditStore.getState().markSaved()
    void clearDraft(draftKey)
    notify(tr('已下载保存的 PDF'))
    return true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('save failed', e)
    notify(tr('保存失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    return false
  } finally {
    saving = false
  }
}
