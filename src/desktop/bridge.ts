/** Typed access to the Electron preload bridge (undefined in the plain browser). */

export interface DesktopFilePayload {
  name: string
  path?: string
  data: Uint8Array
  fingerprint?: DiskFingerprint
}

/** Identity of the exact disk snapshot that was opened or successfully saved. */
export interface DiskFingerprint {
  sha256: string
  size: number
  mtimeMs: number
  ctimeMs: number
  dev: string
  ino: string
  mtimeNs?: string
  ctimeNs?: string
}

export type DiskCheck = {
  status: 'same' | 'changed' | 'missing' | 'unavailable'
  fingerprint?: DiskFingerprint
  message?: string
}

export type PdfWriteResult =
  | { ok: true; path: string; fingerprint: DiskFingerprint }
  | { ok: false; reason: 'cancelled' | 'conflict' | 'missing' | 'unavailable'; message?: string }

export interface RecentItem {
  name: string
  path: string
}

export interface PdfDesktop {
  isDesktop: true
  getLanguage?: () => Promise<'en' | 'zh-CN'>
  setLanguage?: (language: 'en' | 'zh-CN') => Promise<boolean>
  openExternal?: (url: string) => Promise<boolean>
  secrets?: {
    load: () => Promise<{ apiKey: string; endpoint: string; available: boolean; error?: string }>
    save: (value: { apiKey: string; endpoint: string }) => Promise<{ ok: boolean; message?: string }>
  }
  openDialog: () => Promise<DesktopFilePayload[] | null>
  getRecent: () => Promise<RecentItem[]>
  readFile: (path: string) => Promise<DesktopFilePayload>
  getPathForFile?: (file: File) => string
  saveAs: (name: string, data: Uint8Array) => Promise<string | null>
  /** write bytes to an existing path (save in place); returns the path */
  writeFile?: (path: string, data: Uint8Array) => Promise<string | null>
  checkFile?: (path: string, expected: DiskFingerprint) => Promise<DiskCheck>
  writePdf?: (path: string, data: Uint8Array, expected: DiskFingerprint) => Promise<PdfWriteResult>
  savePdfAs?: (
    name: string,
    data: Uint8Array,
    guard?: { path?: string; fingerprint?: DiskFingerprint; otherOpenPaths?: string[] },
  ) => Promise<PdfWriteResult>
  /** tell the main process whether there are unsaved edits (quit guard) */
  setDirty?: (dirty: boolean) => void
  /** main asks the renderer to resolve unsaved edits before closing */
  onCloseRequest?: (cb: () => void) => void
  /** print pre-rendered pages through the native print dialog */
  printPages?: (pages: { src: string; widthPt: number; heightPt: number }[], title: string) => Promise<boolean>
  /** renderer answers a close request: true = go ahead and close */
  closeResponse?: (ok: boolean) => void
  saveFile?: (name: string, data: Uint8Array, filterName: string, extensions: string[]) => Promise<string | null>
  setTitle: (title: string) => void
  onOpenFile: (cb: (f: DesktopFilePayload) => void) => void
  consumePendingOpen: () => Promise<DesktopFilePayload | null>
  onMenu: (cb: (id: string) => void) => void
  aiRequest?: (
    req: { id: string; url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string },
    onChunk: (chunk: string) => void,
  ) => Promise<{ ok: boolean; status: number; text?: string }>
  aiAbort?: (id: string) => void
  localAI?: {
    state: () => Promise<LocalAIState>
    download: (id: string) => Promise<boolean>
    cancel: (id: string) => Promise<void>
    remove: (id: string) => Promise<void>
    start: (id: string) => Promise<{ ok: boolean; error?: string }>
    stop: () => Promise<void>
    reveal: () => Promise<string>
    onState: (cb: (s: LocalAIState) => void) => () => void
  }
  share?: (name: string, data: Uint8Array) => Promise<boolean>
  ocrAvailable?: () => Promise<boolean>
  ocr?: (images: Uint8Array[]) => Promise<OcrPage[]>
}

export interface OcrPage {
  w: number
  h: number
  /** box normalised 0..1, origin top-left */
  lines: { text: string; conf: number; box: [number, number, number, number] }[]
  error?: string
}

export function getDesktop(): PdfDesktop | null {
  const d = (window as unknown as Record<string, unknown>).pdfDesktop as PdfDesktop | undefined
  return d && d.isDesktop ? d : null
}

export const isDesktop = (): boolean => getDesktop() !== null

export interface LocalModelInfo {
  id: string
  name: string
  desc: string
  size: number
  minRamGB: number
  recommended: boolean
  fits: boolean
  installed: boolean
  partial: number
  download: { done: number; total: number; bps: number; error: string; active: boolean } | null
}

export interface LocalAIState {
  /** llama-server is in the app bundle */
  engine: boolean
  ramGB: number
  modelDir: string
  server: {
    state: 'stopped' | 'starting' | 'ready' | 'stopping' | 'crashed'
    modelId: string
    pid: number | null
    port: number | null
    error: string
    logTail: string[]
  }
  models: LocalModelInfo[]
}

let openPathsProvider: () => string[] = () => []
export function registerOpenPathsProvider(provider: () => string[]): void {
  openPathsProvider = provider
}
export function otherDocumentPaths(): string[] {
  return openPathsProvider()
}
