// Fetch the pinned llama.cpp release and keep only llama-server + the
// dylibs it loads (rpath = @loader_path → same directory) in vendor/llama.
// Run once before packaging: node scripts/fetch-llama.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TAG = 'b11980'
const ASSET = { 'darwin-arm64': `llama-${TAG}-bin-macos-arm64.tar.gz` }
const SHA256 = { 'darwin-arm64': 'b7d060dd22924984dcb924fdea9858bd5bec2638217b6435fd16da55524f5524' }

const key = `${process.platform}-${process.arch}`
const asset = ASSET[key]
if (!asset) {
  console.error(`no llama.cpp build configured for ${key}`)
  process.exit(1)
}
const out = new URL('../vendor/llama/', import.meta.url).pathname
if (
  existsSync(join(out, 'llama-server')) &&
  existsSync(join(out, 'VERSION')) &&
  existsSync(join(out, 'LICENSE')) &&
  readFileSync(join(out, 'VERSION'), 'utf8').trim() === TAG
) {
  console.log(`vendor/llama already at ${TAG}`)
  process.exit(0)
}
const tmp = mkdtempSync(join(tmpdir(), 'llama-'))
const tgz = join(tmp, asset)
const url = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${asset}`
console.log('downloading', url)
execFileSync('curl', ['-fL', '--retry', '3', '-o', tgz, url], { stdio: 'inherit' })
const sum = createHash('sha256').update(readFileSync(tgz)).digest('hex')
if (SHA256[key] && SHA256[key] !== sum) throw new Error(`checksum mismatch: ${sum}`)
console.log('sha256', sum)
execFileSync('tar', ['xzf', tgz, '-C', tmp])
const src = join(tmp, `llama-${TAG}`)
mkdirSync(out, { recursive: true })

// llama-server and its dylib closure (resolve @rpath names against src)
const need = new Set(['llama-server'])
const queue = ['llama-server']
while (queue.length) {
  const f = queue.pop()
  const deps = execFileSync('otool', ['-L', join(src, f)], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /@rpath\/(\S+)/.exec(l)?.[1])
    .filter(Boolean)
  for (const d of deps) if (!need.has(d)) (need.add(d), queue.push(d))
}
for (const f of need) copyFileSync(join(src, f), join(out, f)) // follows symlinks
copyFileSync(join(src, 'LICENSE'), join(out, 'LICENSE'))
writeFileSync(join(out, 'VERSION'), TAG + '\n')
// Remove quarantine from verified build inputs. Distribution signing is configured separately.
execFileSync('xattr', ['-cr', out])
console.log('vendor/llama:', readdirSync(out).join(', '))
