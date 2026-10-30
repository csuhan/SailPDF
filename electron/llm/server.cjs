const { tr } = require('../locale.cjs')
// Lifecycle of the bundled llama-server child process.
//
// Communication
//   llama-server listens on 127.0.0.1 only, on a free port picked by us, and
//   requires a random per-launch API key (passed through --api-key-file, so
//   it never shows up in `ps`). Only the Electron main process knows port +
//   key; the renderer reaches the model through IPC (see main.cjs), never
//   directly. Readiness = GET /health returns 200.
//
// Process management
//   - at most one server; start() is idempotent and concurrent callers share
//     the same pending start
//   - switching models = stop + start
//   - stop(): SIGTERM, then SIGKILL after a grace period; resolves when the
//     process has really exited
//   - the pid is recorded in a pidfile; a server left behind by a crashed
//     app is found and killed on the next launch (after checking that the
//     pid really is our llama-server binary)
//   - idle timeout: the model is unloaded after N minutes without requests
//     and transparently started again on the next request
//   - unexpected exit: state becomes "crashed" with the last log lines; no
//     restart loop, the next request tries once more
//   - stdout/stderr are drained continuously (a full pipe would block the
//     child) into a ring buffer + log file
;('use strict')

const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')

const STATES = ['stopped', 'starting', 'ready', 'stopping', 'crashed']

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** command line of a pid (macOS / Linux), '' when unknown */
function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2000 }).trim()
  } catch {
    return ''
  }
}

class LlamaServer extends EventEmitter {
  /**
   * @param {{ binDir: string, runDir: string, logFile: string,
   *           idleMinutes?: number, startTimeoutMs?: number }} opts
   */
  constructor(opts) {
    super()
    this.binDir = opts.binDir
    this.runDir = opts.runDir
    this.logFile = opts.logFile
    this.idleMs = (opts.idleMinutes ?? 15) * 60 * 1000
    this.startTimeoutMs = opts.startTimeoutMs ?? 180000
    this.pidFile = path.join(this.runDir, 'llama-server.pid')
    this.keyFile = path.join(this.runDir, 'llama-server.key')
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null
    this.state = 'stopped'
    this.port = 0
    this.key = ''
    this.modelPath = ''
    this.modelId = ''
    this.error = ''
    this.logs = []
    this.pending = null
    this.idleTimer = null
    this.activeRequests = 0
    this.exitWaiters = []
  }

  get binary() {
    return path.join(this.binDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
  }

  available() {
    return fs.existsSync(this.binary)
  }

  status() {
    return {
      state: this.state,
      modelId: this.modelId,
      pid: this.child?.pid ?? null,
      port: this.state === 'ready' ? this.port : null,
      error: this.error,
      logTail: this.logs.slice(-12),
    }
  }

  setState(s, error = '') {
    if (!STATES.includes(s)) return
    this.state = s
    this.error = error
    this.emit('status', this.status())
  }

  log(line) {
    if (!line) return
    this.logs.push(line)
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400)
    fs.appendFile(this.logFile, line + '\n', () => {})
  }

