const { tr } = require('./locale.cjs')
// Sail PDF — Electron main process
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell, safeStorage } = require('electron')
const { createDiskFiles, cleanPath, failure: diskFailure } = require('./disk-files.cjs')

const security = require('./security.cjs')
const { SecretStore } = require('./secret-store.cjs')
const INDEX_FILE = path.join(__dirname, '../dist/index.html')
const diskFiles = createDiskFiles()
const knownDiskVersions = new Map()

const isDev = !!process.env.PDFPRO_DEV_URL
let mainWindow = null
let rendererReady = false
function assertRequest(event, channel, args) {
  if (
    !security.trustedSender(event, mainWindow, INDEX_FILE, process.env.PDFPRO_DEV_URL) ||
    !security.validRequest(channel, args)
  )
    throw new Error(tr('已拒绝不受信任或无效的应用请求'))
}
const handle = (channel, fn) =>
  ipcMain.handle(channel, (event, ...args) => {
    assertRequest(event, channel, args)
    return fn(event, ...args)
  })
const listen = (channel, fn) =>
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertRequest(event, channel, args)
      fn(event, ...args)
    } catch {
      /* Do not log arguments: they may contain credentials or document data. */
    }
  })

// app identity: when launched through the plain `electron` binary (npm run
// app) macOS would otherwise show "Electron" in the menu bar / Dock / About
const APP_NAME = 'Sail PDF'
app.setName(APP_NAME)
// keep using the existing data folder (recent files, local storage);
// PDFPRO_USER_DATA (tests) gives a separate profile + single-instance lock
app.setPath('userData', process.env.PDFPRO_USER_DATA || path.join(app.getPath('appData'), 'pdf-pro'))
const nativeLocale = require('./locale.cjs')
const languageFile = path.join(app.getPath('userData'), 'ui-language.json')
try {
  nativeLocale.setLanguage(JSON.parse(fs.readFileSync(languageFile, 'utf8')).language)
} catch {
  /* New profiles default to English. */
}
handle('pdfpro:get-language', () => nativeLocale.getLanguage())
let languageWrites = Promise.resolve()
handle('pdfpro:set-language', async (_event, language) => {
  nativeLocale.setLanguage(language)
  buildMenu()
  languageWrites = languageWrites
    .then(async () => {
      await fsp.mkdir(path.dirname(languageFile), { recursive: true })
      await fsp.writeFile(languageFile, JSON.stringify({ language }))
    })
    .catch(() => {})
  await languageWrites
  return true
})
const secretStore = new SecretStore({ directory: path.join(app.getPath('userData'), 'secure-settings'), safeStorage })
handle('pdfpro:secret-load', () => secretStore.load())
handle('pdfpro:secret-save', (_event, value) => secretStore.save(value))
async function openExternal(raw) {
  const url = security.externalUrl(raw)
  if (!url) return false
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
handle('pdfpro:open-external', (_event, url) => openExternal(url))
const authorizedPaths = new Set()
listen('pdfpro:authorize-dropped-file', (_event, p) => authorizedPaths.add(cleanPath(p)))
function authorizedRead(p) {
  const target = cleanPath(p)
  return authorizedPaths.has(target) || knownDiskVersions.has(target) || recent.includes(target)
}
const ICON_PNG = path.join(__dirname, '../build/icon.png')
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: require('../package.json').version,
  copyright: '© Sail PDF',
  iconPath: fs.existsSync(ICON_PNG) ? ICON_PNG : undefined,
})

if (process.env.PDFPRO_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.PDFPRO_DEBUG_PORT)
}

// ── recent files (persisted to userData as JSON) ─────────────
const recentFile = () => path.join(app.getPath('userData'), 'recent.json')
let recent = []
try {
  recent = JSON.parse(fs.readFileSync(recentFile(), 'utf8'))
  if (!Array.isArray(recent)) recent = []
} catch {
  recent = []
}
function addRecent(p) {
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, 12)
  try {
    fs.writeFileSync(recentFile(), JSON.stringify(recent))
  } catch {
    /* ignore */
  }
  app.addRecentDocument(p)
  buildMenu()
}

