import { tr } from '../i18n/locale'
import { create } from 'zustand'
import type { AgentTurn, ReplyStyle } from './agent'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'

let activeRequest: AbortController | null = null

export function cancelAiRequest(reason = tr('已停止')): void {
  const ctrl = activeRequest
  if (!ctrl) return
  activeRequest = null
  ctrl.abort()
  useAiStore.setState((s) => ({
    busy: false,
    turns: s.turns.map((turn, i) =>
      i === s.turns.length - 1 && turn.role === 'assistant' ? { ...turn, error: reason } : turn,
    ),
  }))
}

export function beginAiRequest(): AbortController {
  cancelAiRequest()
  const ctrl = new AbortController()
  activeRequest = ctrl
  useAiStore.setState({ busy: true })
  return ctrl
}

export function isAiRequestCurrent(ctrl: AbortController): boolean {
  return activeRequest === ctrl && !ctrl.signal.aborted
}

export function finishAiRequest(ctrl: AbortController): void {
  if (activeRequest !== ctrl) return
  activeRequest = null
  useAiStore.setState({ busy: false })
}

interface AiState {
  open: boolean
  setOpen: (v: boolean) => void
  turns: AgentTurn[]
  setTurns: (fn: (t: AgentTurn[]) => AgentTurn[]) => void
  busy: boolean
  setBusy: (v: boolean) => void
  style: ReplyStyle
  setStyle: (s: ReplyStyle) => void
  /** text selected in the document, attached to the next question */
  selection: { text: string; page: number } | null
  setSelection: (s: AiState['selection']) => void
  /** a question queued from elsewhere (selection menu) */
  pending: { prompt: string; selection: AiState['selection'] } | null
  ask: (prompt: string, selection?: AiState['selection']) => void
  clearPending: () => void
}

export const useAiStore = create<AiState>((set) => ({
  open: false,
  setOpen: (v) => {
    if (!v) cancelAiRequest()
    set({ open: v })
  },
  turns: [],
  setTurns: (fn) => set((s) => ({ turns: fn(s.turns) })),
  busy: false,
  setBusy: (v) => set({ busy: v }),
  style: 'concise',
  setStyle: (s) => set({ style: s }),
  selection: null,
  setSelection: (s) => set({ selection: s }),
  pending: null,
  ask: (prompt, selection = null) => set({ open: true, pending: { prompt, selection } }),
  clearPending: () => set({ pending: null }),
}))

// The store outlives the panel, so hidden panels cannot retain a plan from
// another document or lose the cancellation handle for a running request.
const unsubscribeDocument = useAppStore.subscribe((state, prev) => {
  if (state.pdfDoc === prev.pdfDoc && state.docEpoch === prev.docEpoch) return
  cancelAiRequest(tr('文档已切换，已停止'))
  useAiStore.setState({ turns: [], busy: false, selection: null, pending: null })
})
const unsubscribeEdits = useEditStore.subscribe((state, prev) => {
  if (state.revision === prev.revision) return
  cancelAiRequest(tr('文档已发生变化，请重新提问'))
  useAiStore.setState((s) => ({
    turns: s.turns.map((turn) => (turn.planState === 'pending' ? { ...turn, planState: 'stale' } : turn)),
  }))
})

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribeDocument()
    unsubscribeEdits()
    cancelAiRequest()
  })
