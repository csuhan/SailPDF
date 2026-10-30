// Acrobat tool parity: true redaction (+ find & redact), optimize (compress),
// stamps, compare files, create PDF from images, crop pages.
// Needs the dev server on 5174; samples in public/samples (bigimage.pdf etc.).
import puppeteer from 'puppeteer-core'
import { ensureTestFixtures, TEST_EMAIL, TEST_READER, TEST_REFERENCE } from './test-fixtures.mjs'
const fixtures = await ensureTestFixtures()

const ORIGIN = 'http://127.0.0.1:5174'
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function open(file) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
  await page.goto(`${ORIGIN}/?file=${encodeURIComponent(file)}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro, { timeout: 20000 })
  await sleep(300)
  return page
}
const tab = (page, l) =>
  page.evaluate((l) => [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(l)).click(), l)
const card = (page, l) =>
  page.evaluate((l) => [...document.querySelectorAll('.tool-card')].find((b) => b.textContent.includes(l)).click(), l)
const btn = (page, sel, l) =>
  page.evaluate((sel, l) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(l)).click(), sel, l)
const outText = (page, pageNo = 1) =>
  page.evaluate(async (pageNo) => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const tc = await (await d.getPage(pageNo)).getTextContent()
    return tc.items.map((i) => i.str).join(' ')
  }, pageNo)

// ── redaction: find & redact an email, removed from the output ──
{
  const page = await open(fixtures.reviewUrl)
  const before = await outText(page)
  check('fixture has the email', before.includes(TEST_EMAIL))
  await tab(page, '工具')
  await sleep(200)
  await card(page, '查找并标记密文')
  await page.waitForSelector('.redact-modal')
  await btn(page, '.redact-modal .chip', '电子邮箱')
  await btn(page, '.redact-modal .btn', '查找')
  await page.waitForSelector('.redact-results li', { timeout: 20000 })
  const n = await page.$$eval('.redact-results li', (l) => l.length)
  check('find & redact lists the email matches', n >= 1, String(n))
  await page.click('.redact-modal .btn.primary')
  await sleep(300)
  const ops = await page.evaluate(
    () => window.__pdfpro.useEditStore.getState().ops.filter((o) => o.kind === 'redact').length,
  )
  check('redaction ops created', ops === n, `${ops} vs ${n}`)
  const after = await outText(page)
  check(
    'email removed from the saved text',
    !after.includes(TEST_EMAIL) && !after.includes('example.test'),
    after.slice(0, 200),
  )
  // text right next to it survives
  check('neighbouring text kept', after.includes(TEST_READER) && after.includes(TEST_REFERENCE), after.slice(0, 200))
  // link annotation on the email removed too
  const links = await page.evaluate(async () => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const a = await (await d.getPage(1)).getAnnotations()
    return a.filter((x) => (x.url ?? '').includes('mailto')).length
  })
  check('mailto link under the redaction removed', links === 0, String(links))
  await page.close()
}

// ── manual area redaction removes image + text below ──
{
  const page = await open('/samples/images.pdf')
  const info = await page.evaluate(async () => {
    const { getGlyphModel } = await import('/src/pdf/edit/glyphModel.ts')
    const p = await window.__pdfpro.useAppStore.getState().pdfDoc.getPage(1)
    const m = await getGlyphModel(p)
    const im = m.images[0]
    window.__pdfpro.useEditStore
      .getState()
      .pushOp({ kind: 'redact', id: 'rA', page: 1, x: im.box.x0 + 2, y: im.box.y0 + 2, width: 20, height: 20 })
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const m2 = await getGlyphModel(await d.getPage(1))
    return { before: m.images.length, after: m2.images.length }
  })
  check('image under a redaction is removed', info.after === info.before - 1, JSON.stringify(info))
  await page.close()
}

// ── optimize ──
{
  const page = await open('/samples/bigimage.pdf')
  await tab(page, '工具')
  await sleep(200)
  await card(page, '压缩 PDF')
  await page.waitForSelector('[aria-label="压缩 PDF"]')
  await page.click('[aria-label="压缩 PDF"] .btn.primary')
  await page.waitForSelector('.opt-result', { timeout: 30000 })
  const txt = await page.$eval('.opt-result', (e) => e.textContent)
  const reduction = Number(/减小 (\d+)%/.exec(txt)?.[1])
  check('optimize reports a big reduction', reduction >= 90 && reduction <= 100, txt)
  await btn(page, '[aria-label="压缩 PDF"] .btn', '替换当前文档')
  await sleep(800)
  const st = await page.evaluate(() => ({
    size: window.__pdfpro.useAppStore.getState().fileBytes.length,
    dirty: window.__pdfpro.useEditStore.getState().dirty,
  }))
  check('replaced document is small and unsaved', st.size < 100_000 && st.dirty, JSON.stringify(st))
  check('text survives optimizing', (await outText(page)).includes('Optimize test page'))
  await page.close()
}

// ── stamp ──
{
  const page = await open('/samples/sample.pdf')
  await tab(page, '批注')
  await sleep(200)
  await page.evaluate(() =>
    [...document.querySelectorAll('.mt-tool')].find((b) => b.textContent.includes('图章')).click(),
  )
  await page.waitForSelector('.stamp-picker')
  await btn(page, '.stamp-chip', '机密')
  const box = await (await page.$('.interaction-layer')).boundingBox()
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.waitForFunction(() => window.__pdfpro.useEditStore.getState().ops.some((o) => o.kind === 'image'), {
    timeout: 5000,
  })
  const op = await page.evaluate(() => {
    const o = window.__pdfpro.useEditStore.getState().ops.find((x) => x.kind === 'image')
    return {
      w: o.width,
      h: o.height,
      sel: window.__pdfpro.useEditStore.getState().selectedOpId === o.id,
      png: o.imageType,
    }
  })
  check('stamp placed as a selectable image', op.w > 60 && op.h > 30 && op.sel && op.png === 'png', JSON.stringify(op))
  await page.close()
}

// ── compare ──
{
  const page = await open('/samples/sample.pdf')
  // edit the document so it differs from the file on disk
  await page.evaluate(async () => {
    const { newOpId } = await import('/src/pdf/edit/ops.ts')
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'overlay-text',
      id: newOpId(),
      page: 1,
      x: 72,
      y: 40,
      text: 'Brandnewsentence',
      fontSize: 12,
      fontName: 'Helvetica',
      color: '#111111',
    })
  })
  const r = await page.evaluate(async () => {
    const { compareDocuments } = await import('/src/pdf/compare.ts')
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const orig = window.__pdfpro.useAppStore.getState().fileBytes
    const a = await pdfjs.getDocument({ data: orig.slice() }).promise
    const b = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const d = await compareDocuments(a, b)
    return d.map((x) => ({ a: x.added, r: x.removed, adds: x.tokens.filter((t) => t.op === 'add').map((t) => t.text) }))
  })
  check(
    'compare finds exactly the added text',
    r[0].a === 1 && r[0].r === 0 && r[0].adds[0] === 'Brandnewsentence' && r.slice(1).every((p) => !p.a && !p.r),
    JSON.stringify(r),
  )
  await tab(page, '工具')
  await sleep(200)
  await card(page, '比较文件')
  await page.waitForSelector('.compare-modal')
  check('compare dialog opens', true)
  await page.close()
}

// ── create PDF from images ──
{
  const page = await open('/samples/sample.pdf')
  await tab(page, '工具')
  await sleep(200)
  await card(page, '创建 PDF')
  await page.waitForSelector('.create-modal')
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.img-add')])
  await chooser.accept([fixtures.landscapePath, fixtures.portraitPath])
  await page.waitForFunction(() => document.querySelectorAll('.img-tile').length === 2)
  // reorder: second first
  await page.click('.img-tile:nth-child(2) [aria-label="前移"]')
  await page.click('.create-modal .btn.primary')
  // current doc unchanged -> opens directly
  await page.waitForFunction(() => window.__pdfpro.useAppStore.getState().fileName === '图片合集.pdf', {
    timeout: 10000,
  })
  const st = await page.evaluate(async () => {
    const a = window.__pdfpro.useAppStore.getState()
    const p1 = await a.pdfDoc.getPage(1)
    const v = p1.getViewport({ scale: 1 })
    return {
      n: a.numPages,
      w: Math.round(v.width),
      h: Math.round(v.height),
      dirty: window.__pdfpro.useEditStore.getState().dirty,
    }
  })
  // img2 (portrait 600x900) first on A4 portrait
  check(
    'images → 2-page PDF, reordered, A4, unsaved',
    st.n === 2 && st.w === 595 && st.h === 842 && st.dirty,
    JSON.stringify(st),
  )
  await page.close()
}

// ── crop ──
{
  const page = await open('/samples/sample.pdf')
  await tab(page, '工具')
  await sleep(200)
  await card(page, '裁剪页面')
  await page.waitForSelector('[aria-label="裁剪页面"]')
  await btn(page, '[aria-label="裁剪页面"] .btn', '自动去除白边')
  await page.waitForFunction(
    () => [...document.querySelectorAll('[aria-label="裁剪页面"] input')].some((i) => Number(i.value) > 0),
    { timeout: 10000 },
  )
  await page.click('[aria-label="裁剪页面"] .btn.primary')
  await sleep(300)
  const r = await page.evaluate(async () => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d0 = window.__pdfpro.useAppStore.getState().pdfDoc
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const v0 = (await d0.getPage(1)).view
    const v1 = (await d.getPage(1)).view
    const t0 = (await (await d0.getPage(1)).getTextContent()).items.map((i) => i.str).join('')
    const t1 = (await (await d.getPage(1)).getTextContent()).items.map((i) => i.str).join('')
    return { v0, v1, same: t0 === t1, n: d.numPages }
  })
  const w0 = r.v0[2] - r.v0[0]
  const w1 = r.v1[2] - r.v1[0]
  check('auto crop shrinks the page box', w1 < w0 - 20 && r.v1[3] - r.v1[1] < r.v0[3] - r.v0[1], JSON.stringify(r))
  check('crop keeps the content', r.same)
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
console.log(failures ? `\n${failures} FAILED` : '\nACROBAT TOOLS TESTS PASS')
process.exit(failures ? 1 : 0)
