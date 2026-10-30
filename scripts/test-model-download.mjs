// Downloader tests (electron/llm/downloader.cjs) against a local HTTP server
// that supports Range, redirects and can be told to drop the connection.
import { createRequire } from 'node:module'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { downloadVerified } = require('../electron/llm/downloader.cjs')
const data = readFileSync(process.argv[2])
const sha = createHash('sha256').update(data).digest('hex')
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}
let dropAfter = 0 // bytes; 0 = never
let ignoreRange = false
let lastRange = ''
const srv = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/file' })
    return res.end()
  }
  lastRange = req.headers.range || ''
  const m = /bytes=(\d+)-/.exec(lastRange)
  const start = m && !ignoreRange ? +m[1] : 0
  res.writeHead(start ? 206 : 200, { 'content-length': data.length - start, 'accept-ranges': 'bytes' })
  const body = data.subarray(start)
  if (dropAfter) {
    res.write(body.subarray(0, dropAfter))
    setTimeout(() => res.destroy(), 50)
  } else res.end(body)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
const dir = mkdtempSync(join(tmpdir(), 'dl-test-'))

// 1. interrupted download, then resume with Range
const dest = join(dir, 'm.gguf')
dropAfter = 5_000_000
let err = ''
let progress = 0
try {
  await downloadVerified({
    url: `${base}/redirect`,
    dest,
    size: data.length,
    sha256: sha,
    onProgress: (d) => (progress = d),
  })
} catch (e) {
  err = e.message
}
check(
  'connection drop is reported, partial kept',
  !!err && existsSync(dest + '.part') && !existsSync(dest) && statSync(dest + '.part').size === 5_000_000,
  err,
)
dropAfter = 0
await downloadVerified({
  url: `${base}/redirect`,
  dest,
  size: data.length,
  sha256: sha,
  onProgress: (d) => (progress = d),
})
check('resume asks for the remaining bytes only (via redirect)', lastRange === 'bytes=5000000-', lastRange)
check(
  'resumed file complete + verified + renamed',
  existsSync(dest) &&
    !existsSync(dest + '.part') &&
    createHash('sha256').update(readFileSync(dest)).digest('hex') === sha &&
    progress === data.length,
)

// 2. checksum mismatch: never installed, partial removed
const dest2 = join(dir, 'bad.gguf')
err = ''
try {
  await downloadVerified({ url: `${base}/file`, dest: dest2, size: data.length, sha256: '0'.repeat(64) })
} catch (e) {
  err = e.message
}
check(
  'checksum mismatch → error, nothing installed',
  /校验失败/.test(err) && !existsSync(dest2) && !existsSync(dest2 + '.part'),
  err,
)

// 3. corrupted partial file (bytes changed) → final hash fails, then a clean retry works
const dest3 = join(dir, 'c.gguf')
const broken = Buffer.from(data.subarray(0, 4_000_000))
broken[1000] ^= 0xff
writeFileSync(dest3 + '.part', broken)
err = ''
try {
  await downloadVerified({ url: `${base}/file`, dest: dest3, size: data.length, sha256: sha })
} catch (e) {
  err = e.message
}
check('corrupted partial is detected and discarded', /校验失败/.test(err) && !existsSync(dest3 + '.part'), err)
await downloadVerified({ url: `${base}/file`, dest: dest3, size: data.length, sha256: sha })
check('clean retry succeeds', existsSync(dest3))

// 4. server ignores Range → restarts from zero, still correct
const dest4 = join(dir, 'r.gguf')
writeFileSync(dest4 + '.part', data.subarray(0, 3_000_000))
ignoreRange = true
await downloadVerified({ url: `${base}/file`, dest: dest4, size: data.length, sha256: sha })
ignoreRange = false
check(
  'server without Range support: restart, verified',
  createHash('sha256').update(readFileSync(dest4)).digest('hex') === sha,
)

// 5. cancel
const dest5 = join(dir, 'x.gguf')
dropAfter = 0
const ctrl = new AbortController()
err = ''
const p = downloadVerified({
  url: `${base}/file`,
  dest: dest5,
  size: data.length,
  sha256: sha,
  signal: ctrl.signal,
  onProgress: () => ctrl.abort(),
})
try {
  await p
} catch (e) {
  err = e.message
}
check('cancel stops the download, nothing installed', /取消/.test(err) && !existsSync(dest5), err)

srv.close()
console.log(failures ? `\n${failures} FAILED` : '\nDOWNLOAD TESTS PASS')
process.exit(failures ? 1 : 0)
