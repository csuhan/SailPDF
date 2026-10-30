import { tr } from '../i18n/locale'
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { checkExternalFile, keepLocalVersion, reloadExternalFile } from '../desktop/fileSync'
import { saveCurrentDocument } from '../utils/save'
import '../styles/external-file.css'

export function ExternalFileBanner() {
  const issue = useAppStore((s) => s.externalFile)
  const detached = useAppStore((s) => s.diskDetached)
  const dirty = useEditStore((s) => s.dirty)
  const [busy, setBusy] = useState(false)
  if (!issue && !detached) return null
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const message = detached
    ? tr('已保留当前版本。磁盘上的文件不会被覆盖，请另存副本。')
    : issue?.status === 'changed'
      ? tr('此文件已被其他应用修改。{0}', dirty ? tr('你的编辑仍保留在这里。') : tr('可以载入磁盘上的最新版本。'))
      : issue?.status === 'missing'
        ? tr('原文件已被移动或删除。当前文档仍可另存副本。')
        : tr('暂时无法访问原文件。当前文档和编辑已保留。')
  return (
    <div className="external-file-banner" role="status" aria-live="polite">
      <span>{message}</span>
      {issue?.status === 'changed' && (
        <button className="btn small" disabled={busy} onClick={() => void run(reloadExternalFile)}>
          {tr('重新载入')}
        </button>
      )}
      {issue && (
        <button className="btn small" disabled={busy} onClick={keepLocalVersion}>
          {tr('保留当前编辑')}
        </button>
      )}
      {issue?.status === 'unavailable' && (
        <button className="btn small" disabled={busy} onClick={() => void run(checkExternalFile)}>
          {tr('重试')}
        </button>
      )}
      <button
        className="btn small primary"
        disabled={busy}
        onClick={() => void run(() => saveCurrentDocument({ saveAs: true }))}
      >
        {tr('另存副本')}
      </button>
    </div>
  )
}
