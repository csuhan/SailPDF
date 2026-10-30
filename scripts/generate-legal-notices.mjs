import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

// Electron 45 installs its runtime lazily. Resolve it before reading bundled licenses.
createRequire(import.meta.url)('electron')
const root = process.cwd(),
  out = path.join(root, 'public/legal')
await mkdir(out, { recursive: true })
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const sections = [
  'Sail PDF third-party software licenses / 第三方软件许可与声明\n生成自本构建的 package-lock.json；Sail PDF 自有代码采用 Apache-2.0，以下第三方内容遵循其各自许可。\n',
]
for (const [relative, entry] of Object.entries(lock.packages).sort()) {
  if (!relative || entry.dev || relative.includes('node_modules/@napi-rs/') || !relative.startsWith('node_modules/'))
    continue
  const folder = path.join(root, relative)
  try {
    const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
    const files = (await readdir(folder)).filter((name) =>
      /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(name),
    )
    sections.push(
      `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense / 许可：${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? entry.license ?? '见上游声明')}\nSource / 来源：${typeof pkg.repository === 'object' ? pkg.repository.url : (pkg.repository ?? pkg.homepage ?? '')}\n`,
    )
    if (!files.length) {
      const readme = await readFile(path.join(folder, 'README.md'), 'utf8')
      const licensePart = readme.slice(readme.search(/^##? License/m))
      sections.push(
        `Package author / 发布包作者：${JSON.stringify(pkg.author ?? '')}\nContributors / 贡献者：${JSON.stringify(pkg.contributors ?? [])}\n发布包未包含单独许可文件，其 README 声明：\n${licensePart}\n`,
      )
      if (!/Permission is hereby granted/.test(licensePart)) {
        if (pkg.license !== 'MIT') throw new Error(`Missing license text: ${relative}`)
        const mit = await readFile('node_modules/pdf-lib/LICENSE.md', 'utf8')
        sections.push(
          `标准 MIT 条款（作者信息见上述发布包归属声明）：\n${mit.slice(mit.indexOf('Permission is hereby granted'))}`,
        )
      }
      if (pkg.name === '@pdf-lib/fontkit') {
        const bundle = await readFile(path.join(folder, 'dist/fontkit.es.js'), 'utf8')
        const comments = bundle.match(/(?:^\s*\/\/[^\n]*(?:\n|$))+/gm) ?? []
        sections.push(
          '发行源码中保留的附加版权与许可声明：\n' +
            comments
              .filter((block) => /Copyright|Permission is hereby|THE SOFTWARE IS PROVIDED/i.test(block))
              .join('\n'),
        )
      }
    }
    for (const file of files) {
      try {
        sections.push(`\n[${file}]\n${await readFile(path.join(folder, file), 'utf8')}\n`)
      } catch (error) {
        if (error.code !== 'EISDIR') throw error
      }
    }
  } catch (error) {
    if (error.code === 'ENOENT' && entry.optional) continue
    throw new Error(`Cannot generate notices for ${relative}: ${error.message}`)
  }
}
for (const [label, file] of [
  ['PDF.js CMaps', 'public/cmaps/LICENSE'],
  ['Foxit 标准字体', 'public/standard_fonts/LICENSE_FOXIT'],
  ['Liberation 标准字体', 'public/standard_fonts/LICENSE_LIBERATION'],
  ['llama.cpp b11980', 'vendor/llama/LICENSE'],
  ['Electron', 'node_modules/electron/dist/LICENSE'],
])
  sections.push(`\n${'='.repeat(72)}\n${label}\n${await readFile(file, 'utf8')}\n`)
await writeFile(path.join(out, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n'))
const chromium = await readFile('node_modules/electron/dist/LICENSES.chromium.html', 'utf8')
const text = chromium
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<\/(?:p|div|h[1-6]|pre|li|table|tr)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
await writeFile(path.join(out, 'CHROMIUM_NOTICES.txt'), text)
await copyFile('node_modules/electron/dist/LICENSES.chromium.html', path.join(out, 'LICENSES.chromium.html'))
await copyFile('node_modules/pdfjs-dist/LICENSE', path.join(out, 'APACHE-2.0.txt'))
console.log('Third-party, font, Electron/Chromium and llama.cpp notices generated.')
await writeFile(
  path.join(out, 'PROJECT_LICENSE.txt'),
  (await readFile('NOTICE', 'utf8')) + '\n' + (await readFile('LICENSE', 'utf8')),
)
