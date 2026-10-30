import { tr } from '../i18n/locale'
import { useEffect } from 'react'
import { getDesktop } from './bridge'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { commitPendingEdits, notify } from '../utils/save'
import { confirmDiscard } from '../utils/docSession'
import { openPossiblyEncrypted } from '../utils/secureOpen'
import { clearDraft } from '../utils/autosave'

/** The native check hashes a stable disk snapshot. Late checks never affect a new session. */
export async function checkExternalFile(): Promise<void> {
  const desktop = getDesktop()
  const s = useAppStore.getState()
  if (!desktop?.checkFile || !s.filePath || !s.diskFingerprint || s.diskDetached || s.loading) return
  const current = () => {
    const now = useAppStore.getState()
    return (
      now.docEpoch === s.docEpoch &&
      now.filePath === s.filePath &&
      now.diskFingerprint === s.diskFingerprint &&
      !now.diskDetached
    )
  }
  try {
    const result = await desktop.checkFile(s.filePath, s.diskFingerprint)
    if (!current()) return
    if (result.status === 'same') {
      useAppStore.setState({ externalFile: null, diskFingerprint: result.fingerprint ?? s.diskFingerprint })
    } else useAppStore.getState().setExternalFile({ status: result.status, message: result.message })
  } catch {
    if (current())
      useAppStore.getState().setExternalFile({ status: 'unavailable', message: tr('暂时无法访问磁盘上的文件') })
  }
}

/** Keep edits in memory without adopting or overwriting an unseen disk version. */
export function keepLocalVersion(): void {
  // A kept older disk version now exists only in memory, even if no edit op
  // was added. Include it in the normal unsaved/quit protection.
  useEditStore.getState().setFormDirty(true)
  useAppStore.setState({ diskDetached: true, savePath: null, externalFile: null })
  notify(tr('已保留当前版本；保存时请选择另一个文件'))
}

export async function reloadExternalFile(): Promise<boolean> {
  const desktop = getDesktop()
  const s = useAppStore.getState()
  if (!desktop || !s.filePath) return false
  commitPendingEdits()
  const revision = useEditStore.getState().revision
  const current = () => {
    const now = useAppStore.getState()
    return now.docEpoch === s.docEpoch && now.filePath === s.filePath && useEditStore.getState().revision === revision
  }
  if (!(await confirmDiscard({ deferDiscard: true })) || !current()) return false
  try {
    const file = await desktop.readFile(s.filePath)
    if (!current()) return false
    const ok = await openPossiblyEncrypted(file.data, file.name, file.path ?? s.filePath, file.fingerprint, current)
    if (!ok) return false
    useAppStore.getState().setViewMode(s.viewMode)
    useAppStore.getState().goToPage(s.currentPage)
    if (s.fitMode === 'custom') useAppStore.getState().setScale(s.scale, 'custom')
    else useAppStore.getState().setFitMode(s.fitMode)
    if (s.savePath === s.filePath) useAppStore.getState().setSavePath(s.savePath)
    if (s.fileBytes && s.fileName) void clearDraft(`${s.filePath}#${s.fileBytes.length}`)
    notify(tr('已载入磁盘上的最新版本'))
    return true
  } catch {
    if (current()) {
      await checkExternalFile()
      notify(tr('无法重新载入，当前文档和编辑已保留'), 'error')
    }
    return false
  }
}

export function useExternalFileSync(): void {
  useEffect(() => {
    let busy = false
    const check = () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      void checkExternalFile().finally(() => {
        busy = false
      })
    }
    const timer = window.setInterval(check, 5000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.docEpoch !== previous.docEpoch) check()
    })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      unsubscribe()
    }
  }, [])
}