const isPdfPath = (p) => typeof p === 'string' && /\.pdf$/i.test(p) && fs.existsSync(p.replace(/^file:\/\//, ''))

// macOS: launched by double-clicking a PDF / second instance with args
function handleArgv(argv) {
  for (const p of argv.filter(isPdfPath)) void openPathInApp(p)
}
app.on('open-file', (e, p) => {
  e.preventDefault()
  openPathInApp(p)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    handleArgv(argv)
  })

  app.whenReady().then(() => {
    // Dock icon for unpackaged runs (packaged builds use the bundle's .icns)
    if (process.platform === 'darwin' && !app.isPackaged && fs.existsSync(ICON_PNG)) {
      app.dock?.setIcon(ICON_PNG)
    }
    const fontsAllowed = (wc, permission) =>
      ['local-fonts', 'clipboard-sanitized-write'].includes(permission) &&
      wc === mainWindow?.webContents &&
      security.trustedUrl(wc.getURL(), INDEX_FILE, process.env.PDFPRO_DEV_URL)
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details = {}) =>
      callback(
        fontsAllowed(wc, permission) &&
          details.isMainFrame !== false &&
          security.trustedUrl(details.requestingUrl || wc.getURL(), INDEX_FILE, process.env.PDFPRO_DEV_URL),
      ),
    )
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission, _origin, details = {}) => fontsAllowed(wc, permission) && details.isMainFrame !== false,
    )

    createWindow()
    buildMenu()
    handleArgv(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1020,
    minHeight: 640,
    title: 'Sail PDF',
    backgroundColor: '#f6f6f4',
    trafficLightPosition: { x: 16, y: 18 },
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
  })
  rendererReady = false
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (isDev) {
    mainWindow.loadURL(process.env.PDFPRO_DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url)
    return { action: 'deny' }
  })
  const preventNavigation = (event, url) => {
    if (!security.trustedUrl(typeof url === 'string' ? url : url.url, INDEX_FILE, process.env.PDFPRO_DEV_URL))
      event.preventDefault()
  }
  mainWindow.webContents.on('will-navigate', preventNavigation)
  mainWindow.webContents.on('will-frame-navigate', preventNavigation)
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.on('did-finish-load', () => {
    // no-op: renderer consumes pending opens via pdfpro:consume-pending-open
  })
  // unsaved-edits guard: the renderer reports dirty state; while dirty a
  // close (window button, ⌘W, ⌘Q) is turned into a request the renderer
  // answers after asking the user (save / don't save / cancel)
  mainWindow.on('close', (e) => {
    if (!docDirty || allowClose) return
    e.preventDefault()
    mainWindow.webContents.send('pdfpro:close-request')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    allowClose = false
  })
}

let docDirty = false
let allowClose = false
let quitting = false

listen('pdfpro:set-dirty', (_e, dirty) => {
  docDirty = !!dirty
  // macOS: the dot in the window's close button
  mainWindow?.setDocumentEdited(docDirty)
})

listen('pdfpro:close-response', (_e, ok) => {
  if (!ok) {
    quitting = false
    return
  }
  allowClose = true
  if (quitting) app.quit()
  else mainWindow?.close()
})

app.on('before-quit', () => {
  quitting = true
})

async function readFilePayload(p) {
  const snapshot = await diskFiles.snapshot(p, true)
  knownDiskVersions.set(snapshot.path, snapshot.fingerprint)
  return { name: path.basename(snapshot.path), ...snapshot }
}

const pendingOpenPayloads = []

async function openPathInApp(p) {
  addRecent(p)
  try {
    const payload = await readFilePayload(p)
    if (mainWindow && rendererReady) mainWindow.webContents.send('pdfpro:open-file', payload)
    else pendingOpenPayloads.push(payload)
  } catch (e) {
    dialog.showErrorBox(tr('无法打开文件'), String(e))
  }
}

