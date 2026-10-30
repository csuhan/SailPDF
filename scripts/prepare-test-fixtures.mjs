// Generate synthetic PDFs locally. System fonts are never committed or shipped
// in the application: production builds omit public/samples entirely.
import fontkit from '@pdf-lib/fontkit'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const output = path.join(root, 'public/samples')
await mkdir(output, { recursive: true })
try {
  execFileSync('qpdf', ['--version'], { stdio: 'ignore' })
} catch {
  throw new Error('PDF fixture generation needs qpdf. On macOS: brew install qpdf')
}
for (const script of ['make-samples', 'make-form', 'make-images', 'make-fontdoc', 'make-links']) {
  execFileSync(process.execPath, [`scripts/${script}.mjs`], { stdio: 'inherit' })
}
const fonts = process.env.SAIL_TEST_FONT_DIR || '/System/Library/Fonts/Supplemental'
const cjkProgram = await readFile(path.join(fonts, 'Arial Unicode.ttf'))
const save = async (name, doc) => writeFile(path.join(output, name), await doc.save())

const mixed = await PDFDocument.create()
mixed.registerFontkit(fontkit)
const regular = await mixed.embedFont(await readFile(path.join(fonts, 'Georgia.ttf')), { subset: true })
const bold = await mixed.embedFont(await readFile(path.join(fonts, 'Georgia Bold.ttf')), { subset: true })
const mixedPage = mixed.addPage([612, 792])
mixedPage.drawText('Mixed line fidelity test', { x: 72, y: 730, size: 22, font: bold })
mixedPage.drawText('Status: ', { x: 72, y: 680, size: 13, font: bold })
mixedPage.drawText('deadline moved to next quarter', { x: 130, y: 680, size: 13, font: regular })
mixedPage.drawText('All letters: the quick brown fox jumps over a lazy dog.', {
  x: 72,
  y: 630,
  size: 12,
  font: regular,
})
await save('mixed-line.pdf', mixed)

const chinese = await PDFDocument.create()
chinese.registerFontkit(fontkit)
const cjk = await chinese.embedFont(cjkProgram, { subset: true })
const chinesePage = chinese.addPage([612, 792])
for (const [text, y, size] of [
  ['产品发布说明', 720, 22],
  ['本次更新修复了若干稳定性问题，建议所有用户升级。', 680, 12],
  ['本页包含多个文字测试示例。', 650, 12],
  ['发布时间：2026 年 10 月 28 日', 620, 12],
])
  chinesePage.drawText(text, { x: 72, y, size, font: cjk })
await save('chinese.pdf', chinese)

const contract = await PDFDocument.create()
contract.setTitle('Synthetic service agreement fixture')
contract.setAuthor('Sail PDF test suite')
contract.registerFontkit(fontkit)
const contractFont = await contract.embedFont(cjkProgram, { subset: true })
const contractPages = [
  [
    ['服务合同', 22],
    ['签订日期：2026年3月15日', 12],
    ['一、服务内容', 17],
    ['1. 需求调研报告', 12],
    ['2. 产品设计与交付', 12],
    ['二、费用与支付', 17],
    ['服务费用为 $48,000。违约金为合同金额的 20%，即 $9,600。', 12],
  ],
  [
    ['三、保密条款', 17],
    ['双方对项目资料承担保密义务。', 12],
    ['示例联系邮箱：test-reader@example.test', 12],
    ['本文件仅用于自动化测试，不构成真实合同。', 12],
  ],
  [
    ['四、验收与交付', 17],
    ['交付前完成团队审阅并保留原始文件。', 12],
    ['编号：0123456789', 12],
  ],
]
for (const lines of contractPages) {
  const page = contract.addPage([612, 792])
  let y = 720
  for (const [text, size] of lines) {
    page.drawText(text, { x: 72, y, size, font: contractFont })
    y -= size > 15 ? 48 : 34
  }
}
await save('contract.pdf', contract)

const big = await PDFDocument.create()
const latin = await big.embedFont(StandardFonts.Helvetica)
const canvas = createCanvas(1800, 1800),
  context = canvas.getContext('2d')
const pixels = context.createImageData(1800, 1800)
let seed = 123456789
for (let offset = 0; offset < pixels.data.length; offset += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const x = (offset / 4) % 1800,
    y = Math.floor(offset / 4 / 1800)
  const base = 150 + Math.floor(30 * Math.sin(x / 130) + 20 * Math.cos(y / 170))
  pixels.data[offset] = base + (seed & 7)
  pixels.data[offset + 1] = base - 10 + ((seed >>> 8) & 7)
  pixels.data[offset + 2] = base + 10 + ((seed >>> 16) & 7)
  pixels.data[offset + 3] = 255
}
context.putImageData(pixels, 0, 0)
const image = await big.embedPng(canvas.toBuffer('image/png'))
const bigPage = big.addPage([612, 792])
bigPage.drawImage(image, { x: 50, y: 120, width: 512, height: 512 })
bigPage.drawText('Optimize test page', { x: 72, y: 720, size: 20, font: latin, color: rgb(0.1, 0.2, 0.3) })
await save('bigimage.pdf', big)

const plain = await PDFDocument.create(),
  plainFont = await plain.embedFont(StandardFonts.Helvetica)
for (let n = 1; n <= 2; n++)
  plain
    .addPage([612, 792])
    .drawText(`Synthetic encrypted fixture page ${n}`, { x: 72, y: 720, size: 18, font: plainFont })
const plainFile = path.join(root, '.scratch/test-fixtures/encryption-source.pdf')
await mkdir(path.dirname(plainFile), { recursive: true })
await writeFile(plainFile, await plain.save())
const encrypt = (name, user, bits, permissions, extra = []) =>
  execFileSync(
    'qpdf',
    [...extra, '--encrypt', user, 'own', String(bits), ...permissions, '--', plainFile, path.join(output, name)],
    { stdio: 'inherit' },
  )
const restricted = ['--print=full', '--modify=none', '--extract=n']
encrypt('enc-aes256.pdf', '123', 256, restricted)
encrypt('enc-rc4.pdf', '123', 128, restricted, ['--allow-weak-crypto'])
encrypt('enc-restrict.pdf', '', 256, ['--print=none', '--modify=none', '--extract=n'])
execFileSync(process.execPath, ['scripts/generate-legal-notices.mjs'], { stdio: 'inherit' })
console.log('All synthetic PDF fixtures are ready. Generated fixtures stay outside Git and production packages.')
