import { create } from 'zustand'
import { useEditStore } from './editStore'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { openPdf, closePdf } from '../pdf/document'
import { clearBitmapCache } from '../pdf/bitmapCache'
import { clearTextCache } from '../pdf/search'
import type { EncryptionInfo, PreservedSecurity } from '../pdf/security/standardSecurity'
import type { DiskFingerprint } from '../desktop/bridge'
import { usePreferences } from './preferences'

export type FitMode = 'custom' | 'fit-width' | 'fit-page'
export type ViewMode = 'continuous' | 'single' | 'spread'
export type SidebarTab = 'none' | 'thumbs' | 'outline' | 'annots' | 'bookmarks' | 'changes'

export interface PageSize {
  /** CSS-px width at scale 1, view-rotation applied */
  width: number
  height: number
}

export interface AppState {
  // ── document ──────────────────────────────────────────────
  fileName: string | null
  /** filesystem path of the open document (desktop), null when unknown */
  filePath: string | null
  diskFingerprint: DiskFingerprint | null
  diskDetached: boolean
  externalFile: { status: 'changed' | 'missing' | 'unavailable'; message?: string } | null
  setExternalFile: (value: AppState['externalFile']) => void
  setDiskFingerprint: (value: DiskFingerprint | null) => void
  /**
   * where ⌘S writes. Null until the user picked a location with the save
   * dialog for this document (opening a file never implies overwriting it).
   */
  savePath: string | null
  setSavePath: (p: string | null) => void
  fileBytes: Uint8Array | null
  /**
   * the file on disk is password protected: `fileBytes` hold the decrypted
   * document; saving writes it with the same protection again unless the
   * security was changed (SecurityOp)
   */
  encryption: {
    info: EncryptionInfo
    preserved: PreservedSecurity
    /** unlocked with the permissions (owner) password */
    owner: boolean
    userPassword: string | null
  } | null
  setEncryption: (e: AppState['encryption']) => void
  pdfDoc: PDFDocumentProxy | null
  numPages: number
  /** per-page size cache (rotated view space, scale 1) */
  pageSizes: Map<number, PageSize>
  loading: boolean
  error: string | null
  setPageSize: (page: number, size: PageSize) => void
  openFile: (
    file: File | Uint8Array,
    name: string,
    path?: string | null,
    encryption?: AppState['encryption'],
    accept?: () => boolean,
    fingerprint?: DiskFingerprint | null,
    newTab?: boolean,
  ) => Promise<boolean>
  /** after "save as": the document now lives at a new path/name */
  setDocumentLocation: (name: string, path: string | null, bytes?: Uint8Array) => void
  closeFile: () => Promise<void>

  // ── view ──────────────────────────────────────────────────
  scale: number
  fitMode: FitMode
  viewMode: ViewMode
  /** extra rotation on top of the page's own rotation, in degrees */
  rotation: number
  /** 1-based current page (used for nav) */
  currentPage: number
  sidebar: SidebarTab
  fullscreen: boolean
  setScale: (scale: number, fit?: FitMode) => void
  setFitMode: (fit: FitMode) => void
  setViewMode: (mode: ViewMode) => void
  rotateView: (delta: number) => void
  setCurrentPage: (page: number) => void
  setSidebar: (tab: SidebarTab) => void
  setFullscreen: (v: boolean) => void
  /** bump to request the viewport to scroll to `currentPage` */
  navRequest: { page: number; seq: number } | null
  goToPage: (page: number) => void

  // ── search ────────────────────────────────────────────────
  searchOpen: boolean
  searchQuery: string
  searchVersion: number
  activeMatchGlobal: number
  /** page → number of matches on that page (filled by SearchPanel) */
  searchPageCounts: Map<number, number>
  searchTotal: number
  /** all matches, ordered by page then position */
  searchMatches: { index: number; page: number; indexOnPage: number }[]
  setSearchOpen: (v: boolean) => void
  setSearchQuery: (q: string) => void
  bumpSearchVersion: () => void
  setActiveMatchGlobal: (i: number) => void
  setSearchStats: (pageCounts: Map<number, number>, total: number) => void
  setSearchResults: (
    matches: { index: number; page: number; indexOnPage: number }[],
    pageCounts: Map<number, number>,
  ) => void

