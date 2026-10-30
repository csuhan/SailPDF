const { tr } = require('../locale.cjs')
// Local model manager: catalog state, downloads, server lifecycle and the
// request bridge used by the AI IPC handler in main.cjs.
;('use strict')

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { CATALOG, hfUrl } = require('./catalog.cjs')
const { downloadVerified } = require('./downloader.cjs')
const { LlamaServer } = require('./server.cjs')

/** virtual base url the renderer uses for the bundled model */
const LOCAL_SCHEME = 'pdfpro-local://'

class LocalModelManager {
  /** @param {{ binDir: string, dataDir: string, notify: (ev: string, payload: unknown) => void }} o */
  constructor(o) {
    this.binDir = o.binDir
    this.modelDir = path.join(o.dataDir, 'models')
    this.notify = o.notify
    this.downloads = new Map() // id -> { ctrl, done, total, bps, error }
    this.server = new LlamaServer({
      binDir: o.binDir,
      runDir: path.join(o.dataDir, 'run'),
      logFile: path.join(o.dataDir, 'llama-server.log'),
      idleMinutes: 15,
    })
    this.server.on('status', () => this.push())
  }

  pathOf(entry, kind = 'model') {
    const f = kind === 'model' ? entry.model : entry.mmproj
    return f ? path.join(this.modelDir, entry.id, f.file) : ''
  }

  installed(entry) {
    try {
      return fs.statSync(this.pathOf(entry)).size === entry.model.size
    } catch {
      return false
    }
  }

  partialBytes(entry) {
    try {
      return fs.statSync(this.pathOf(entry) + '.part').size
    } catch {
      return 0
    }
  }

  state() {
    const ramGB = Math.round(os.totalmem() / 1024 ** 3)
    return {
      engine: this.server.available(),
      ramGB,
      modelDir: this.modelDir,
      server: this.server.status(),
      models: CATALOG.map((e) => {
        const d = this.downloads.get(e.id)
        return {
          id: e.id,
          name: e.name,
          desc: e.desc,
          size: e.model.size + (e.mmproj?.size ?? 0),
          minRamGB: e.minRamGB,
          recommended: !!e.recommended,
          fits: ramGB >= e.minRamGB,
          installed: this.installed(e),
          partial: this.partialBytes(e),
          download: d ? { done: d.done, total: d.total, bps: d.bps, error: d.error, active: !!d.ctrl } : null,
        }
      }),
    }
  }

  push() {
    this.notify('pdfpro:local-ai-state', this.state())
  }

  async download(id) {
    const e = CATALOG.find((x) => x.id === id)
    if (!e) throw new Error(tr('未知模型'))
    if (this.installed(e)) return
    const cur = this.downloads.get(id)
    if (cur?.ctrl) return
    // disk space: need what is still missing + a little headroom
    const need = e.model.size - this.partialBytes(e) + 200 * 1024 * 1024
    try {
      await fsp.mkdir(this.modelDir, { recursive: true })
      const st = await fsp.statfs(this.modelDir)
      if (st.bavail * st.bsize < need) throw new Error(tr('磁盘空间不足，需要约 {0} GB', (need / 1024 ** 3).toFixed(1)))
    } catch (err) {
      if (/磁盘空间/.test(err.message)) throw err
    }
    const ctrl = new AbortController()
    const d = { ctrl, done: this.partialBytes(e), total: e.model.size, bps: 0, error: '' }
    this.downloads.set(id, d)
    this.push()
    let lastPush = 0
    try {
      const files = [e.model, ...(e.mmproj ? [e.mmproj] : [])]
      for (const f of files) {
        await downloadVerified({
          url: hfUrl(e.repo, f.file),
          dest: path.join(this.modelDir, e.id, f.file),
          size: f.size,
          sha256: f.sha256,
          signal: ctrl.signal,
          onProgress: (done, total, bps) => {
            if (f !== e.model) return
            d.done = done
            d.total = total
            d.bps = bps
            const now = Date.now()
            if (now - lastPush > 400 || done === total) {
              lastPush = now
              this.push()
            }
          },
        })
      }
      this.downloads.delete(id)
    } catch (err) {
      d.ctrl = null
      d.error = ctrl.signal.aborted ? '' : err.message || String(err)
      if (ctrl.signal.aborted) this.downloads.delete(id)
    } finally {
      this.push()
    }
  }

  cancelDownload(id) {
    this.downloads.get(id)?.ctrl?.abort()
  }

  async remove(id) {
    const e = CATALOG.find((x) => x.id === id)
    if (!e) return
    this.cancelDownload(id)
    if (this.server.modelId === id) await this.server.stop()
    await fsp.rm(path.join(this.modelDir, e.id), { recursive: true, force: true })
    this.downloads.delete(id)
    this.push()
  }

  /** start (or reuse) the server for a model; returns { url, key } */
  async ensure(id) {
    const e = CATALOG.find((x) => x.id === id)
    if (!e) throw new Error(tr('未知的本机模型：{0}', id))
    if (!this.installed(e)) throw new Error(tr('{0} 还没有下载', e.name))
    return this.server.ensure({
      id: e.id,
      modelPath: this.pathOf(e),
      mmprojPath: e.mmproj ? this.pathOf(e, 'mmproj') : undefined,
      ctx: e.ctx,
    })
  }

  /**
   * Forward an OpenAI-style request for the bundled model.
   * `path` like "/v1/chat/completions"; `model` selects the catalog entry.
   * Streams the raw response text to onChunk; resolves { ok, status, text }.
   */
  async request({ path: p, method, body, model, signal, onChunk }) {
    if (p === '/v1/models') {
      // models that can be used right now (installed)
      const data = CATALOG.filter((e) => this.installed(e)).map((e) => ({
        id: e.id,
        object: 'model',
        owned_by: tr('sail-pdf (本机)'),
      }))
      onChunk(JSON.stringify({ object: 'list', data }))
      return { ok: true, status: 200 }
    }
    const { url, key } = await this.ensure(model)
    this.server.begin()
    try {
      return await new Promise((resolve) => {
        const target = new URL(p, url)
        const req = http.request(
          {
            host: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          },
          (res) => {
            res.setEncoding('utf8')
            let errText = ''
            const ok = (res.statusCode || 0) < 400
            res.on('data', (c) => (ok ? onChunk(c) : (errText += c)))
            res.on('end', () => resolve({ ok, status: res.statusCode || 0, text: errText }))
            res.on('error', (e) => resolve({ ok: false, status: 0, text: e.message }))
          },
        )
        req.on('error', (e) => resolve({ ok: false, status: 0, text: this.server.error || e.message }))
        if (signal) {
          if (signal.aborted) req.destroy()
          // cancelling in the UI stops generation in llama-server too
          signal.addEventListener('abort', () => req.destroy(new Error(tr('已停止'))), { once: true })
        }
        if (method === 'POST' && body) req.write(body)
        req.end()
      })
    } finally {
      this.server.end()
    }
  }

  async shutdown() {
    for (const d of this.downloads.values()) d.ctrl?.abort()
    await this.server.stop(3000)
  }

  killSync() {
    this.server.killSync()
  }
}

module.exports = { LocalModelManager, LOCAL_SCHEME }
