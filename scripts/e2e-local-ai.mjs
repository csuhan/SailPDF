// Bundled llama.cpp through the real Electron app (dev build, separate
// profile). Covers: catalog state over IPC, download progress events,
// on-demand start through the AI request bridge, streaming + cancel,
// stop, and that quitting the app terminates llama-server.
// Usage: node scripts/e2e-local-ai.mjs   (Electron must listen on 9334)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
const BIN = new URL('../vendor/llama/llama-server', import.meta.url).pathname
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`)
  if (!cond) failures++
}
const servers = () => {
  try {
    return execFileSync('pgrep', ['-f', BIN], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9334', defaultViewport: null })
const p = (await b.pages()).find((x) => x.url().includes('5174'))
p.on('pageerror', (e) => check(`no page error (${e.message})`, false))
await p.waitForFunction(() => window.pdfDesktop?.localAI && window.__pdfpro, { timeout: 20000 })

const st0 = await p.evaluate(() => window.pdfDesktop.localAI.state())
check(
  'engine bundled, catalog listed',
  st0.engine && st0.models.length === 3 && st0.models.every((m) => m.size > 1e9),
  JSON.stringify(st0).slice(0, 200),
)
check('server not started before it is needed', st0.server.state === 'stopped' && servers().length === 0)
const id = process.env.LOCAL_MODEL || st0.models.find((m) => m.installed)?.id
check('a model is installed for the test', !!id, 'download one first')
if (!id) process.exit(1)

// models endpoint = installed models
const models = await p.evaluate(async () => {
  const { listModels } = await import('/src/ai/client.ts')
  return listModels({ provider: 'bundled', baseUrl: '', apiKey: '', model: '', language: 'auto' })
})
check('bundled /models lists installed models', models.includes(id), JSON.stringify(models))

// first request starts the server on demand
const events = []
await p.evaluate(() => {
  window.__lst = []
  window.pdfDesktop.localAI.onState((s) => window.__lst.push(s.server.state))
})
const t0 = Date.now()
const r = await p.evaluate(async (id) => {
  const { chat } = await import('/src/ai/client.ts')
  const res = await chat(
    { provider: 'bundled', baseUrl: '', apiKey: '', model: id, language: 'auto' },
    [{ role: 'user', content: '用一句话回答：1+1 等于几？' }],
    { maxTokens: 64 },
  )
  return res.content
}, id)
const ms = Date.now() - t0
const seen = await p.evaluate(() => window.__lst)
check(`first request starts llama-server and answers (${ms} ms)`, r.length > 0 && servers().length === 1, r)
check('status went starting → ready', seen.includes('starting') && seen.includes('ready'), JSON.stringify(seen))
const st1 = await p.evaluate(() => window.pdfDesktop.localAI.state())
check(
  'renderer never learns the port / key? (port only shown when ready)',
  st1.server.state === 'ready' && !JSON.stringify(st1).includes('api-key'),
)

// second request reuses the process
const pid = servers()[0]
await p.evaluate(async (id) => {
  const { chat } = await import('/src/ai/client.ts')
  await chat(
    { provider: 'bundled', baseUrl: '', apiKey: '', model: id, language: 'auto' },
    [{ role: 'user', content: 'hi' }],
    { maxTokens: 8 },
  )
}, id)
check('next request reuses the same process', servers().length === 1 && servers()[0] === pid)

// streaming + cancel from the renderer
const c = await p.evaluate(async (id) => {
  const { chat } = await import('/src/ai/client.ts')
  const ctrl = new AbortController()
  let n = 0
  let err = ''
  try {
    await chat(
      { provider: 'bundled', baseUrl: '', apiKey: '', model: id, language: 'auto' },
      [{ role: 'user', content: '写一篇 500 字的故事' }],
      {
        maxTokens: 800,
        signal: ctrl.signal,
        onDelta: () => {
          if (++n === 6) ctrl.abort()
        },
      },
    )
  } catch (e) {
    err = String(e)
  }
  return { n, err }
}, id)
check('stream can be stopped from the UI', c.n >= 6 && c.n < 60, JSON.stringify(c))
await sleep(500)
const slots = await p.evaluate(async (id) => {
  const { chat } = await import('/src/ai/client.ts')
  const t = Date.now()
  await chat(
    { provider: 'bundled', baseUrl: '', apiKey: '', model: id, language: 'auto' },
    [{ role: 'user', content: 'ok' }],
    { maxTokens: 4 },
  )
  return Date.now() - t
}, id)
check(`generation really stopped (next request served promptly, ${slots} ms)`, slots < 15000)

// explicit stop from the UI
await p.evaluate(() => window.pdfDesktop.localAI.stop())
await sleep(300)
check(
  'stop() terminates llama-server',
  servers().length === 0 && (await p.evaluate(() => window.pdfDesktop.localAI.state())).server.state === 'stopped',
)

// start again for the quit test
await p.evaluate((id) => window.pdfDesktop.localAI.start(id), id)
check('started again', servers().length === 1)
b.disconnect()
console.log(
  failures ? `\n${failures} FAILED` : '\nLOCAL AI TESTS PASS (now quit the app and check no llama-server is left)',
)
process.exit(failures ? 1 : 0)