  // ── interaction helpers ───────────────────────────────────
  /** increments whenever a document is (re)opened; used to reset hooks */
  docEpoch: number
}

let navSeq = 0
let openSequence = 0
let lifecycle: {
  beforeNewTab: () => void | Promise<void>
  opened: (newTab: boolean) => void
  closed: () => void
  aborted: () => void
} = { beforeNewTab: () => {}, opened: (_newTab: boolean) => {}, closed: () => {}, aborted: () => {} }
export function setDocumentLifecycle(value: typeof lifecycle): void {
  lifecycle = value
}
export function invalidateDocumentOpen(): void {
  ++openSequence
  useAppStore.setState({ loading: false })
}

// ── last reading position per document (localStorage) ─────────
const POS_KEY = 'pdfpro.lastPositions'
function positionKey(name: string | null, path: string | null, size: number): string {
  return path ?? `${name}#${size}`
}
function lastPositions(): Record<string, { page: number; t: number }> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([, value]) =>
          value &&
          typeof value === 'object' &&
          Number.isInteger(value.page) &&
          value.page > 0 &&
          Number.isFinite(value.t),
      ),
    )
  } catch {
    return {}
  }
}
function rememberPosition(s: {
  pdfDoc: unknown
  fileName: string | null
  filePath: string | null
  fileBytes: Uint8Array | null
  currentPage: number
}) {
  if (!s.pdfDoc || !s.fileBytes) return
  try {
    const all = lastPositions()
    all[positionKey(s.fileName, s.filePath, s.fileBytes.length)] = { page: s.currentPage, t: Date.now() }
    // keep the 200 most recent documents
    const entries = Object.entries(all)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 200)
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* storage unavailable */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => rememberPosition(useAppStore.getState()))
}

