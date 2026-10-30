import { tr } from '../i18n/locale'
import { registerOpenPathsProvider } from '../desktop/bridge'
import { checkpointCurrentDraft, checkpointBeforeSwitch } from '../utils/autosave'
import { create } from 'zustand'
import { useAppStore, setDocumentLifecycle, invalidateDocumentOpen, type AppState } from './stores'
import { captureEdits, restoreEdits, useEditStore } from './editStore'
import { useToolStore } from './toolStore'
import { useAiStore, cancelAiRequest } from '../ai/aiStore'
import { activatePdf } from '../pdf/document'
import { clearImagePreviews } from '../pdf/edit/imagePreview'
import { clearBitmapCache } from '../pdf/bitmapCache'
import { clearTextCache } from '../pdf/search'
import { clearPageRegistry } from '../pdf/registry'
import { commitPendingEdits } from '../utils/save'

interface Tab {
  id: string
  name: string
  path: string | null
  dirty: boolean
}
interface Snapshot {
  app: Partial<AppState>
  edits: ReturnType<typeof captureEdits>
  tools: ReturnType<typeof useToolStore.getState>
  ai: ReturnType<typeof useAiStore.getState>
}
const snapshots = new Map<string, Snapshot>()
let transition = false
let sequence = 0
export const useTabStore = create<{ tabs: Tab[]; activeId: string | null }>(() => ({ tabs: [], activeId: null }))

function stash(): void {
  const id = useTabStore.getState().activeId
  if (!id || !useAppStore.getState().pdfDoc) return
  commitPendingEdits()
  void checkpointCurrentDraft()
  cancelAiRequest(tr('已切换文档，已停止'))
  const app = Object.fromEntries(
    Object.entries(useAppStore.getState()).filter(
      ([key, value]) => typeof value !== 'function' && !['docEpoch', 'loading', 'error', 'navRequest'].includes(key),
    ),
  ) as Partial<AppState>
  snapshots.set(id, { app, edits: captureEdits(), tools: useToolStore.getState(), ai: useAiStore.getState() })
}

export function activateTab(id: string): void {
  if (id === useTabStore.getState().activeId) return
  const saved = snapshots.get(id)
  if (!saved?.app.pdfDoc) return
  stash()
  transition = true
  invalidateDocumentOpen()
  activatePdf(saved.app.pdfDoc)
  clearBitmapCache()
  clearTextCache()
  clearPageRegistry()
  clearImagePreviews()
  useTabStore.setState({ activeId: id })
  useAppStore.setState({
    ...saved.app,
    loading: false,
    error: null,
    searchTotal: 0,
    searchMatches: [],
    searchPageCounts: new Map(),
    docEpoch: useAppStore.getState().docEpoch + 1,
  })
  restoreEdits(saved.edits)
  const { mode, activeTool, lastTool, textStyle, drawStyle, shapeKind, shapeFill, markupColors, noteColor, stampId } =
    saved.tools
  useToolStore.setState({
    mode,
    activeTool,
    lastTool,
    textStyle,
    drawStyle,
    shapeKind,
    shapeFill,
    markupColors,
    noteColor,
    stampId,
  })
  useAiStore.setState({
    open: saved.ai.open,
    busy: false,
    pending: null,
    selection: null,
    turns: saved.ai.turns.map((turn) => (turn.planState === 'pending' ? { ...turn, planState: 'stale' } : turn)),
  })
  useAppStore.getState().goToPage(saved.app.currentPage ?? 1)
  transition = false
}

export function findTabByPath(path: string): string | undefined {
  return useTabStore.getState().tabs.find((tab) => tab.path === path)?.id
}
export function otherOpenPaths(): string[] {
  const { tabs, activeId } = useTabStore.getState()
  return tabs.filter((tab) => tab.id !== activeId && tab.path).map((tab) => tab.path!)
}
export function hasAnyDirtyTab(): boolean {
  return (
    useEditStore.getState().dirty ||
    useTabStore.getState().tabs.some((tab) => tab.id !== useTabStore.getState().activeId && tab.dirty)
  )
}

setDocumentLifecycle({
  beforeNewTab: async () => {
    if (!(await checkpointBeforeSwitch())) throw new Error(tr('恢复草稿未能保存，请先手动保存当前 PDF'))
    stash()
    transition = true
  },
  opened: (newTab) => {
    const app = useAppStore.getState()
    const id = newTab || !useTabStore.getState().activeId ? `document-${++sequence}` : useTabStore.getState().activeId!
    const tab = { id, name: app.fileName ?? tr('文档.pdf'), path: app.filePath, dirty: useEditStore.getState().dirty }
    useTabStore.setState((state) => ({
      activeId: id,
      tabs: state.tabs.some((t) => t.id === id) ? state.tabs.map((t) => (t.id === id ? tab : t)) : [...state.tabs, tab],
    }))
    snapshots.delete(id)
    transition = false
  },
  aborted: () => {
    transition = false
  },
  closed: () => {
    const id = useTabStore.getState().activeId
    if (id) snapshots.delete(id)
    useTabStore.setState((state) => ({ activeId: null, tabs: state.tabs.filter((tab) => tab.id !== id) }))
  },
})
useEditStore.subscribe((state) => {
  if (transition) return
  const { activeId, tabs } = useTabStore.getState()
  if (tabs.find((tab) => tab.id === activeId)?.dirty !== state.dirty)
    useTabStore.setState({ tabs: tabs.map((tab) => (tab.id === activeId ? { ...tab, dirty: state.dirty } : tab)) })
})
useAppStore.subscribe((state, old) => {
  if (transition || !state.pdfDoc || (state.fileName === old.fileName && state.filePath === old.filePath)) return
  const { activeId, tabs } = useTabStore.getState()
  useTabStore.setState({
    tabs: tabs.map((tab) => (tab.id === activeId ? { ...tab, name: state.fileName!, path: state.filePath } : tab)),
  })
})

registerOpenPathsProvider(otherOpenPaths)

let switchRequest = 0
/** User-facing switches wait for the outgoing recovery snapshot to commit. */
export async function switchDocumentTab(id: string): Promise<void> {
  const request = ++switchRequest,
    original = useTabStore.getState().activeId
  commitPendingEdits()
  if (!(await checkpointBeforeSwitch())) return
  if (request === switchRequest && useTabStore.getState().activeId === original) activateTab(id)
}
