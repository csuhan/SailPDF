import { create } from 'zustand'
import type { EditOp } from '../pdf/edit/ops'

interface EditState {
  ops: EditOp[]
  redoStack: EditOp[]
  dirty: boolean
  /** Changes even when an existing operation or form field is edited. */
  revision: number
  selectedOpId: string | null
  setSelectedOp: (id: string | null) => void
  pushOp: (op: EditOp) => void
  pushOps: (ops: EditOp[]) => void
  updateOp: (id: string, patch: Partial<EditOp>) => void
  removeOp: (id: string) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  formDirty: boolean
  setFormDirty: (v: boolean) => void
  reset: () => void
}

// Operations are immutable: unchanged image buffers and layout trees compare
// by identity, while a changed operation is compared with its saved contents.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i])
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a),
    bk = Object.keys(b)
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  )
}
let savedOps: readonly EditOp[] = []
const differsFromSaved = (ops: EditOp[]) => !sameValue(ops, savedOps)

export function captureEdits() {
  const { ops, redoStack, dirty, formDirty, selectedOpId } = useEditStore.getState()
  return { ops, redoStack, dirty, formDirty, selectedOpId, savedOps }
}
export function restoreEdits(snapshot: ReturnType<typeof captureEdits>): void {
  savedOps = snapshot.savedOps
  const { savedOps: _, ...state } = snapshot
  useEditStore.setState({ ...state, revision: useEditStore.getState().revision + 1 })
}

export const useEditStore = create<EditState>((set) => ({
  ops: [],
  redoStack: [],
  dirty: false,
  revision: 0,
  formDirty: false,
  selectedOpId: null,
  setSelectedOp: (id) => set({ selectedOpId: id }),
  setFormDirty: (v) => set((s) => ({ formDirty: v, dirty: v || differsFromSaved(s.ops), revision: s.revision + 1 })),
  pushOp: (op) =>
    set((s) => {
      const ops = [...s.ops, op]
      return { ops, redoStack: [], dirty: s.formDirty || differsFromSaved(ops), revision: s.revision + 1 }
    }),
  pushOps: (list) =>
    set((s) => {
      if (!list.length) return s
      const group = `g-${list[0].id}`
      const ops = [...s.ops, ...list.map((o) => ({ ...o, group }) as EditOp)]
      return { ops, redoStack: [], dirty: s.formDirty || differsFromSaved(ops), revision: s.revision + 1 }
    }),
  updateOp: (id, patch) =>
    set((s) => {
      if (!s.ops.some((o) => o.id === id)) return s
      const ops = s.ops.map((o) => (o.id === id ? ({ ...o, ...patch } as EditOp) : o))
      return { ops, redoStack: [], dirty: s.formDirty || differsFromSaved(ops), revision: s.revision + 1 }
    }),
  removeOp: (id) =>
    set((s) => {
      const ops = s.ops.filter((o) => o.id !== id)
      if (ops.length === s.ops.length) return s
      return {
        ops,
        dirty: s.formDirty || differsFromSaved(ops),
        selectedOpId: s.selectedOpId === id ? null : s.selectedOpId,
        revision: s.revision + 1,
      }
    }),
  undo: () =>
    set((s) => {
      if (!s.ops.length) return s
      const ops = s.ops.slice()
      const popped: EditOp[] = [ops.pop()!]
      const g = popped[0].group
      while (g && ops.length && ops[ops.length - 1].group === g) popped.push(ops.pop()!)
      return {
        ops,
        redoStack: [...s.redoStack, ...popped],
        dirty: s.formDirty || differsFromSaved(ops),
        revision: s.revision + 1,
      }
    }),
  redo: () =>
    set((s) => {
      if (!s.redoStack.length) return s
      const redoStack = s.redoStack.slice()
      const back: EditOp[] = [redoStack.pop()!]
      const g = back[0].group
      while (g && redoStack.length && redoStack[redoStack.length - 1].group === g) back.push(redoStack.pop()!)
      const ops = [...s.ops, ...back]
      return { ops, redoStack, dirty: s.formDirty || differsFromSaved(ops), revision: s.revision + 1 }
    }),
  markSaved: () =>
    set((s) => {
      savedOps = s.ops.slice()
      return { dirty: false, formDirty: false }
    }),
  reset: () =>
    set((s) => {
      savedOps = []
      return { ops: [], redoStack: [], dirty: false, formDirty: false, selectedOpId: null, revision: s.revision + 1 }
    }),
}))
