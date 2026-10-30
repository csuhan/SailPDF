// Acrobat-style tools: watermark, page numbers, sticky note (real PDF
// annotation), document properties, form filling, signature, exports.
// Needs the dev server on 5174 and public/samples/form.pdf (node scripts/make-form.mjs).
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'

const ORIGIN = 'http://127.0.0.1:5174'
const DL = `/tmp/pdfpro-tools-${Date.now()}`
mkdirSync(DL)
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})
let failures = 0
const results = []
const check = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}
async function open(file) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
  await cdp.send('Browser.setPermission', { permission: { name: 'local-fonts' }, setting: 'granted', origin: ORIGIN })
  await page.goto(`${ORIGIN}/?file=${file}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
  await new Promise((r) => setTimeout(r, 500))
  return page
}
const tab = (page, l) =>
  page.evaluate((l) => [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(l)).click(), l)
const card = (page, l) =>
  page.evaluate((l) => [...document.querySelectorAll('.tool-card')].find((b) => b.textContent.includes(l)).click(), l)
const output = (page, fn) =>
  page.evaluate(async (fn) => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    // eslint-disable-next-line no-new-func
    return new Function('d', `return (async () => { ${fn} })()`)(d)
  }, fn)

// ── watermark, page numbers, note, properties ──
{
  const page = await open('/samples/sample.pdf')
  await tab(page, '工具')
  await new Promise((r) => setTimeout(r, 300))
  check('tools hub lists the tools', (await page.$$('.tool-card')).length >= 15)
  await card(page, '水印')
  await page.waitForSelector('.form-modal')
  await page.click('.form-modal .btn.primary')
  await tab(page, '工具')
  await new Promise((r) => setTimeout(r, 200))
  await card(page, '页码')
  await page.waitForSelector('.form-modal')
  await page.click('.form-modal .btn.primary')
  await card(page, '文档属性')
  await page.waitForSelector('.form-modal')
  await page.click('.form-modal .form-input', { clickCount: 3 })
  await page.keyboard.type('测试标题 Test')
  await page.click('.form-modal .btn.primary')
  await tab(page, '批注')
  await new Promise((r) => setTimeout(r, 300))
  await page.click('.mt-tool[aria-label="注释"]')
  const p = await page.evaluate(() => {
    const r = document.querySelector('.page-box .interaction-layer').getBoundingClientRect()
    return { x: r.left + 500, y: r.top + 300 }
  })
  await page.mouse.click(p.x, p.y)
  await page.waitForSelector('.note-popup textarea')
  await page.keyboard.type('请核对这一段数据', { delay: 5 })
  await page.keyboard.down('Meta')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Meta')
  const r = await output(
    page,
    `const p1 = await d.getPage(1); const p3 = await d.getPage(3)
     const t1 = (await p1.getTextContent()).items.map((i) => i.str).join(' ')
     const t3 = (await p3.getTextContent()).items.map((i) => i.str).join(' ')
     const ann = (await p1.getAnnotations()).map((a) => a.subtype + ':' + (a.contentsObj?.str ?? ''))
     const meta = await d.getMetadata()
     return { wm: t1.includes('内部资料'), n1: /\\b1 \\/ 6\\b/.test(t1), n3: /\\b3 \\/ 6\\b/.test(t3), ann, title: meta.info.Title }`,
  )
  check('watermark on the page', r.wm, JSON.stringify(r))
  check('page numbers "n / total"', r.n1 && r.n3, JSON.stringify(r))
  check('sticky note saved as a PDF annotation', r.ann.includes('Text:请核对这一段数据'), JSON.stringify(r.ann))
  check('document title saved', r.title === '测试标题 Test', JSON.stringify(r.title))

  // exports
  await tab(page, '工具')
  await new Promise((r2) => setTimeout(r2, 200))
  await card(page, '导出为文本')
  await new Promise((r2) => setTimeout(r2, 2500))
  await card(page, '导出为图片')
  await page.waitForSelector('.form-modal')
  await page.click('.form-modal .btn.primary')
  await new Promise((r2) => setTimeout(r2, 6000))
  const files = readdirSync(DL)
  const txt = files.find((f) => f.endsWith('.txt'))
  const zip = files.find((f) => f.endsWith('.zip'))
  check(
    'export as text',
    !!txt && readFileSync(`${DL}/${txt}`, 'utf8').includes('Sail PDF Feature Test'),
    JSON.stringify(files),
  )
  check(
    'export pages as images (zip)',
    !!zip && readFileSync(`${DL}/${zip}`).subarray(0, 2).toString() === 'PK',
    JSON.stringify(files),
  )
  await page.close()
}

// ── form filling ──
{
  const page = await open('/samples/form.pdf')
  await page.waitForSelector('.annotationLayer input')
  const inputs = await page.$$('.annotationLayer input[type="text"]')
  await inputs[0].click()
  await page.keyboard.type('韩佳明 Jiaming')
  await page.select('.annotationLayer select', 'Japan')
  await page.click('.annotationLayer input[type="checkbox"]')
  await page.mouse.click(1300, 800)
  await new Promise((r) => setTimeout(r, 300))
  const dirty = await page.evaluate(() => window.__pdfpro.useEditStore.getState().dirty)
  check('filling a field marks the document dirty', dirty)
  const v = await page.evaluate(async () => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { PDFDocument } = await import('/node_modules/.vite/deps/pdf-lib.js')
    const f = (await PDFDocument.load(await currentOutputBytes())).getForm()
    return {
      name: f.getTextField('name').getText(),
      country: f.getDropdown('country').getSelected(),
      sub: f.getCheckBox('subscribe').isChecked(),
    }
  })
  check(
    'form values are written into the saved PDF',
    v.name === '韩佳明 Jiaming' && v.country[0] === 'Japan' && v.sub,
    JSON.stringify(v),
  )

  // signature
  await page.evaluate(() => localStorage.removeItem('pdfpro.signature'))
  await tab(page, '编辑')
  await new Promise((r) => setTimeout(r, 300))
  await page.click('.mt-tool[aria-label="签名"]')
  const at = await page.evaluate(() => {
    const r = document.querySelector('.page-box .interaction-layer').getBoundingClientRect()
    return { x: r.left + r.width * 0.6, y: Math.min(r.top + r.height * 0.75, innerHeight - 160) }
  })
  await page.mouse.click(at.x, at.y)
  await page.waitForSelector('.sig-pad')
  const pad = await page.$eval('.sig-pad', (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.left, y: r.top }
  })
  await page.mouse.move(pad.x + 40, pad.y + 110)
  await page.mouse.down()
  for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 40 + i * 12, pad.y + 100 + Math.sin(i / 3) * 40)
  await page.mouse.up()
  await page.click('.sig-modal .btn.primary')
  await new Promise((r) => setTimeout(r, 800))
  const placed = await page.evaluate(() => {
    const o = window.__pdfpro.useEditStore.getState().ops.at(-1)
    return o?.kind === 'image' && window.__pdfpro.useEditStore.getState().selectedOpId === o.id
  })
  check('drawn signature is placed and selected', placed)
  await page.evaluate(() => window.__pdfpro.useToolStore.getState().setTool('signature'))
  await page.mouse.click(at.x - 200, at.y - 150)
  await new Promise((r) => setTimeout(r, 600))
  const n = await page.evaluate(
    () => window.__pdfpro.useEditStore.getState().ops.filter((o) => o.kind === 'image').length,
  )
  check('saved signature is reused without the dialog', n === 2 && !(await page.$('.sig-modal')), String(n))
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nTOOLS TESTS PASS')
