// Unified runner. Unit tests need no browser; browser suites own a dev server
// unless --external explicitly selects an already running server on 5174.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const origin = 'http://127.0.0.1:5174'
const args = new Set(process.argv.slice(2))
const allowed = new Set(['--unit', '--regressions', '--external', '--help'])
for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`)
if (args.has('--unit') && args.has('--regressions')) throw new Error('Choose --unit or --regressions, not both.')
if (args.has('--help')) {
  console.log(
    'node scripts/run-tests.mjs [--unit | --regressions] [--external]\nDefault: unit + browser regression + legacy Web suites.\n--external: reuse Vite on 127.0.0.1:5174; never stop it.\nLogs and results are saved in a new system temporary directory.',
  )
  process.exit(0)
}

const units = [
  'test-edit-store',
  'test-llama-concurrency',
  'test-pdf-integrity',
  'test-font-program',
  'test-textruns',
  'test-disk-files',
  'test-tool-registry',
  'test-preferences',
  'test-desktop-security',
  'test-i18n',
].map((name) => ({ name, script: `scripts/${name}.mjs` }))
const regressions = [
  'test-search-session',
  'e2e-ai-regressions',
  'e2e-document-session',
  'e2e-save-guard',
  'e2e-tool-discovery',
  'e2e-preferences',
  'e2e-settings-navigation',
  'e2e-ai-entry',
  'e2e-tabs-annotations',
  'e2e-release-readiness',
  'e2e-bilingual',
].map((name) => ({ name, script: `scripts/${name}.mjs` }))
const legacy = [
  { name: 'smoke', script: 'scripts/verify.mjs', args: [`${origin}/?file=/samples/sample.pdf`, 'interact'] },
  { name: 'stress-400', script: 'scripts/verify.mjs', args: [`${origin}/?file=/samples/stress-400.pdf`] },
  ...[
    'e2e-edit',
    'e2e-tools',
    'e2e-session',
    'e2e-image-edit',
    'e2e-line-edit',
    'e2e-font-fidelity',
    'e2e-cjk',
    'e2e-cjk-edit',
    'e2e-checklist',
    'e2e-acrobat-tools',
    'e2e-security',
  ].map((name) => ({ name, script: `scripts/${name}.mjs` })),
]
const tests = args.has('--unit')
  ? units
  : args.has('--regressions')
    ? regressions
    : [...units, ...regressions, ...legacy]
const logs = await mkdtemp(path.join(tmpdir(), 'pdfpro-tests-'))
const results = []
let activeChild = null
let vite = null
let interrupted = false
let chineseBefore
let preserveChinese = false
const chinesePath = path.join(root, 'public', 'samples', 'chinese.pdf')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failedOutput = (text) =>
  text.split(/\r?\n/).filter((line) => /❌|\[PAGEERROR\]|\bpageerror\b|\bpage error\b/i.test(line))

function signalTree(child, signal) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
async function stopTree(child) {
  if (!child?.pid) return
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0)
  } catch {
    return
  }
  signalTree(child, 'SIGTERM')
  await pause(250)
  signalTree(child, 'SIGKILL')
}
const interrupt = () => {
  interrupted = true
  signalTree(activeChild, 'SIGTERM')
  signalTree(vite, 'SIGTERM')
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)

async function healthyVite() {
  try {
    const response = await fetch(`${origin}/@vite/client`, { signal: AbortSignal.timeout(1500) })
    return response.ok && (await response.text()).includes('createHotContext')
  } catch {
    return false
  }
}

async function startVite() {
  if (args.has('--external')) {
    if (!(await healthyVite())) throw new Error(`--external requires an existing Vite server at ${origin}`)
    console.log(`Using external Vite: ${origin}`)
    return
  }
  if (await healthyVite()) throw new Error(`Vite is already running at ${origin}. Use --external to reuse it.`)
  const log = createWriteStream(path.join(logs, 'vite.log'))
  vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PDFPRO_TEST_LANGUAGE: 'zh-CN' },
    },
  )
  let startError
  vite.once('error', (error) => {
    startError = error
  })
  vite.stdout.pipe(log, { end: false })
  vite.stderr.pipe(log, { end: false })
  vite.once('close', () => log.end())
  for (let i = 0; i < 80; i++) {
    if (interrupted) throw new Error('Test run interrupted')
    if (startError) throw startError
    if (vite.exitCode !== null || vite.signalCode !== null)
      throw new Error(`Vite failed to start. See ${path.join(logs, 'vite.log')}`)
    if (await healthyVite()) {
      console.log(`Started Vite: ${origin}`)
      return
    }
    await pause(250)
  }
  throw new Error(`Vite did not become ready. See ${path.join(logs, 'vite.log')}`)
}

async function requireSamples() {
  const names = args.has('--regressions')
    ? ['sample.pdf', 'links.pdf', 'form.pdf', 'enc-aes256.pdf', 'enc-rc4.pdf', 'enc-restrict.pdf']
    : [
        'sample.pdf',
        'stress-400.pdf',
        'links.pdf',
        'form.pdf',
        'images.pdf',
        'georgia.pdf',
        'mixed-line.pdf',
        'chinese.pdf',
        'contract.pdf',
        'bigimage.pdf',
        'enc-aes256.pdf',
        'enc-rc4.pdf',
        'enc-restrict.pdf',
      ]
  const missing = []
  for (const name of names) {
    try {
      await access(path.join(root, 'public', 'samples', name))
    } catch {
      missing.push(name)
    }
  }
  if (missing.length)
    throw new Error(`Missing test samples in public/samples: ${missing.join(', ')}. See README testing instructions.`)
}

async function run(test) {
  const file = path.join(logs, `${test.name}.log`)
  const log = createWriteStream(file)
  const started = Date.now()
  console.log(`RUN  ${test.name}`)
  const child = spawn(process.execPath, [test.script, ...(test.args || [])], {
    cwd: root,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PDFPRO_TEST_ORIGIN: origin, PDFPRO_TEST_LANGUAGE: 'zh-CN' },
  })
  activeChild = child
  let output = ''
  let timedOut = false
  let killTimer
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output += chunk
      log.write(chunk)
    })
  const timer = setTimeout(
    () => {
      timedOut = true
      signalTree(child, 'SIGTERM')
      killTimer = setTimeout(() => signalTree(child, 'SIGKILL'), 2000)
      killTimer.unref()
    },
    args.has('--unit') ? 120000 : 240000,
  )
  const status = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer)
  clearTimeout(killTimer)
  await stopTree(child)
  activeChild = null
  await new Promise((resolve) => log.end(resolve))
  const failures = failedOutput(output)
  const ok = status.code === 0 && !status.signal && !status.error && !timedOut && !failures.length
  const result = {
    name: test.name,
    ok,
    ...status,
    timedOut,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    failures,
    log: file,
  }
  results.push(result)
  await writeFile(path.join(logs, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${test.name} (${result.seconds}s)`)
  if (!ok) console.error(output.slice(-4000) || status.error || `Terminated by ${status.signal ?? 'timeout'}`)
}

console.log(`Test logs: ${logs}`)
try {
  if (!args.has('--unit')) {
    await requireSamples()
    if (!args.has('--regressions')) {
      chineseBefore = await readFile(chinesePath).catch(() => null)
      preserveChinese = true
      await mkdir('/tmp/pdfpro-shots', { recursive: true })
      const { ensureTestFixtures } = await import('./test-fixtures.mjs')
      await ensureTestFixtures()
    }
    await startVite()
  }
  for (const test of tests) {
    if (interrupted) break
    await run(test)
  }
  if (interrupted || results.some((result) => !result.ok) || results.length !== tests.length) process.exitCode = 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await stopTree(activeChild)
  await stopTree(vite)
  if (preserveChinese) {
    if (chineseBefore) await writeFile(chinesePath, chineseBefore)
    else await rm(chinesePath, { force: true })
  }
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  console.log(`Results: ${results.filter((result) => result.ok).length}/${tests.length} passed. Logs: ${logs}`)
}
