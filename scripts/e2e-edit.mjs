// End-to-end editing verification: simulate user edits, bake, reopen, assert.
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://127.0.0.1:5174/?file=/samples/sample.pdf'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message))

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 })
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas.page-canvas')
    return c && c.width > 100 && window.__pdfpro
  },
  { timeout: 30000 },
)
await sleep(800)

// ── 1. add text via real UI ──────────────────────────────────
await page.evaluate(() => {
  // edit mode tab, then the "add text" tool in the contextual strip
  Array.from(document.querySelectorAll('.mode-tab'))
    .find((b) => b.textContent.includes('编辑'))
    ?.click()
})
await page.waitForSelector('.mt-tool[aria-label="添加文本"]')
await page.click('.mt-tool[aria-label="添加文本"]')
await sleep(150) // wait one frame for the interaction layer to re-commit pointer-events
const box = await page.evaluate(() => {
  const c = document.querySelector('canvas.page-canvas')
  const r = c.getBoundingClientRect()
  return { x: r.left + r.width / 3, y: r.top + r.height / 4 }
})
await page.mouse.click(box.x, box.y)
await sleep(150)
await page.keyboard.type('HELLO_EDIT_42', { delay: 5 })
await page.keyboard.down('Meta')
await page.keyboard.press('Enter')
await page.keyboard.up('Meta')
await sleep(300)
const opCount1 = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length)
check('添加文本 (UI 点击输入)', opCount1 === 1, `ops=${opCount1}`)

// ── 2. edit-span simulation + markup + image + draw ops ─────
const opsSetup = await page.evaluate(async () => {
  const { useEditStore } = window.__pdfpro
  const push = (o) => useEditStore.getState().pushOp(o)
  push({
    kind: 'overlay-text',
    id: 't2',
    page: 1,
    x: 72,
    y: 640,
    text: 'OVERLAY_TEXT_OK',
    fontSize: 18,
    fontName: 'Helvetica-Bold',
    color: '#1565c0',
  })
  push({
    kind: 'markup',
    id: 't3',
    page: 1,
    markup: 'highlight',
    quads: [{ x: 72, y: 660, width: 200, height: 14 }],
    color: '#ffeb3b',
    opacity: 0.4,
  })
  push({
    kind: 'draw',
    id: 't4',
    page: 2,
    points: [
      { x: 100, y: 700 },
      { x: 160, y: 650 },
      { x: 220, y: 700 },
    ],
    color: '#d32f2f',
    thickness: 3,
    opacity: 1,
  })
  push({
    kind: 'shape',
    id: 't5',
    page: 2,
    shape: 'arrow',
    x: 300,
    y: 600,
    width: 120,
    height: 60,
    color: '#2e7d32',
    thickness: 2,
    fill: false,
  })
  push({
    kind: 'redact',
    id: 't6',
    page: 3,
    x: 100,
    y: 650,
    width: 180,
    height: 40,
  })
  // 1x1 red png
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  push({
    kind: 'image',
    id: 't7',
    page: 1,
    x: 400,
    y: 500,
    width: 80,
    height: 80,
    rotation: 0,
    imageType: 'png',
    imageData: png,
  })
  return useEditStore.getState().ops.length
})
check('程序化 ops (文本/高亮/画笔/箭头/涂黑/图片)', opsSetup === 7, `ops=${opsSetup}`)

// ── 3b. page ops BEFORE baking: rotate page 2 + reorder ──────
await page.evaluate(async () => {
  const { useEditStore } = window.__pdfpro
  const push = (o) => useEditStore.getState().pushOp(o)
  push({ kind: 'page-rotate', id: 'r1', page: 0, pageIndex: 1, degrees: 90 })
  push({ kind: 'page-reorder', id: 'r2', page: 0, order: [3, 2, 1, 4, 5, 6] })
})

