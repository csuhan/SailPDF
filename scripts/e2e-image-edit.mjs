// End-to-end editing of ORIGINAL page images through the UI (edit-text tool):
// click image → action bar → delete / replace / restore / export; then bake
// and verify the saved PDF's images exactly. Needs the dev server on 5174
// and public/samples/images.pdf (node scripts/make-images.mjs).
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { png } from './make-images.mjs'

const ORIGIN = 'http://127.0.0.1:5174'
const GREEN = '/tmp/pdfpro-e2e-green.png'
writeFileSync(
  GREEN,
  png(40, 20, () => [0, 200, 0, 255]),
)

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

async function openDoc() {
  const page = await browser.newPage()
  page.on('pageerror', (e) => {
    failures++
    results.push(`❌ page error: ${e.message}`)
  })
  await page.goto(`${ORIGIN}/?file=/samples/images.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
  await new Promise((r) => setTimeout(r, 700))
  await page.evaluate(() => window.__pdfpro.useToolStore.getState().setTool('edit-text'))
  await new Promise((r) => setTimeout(r, 400))
  return page
}

/** click a pdf point on view page `vp` */
async function clickPdf(page, x, y, vp = 1) {
  const pt = await page.evaluate(
    ([x, y, vp]) => {
      const box = document.querySelector(`.page-box[data-page="${vp}"]`)
      box.scrollIntoView({ block: 'center' })
      const il = box.querySelector('.interaction-layer').getBoundingClientRect()
      const s = window.__pdfpro.useAppStore.getState().scale
      return { x: il.left + x * s, y: il.top + (792 - y) * s }
    },
    [x, y, vp],
  )
  await new Promise((r) => setTimeout(r, 300))
  await page.mouse.click(pt.x, pt.y)
  await new Promise((r) => setTimeout(r, 500))
}

const barOpen = (page) => page.evaluate(() => !!document.querySelector('.image-action-bar'))

/** images of the baked document: per page list of [x0,y0,x1,y1,w,h] */
async function bakedImages(page) {
  return page.evaluate(async () => {
    const { getGlyphModel } = await import('/src/pdf/edit/glyphModel.ts')
    const pdfjs = await import('/node_modules/.vite/deps/pdfjs-dist.js')
    if (!pdfjs.GlobalWorkerOptions.workerSrc)
      pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
    const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
    const bytes = await bakePdf(useAppStore.getState().fileBytes, useEditStore.getState().ops)
    const d = await pdfjs.getDocument({ data: bytes.slice() }).promise
    const out = []
    for (let pn = 1; pn <= d.numPages; pn++) {
      const pg = await d.getPage(pn)
      const m = await getGlyphModel(pg)
      const text = (await pg.getTextContent()).items.map((i) => i.str).join('')
      out.push({
        text,
        images: m.images.map((i) =>
          [i.box.x0, i.box.y0, i.box.x1, i.box.y1, i.width, i.height].map((v) => Math.round(v)),
        ),
      })
    }
    await d.destroy()
    return out
  })
}

const has = (imgs, x0, y0, w, h) =>
  imgs.some(
    (i) => Math.abs(i[0] - x0) <= 1 && Math.abs(i[1] - y0) <= 1 && (w === undefined || (i[4] === w && i[5] === h)),
  )

// ── 1: every image type can be selected and deleted ──
const TARGETS = [
  ['opaque XObject', 170, 560, 72, 500],
  ['PNG with alpha (SMask)', 370, 560, 330, 520],
  ['rotated', 505, 563, 450, 520],
  ['inside a form XObject', 120, 350, 72, 300],
  ['inline image', 360, 330, 330, 300],
]
for (const [name, cx, cy, x0, y0] of TARGETS) {
  const page = await openDoc()
  await clickPdf(page, cx, cy)
  const open = await barOpen(page)
  check(`1a ${name}: click selects it`, open)
  if (open) {
    await page.click('.iab-btn.danger')
    await new Promise((r) => setTimeout(r, 300))
    const B = await bakedImages(page)
    check(`1b ${name}: gone after save`, !has(B[0].images, x0, y0), JSON.stringify(B[0].images))
    check(`1c ${name}: other images kept`, B[0].images.length === 4, String(B[0].images.length))
    check(
      `1d ${name}: page 2 untouched`,
      B[1].images.length === 1 && has(B[1].images, 72, 500, 160, 100),
      JSON.stringify(B[1].images),
    )
    check(
      `1e ${name}: text untouched`,
      B[0].text.includes('Caption below the gradient image.') && B[0].text.includes('Image Editing Test'),
      B[0].text,
    )
  }
  await page.close()
}

// ── 2: replace keeps aspect inside the original box; restore; Delete key ──
{
  const page = await openDoc()
  await clickPdf(page, 170, 560)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.iab-btn[title="替换图片"]')])
  await chooser.accept([GREEN])
  await new Promise((r) => setTimeout(r, 400))
  let B = await bakedImages(page)
  // 200x125 box, 2:1 image -> 200x100 centered: y 512.5..612.5
  check(
    '2a replaced image fits the old box, aspect kept',
    has(B[0].images, 72, 513, 40, 20) && !has(B[0].images, 72, 500, 160, 100),
    JSON.stringify(B[0].images),
  )
  check('2b shared copy on page 2 untouched', has(B[1].images, 72, 500, 160, 100), JSON.stringify(B[1].images))
  check(
    '2c bar shows the replaced state',
    await page.evaluate(() => document.querySelector('.iab-info')?.textContent.includes('已替换')),
  )
  await page.click('.iab-btn[title="恢复原图"]')
  await new Promise((r) => setTimeout(r, 300))
  B = await bakedImages(page)
  check(
    '2d restore brings the original back',
    has(B[0].images, 72, 500, 160, 100) && B[0].images.length === 5,
    JSON.stringify(B[0].images),
  )
  // keyboard delete on the disc, Esc closes, undo restores
  await page.keyboard.press('Escape')
  await clickPdf(page, 370, 560)
  await page.keyboard.press('Delete')
  await new Promise((r) => setTimeout(r, 300))
  B = await bakedImages(page)
  check('2e Delete key removes the selected image', !has(B[0].images, 330, 520), JSON.stringify(B[0].images))
  await page.keyboard.press('Escape')
  check('2f Esc closes the action bar', !(await barOpen(page)))
  const tool = await page.evaluate(() => window.__pdfpro.useToolStore.getState().activeTool)
  check('2g Esc on the bar keeps the edit tool', tool === 'edit-text', tool)
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
  B = await bakedImages(page)
  check(
    '2h undo restores the deleted image',
    has(B[0].images, 330, 520) && B[0].images.length === 5,
    JSON.stringify(B[0].images),
  )
  await page.close()
}

// ── 3: export writes the image file ──
{
  const page = await openDoc()
  const dir = `/tmp/pdfpro-e2e-dl-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
  await clickPdf(page, 370, 560)
  await page.click('.iab-btn[title="导出图片"]')
  await new Promise((r) => setTimeout(r, 1500))
  const files = readdirSync(dir)
  check('3a export downloads a file', files.length === 1 && /_p1_image2\.png$/.test(files[0]), JSON.stringify(files))
  if (files[0]) {
    const head = readFileSync(`${dir}/${files[0]}`).subarray(0, 8)
    check('3b exported file is a PNG', head[0] === 0x89 && head[1] === 0x50, head.toString('hex'))
    const info = await page.evaluate(
      async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const ctx = c.getContext('2d')
        ctx.drawImage(bmp, 0, 0)
        return {
          w: bmp.width,
          h: bmp.height,
          corner: ctx.getImageData(1, 1, 1, 1).data[3],
          center: Array.from(ctx.getImageData(40, 40, 1, 1).data),
        }
      },
      readFileSync(`${dir}/${files[0]}`).toString('base64'),
    )
    check(
      '3c full resolution + transparency kept',
      info.w === 80 && info.h === 80 && info.corner === 0 && info.center[0] === 220,
      JSON.stringify(info),
    )
  }
  await page.close()
}

