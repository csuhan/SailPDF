const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('pdfDesktop', {
  isDesktop: true,
  getLanguage: () => ipcRenderer.invoke('pdfpro:get-language'),
  setLanguage: (language) => ipcRenderer.invoke('pdfpro:set-language', language),
  /** Electron 32+ removed File.path; resolve native drag/drop files here. */
  getPathForFile: (file) => {
    const p = webUtils.getPathForFile(file)
    if (p) ipcRenderer.send('pdfpro:authorize-dropped-file', p)
    return p
  },
  openExternal: (url) => ipcRenderer.invoke('pdfpro:open-external', url),
  secrets: {
    load: () => ipcRenderer.invoke('pdfpro:secret-load'),
    save: (value) => ipcRenderer.invoke('pdfpro:secret-save', value),
  },
  /** show native open dialog; returns [{name,path,data}] | null */
  openDialog: () => ipcRenderer.invoke('pdfpro:open-dialog'),
  /** recent files [{name,path}] */
  getRecent: () => ipcRenderer.invoke('pdfpro:get-recent'),
  /** open a path (recent file); returns {name,path,data} */
  readFile: (p) => ipcRenderer.invoke('pdfpro:read-file', p),
  /** compare a stable disk snapshot to the version opened by the renderer */
  checkFile: (path, expected) => ipcRenderer.invoke('pdfpro:check-file', { path, expected }),
  /** guarded PDF save; structured result keeps conflicts distinct from I/O failures */
  writePdf: (path, data, expected) => ipcRenderer.invoke('pdfpro:write-pdf', { path, data, expected }),
  savePdfAs: (name, data, guard) => ipcRenderer.invoke('pdfpro:save-pdf-as', { name, data, guard }),
  /** native save-as dialog; returns saved path | null */
  saveAs: (name, data) => ipcRenderer.invoke('pdfpro:save-as', { name, data }),
  /** native save dialog for any file; returns saved path | null */
  saveFile: (name, data, filterName, extensions) =>
    ipcRenderer.invoke('pdfpro:save-file', { name, data, filterName, extensions }),
  setTitle: (t) => ipcRenderer.send('pdfpro:window-title', t),
  /** save in place; returns the path */
  writeFile: (path, data) => ipcRenderer.invoke('pdfpro:write-file', { path, data }),
  setDirty: (dirty) => ipcRenderer.send('pdfpro:set-dirty', !!dirty),
  onCloseRequest: (cb) => {
    ipcRenderer.on('pdfpro:close-request', () => cb())
  },
  closeResponse: (ok) => ipcRenderer.send('pdfpro:close-response', !!ok),
  printPages: (pages, title) => ipcRenderer.invoke('pdfpro:print-pages', { pages, title }),
  /** main sends {name,path,data} when a file is opened from Finder */
  onOpenFile: (cb) => {
    ipcRenderer.on('pdfpro:open-file', (_e, f) => cb(f))
  },
  /** pull a buffered open (handles cold-start race with renderer mount) */
  consumePendingOpen: () => ipcRenderer.invoke('pdfpro:consume-pending-open'),
  /** AI request through the main process; onChunk receives raw stream text */
  aiRequest: (req, onChunk) => {
    const listener = (_e, m) => {
      if (m.id === req.id) onChunk(m.chunk)
    }
    ipcRenderer.on('pdfpro:ai-chunk', listener)
    return ipcRenderer
      .invoke('pdfpro:ai-request', req)
      .finally(() => ipcRenderer.removeListener('pdfpro:ai-chunk', listener))
  },
  aiAbort: (id) => ipcRenderer.send('pdfpro:ai-abort', id),
  /** bundled local model: catalog / download / server status */
  localAI: {
    state: () => ipcRenderer.invoke('pdfpro:local-ai-state'),
    download: (id) => ipcRenderer.invoke('pdfpro:local-ai-download', id),
    cancel: (id) => ipcRenderer.invoke('pdfpro:local-ai-cancel', id),
    remove: (id) => ipcRenderer.invoke('pdfpro:local-ai-remove', id),
    start: (id) => ipcRenderer.invoke('pdfpro:local-ai-start', id),
    stop: () => ipcRenderer.invoke('pdfpro:local-ai-stop'),
    reveal: () => ipcRenderer.invoke('pdfpro:local-ai-reveal'),
    onState: (cb) => {
      const l = (_e, st) => cb(st)
      ipcRenderer.on('pdfpro:local-ai-state', l)
      return () => ipcRenderer.removeListener('pdfpro:local-ai-state', l)
    },
  },
  share: (name, data) => ipcRenderer.invoke('pdfpro:share', { name, data }),
  /** on-device OCR (macOS Vision): PNG bytes per page -> recognised lines */
  ocrAvailable: () => ipcRenderer.invoke('pdfpro:ocr-available'),
  ocr: (images) => ipcRenderer.invoke('pdfpro:ocr', { images }),
  /** main menu actions */
  onMenu: (cb) => {
    ipcRenderer.on('pdfpro:menu', (_e, id) => cb(id))
  },
})
