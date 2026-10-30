import { tr } from '../i18n/locale'
/** Per-document recovery snapshots. Writes remain bound to their captured document. */
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { usePreferences } from '../state/preferences'
import { recoveryResult } from '../state/recoveryStatus'
import type { EditOp } from '../pdf/edit/ops'
import { notify } from './save'

const DB = 'pdfpro',
  STORE = 'drafts'
const suppressed = new Map<string, number>()
const revisions = new Map<string, number>()
const pendingRestore = new Set<string>()
const hashes = new WeakMap<Uint8Array, Promise<string>>()
let writes: Promise<unknown> = Promise.resolve()
let generation = 0
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = writes.then(fn, fn)
  writes = result.catch(() => {})
  return result
}
export async function flushDraftWrites(): Promise<void> {
  await writes
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(tr('草稿存储暂时不可用')))
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    let result: T
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onabort = transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error(tr('无法更新草稿')))
    }
    try {
      const request = fn(transaction.objectStore(STORE))
      request.onsuccess = () => {
        result = request.result
      }
    } catch (error) {
      transaction.abort()
      database.close()
      reject(error)
    }
  })
}
type FormValues = Record<string, Record<string, unknown>>
interface Draft {
  ops: EditOp[]
  forms?: FormValues
  savedAt: number
  size: number
  name: string
  sourceHash?: string
}
export interface DraftSummary {
  key: string
  name: string
  savedAt: number
  size: number
  opCount: number
}
function keyOf(s = useAppStore.getState()): string | null {
  return s.fileBytes && s.fileName ? `${s.filePath ?? s.fileName}#${s.fileBytes.length}` : null
}
function hash(bytes: Uint8Array): Promise<string> {
  let value = hashes.get(bytes)
  if (!value) {
    value = crypto.subtle
      .digest('SHA-256', bytes.slice().buffer)
      .then((result) => Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, '0')).join(''))
    hashes.set(bytes, value)
  }
  return value
}
/** Capture synchronously, then persist independently of later tab switches. */
export function checkpointCurrentDraft(): Promise<boolean> {
  const app = useAppStore.getState(),
    edits = useEditStore.getState(),
    key = keyOf(app)
  if (!key || !app.fileBytes || !usePreferences.getState().autosaveEnabled || suppressed.get(key) === edits.revision)
    return Promise.resolve(true)
  revisions.set(key, edits.revision)
  // A clean newly opened document must never erase an unaccepted recovery offer.
  if (!edits.dirty) return Promise.resolve(true)
  const capturedGeneration = generation,
    revision = edits.revision,
    bytes = app.fileBytes
  let forms: FormValues | undefined
  try {
    forms = edits.formDirty ? (structuredClone(app.pdfDoc?.annotationStorage.getAll() ?? {}) as FormValues) : undefined
  } catch {
    recoveryResult(key, tr('“{0}”的表单恢复快照未能保存，请及时手动保存 PDF。', app.fileName))
    return Promise.resolve(false)
  }
  const draft: Draft = { ops: edits.ops, forms, savedAt: Date.now(), size: bytes.length, name: app.fileName! }
  return serial(async () => {
    if (
      capturedGeneration !== generation ||
      !usePreferences.getState().autosaveEnabled ||
      suppressed.get(key) === revision
    )
      return true
    try {
      draft.sourceHash = await hash(bytes)
      if (
        capturedGeneration !== generation ||
        suppressed.get(key) === revision ||
        !usePreferences.getState().autosaveEnabled
      )
        return true
      await tx('readwrite', (store) => store.put(draft, key))
      recoveryResult(key)
      return true
    } catch {
      recoveryResult(key, tr('“{0}”的恢复草稿未能保存，请及时手动保存 PDF。', draft.name))
      return false
    }
  })
}
/** Wait for the latest revision, including edits typed while an earlier write was pending. */
export async function checkpointBeforeSwitch(): Promise<boolean> {
  const epoch = useAppStore.getState().docEpoch
  for (;;) {
    const revision = useEditStore.getState().revision
    if (!(await checkpointCurrentDraft())) return false
    if (useAppStore.getState().docEpoch !== epoch || useEditStore.getState().revision === revision) return true
  }
}
export async function listDrafts(): Promise<DraftSummary[]> {
  await flushDraftWrites()
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly'),
      items: DraftSummary[] = []
    const request = transaction.objectStore(STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value = cursor.value as Partial<Draft> | null
      if (
        typeof cursor.key === 'string' &&
        value &&
        typeof value.name === 'string' &&
        Array.isArray(value.ops) &&
        Number.isFinite(value.savedAt) &&
        Number.isFinite(value.size)
      )
        items.push({
          key: cursor.key,
          name: value.name,
          savedAt: value.savedAt!,
          size: value.size!,
          opCount: value.ops.length + Object.keys(value.forms ?? {}).length,
        })
      cursor.continue()
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(items.sort((a, b) => b.savedAt - a.savedAt))
    }
    transaction.onabort = transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error(tr('无法读取草稿')))
    }
  })
}
export async function removeDraft(key: string): Promise<boolean> {
  if (!key) return false
  const revision = key === keyOf() ? useEditStore.getState().revision : revisions.get(key)
  if (revision !== undefined) suppressed.set(key, revision)
  pendingRestore.delete(key)
  if (key === keyOf()) restoreAsker?.(null)
  return serial(async () => {
    try {
      await tx('readwrite', (store) => store.delete(key))
      recoveryResult(key)
      return true
    } catch {
      return false
    }
  })
}
export async function clearAllDrafts(): Promise<boolean> {
  generation++
  for (const [key, revision] of revisions) suppressed.set(key, revision)
  if (keyOf()) suppressed.set(keyOf()!, useEditStore.getState().revision)
  pendingRestore.clear()
  restoreAsker?.(null)
  return serial(async () => {
    try {
      await tx('readwrite', (store) => store.clear())
      return true
    } catch {
      return false
    }
  })
}
export async function clearDraft(key = keyOf()): Promise<void> {
  if (key) await removeDraft(key)
}
async function offerRestore(accept: () => boolean): Promise<void> {
  const app = useAppStore.getState(),
    revision = useEditStore.getState().revision,
    key = keyOf(app)
  if (!key || !app.fileBytes) return
  const current = () =>
    accept() &&
    keyOf() === key &&
    useAppStore.getState().docEpoch === app.docEpoch &&
    useEditStore.getState().revision === revision &&
    suppressed.get(key) !== revision
  let draft: Draft | undefined
  try {
    await flushDraftWrites()
    draft = await tx<Draft | undefined>('readonly', (store) => store.get(key))
  } catch {
    return
  }
  const formCount = Object.keys(draft?.forms ?? {}).length
  if (
    !draft ||
    !Array.isArray(draft.ops) ||
    (!draft.ops.length && !formCount) ||
    !Number.isFinite(draft.savedAt) ||
    !current() ||
    useEditStore.getState().dirty
  )
    return
  if (draft.sourceHash && draft.sourceHash !== (await hash(app.fileBytes))) {
    notify(tr('已有恢复草稿对应另一版本的 PDF，未自动应用；请保留草稿并核对原文件。'), 'error')
    return
  }
  if (!current()) return
  pendingRestore.add(key)
  const when = new Date(draft.savedAt),
    pad = (value: number) => String(value).padStart(2, '0')
  restoreAsker?.({
    count: draft.ops.length + formCount,
    when: tr('{0}月{1}日 {2}:{3}', when.getMonth() + 1, when.getDate(), pad(when.getHours()), pad(when.getMinutes())),
    restore: () => {
      if (!current()) return
      pendingRestore.delete(key)
      // Re-mount form widgets after updating annotationStorage so visible fields
      // and the next saved PDF contain exactly the same recovered values.
      for (const [id, value] of Object.entries(draft!.forms ?? {})) app.pdfDoc?.annotationStorage.setValue(id, value)
      if (draft!.ops.length)
        useEditStore.getState().pushOps(draft!.ops.map((op) => ({ ...op, group: undefined }) as EditOp))
      if (formCount) {
        useEditStore.getState().setFormDirty(true)
        useAppStore.setState({ docEpoch: useAppStore.getState().docEpoch + 1 })
      }
      notify(tr('已恢复 {0} 处未保存的修改', draft!.ops.length + formCount))
    },
    discard: () => void clearDraft(key),
  })
}
export interface RestoreOffer {
  count: number
  when: string
  restore: () => void
  discard: () => void
}
let restoreAsker: ((offer: RestoreOffer | null) => void) | null = null
export function setRestoreAsker(fn: typeof restoreAsker): void {
  restoreAsker = fn
}
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined,
    active = true
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const schedule = () => {
    cancel()
    if (!active || !usePreferences.getState().autosaveEnabled || !keyOf()) return
    const app = useAppStore.getState(),
      revision = useEditStore.getState().revision,
      key = keyOf(app)!
    revisions.set(key, revision)
    timer = setTimeout(() => {
      timer = undefined
      if (
        !active ||
        useAppStore.getState().docEpoch !== app.docEpoch ||
        useEditStore.getState().revision !== revision ||
        suppressed.get(key) === revision
      )
        return
      if (!useEditStore.getState().dirty && !pendingRestore.has(key)) void clearDraft(key)
      else void checkpointCurrentDraft()
    }, usePreferences.getState().autosaveIntervalMs)
  }
  const unsubscribeEdits = useEditStore.subscribe((state, previous) => {
    if (state.revision !== previous.revision) {
      if (state.dirty) {
        pendingRestore.delete(keyOf() ?? '')
        restoreAsker?.(null)
      }
      schedule()
    }
  })
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    if (state.docEpoch === previous.docEpoch) return
    cancel()
    restoreAsker?.(null)
    queueMicrotask(() => {
      if (active && useAppStore.getState().docEpoch === state.docEpoch) void offerRestore(() => active)
    })
  })
  const unsubscribePreferences = usePreferences.subscribe((state, previous) => {
    if (state.autosaveEnabled !== previous.autosaveEnabled || state.autosaveIntervalMs !== previous.autosaveIntervalMs)
      schedule()
  })
  const checkpoint = () => {
    if (active) void checkpointCurrentDraft()
  }
  const visibility = () => {
    if (document.visibilityState === 'hidden') checkpoint()
  }
  window.addEventListener('pagehide', checkpoint)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('blur', checkpoint)
  if (keyOf()) {
    void offerRestore(() => active)
    schedule()
  }
  return () => {
    active = false
    cancel()
    unsubscribeEdits()
    unsubscribeApp()
    unsubscribePreferences()
    window.removeEventListener('pagehide', checkpoint)
    window.removeEventListener('blur', checkpoint)
    document.removeEventListener('visibilitychange', visibility)
  }
}
