// Process-management tests for electron/llm/server.cjs with the real
// bundled llama-server and a tiny GGUF model (no Electron needed).
// Usage: node scripts/test-llama-server.mjs <model.gguf>
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const require = createRequire(import.meta.url)
const { LlamaServer } = require('../electron/llm/server.cjs')
const MODEL = process.argv[2]
const BIN = new URL('../vendor/llama/', import.meta.url).pathname
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const count = () => {
  try {
    return execFileSync('pgrep', ['-f', `${BIN}llama-server`], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean).length
  } catch {
    return 0
  }
}
const get = (port, path, key) =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path, headers: key ? { Authorization: `Bearer ${key}` } : {} },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, body: b }))
      },
    )
    req.on('error', (e) => resolve({ status: 0, body: e.message }))
  })
const post = (port, path, key, body, onData) =>
  new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => {
          b += c
          onData?.(String(c), req)
        })
        res.on('end', () => resolve({ status: res.statusCode, body: b }))
        res.on('error', () => resolve({ status: res.statusCode, body: b, aborted: true }))
      },
    )
    req.on('error', (e) => resolve({ status: 0, body: e.message, aborted: true }))
    req.end(JSON.stringify(body))
  })

const dir = mkdtempSync(join(tmpdir(), 'llama-test-'))
const mk = (o = {}) =>
  new LlamaServer({ binDir: BIN, runDir: join(dir, 'run'), logFile: join(dir, 'server.log'), ...o })
const model = { id: 'tiny', modelPath: MODEL, ctx: 512 }

// 1. start + health + auth
let s = mk()
const t0 = Date.now()
const { url, key } = await s.ensure(model)
const port = Number(new URL(url).port)
check(`starts and becomes ready (${Date.now() - t0} ms)`, s.state === 'ready' && port > 0)
check('listens on 127.0.0.1 only', url.startsWith('http://127.0.0.1:'))
check('pidfile written', readFileSync(join(dir, 'run', 'llama-server.pid'), 'utf8').trim() === String(s.child.pid))
check('key file is private (0600)', (statSync(join(dir, 'run', 'llama-server.key')).mode & 0o777) === 0o600)
check(
  'key not visible in the command line',
  !execFileSync('ps', ['-p', String(s.child.pid), '-o', 'command='], { encoding: 'utf8' }).includes(key),
)
check('request without key is rejected', (await get(port, '/v1/models')).status === 401)
check('request with key works', (await get(port, '/v1/models', key)).status === 200)

// 2. concurrent ensure() share one process
const pid1 = s.child.pid
const [a, b] = await Promise.all([s.ensure(model), s.ensure(model)])
check(
  'concurrent ensure() reuse the running server',
  a.url === url && b.url === url && s.child.pid === pid1 && count() === 1,
)

// 3. streaming + cancel stops generation in the server
let chunks = 0
const r = await post(
  port,
  '/v1/chat/completions',
  key,
  { model: 'tiny', stream: true, max_tokens: 400, messages: [{ role: 'user', content: 'Once upon a time' }] },
  (c, req) => {
    if (c.includes('data:')) chunks++
    if (chunks === 5) req.destroy()
  },
)
check('streams tokens and can be cancelled mid-stream', chunks >= 5 && r.aborted)
const after = await post(port, '/v1/chat/completions', key, {
  model: 'tiny',
  max_tokens: 8,
  messages: [{ role: 'user', content: 'Hi' }],
})
check(
  'server keeps working after a cancelled request',
  after.status === 200 && JSON.parse(after.body).choices?.length === 1,
  after.body.slice(0, 200),
)

// 4. graceful stop
await s.stop()
check(
  'stop(): process gone, files cleaned',
  !alive(pid1) &&
    s.state === 'stopped' &&
    !existsSync(join(dir, 'run', 'llama-server.pid')) &&
    !existsSync(join(dir, 'run', 'llama-server.key')),
)

// 5. crash detection: kill -9 behind its back
await s.ensure(model)
const pid2 = s.child.pid
process.kill(pid2, 'SIGKILL')
await new Promise((r) => setTimeout(r, 500))
check('unexpected exit → crashed with a reason', s.state === 'crashed' && /SIGKILL/.test(s.error), s.error)
const again = await s.ensure(model)
check('next request starts it again', s.state === 'ready' && again.url && s.child.pid !== pid2)
await s.stop()

// 6. orphan from a crashed app is reaped on the next start
const orphan = spawn(
  join(BIN, 'llama-server'),
  ['--host', '127.0.0.1', '--port', '0', '-m', MODEL, '-c', '256', '--no-webui'],
  { stdio: 'ignore', detached: true },
)
orphan.unref()
const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync(join(dir, 'run'), { recursive: true })
writeFileSync(join(dir, 'run', 'llama-server.pid'), String(orphan.pid))
await new Promise((r) => setTimeout(r, 800))
check('orphan running before', alive(orphan.pid))
s = mk()
await s.ensure(model)
await new Promise((r) => setTimeout(r, 300))
check('orphan reaped on start, only one server left', !alive(orphan.pid) && count() === 1, `count=${count()}`)

// 7. a pidfile pointing at an unrelated process is NOT killed
await s.stop()
const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })
writeFileSync(join(dir, 'run', 'llama-server.pid'), String(sleeper.pid))
await s.ensure(model)
check('unrelated pid in a stale pidfile is left alone', alive(sleeper.pid))
sleeper.kill()
await s.stop()

// 8. idle unload
s = mk({ idleMinutes: 0.02 }) // ~1.2 s
await s.ensure(model)
const pid3 = s.child.pid
s.begin()
await new Promise((r) => setTimeout(r, 1800))
check('no idle unload while a request is active', s.state === 'ready' && alive(pid3))
s.end()
await new Promise((r) => setTimeout(r, 2500))
check('idle unload after the timeout', s.state === 'stopped' && !alive(pid3))

// 9. bad model file → clear error, no leftover process
s = mk({ startTimeoutMs: 20000 })
const badPath = join(dir, 'bad.gguf')
writeFileSync(badPath, 'not a gguf')
let err = ''
try {
  await s.ensure({ id: 'bad', modelPath: badPath, ctx: 512 })
} catch (e) {
  err = e.message
}
check('broken model: start fails with a reason, no process left', !!err && s.child === null && count() === 0, err)

// 10. killSync (process exit path)
s = mk()
await s.ensure(model)
const pid4 = s.child.pid
s.killSync()
await new Promise((r) => setTimeout(r, 400))
check('killSync() terminates the server', !alive(pid4))

check('no llama-server left running', count() === 0, `count=${count()}`)
console.log(failures ? `\n${failures} FAILED` : '\nLLAMA SERVER TESTS PASS')
process.exit(failures ? 1 : 0)