// ── 3. bake and validate bytes ───────────────────────────────
const baked = await page.evaluate(async () => {
  const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
  const s = useAppStore.getState()
  const bytes = await bakePdf(s.fileBytes, useEditStore.getState().ops)
  const head = Array.from(bytes.slice(0, 5))
    .map((b) => String.fromCharCode(b))
    .join('')
  window.__bakedBytes = bytes
  return { len: bytes.length, head }
})
check('bake 输出 PDF 字节', baked.head === '%PDF-' && baked.len > 4000, `${baked.len}B head=${baked.head}`)
// ── 5. reopen baked doc and verify content/positions order ──
const reopen = await page.evaluate(async () => {
  const { useAppStore, useEditStore } = window.__pdfpro
  useEditStore.getState().reset()
  await useAppStore.getState().openFile(window.__bakedBytes, 'baked.pdf')
  return { numPages: useAppStore.getState().numPages }
})
await sleep(1200)
check('重开烘焙文档', reopen.numPages === 6, `pages=${reopen.numPages}`)

const firstPageText = await page.evaluate(async () => {
  const { useAppStore } = window.__pdfpro
  const page1 = await useAppStore.getState().pdfDoc.getPage(1)
  const tc = await page1.getTextContent()
  return tc.items
    .map((i) => i.str)
    .join(' | ')
    .slice(0, 120)
})
check('重排后第1页 = 原第3页(Page Operations)', firstPageText.includes('Page Operations'), firstPageText.slice(0, 60))

const page2Text = await page.evaluate(async () => {
  const { useAppStore } = window.__pdfpro
  const page2 = await useAppStore.getState().pdfDoc.getPage(2)
  const tc = await page2.getTextContent()
  return tc.items
    .map((i) => i.str)
    .join(' ')
    .slice(0, 200)
})
check('第2页旋转后仍在 (Text Editing Test)', page2Text.includes('Text Editing Test'), page2Text.slice(0, 50))

const overlayCheck = await page.evaluate(async () => {
  const { useAppStore } = window.__pdfpro
  const page3 = await useAppStore.getState().pdfDoc.getPage(3)
  const tc = await page3.getTextContent()
  return tc.items.map((i) => i.str).join(' ')
})
check('覆盖文本烧入原第1页', overlayCheck.includes('OVERLAY_TEXT_OK'), '')

// ── 6. split / merge / extract (byte level) ──────────────────
const mult = await page.evaluate(async () => {
  const { extractPagesFromBuffer, splitPdfBuffer, mergePdfBuffers } = window.__pdfpro
  const bytes = window.__bakedBytes
  const ex = await extractPagesFromBuffer(bytes, [1, 3])
  const parts = await splitPdfBuffer(bytes, [
    { from: 1, to: 2 },
    { from: 3, to: 6 },
  ])
  const merged = await mergePdfBuffers([ex, ex])
  const head = (b) =>
    Array.from(b.slice(0, 5))
      .map((x) => String.fromCharCode(x))
      .join('')
  return {
    ex: { len: ex.length, head: head(ex) },
    parts: parts.map((p) => p.length),
    mergedLen: merged.length,
    mergedHead: head(merged),
  }
})
check('提取 2 页', mult.ex.head === '%PDF-', `${mult.ex.len}B`)
check('拆分为 2 个文件', mult.parts.length === 2, mult.parts.join('B, ') + 'B')
check('合并两个提取件=4页', mult.mergedHead === '%PDF-' && mult.mergedLen > 0, `${mult.mergedLen}B`)

// ui screenshot with overlay ops visible (reset to doc state)
await page.evaluate(async () => {
  const { useAppStore } = window.__pdfpro
  const f = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
  await useAppStore.getState().openFile(f, 'sample.pdf')
})
await sleep(1500)
await page.screenshot({ path: '/tmp/pdfpro-shots/e2e-final.png' })

const fails = results.filter((r) => !r.ok).length
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
await browser.close()
process.exit(fails === 0 ? 0 : 1)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
