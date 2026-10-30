import assert from 'node:assert/strict'
// End-to-end CJK edit fidelity: make a Chinese PDF with an embedded local CJK font,
// edit a line in-app, bake, reopen, verify text + font + capture screenshots.
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

// 1) get a usable local CJK program through the production font resolver
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const preBrowser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu'] })
const pre = await preBrowser.newPage()
const preCdp = await pre.createCDPSession()
await preCdp.send('Browser.setPermission', {
  permission: { name: 'local-fonts' },
  setting: 'granted',
  origin: 'http://127.0.0.1:5174',
})
await pre.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle2' })
await pre.waitForFunction(() => window.__pdfpro)
const b64 = await pre.evaluate(async () => {
  const { loadSystemCjkFont } = await import('/src/pdf/edit/cjkFont.ts')
  const buf = await loadSystemCjkFont()
  if (!buf) throw new Error('No usable installed CJK font')
  let s = ''
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192))
  return btoa(s)
})
await preBrowser.close()
const pf = new Uint8Array(Buffer.from(b64, 'base64'))
console.log('CJK program bytes:', pf.length, 'tag:', String.fromCharCode(...pf.slice(0, 4)))

// 2) generate a Chinese test doc with an embedded local CJK font (subset, like real docs)
const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
const cjk = await doc.embedFont(pf)
const pg = doc.addPage([612, 792])
pg.drawText('产品发布说明', { x: 72, y: 720, size: 22, font: cjk, color: rgb(0.12, 0.16, 0.4) })
pg.drawText('本次更新修复了若干稳定性问题，建议所有用户升级。', {
  x: 72,
  y: 680,
  size: 12,
  font: cjk,
  color: rgb(0.15, 0.15, 0.15),
})
pg.drawText('发布时间：2026 年 10 月 28 日', { x: 72, y: 656, size: 12, font: cjk, color: rgb(0.4, 0.4, 0.4) })
const bytes = await doc.save()
writeFileSync('public/samples/chinese.pdf', bytes)
console.log('chinese.pdf written:', bytes.length)

// 3) edit in app
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--force-device-scale-factor=2'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => {
  pageErrors.push(e.message)
  console.error('[PAGEERROR]', e.message)
})
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('pdf-pro')) console.log('[page]', t.slice(0, 160))
})
const cdp = await page.createCDPSession()
await cdp.send('Browser.setPermission', {
  permission: { name: 'local-fonts' },
  setting: 'granted',
  origin: 'http://127.0.0.1:5174',
})

await page.goto('http://127.0.0.1:5174/?file=/samples/chinese.pdf', { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
await new Promise((r) => setTimeout(r, 800))
await page.evaluate(() => window.__pdfpro.useToolStore.getState().setTool('edit-text'))
await new Promise((r) => setTimeout(r, 500))
const pt = await page.evaluate(() => {
  const s = Array.from(document.querySelectorAll('.textLayer span')).find((x) => x.textContent?.includes('本次更新'))
  const r = s.getBoundingClientRect()
  return { x: r.left + 30, y: r.top + r.height / 2 }
})
await page.mouse.click(pt.x, pt.y)
await new Promise((r) => setTimeout(r, 500))
const ed = await page.evaluate(() => {
  const e = document.querySelector('.inline-text-editor')
  if (!e) return null
  const cs = getComputedStyle(e)
  return { text: e.innerText, font: cs.fontFamily }
})
console.log('editor:', JSON.stringify(ed))
await page.evaluate(() => {
  document.querySelector('.inline-text-editor').innerText = '本次更新新增了 PDF 编辑功能，并修复了稳定性问题。'
})
await page.keyboard.down('Meta')
await page.keyboard.press('Enter')
await page.keyboard.up('Meta')
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({
  path: '/tmp/pdfpro-shots/cjk-edit-preview.png',
  clip: { x: 200, y: 200, width: 1200, height: 260 },
})

const baked = await page.evaluate(async () => {
  const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
  const bytes = await bakePdf(useAppStore.getState().fileBytes, useEditStore.getState().ops)
  window.__bk = bytes
  useEditStore.getState().reset()
  await useAppStore.getState().openFile(bytes, 'baked-cjk.pdf')
  return bytes.length
})
console.log('baked:', baked)
await new Promise((r) => setTimeout(r, 900))
const check = await page.evaluate(async () => {
  const { useAppStore } = window.__pdfpro
  const page1 = await useAppStore.getState().pdfDoc.getPage(1)
  const tc = await page1.getTextContent()
  // edited text is laid out in pieces (spaces are positioned gaps), so compare
  // with whitespace normalized
  const joined = tc.items
    .map((i) => i.str)
    .join('')
    .replace(/\s+/g, '')
  return { ok: joined.includes('本次更新新增了PDF编辑功能'), snippet: joined.slice(0, 80) }
})
console.log('reopen check:', JSON.stringify(check))
if (!(check.has ?? check.ok)) {
  await browser.close()
  assert.fail('Exported CJK text did not survive reopening')
}
await page.screenshot({
  path: '/tmp/pdfpro-shots/cjk-edit-baked.png',
  clip: { x: 200, y: 200, width: 1200, height: 260 },
})
await browser.close()
assert.deepEqual(pageErrors, [], 'Unexpected browser error')
console.log('done')
