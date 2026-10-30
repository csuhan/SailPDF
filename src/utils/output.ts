import { tr } from '../i18n/locale'
/**
 * The bytes the current document would be saved as: original file + filled
 * form values (pdf.js) + all edit ops (pdf-lib bake).
 */
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { bakePdf } from '../pdf/edit/applyOps'
import { bytesWithFormValues, hasFormChanges } from '../pdf/document'
import type { EditOp, SecurityOp } from '../pdf/edit/ops'
import { encryptPdf, reapplySecurity } from '../pdf/security/standardSecurity'

export function hasUnsavedOutput(): boolean {
  return useEditStore.getState().ops.length > 0 || hasFormChanges()
}

/** latest security change, if the user made one */
export function latestSecurityOp(ops: EditOp[] = useEditStore.getState().ops): SecurityOp | null {
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === 'security') return ops[i] as SecurityOp
  return null
}

/**
 * The bytes of the current document as they appear in the app (no password
 * protection). Used by exports, previews and page tools.
 */
export async function currentOutputBytes(): Promise<Uint8Array | null> {
  const s = useAppStore.getState()
  if (!s.fileBytes) return null
  const { ops, revision } = useEditStore.getState()
  const current = () =>
    useAppStore.getState().pdfDoc === s.pdfDoc &&
    useAppStore.getState().docEpoch === s.docEpoch &&
    useEditStore.getState().revision === revision
  const withForms = (await bytesWithFormValues()) ?? s.fileBytes
  if (!current()) throw new Error(tr('文档已变化，请重新执行此操作'))
  const content = ops.filter((o) => o.kind !== 'security')
  const out = content.length > 0 ? await bakePdf(withForms, content) : withForms
  if (!current()) throw new Error(tr('文档已变化，请重新执行此操作'))
  return out
}

/**
 * What gets written to disk: the current output with its protection —
 * the original password protection of an encrypted file, or the one the
 * user set with the "保护" tool.
 */
export async function savedFileBytes(preparedPlain?: Uint8Array): Promise<Uint8Array | null> {
  const app = useAppStore.getState()
  const edits = useEditStore.getState()
  const current = () =>
    useAppStore.getState().pdfDoc === app.pdfDoc &&
    useAppStore.getState().docEpoch === app.docEpoch &&
    useEditStore.getState().revision === edits.revision
  const sec = latestSecurityOp(edits.ops)
  const enc = app.encryption
  const plain = preparedPlain ?? (await currentOutputBytes())
  if (!plain) return null
  if (!current()) throw new Error(tr('文档已变化，请重新保存'))
  if (sec) {
    if (!sec.protect) return plain
    const encrypted = await encryptPdf(plain, {
      userPassword: sec.protect.userPassword,
      ownerPassword: sec.protect.ownerPassword,
      permissions: sec.protect.permissions,
    })
    if (!current()) throw new Error(tr('文档已变化，请重新保存'))
    return encrypted
  }
  const out = enc ? await reapplySecurity(plain, enc.preserved) : plain
  if (!current()) throw new Error(tr('文档已变化，请重新保存'))
  return out
}
