import { create } from 'zustand'
import type { MarkupKind, ShapeKind, StandardFontName } from '../pdf/edit/ops'

export type ToolId =
  | 'select'
  | 'hand'
  | 'edit-text'
  | 'add-text'
  | 'add-image'
  | 'draw'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'shape'
  | 'redact'
  | 'organize'
  | 'note'
  | 'signature'
  | 'stamp'
  | 'link'

/** work modes: what the user is doing; each owns a set of tools */
export type AppMode = 'read' | 'edit' | 'annotate' | 'pages' | 'tools'

export const MODE_TOOLS: Record<AppMode, ToolId[]> = {
  read: ['select'],
  edit: ['edit-text', 'add-text', 'add-image', 'signature', 'link', 'select'],
  annotate: ['note', 'highlight', 'underline', 'strikeout', 'draw', 'shape', 'stamp', 'redact', 'select'],
  pages: ['organize'],
  tools: ['select'],
}

/** mode a tool belongs to; null for tools usable in any mode (select / hand) */
function modeOfTool(t: ToolId): AppMode | null {
  if (t === 'select' || t === 'hand') return null
  for (const m of Object.keys(MODE_TOOLS) as AppMode[]) {
    if (MODE_TOOLS[m].includes(t)) return m
  }
  return null
}

export interface TextStyle {
  fontName: StandardFontName
  fontSize: number
  color: string
}

export interface DrawStyle {
  color: string
  thickness: number
  opacity: number
}

interface ToolState {
  activeTool: ToolId
  mode: AppMode
  /** last tool used per mode (restored when switching back) */
  lastTool: Record<AppMode, ToolId>
  textStyle: TextStyle
  drawStyle: DrawStyle
  shapeKind: ShapeKind
  shapeFill: boolean
  markupColors: Record<MarkupKind, string>
  noteColor: string
  /** stamp placed by the stamp tool (StampDef id) */
  stampId: string
  setStampId: (id: string) => void
  /** app-level "create PDF from images" dialog (also reachable from home) */
  createPdfOpen: boolean
  setCreatePdfOpen: (v: boolean) => void
  /** bump to ask the UI to (re)create the signature */
  signatureRequest: number
  requestSignature: () => void
  setNoteColor: (c: string) => void
  /** set when 'shape' tool is active */
  setTool: (t: ToolId) => void
  setMode: (m: AppMode) => void
  setTextStyle: (p: Partial<TextStyle>) => void
  setDrawStyle: (p: Partial<DrawStyle>) => void
  setShapeKind: (k: ShapeKind) => void
  setShapeFill: (f: boolean) => void
  setMarkupColor: (kind: MarkupKind, color: string) => void
}

/**
 * guard installed by the app (document permissions): false blocks entering a
 * mode / tool. Kept as a hook-in so this store has no document dependency.
 */
let modeGuard: ((m: AppMode) => boolean) | null = null
export function setModeGuard(fn: ((m: AppMode) => boolean) | null): void {
  modeGuard = fn
}

export const useToolStore = create<ToolState>((set, get) => ({
  activeTool: 'select',
  mode: 'read',
  lastTool: { read: 'select', edit: 'edit-text', annotate: 'note', pages: 'organize', tools: 'select' },
  textStyle: { fontName: 'Helvetica', fontSize: 14, color: '#111111' },
  drawStyle: { color: '#d32f2f', thickness: 2.4, opacity: 1 },
  shapeKind: 'rect',
  shapeFill: false,
  markupColors: { highlight: '#ffeb3b', underline: '#1e88e5', strikeout: '#e53935' },
  noteColor: '#f5b400',
  stampId: 'approved',
  setStampId: (id) => set({ stampId: id }),
  createPdfOpen: false,
  setCreatePdfOpen: (v) => set({ createPdfOpen: v }),
  signatureRequest: 0,
  requestSignature: () => set((s) => ({ signatureRequest: s.signatureRequest + 1 })),
  setNoteColor: (c) => set({ noteColor: c }),
  setTool: (t) => {
    const s = get()
    let mode = modeOfTool(t) ?? s.mode
    if (modeGuard && !modeGuard(mode)) return
    // leaving the page organizer / tools hub through "select" returns to reading
    if ((mode === 'pages' && t !== 'organize') || mode === 'tools') mode = 'read'
    set({ activeTool: t, mode, lastTool: { ...s.lastTool, [mode]: t } })
  },
  setMode: (m) => {
    if (modeGuard && !modeGuard(m)) return
    const s = get()
    set({ mode: m, activeTool: s.lastTool[m] ?? MODE_TOOLS[m][0] })
  },
  setTextStyle: (p) => set((s) => ({ textStyle: { ...s.textStyle, ...p } })),
  setDrawStyle: (p) => set((s) => ({ drawStyle: { ...s.drawStyle, ...p } })),
  setShapeKind: (k) => set({ shapeKind: k }),
  setShapeFill: (f) => set({ shapeFill: f }),
  setMarkupColor: (kind, color) => set((s) => ({ markupColors: { ...s.markupColors, [kind]: color } })),
}))
