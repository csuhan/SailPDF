import { tr } from '../i18n/locale'
/**
 * Document session: every way of opening / closing a document goes through
 * here, so unsaved edits are never silently thrown away (Acrobat-style
 * "Save changes before closing?" with Save / Don't Save / Cancel).
 */
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { getDesktop, type DiskFingerprint } from '../desktop/bridge'
import { pickPdfFile } from './fileOpen'
import { commitPendingEdits, saveCurrentDocument } from './save'
import { openPossiblyEncrypted } from './secureOpen'
import { clearDraft, checkpointBeforeSwitch } from './autosave'
import { activateTab, findTabByPath, useTabStore } from '../state/tabStore'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

type Asker = (fileName: string, opCount: number) => Promise<UnsavedChoice>
let asker: Asker | null = null

/** registered by the in-app dialog component */
export function setUnsavedAsker(fn: Asker | null): void {
  asker = fn
}

/**
 * Resolve pending edits before the current document goes away.
 * Returns false when the user cancels (or a save was cancelled / failed).
 */
export async function confirmDiscard(opts: { deferDiscard?: boolean } = {}): Promise<boolean> {
  commitPendingEdits()
  const edits = useEditStore.getState()
  const app = useAppStore.getState()
  if (!edits.dirty || !app.pdfDoc) return true
  const choice: UnsavedChoice = asker
    ? await asker(app.fileName ?? tr('文档'), edits.ops.length)
    : window.confirm(tr('文档有未保存的修改，确定要放弃这些修改吗？'))
      ? 'discard'
      : 'cancel'
  // A Finder open event can arrive while the modal is waiting for an answer.
  // Never apply that answer (especially Save) to a different active document.
  if (useAppStore.getState().pdfDoc !== app.pdfDoc || useAppStore.getState().docEpoch !== app.docEpoch) return false
  if (choice === 'cancel') return false
  if (choice === 'save') {
    const ok = await saveCurrentDocument()
    return ok
  }
  // "don't save": the user threw the changes away on purpose
  if (!opts.deferDiscard) await clearDraft()
  return true
}

export interface OpenPayload {
  data: Uint8Array | File
  name: string
  /** filesystem path (desktop) — enables saving back in place */
  path?: string | null
  fingerprint?: DiskFingerprint
}

// Finder can deliver several open-file events together. Serialize new tabs so
// the parser's stale-request guard does not discard an earlier requested file.
let pendingOpens: Promise<void> = Promise.resolve()
export function openDocument(p: OpenPayload): Promise<boolean> {
  const result = pendingOpens.then(() => openDocumentNow(p))
  pendingOpens = result.then(
    () => {},
    () => {},
  )
  return result
}

/** Add a tab only after its document has parsed successfully. */
async function openDocumentNow(p: OpenPayload): Promise<boolean> {
  commitPendingEdits()
  if (!(await checkpointBeforeSwitch())) return false
  const existing = p.path ? findTabByPath(p.path) : undefined
  if (existing) {
    activateTab(existing)
    return true
  }
  const ok = await openPossiblyEncrypted(p.data, p.name, p.path ?? null, p.fingerprint, () => true, true)
  if (ok) useToolStore.getState().setMode('read')
  return ok
}

export async function pickAndOpen(): Promise<void> {
  const desktop = getDesktop()
  if (desktop) {
    const files = await desktop.openDialog()
    for (const file of files ?? []) await openDocument(file)
  } else {
    const files = await pickPdfFile(true)
    for (const file of Array.isArray(files) ? files : files ? [files] : [])
      await openDocument({ data: file, name: file.name })
  }
}

/** Close one tab, resolving only that tab's unsaved edits. */
export async function closeDocument(id = useTabStore.getState().activeId): Promise<boolean> {
  if (!id) return true
  const original = useTabStore.getState().activeId
  if (id !== original) activateTab(id)
  if (useTabStore.getState().activeId !== id) return false
  if (!(await confirmDiscard()) || useTabStore.getState().activeId !== id) {
    if (original) activateTab(original)
    return false
  }
  const tabs = useTabStore.getState().tabs
  const index = tabs.findIndex((tab) => tab.id === id)
  const next =
    original !== id && tabs.some((tab) => tab.id === original) ? original : (tabs[index + 1] ?? tabs[index - 1])?.id
  await useAppStore.getState().closeFile()
  if (useTabStore.getState().activeId) return true
  if (next) activateTab(next)
  else useToolStore.getState().setMode('read')
  return true
}

/** Window quit resolves every dirty tab, including background documents. */
export async function confirmAllDocuments(): Promise<boolean> {
  const original = useTabStore.getState().activeId
  const discardedKeys: string[] = []
  for (const tab of [...useTabStore.getState().tabs]) {
    activateTab(tab.id)
    if (!(await confirmDiscard({ deferDiscard: true }))) {
      if (original) activateTab(original)
      return false
    }
    const app = useAppStore.getState()
    if (useEditStore.getState().dirty && app.fileBytes)
      discardedKeys.push(`${app.filePath ?? app.fileName}#${app.fileBytes.length}`)
  }
  if (original) activateTab(original)
  for (const key of discardedKeys) await clearDraft(key)
  return true
}
