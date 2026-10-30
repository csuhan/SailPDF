import { tr, onLocaleChange } from '../i18n/locale'
/**
 * Opening password-protected PDFs (Acrobat "此文档受密码保护").
 *
 * Encrypted files are decrypted once on open; the app then works on the
 * plain bytes (rendering, editing, glyph re-encoding all need them) and the
 * protection is written again when saving.
 */
import { PDFDocument } from 'pdf-lib'
import { useAppStore } from '../state/stores'
import {
  ALL_PERMISSIONS,
  PasswordError,
  UnsupportedEncryptionError,
  decryptPdf,
  inspectEncryption,
  reapplySecurity,
  type Permissions,
} from '../pdf/security/standardSecurity'
import { notify } from './save'
import { setModeGuard, useToolStore } from '../state/toolStore'
import type { DiskFingerprint } from '../desktop/bridge'

/**
 * What the open document allows. A restricted file opened with only its open
 * password keeps its restrictions (as in Acrobat); the permissions password
 * lifts them.
 */
export function docPermissions(enc = useAppStore.getState().encryption): Permissions {
  if (!enc || enc.owner) return ALL_PERMISSIONS
  return enc.info.permissions
}

/** can the user switch to this work mode with these permissions? */
export function modeAllowed(mode: string, p: Permissions): boolean {
  if (mode === 'edit') return p.modify
  if (mode === 'annotate') return p.annotate
  if (mode === 'pages') return p.assemble
  return true
}

/** human readable reason for a disabled action */
function createRestrictedHint() {
  return tr('文档权限不允许此操作（在“工具 → 保护”中输入权限密码可解除）')
}

export let RESTRICTED_HINT = createRestrictedHint()

/**
 * Lift restrictions of the open document with its permissions password.
 * Returns true when the password was right.
 */
export async function unlockWithOwnerPassword(password: string): Promise<boolean> {
  const app = useAppStore.getState()
  const enc = app.encryption
  if (!enc) return true
  // the preserved encryption dictionary is all that is needed to check it
  const probe = await reprotectedProbe()
  if (!probe) return false
  try {
    const r = await decryptPdf(probe, password)
    if (!r.owner) return false
    app.setEncryption({ ...enc, owner: true })
    return true
  } catch {
    return false
  }
}

/** a tiny file protected exactly like the open document (password checks) */
async function reprotectedProbe(): Promise<Uint8Array | null> {
  const enc = useAppStore.getState().encryption
  if (!enc) return null
  const d = await PDFDocument.create()
  d.addPage([10, 10])
  return reapplySecurity(await d.save({ useObjectStreams: false }), enc.preserved)
}

/** asks the user for a password; null = cancelled */
type PasswordAsker = (fileName: string, retry: boolean) => Promise<string | null>
let asker: PasswordAsker | null = null
export function setPasswordAsker(fn: PasswordAsker | null): void {
  asker = fn
}

/**
 * Open bytes as the current document, unlocking them first when encrypted.
 * Returns false when the user cancelled the password prompt.
 */
let openRequest = 0

export async function openPossiblyEncrypted(
  data: Uint8Array | File,
  name: string,
  path: string | null,
  fingerprint?: DiskFingerprint,
  accept: () => boolean = () => true,
  newTab = false,
): Promise<boolean> {
  const request = ++openRequest
  const epoch = useAppStore.getState().docEpoch
  const current = () => request === openRequest && epoch === useAppStore.getState().docEpoch && accept()
  let bytes: Uint8Array
  try {
    bytes = data instanceof File ? new Uint8Array(await data.arrayBuffer()) : data
  } catch (e) {
    if (current()) notify(tr('无法读取文件：{0}', e instanceof Error ? e.message : String(e)), 'error')
    return false
  }
  if (!current()) return false
  let info = null
  try {
    info = await inspectEncryption(bytes)
  } catch (e) {
    if (e instanceof UnsupportedEncryptionError) {
      notify(e.message, 'error')
      return false
    }
    // unparsable for pdf-lib: let pdf.js try (it is more tolerant)
    info = null
  }
  if (!current()) return false
  const app = useAppStore.getState()
  if (!info) {
    const ok = await app.openFile(bytes, name, path, null, current, fingerprint, newTab)
    if (!ok && current() && useAppStore.getState().error)
      notify(tr('无法打开文件：{0}', useAppStore.getState().error), 'error')
    return ok
  }
  // no open password: only permissions are restricted -> unlock silently
  let password: string | null = info.needsPassword ? null : ''
  let retry = false
  for (;;) {
    if (!current()) return false
    if (password === null) {
      password = asker ? await asker(name, retry) : window.prompt(tr('“{0}”受密码保护，请输入密码', name))
      if (password === null || !current()) return false
    }
    try {
      const r = await decryptPdf(bytes, password)
      if (!current()) return false
      const ok = await app.openFile(
        r.bytes,
        name,
        path,
        {
          info: r.info,
          preserved: r.preserved,
          owner: r.owner,
          userPassword: r.userPassword,
        },
        current,
        fingerprint,
        newTab,
      )
      if (!ok && current() && useAppStore.getState().error)
        notify(tr('无法打开文件：{0}', useAppStore.getState().error), 'error')
      return ok
    } catch (e) {
      if (e instanceof PasswordError) {
        password = null
        retry = true
        continue
      }
      notify(tr('无法打开加密文档：{0}', e instanceof Error ? e.message : String(e)), 'error')
      return false
    }
  }
}

// entering edit / annotate / page modes honors the document permissions
setModeGuard((m) => {
  if (modeAllowed(m, docPermissions())) return true
  notify(RESTRICTED_HINT, 'error')
  return false
})

// a restricted document opened in a mode it does not allow drops to reading
useAppStore.subscribe((s, prev) => {
  if (s.encryption === prev.encryption) return
  const ts = useToolStore.getState()
  if (!modeAllowed(ts.mode, docPermissions(s.encryption))) ts.setMode('read')
})

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  RESTRICTED_HINT = createRestrictedHint()
})