  /** kill a server left behind by a previous (crashed) run of the app */
  async reapOrphan() {
    let pid = 0
    try {
      pid = parseInt(await fsp.readFile(this.pidFile, 'utf8'), 10)
    } catch {
      return
    }
    if (pid > 0 && alive(pid) && commandOf(pid).includes('llama-server')) {
      this.log(`[pdfpro] killing orphaned llama-server pid ${pid}`)
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* gone */
      }
      for (let i = 0; i < 25 && alive(pid); i++) await new Promise((r) => setTimeout(r, 200))
      if (alive(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* gone */
        }
      }
    }
    await fsp.unlink(this.pidFile).catch(() => {})
  }

  /**
   * Make sure the server runs `modelPath`. Resolves with { url, key } when
   * it is ready. Concurrent calls share one start.
   * @param {{ id: string, modelPath: string, mmprojPath?: string, ctx: number }} m
   */
  async ensure(m) {
    m = { ...m, modelPath: path.resolve(m.modelPath) }
    for (;;) {
      if (this.pending) {
        if (this.pendingModel === m.modelPath) return this.pending
        await this.pending.catch(() => {})
        // Several callers can wake together. Recheck the transition lock.
        continue
      }
      if (this.state === 'ready' && this.modelPath === m.modelPath && this.child) {
        this.touch()
        return { url: `http://127.0.0.1:${this.port}`, key: this.key }
      }
      this.pendingModel = m.modelPath
      // Reserve the whole stop/start transition before either can yield.
      const pending = Promise.resolve()
        .then(async () => {
          if (this.child) await this.stop()
          return this.start(m)
        })
        .finally(() => {
          if (this.pending === pending) {
            this.pending = null
            this.pendingModel = null
          }
        })
      this.pending = pending
      return pending
    }
  }

  async start(m) {
    // the child runs with cwd = binDir: never hand it relative paths
    m = {
      ...m,
      modelPath: path.resolve(m.modelPath),
      mmprojPath: m.mmprojPath ? path.resolve(m.mmprojPath) : undefined,
    }
    if (!this.available()) throw new Error(tr('本机模型引擎（llama-server）不在安装包中'))
    if (!fs.existsSync(m.modelPath)) throw new Error(tr('模型文件不存在，请先下载'))
    await fsp.mkdir(this.runDir, { recursive: true })
    await this.reapOrphan()
    this.port = await freePort()
    this.key = crypto.randomBytes(24).toString('hex')
    // key file readable by the user only; removed again on exit
    await fsp.writeFile(this.keyFile, this.key + '\n', { mode: 0o600 })
    this.modelPath = m.modelPath
    this.modelId = m.id
    this.logs = []
    this.setState('starting')
    const args = [
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--api-key-file',
      this.keyFile,
      '-m',
      m.modelPath,
      '--alias',
      m.id,
      '-c',
      String(m.ctx),
      // one request at a time: the whole context window for the document
      '--parallel',
      '1',
      '--no-webui',
      '--jinja',
      // answers go straight to the point: no long hidden "thinking" before
      // the reply (document Q&A / tool calls don't need it, it only adds latency)
      '--reasoning',
      'off',
      '-ngl',
      '999',
      '--no-mmproj-auto',
      // plain lines (no colours) into our ring buffer / log file
      '--log-colors',
      'off',
    ]
    if (m.mmprojPath && fs.existsSync(m.mmprojPath)) args.push('--mmproj', m.mmprojPath)
    this.log(`[pdfpro] starting ${this.binary} ${args.join(' ').replace(this.keyFile, '<keyfile>')}`)
    const child = spawn(this.binary, args, {
      cwd: this.binDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // same process group as the app: a hard kill of the app group takes it along
      detached: false,
      env: {
        ...process.env,
        // dylibs live next to the binary (@loader_path rpath); no HF access from it
        LLAMA_OFFLINE: '1',
        HF_HUB_OFFLINE: '1',
      },
      windowsHide: true,
    })
    this.child = child
    fs.writeFile(this.pidFile, String(child.pid), () => {})
    const pipe = (stream) => {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (d) => {
        buf += d
        let i = buf.indexOf('\n')
        while (i >= 0) {
          this.log(buf.slice(0, i).trimEnd())
          buf = buf.slice(i + 1)
          i = buf.indexOf('\n')
        }
      })
    }
    pipe(child.stdout)
    pipe(child.stderr)

    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
      child.once('error', (err) => resolve({ code: -1, signal: null, err }))
    })
    exited.then(({ code, signal, err }) => this.onExit(child, code, signal, err))

    // wait for /health, the process dying, or the timeout
    const t0 = Date.now()
    for (;;) {
      if (this.child !== child) throw new Error(tr('启动被取消'))
      if (child.exitCode !== null || child.signalCode !== null || this.state === 'crashed') {
        throw new Error(this.error || tr('本机模型启动失败'))
      }
      if (Date.now() - t0 > this.startTimeoutMs) {
        await this.stop()
        throw new Error(tr('本机模型启动超时'))
      }
      const st = await this.health()
      if (st === 200) break
      await new Promise((r) => setTimeout(r, st === 503 ? 400 : 250))
    }
    this.setState('ready')
    this.touch()
    return { url: `http://127.0.0.1:${this.port}`, key: this.key }
  }

  /** GET /health status code (503 = loading the model), 0 when unreachable */
  health() {
    return new Promise((resolve) => {
      const req = require('node:http').get(
        {
          host: '127.0.0.1',
          port: this.port,
          path: '/health',
          timeout: 1500,
          headers: { Authorization: `Bearer ${this.key}` },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode || 0)
        },
      )
      req.on('timeout', () => req.destroy())
      req.on('error', () => resolve(0))
    })
  }

  onExit(child, code, signal, err) {
    if (this.child !== child) return
    this.child = null
    // synchronous: when stop() resolves, the files are really gone
    for (const f of [this.pidFile, this.keyFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* already removed */
      }
    }
    clearTimeout(this.idleTimer)
    const waiters = this.exitWaiters.splice(0)
    waiters.forEach((w) => w())
    if (this.state === 'stopping' || this.state === 'stopped') {
      this.setState('stopped')
      return
    }
    // unexpected: keep the reason for the UI
    const tail = this.logs
      .filter((l) => !l.startsWith('[pdfpro]'))
      .slice(-6)
      .join('\n')
    const why = err ? err.message : signal ? tr('被信号 {0} 终止', signal) : tr('退出码 {0}', code)
    let hint = ''
    if (/failed to allocate|out of memory|ggml_metal.*error/i.test(tail)) hint = tr('（内存不足，请换用更小的模型）')
    this.log(`[pdfpro] llama-server exited unexpectedly: ${why}`)
    this.setState('crashed', tr('本机模型意外退出：{0}{1}{2}', why, hint, tail ? `\n${tail}` : ''))
  }

  /** request bookkeeping for the idle timer */
  begin() {
    this.activeRequests++
    clearTimeout(this.idleTimer)
  }

  end() {
    this.activeRequests = Math.max(0, this.activeRequests - 1)
    this.touch()
  }

  touch() {
    clearTimeout(this.idleTimer)
    if (!this.idleMs || this.activeRequests > 0) return
    this.idleTimer = setTimeout(() => {
      if (this.activeRequests === 0 && this.state === 'ready') {
        this.log('[pdfpro] idle: unloading model')
        void this.stop()
      }
    }, this.idleMs)
    this.idleTimer.unref?.()
  }

  /** graceful stop; resolves once the process is gone */
  stop(graceMs = 5000) {
    const child = this.child
    clearTimeout(this.idleTimer)
    if (!child) {
      if (this.state !== 'stopped') this.setState('stopped')
      return Promise.resolve()
    }
    this.setState('stopping')
    return new Promise((resolve) => {
      this.exitWaiters.push(resolve)
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      const t = setTimeout(() => {
        if (this.child === child) {
          this.log('[pdfpro] llama-server did not stop in time: SIGKILL')
          try {
            child.kill('SIGKILL')
          } catch {
            /* gone */
          }
        }
      }, graceMs)
      t.unref?.()
    })
  }

  /** synchronous last-resort kill (process 'exit' handler) */
  killSync() {
    const child = this.child
    if (!child) return
    try {
      child.kill('SIGKILL')
    } catch {
      /* gone */
    }
    try {
      fs.unlinkSync(this.pidFile)
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(this.keyFile)
    } catch {
      /* ignore */
    }
  }
}

module.exports = { LlamaServer }