// ── 4: text on top of an image still opens the text editor ──
{
  const page = await openDoc()
  const cap = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Caption'))
    const r = s.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + r.height / 2 }
  })
  await page.mouse.click(cap.x, cap.y)
  await new Promise((r) => setTimeout(r, 500))
  const t = await page.evaluate(() => document.querySelector('.inline-text-editor')?.textContent ?? null)
  check(
    '4a text click opens the text editor, not the image bar',
    t === 'Caption below the gradient image.' && !(await barOpen(page)),
    JSON.stringify(t),
  )
  await page.keyboard.press('Escape')
  // clicking empty page area does nothing
  await clickPdf(page, 300, 150)
  check(
    '4b empty area opens nothing',
    !(await barOpen(page)) && !(await page.evaluate(() => !!document.querySelector('.inline-text-editor'))),
  )
  await page.close()
}

// ── 5: page reorder before saving keeps the edit on the right page ──
{
  const page = await openDoc()
  await clickPdf(page, 370, 560)
  await page.click('.iab-btn.danger')
  await page.evaluate(() => {
    const s = window.__pdfpro.useEditStore.getState()
    s.pushOp({ kind: 'page-reorder', id: 'ro', page: 0, order: [2, 1] })
  })
  const B = await bakedImages(page)
  check(
    '5a after reorder: original page 1 is now page 2, disc deleted there',
    B[1].images.length === 4 && !has(B[1].images, 330, 520),
    JSON.stringify(B),
  )
  check('5b page from original page 2 untouched', B[0].images.length === 1, JSON.stringify(B[0].images))
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nIMAGE EDIT TESTS PASS')