export const useAppStore = create<AppState>((set, get) => ({
  fileName: null,
  filePath: null,
  diskFingerprint: null,
  diskDetached: false,
  externalFile: null,
  setExternalFile: (externalFile) => set({ externalFile }),
  setDiskFingerprint: (diskFingerprint) => set({ diskFingerprint }),
  savePath: null,
  setSavePath: (p) => set({ savePath: p }),
  fileBytes: null,
  encryption: null,
  setEncryption: (e) => set({ encryption: e }),
  pdfDoc: null,
  numPages: 0,
  pageSizes: new Map(),
  loading: false,
  error: null,

  setPageSize: (page, size) =>
    set((s) => {
      const m = new Map(s.pageSizes)
      m.set(page, size)
      return { pageSizes: m }
    }),

  setDocumentLocation: (name, path, bytes) =>
    set((s) => ({ fileName: name, filePath: path, fileBytes: bytes ?? s.fileBytes })),

  openFile: async (file, name, path = null, encryption = null, accept, fingerprint = null, newTab = false) => {
    const request = ++openSequence
    // Keep the current document and edits usable until the replacement loads.
    rememberPosition(get())
    set({ loading: true, error: null })
    try {
      const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file
      // give PDF.js its own copy; worker may neuter buffers
      if (request !== openSequence) return false
      const doc = await openPdf(
        bytes.slice(),
        () => request === openSequence && (!accept || accept()),
        newTab,
        () => {
          if (newTab) return lifecycle.beforeNewTab()
        },
      )
      if (!doc) {
        lifecycle.aborted()
        if (request === openSequence) set({ loading: false })
        return false
      }
      useEditStore.getState().reset()
      clearBitmapCache()
      clearTextCache()
      const preferences = usePreferences.getState()
      set((s) => ({
        fileName: name,
        filePath: path,
        diskFingerprint: fingerprint,
        diskDetached: false,
        externalFile: null,
        savePath: null,
        encryption,
        fileBytes: bytes,
        pdfDoc: doc,
        numPages: doc.numPages,
        pageSizes: new Map(),
        loading: false,
        currentPage: 1,
        scale: preferences.defaultScale,
        fitMode: preferences.defaultFitMode,
        viewMode: preferences.defaultViewMode,
        rotation: 0,
        activeMatchGlobal: 0,
        searchPageCounts: new Map(),
        searchTotal: 0,
        searchQuery: '',
        searchMatches: [],
        docEpoch: s.docEpoch + 1,
      }))
      lifecycle.opened(newTab)
      // reopen where the reader left off (Acrobat "restore last view")
      const last = preferences.restorePosition ? lastPositions()[positionKey(name, path, bytes.length)] : null
      if (last && last.page > 1 && last.page <= doc.numPages) {
        setTimeout(() => {
          if (request === openSequence) get().goToPage(last.page)
        }, 60)
      }
      return true
    } catch (e) {
      lifecycle.aborted()
      if (request === openSequence) set({ loading: false, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  closeFile: async () => {
    ++openSequence
    rememberPosition(get())
    const closing = closePdf()
    useEditStore.getState().reset()
    clearBitmapCache()
    clearTextCache()
    set((s) => ({
      fileName: null,
      filePath: null,
      diskFingerprint: null,
      diskDetached: false,
      externalFile: null,
      savePath: null,
      encryption: null,
      fileBytes: null,
      pdfDoc: null,
      numPages: 0,
      loading: false,
      error: null,
      pageSizes: new Map(),
      currentPage: 1,
      searchOpen: false,
      searchQuery: '',
      searchTotal: 0,
      searchMatches: [],
      searchPageCounts: new Map(),
      docEpoch: s.docEpoch + 1,
    }))
    lifecycle.closed()
    await closing
  },

  // ── view ──
  scale: 1,
  fitMode: 'fit-width',
  viewMode: 'continuous',
  rotation: 0,
  currentPage: 1,
  sidebar: 'thumbs',
  fullscreen: false,

  setScale: (scale, fit) => set({ scale: Math.min(8, Math.max(0.1, scale)), fitMode: fit ?? 'custom' }),
  setFitMode: (fit) => set({ fitMode: fit }),
  setViewMode: (mode) => set({ viewMode: mode }),
  rotateView: (delta) =>
    set((s) => {
      let r = (s.rotation + delta) % 360
      if (r < 0) r += 360
      return { rotation: r, fitMode: s.fitMode === 'custom' ? 'custom' : s.fitMode }
    }),
  setCurrentPage: (page) => {
    const { numPages } = get()
    const p = Math.max(1, Math.min(numPages || 1, page))
    if (p !== get().currentPage) set({ currentPage: p })
  },
  setSidebar: (tab) => set({ sidebar: tab }),
  setFullscreen: (v) => set({ fullscreen: v }),

  navRequest: null,
  goToPage: (page) => {
    const { numPages } = get()
    const p = Math.max(1, Math.min(numPages || 1, Math.round(page)))
    navSeq++
    set({ currentPage: p, navRequest: { page: p, seq: navSeq } })
  },

  // ── search ──
  searchOpen: false,
  searchQuery: '',
  searchVersion: 0,
  activeMatchGlobal: 0,
  searchPageCounts: new Map(),
  searchTotal: 0,
  searchMatches: [],
  setSearchOpen: (v) => set({ searchOpen: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  bumpSearchVersion: () => set((s) => ({ searchVersion: s.searchVersion + 1 })),
  setActiveMatchGlobal: (i) => set({ activeMatchGlobal: i }),
  setSearchStats: (pageCounts, total) => set({ searchPageCounts: pageCounts, searchTotal: total }),
  setSearchResults: (matches, pageCounts) =>
    set({ searchMatches: matches, searchPageCounts: pageCounts, searchTotal: matches.length }),

  docEpoch: 0,
}))
