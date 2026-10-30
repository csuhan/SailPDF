import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
if (!files.length) throw new Error('No source files are staged or tracked.')
const forbidden =
  /^(?:\.scratch|node_modules|dist|release|website|\.openai|\.codex)\/|(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.DS_Store$|^public\/(?:samples|cmaps|standard_fonts|pdfjs-images)\//
const secrets = [
  /github_pat_[A-Za-z0-9_]{30,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,
]
const failures = []
for (const file of files) {
  if (
    forbidden.test(file) ||
    /\.(?:dmg|zip|dylib|icns|p12|pem|mobileprovision)$/i.test(file) ||
    file === 'native/pdfpro-ocr'
  )
    failures.push(`${file}: generated/private material`)
  const info = await stat(file)
  if (info.size > 5 * 1024 * 1024) failures.push(`${file}: unexpected large source file`)
  if (/\.(?:png|jpe?g|gif|webp)$/i.test(file)) continue
  const content = await readFile(file, 'utf8')
  if (secrets.some((pattern) => pattern.test(content))) failures.push(`${file}: possible embedded credential`)
  if (content.includes(homedir() + '/')) failures.push(`${file}: private workstation path`)
}
if (failures.length) throw new Error(`Publication review failed:\n${failures.join('\n')}`)
console.log(`Publication review passed for ${files.length} source/documentation files.`)