// The renderer drains the queue after installing its event listener. During
// startup, every Finder event is retained, including files arriving mid-drain.
handle('pdfpro:consume-pending-open', () => {
  const payload = pendingOpenPayloads.shift() ?? null
  if (!payload) rendererReady = true
  return payload
})

function menuAction(id) {
  mainWindow?.webContents.send('pdfpro:menu', id)
}

function recentSubmenu() {
  if (recent.length === 0) return [{ label: tr('（空）'), enabled: false }]
  return recent.map((p) => ({
    label: path.basename(p),
    sublabel: p,
    click: () => openPathInApp(p),
  }))
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about', label: tr('关于 {0}', APP_NAME) },
              { label: tr('设置…'), accelerator: 'CmdOrCtrl+,', click: () => menuAction('settings') },
              { type: 'separator' },
              { role: 'hide', label: tr('隐藏 {0}', APP_NAME) },
              { role: 'hideOthers', label: tr('隐藏其他') },
              { type: 'separator' },
              { role: 'quit', label: tr('退出 {0}', APP_NAME) },
            ],
          },
        ]
      : []),
    {
      label: tr('文件'),
      submenu: [
        { label: tr('打开…'), accelerator: 'CmdOrCtrl+O', click: () => menuAction('open') },
        { label: tr('最近打开'), submenu: recentSubmenu() },
        { type: 'separator' },
        { label: tr('保存'), accelerator: 'CmdOrCtrl+S', click: () => menuAction('save') },
        { label: tr('另存为…'), accelerator: 'CmdOrCtrl+Shift+S', click: () => menuAction('save-as') },
        { label: tr('关闭文档'), accelerator: 'CmdOrCtrl+W', click: () => menuAction('close-doc') },
        { label: tr('打印…'), accelerator: 'CmdOrCtrl+P', click: () => menuAction('print') },
        ...(process.platform === 'darwin'
          ? []
          : [{ label: tr('设置…'), accelerator: 'CmdOrCtrl+,', click: () => menuAction('settings') }]),
        { type: 'separator' },
        ...(process.platform === 'darwin' ? [] : [{ role: 'quit', label: tr('退出') }]),
      ],
    },
    {
      label: tr('编辑'),
      submenu: [
        { label: tr('撤销'), accelerator: 'CmdOrCtrl+Z', click: () => menuAction('undo') },
        { label: tr('重做'), accelerator: 'CmdOrCtrl+Shift+Z', click: () => menuAction('redo') },
        { type: 'separator' },
        { role: 'cut', label: tr('剪切') },
        { role: 'copy', label: tr('拷贝') },
        { role: 'paste', label: tr('粘贴') },
        { role: 'selectAll', label: tr('全选') },
        { type: 'separator' },
        { label: tr('查找…'), accelerator: 'CmdOrCtrl+F', click: () => menuAction('find') },
      ],
    },
    {
      label: tr('视图'),
      submenu: [
        { label: tr('放大'), accelerator: 'CmdOrCtrl+=', click: () => menuAction('zoom-in') },
        { label: tr('缩小'), accelerator: 'CmdOrCtrl+-', click: () => menuAction('zoom-out') },
        { label: tr('实际大小'), accelerator: 'CmdOrCtrl+0', click: () => menuAction('actual-size') },
        { label: tr('适合宽度'), accelerator: 'CmdOrCtrl+9', click: () => menuAction('fit-width') },
        { label: tr('适合页面'), accelerator: 'CmdOrCtrl+8', click: () => menuAction('fit-page') },
        { type: 'separator' },
        { label: tr('顺时针旋转'), accelerator: 'R', click: () => menuAction('rotate-cw') },
        { label: tr('逆时针旋转'), accelerator: 'Shift+R', click: () => menuAction('rotate-ccw') },
        { type: 'separator' },
        { label: tr('上一页'), accelerator: 'CmdOrCtrl+Up', click: () => menuAction('prev-page') },
        { label: tr('下一页'), accelerator: 'CmdOrCtrl+Down', click: () => menuAction('next-page') },
        { label: tr('第一页'), accelerator: 'CmdOrCtrl+Home', click: () => menuAction('first-page') },
        { label: tr('最后一页'), accelerator: 'CmdOrCtrl+End', click: () => menuAction('last-page') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: tr('进入全屏') },
        { role: 'toggleDevTools', label: tr('开发者工具'), ...(isDev ? {} : { visible: false }) },
      ],
    },
    {
      label: tr('窗口'),
      submenu: [
        { role: 'minimize', label: tr('最小化') },
        { role: 'zoom', label: tr('缩放') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── IPC ───────────────────────────────────────────────────────

handle('pdfpro:open-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: tr('打开 PDF'),
    filters: [{ name: tr('PDF 文档'), extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (r.canceled || r.filePaths.length === 0) return null
  const files = []
  for (const p of r.filePaths) {
    try {
      files.push(await readFilePayload(p))
      addRecent(p)
    } catch {
      /* skip */
    }
  }
  return files.length ? files : null
})

handle('pdfpro:get-recent', () =>
  recent.filter((p) => fs.existsSync(p)).map((p) => ({ name: path.basename(p), path: p })),
)

handle('pdfpro:read-file', async (_e, p) => {
  if (!authorizedRead(p)) throw new Error(tr('请通过打开对话框或拖放选择这份 PDF'))
  if (!isPdfPath(p)) throw new Error('not a pdf or missing')
  const payload = await readFilePayload(p)
  addRecent(p)
  return payload
})

handle('pdfpro:open-recent', async (_e, p) => {
  if (!authorizedRead(p)) throw new Error(tr('未授权的文件'))
  return openPathInApp(p)
})

async function savePdfAs(name, data, guard) {
  try {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: tr('保存 PDF'),
      defaultPath: name,
      filters: [{ name: tr('PDF 文档'), extensions: ['pdf'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, reason: 'cancelled', message: tr('已取消保存') }
    const target = cleanPath(r.filePath)
    if (guard?.otherOpenPaths?.some((p) => cleanPath(p) === target))
      return { ok: false, reason: 'unavailable', message: tr('该文件已在其他标签页打开，请选择其他保存位置') }
    if (guard?.path && cleanPath(guard.path) === target && !guard.fingerprint?.sha256) {
      return { ok: false, reason: 'unavailable', message: tr('缺少文件的磁盘版本，请选择新的保存位置') }
    }
    const expected = guard?.path && cleanPath(guard.path) === target ? guard.fingerprint : knownDiskVersions.get(target)
    const result = await diskFiles.writeGuarded(target, data, expected)
    if (result.ok) {
      knownDiskVersions.set(result.path, result.fingerprint)
      addRecent(result.path)
    }
    return result
  } catch (error) {
    return diskFailure(error)
  }
}

async function writePdf(p, data, expected) {
  if (!knownDiskVersions.has(cleanPath(p)))
    return { ok: false, reason: 'unavailable', message: tr('请先通过保存对话框选择目标文件') }
  if (!expected?.sha256) return { ok: false, reason: 'unavailable', message: tr('缺少文件的磁盘版本，请另存副本') }
  const result = await diskFiles.writeGuarded(p, data, expected)
  if (result.ok) {
    knownDiskVersions.set(result.path, result.fingerprint)
    addRecent(result.path)
  }
  return result
}

handle('pdfpro:check-file', (_e, { path: p, expected }) => {
  if (!authorizedRead(p)) throw new Error(tr('未授权的文件'))
  return diskFiles.checkFile(p, expected)
})
handle('pdfpro:save-pdf-as', (_e, { name, data, guard }) => savePdfAs(name, data, guard))
handle('pdfpro:write-pdf', (_e, { path: p, data, expected }) => writePdf(p, data, expected))

// Compatibility for older renderer clients. These paths also use guarded
// replacement, so a stale client cannot bypass protection for an opened file.
handle('pdfpro:save-as', async (_e, { name, data }) => {
  const result = await savePdfAs(name, data)
  if (result.ok) return result.path
  if (result.reason === 'cancelled') return null
  throw new Error(`${result.reason}: ${result.message}`)
})
handle('pdfpro:write-file', async (_e, { path: p, data }) => {
  const result = await writePdf(p, data, knownDiskVersions.get(cleanPath(p)))
  if (result.ok) return result.path
  throw new Error(`${result.reason}: ${result.message}`)
})

// print pre-rendered page images through the native dialog. A hidden
// window lays the pages out one per sheet with the page's own size.
handle('pdfpro:print-pages', async (_e, { pages, title }) => {
  if (!Array.isArray(pages) || pages.length === 0) return false
  const first = pages[0]
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: ${first.widthPt}pt ${first.heightPt}pt; margin: 0 }
    html, body { margin: 0; padding: 0; background: #fff }
    img { display: block; width: 100vw; height: 100vh; object-fit: contain; page-break-after: always; break-after: page }
    img:last-child { page-break-after: auto; break-after: auto }
  </style></head><body>${pages.map((p) => `<img src="${p.src}">`).join('')}</body></html>`
  const tmp = path.join(app.getPath('temp'), `pdfpro-print-${Date.now()}.html`)
  await fsp.writeFile(tmp, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(tmp)
    // wait until every page image is decoded, else the first print pass
    // lays out empty sheets
    await win.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))).then(() => document.images.length)',
    )
    if (process.env.PDFPRO_PRINT_TO_PDF) {
      // test hook: render what would be printed into a PDF instead
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
      await fsp.writeFile(process.env.PDFPRO_PRINT_TO_PDF, pdf)
      return true
    }
    return await new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (ok) =>
        resolve(ok),
      )
    })
  } finally {
    win.destroy()
    fsp.unlink(tmp).catch(() => {})
  }
})

// ── AI: OpenAI-compatible chat completions, proxied through the main
// process (local model servers rarely send CORS headers). Streaming chunks
// are forwarded to the renderer as they arrive.
const aiStreams = new Map()
handle('pdfpro:ai-request', async (e, { id, url, method, headers, body }) => {
  const ctrl = new AbortController()
  aiStreams.set(id, ctrl)
  // the bundled model: started on demand, reached only from this process
  if (typeof url === 'string' && url.startsWith(LOCAL_SCHEME)) {
    try {
      const rest = url.slice(LOCAL_SCHEME.length) // "<host>/v1/..."
      const p = rest.slice(rest.indexOf('/'))
      let model = ''
      try {
        model = JSON.parse(body || '{}').model || ''
      } catch {
        /* GET */
      }
      return await localAI().request({
        path: p,
        method: method === 'GET' ? 'GET' : 'POST',
        body,
        model,
        signal: ctrl.signal,
        onChunk: (chunk) => {
          if (!e.sender.isDestroyed()) e.sender.send('pdfpro:ai-chunk', { id, chunk })
        },
      })
    } catch (err) {
      return { ok: false, status: 0, text: String(err && err.message ? err.message : err) }
    } finally {
      aiStreams.delete(id)
    }
  }
  // never wait forever on a host that does not answer
  const connectTimer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const m = method === 'GET' ? 'GET' : 'POST'
    const res = await fetch(url, {
      redirect: 'error',
      method: m,
      headers,
      body: m === 'POST' ? body : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(connectTimer)
    if (!res.ok || !res.body) {
      return { ok: false, status: res.status, text: await res.text().catch(() => '') }
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      e.sender.send('pdfpro:ai-chunk', { id, chunk: dec.decode(value, { stream: true }) })
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, text: String(err && err.message ? err.message : err) }
  } finally {
    clearTimeout(connectTimer)
    aiStreams.delete(id)
  }
})
listen('pdfpro:ai-abort', (_e, id) => aiStreams.get(id)?.abort())

// ── bundled local model (llama.cpp llama-server) ─────────────────
const { LocalModelManager, LOCAL_SCHEME } = require('./llm/manager.cjs')
const LLAMA_DIR = app.isPackaged ? path.join(process.resourcesPath, 'llama') : path.join(__dirname, '../vendor/llama')
let localManager = null
function localAI() {
  if (!localManager) {
    localManager = new LocalModelManager({
      binDir: LLAMA_DIR,
      dataDir: path.join(app.getPath('userData'), 'local-ai'),
      notify: (ev, payload) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ev, payload)
      },
    })
  }
  return localManager
}
handle('pdfpro:local-ai-state', () => localAI().state())
handle('pdfpro:local-ai-download', (_e, id) => {
  // runs in the background; progress arrives as state events
  void localAI().download(id)
  return true
})
handle('pdfpro:local-ai-cancel', (_e, id) => localAI().cancelDownload(id))
handle('pdfpro:local-ai-remove', (_e, id) => localAI().remove(id))
handle('pdfpro:local-ai-start', async (_e, id) => {
  try {
    await localAI().ensure(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
})
handle('pdfpro:local-ai-stop', () => localAI().server.stop())
handle('pdfpro:local-ai-reveal', () => shell.openPath(localAI().modelDir))

// The child process must never outlive the app:
//  - normal quit: will-quit (fires after all windows closed, i.e. after the
//    unsaved-changes prompt was answered) is held until llama-server exited
//  - window closed on macOS (app keeps running): the model keeps running
//    until the idle timeout unloads it
//  - any other exit of this process: synchronous SIGKILL in 'exit'
//  - signals to the app (Ctrl+C in a terminal, kill): stop, then exit
//  - a crash of the app: the next launch reaps the orphan via its pidfile
let localShutdownDone = false
app.on('will-quit', (e) => {
  if (!localManager || localShutdownDone) return
  localShutdownDone = true
  const st = localManager.server.state
  const busy = st !== 'stopped' && st !== 'crashed'
  const downloading = Array.from(localManager.downloads.values()).some((d) => d.ctrl)
  if (!busy && !downloading) return
  e.preventDefault()
  localManager.shutdown().finally(() => app.quit())
})
process.on('exit', () => localManager?.killSync())
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!localManager) return process.exit(0)
    localManager.shutdown().finally(() => process.exit(0))
  })
}

// share sheet (macOS): the bytes are written to a temp file with the
// document's name, then the native share menu is shown at the cursor
handle('pdfpro:share', async (_e, { name, data }) => {
  const { ShareMenu } = require('electron')
  if (process.platform !== 'darwin' || !ShareMenu) return false
  const dir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'pdfpro-share-'))
  const f = path.join(dir, path.basename(name || 'document.pdf'))
  await fsp.writeFile(f, Buffer.from(data))
  new ShareMenu({ filePaths: [f] }).popup({ window: mainWindow })
  return true
})

// ── OCR: Apple Vision through the bundled helper (on-device) ──────
const OCR_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'pdfpro-ocr')
  : path.join(__dirname, '../native/pdfpro-ocr')
handle('pdfpro:ocr-available', () => process.platform === 'darwin' && fs.existsSync(OCR_BIN))
handle('pdfpro:ocr', async (_e, { images }) => {
  const dir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'pdfpro-ocr-'))
  const files = []
  try {
    for (let i = 0; i < images.length; i++) {
      const f = path.join(dir, `p${i}.png`)
      await fsp.writeFile(f, Buffer.from(images[i]))
      files.push(f)
    }
    const out = await new Promise((resolve, reject) => {
      require('node:child_process').execFile(OCR_BIN, files, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      )
    })
    return String(out)
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } finally {
    for (const f of files) fsp.unlink(f).catch(() => {})
    fsp.rmdir(dir).catch(() => {})
  }
})

// generic file export (e.g. extracted images) with a native save dialog
handle('pdfpro:save-file', async (_e, { name, data, filterName, extensions }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: tr('导出'),
    defaultPath: name,
    filters: [
      {
        name: filterName || tr('文件'),
        extensions: Array.isArray(extensions) && extensions.length ? extensions : ['*'],
      },
    ],
  })
  if (r.canceled || !r.filePath) return null
  await fsp.writeFile(r.filePath, Buffer.from(data))
  return r.filePath
})

listen('pdfpro:window-title', (_e, t) => {
  if (mainWindow && typeof t === 'string') mainWindow.setTitle(t)
})
