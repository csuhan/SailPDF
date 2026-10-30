// Checklist features: two-page view, dark mode, bookmarks, annotation list
// (+ delete of file annotations, export / import), autosave + restore, links,
// export variants (flatten / clean), conversion (docx / md / tex).
// Needs the dev server on 5174 and public/samples/contract.pdf.
import puppeteer from 'puppeteer-core'
import { ensureTestFixtures } from './test-fixtures.mjs'
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
async function open(file, page) {
  page ??= await browser.newPage()
  page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
  await page.goto(`${ORIGIN}/?file=${encodeURIComponent(file)}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro, { timeout: 20000 })
  await sleep(300)
  return page
}
const out = (page, fn) =>
  page.evaluate(async (fn) => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    return new Function('d', `return (async () => { ${fn} })()`)(d)
  }, fn)

// ── view modes, theme, bookmarks ──
{
  const page = await open('/samples/sample.pdf')
  await page.evaluate(() => localStorage.removeItem('pdfpro.bookmarks'))
  await page.evaluate(() => window.__pdfpro.useAppStore.getState().setViewMode('spread'))
  await sleep(800)
  const pos = await page.evaluate(() =>
    [...document.querySelectorAll('.page-slot')]
      .slice(0, 3)
      .map((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().left)]),
  )
  check(
    'spread: cover alone, pages 2+3 side by side',
    pos.length >= 3 && pos[1][0] === pos[2][0] && pos[1][1] < pos[2][1] && pos[0][0] < pos[1][0],
    JSON.stringify(pos),
  )
  await page.keyboard.down('Meta')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyD')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Meta')
  check('⇧⌘D switches to dark mode', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  check(
    'dark mode inverts the page canvas',
    (await page.$eval('.page-canvas', (c) => getComputedStyle(c).filter)).includes('invert'),
  )
  await page.evaluate(
    () => (
      window.__pdfpro.useAppStore.getState().setViewMode('continuous'),
      window.__pdfpro.useAppStore.getState().goToPage(3)
    ),
  )
  await sleep(500)
  await page.keyboard.down('Meta')
  await page.keyboard.press('KeyD')
  await page.keyboard.up('Meta')
  await page.evaluate(() => window.__pdfpro.useAppStore.getState().setSidebar('bookmarks'))
  await sleep(300)
  check(
    '⌘D bookmarks the current page',
    await page.evaluate(() => {
      const cur = window.__pdfpro.useAppStore.getState().currentPage
      return document.querySelector('.bookmarks .annot-row .annot-meta')?.textContent === `第 ${cur} 页`
    }),
  )
  await page.evaluate(() => localStorage.setItem('pdfpro.theme', 'light'))
  await page.close()
}

// ── annotations: list, filter, delete existing, export / import ──
{
  const page = await open(fixtures.reviewUrl)
  await page.evaluate(async () => {
    const { newOpId } = await import('/src/pdf/edit/ops.ts')
    const es = window.__pdfpro.useEditStore.getState()
    es.pushOp({
      kind: 'markup',
      id: newOpId(),
      page: 1,
      markup: 'highlight',
      quads: [{ x: 100, y: 600, width: 80, height: 10 }],
      color: '#ffeb3b',
      opacity: 0.4,
    })
    es.pushOp({
      kind: 'markup',
      id: newOpId(),
      page: 1,
      markup: 'underline',
      quads: [{ x: 100, y: 500, width: 80, height: 10 }],
      color: '#1e88e5',
      opacity: 1,
    })
    es.pushOp({
      kind: 'draw',
      id: newOpId(),
      page: 2,
      points: [
        { x: 100, y: 100 },
        { x: 150, y: 120 },
      ],
      color: '#d32f2f',
      thickness: 2,
      opacity: 1,
    })
    window.__pdfpro.useAppStore.getState().setSidebar('annots')
  })
  await page.waitForFunction(() => document.querySelectorAll('.annot-row').length >= 4)
  const n0 = await page.$$eval('.annot-row', (l) => l.length)
  check('annotation list shows file + session annotations', n0 >= 4, String(n0))
  await page.evaluate(() =>
    [...document.querySelectorAll('.annots-filters .chip')].find((c) => c.textContent.includes('标记')).click(),
  )
  check('filter by type', (await page.$$eval('.annot-row', (l) => l.length)) === 2)
  // colour filter: one yellow item
  await page.evaluate(() =>
    [...document.querySelectorAll('.annot-color')].find((c) => c.style.background.includes('255, 235, 59')).click(),
  )
  check('filter by colour', (await page.$$eval('.annot-row', (l) => l.length)) === 1)
  await page.evaluate(() => document.querySelector('.annot-color.active').click())
  await page.evaluate(() =>
    [...document.querySelectorAll('.annots-filters .chip')].find((c) => c.textContent.includes('全部')).click(),
  )
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.annot-row')].some((r) => r.textContent.includes('文件中')),
  )
  const exported = await page.evaluate(async () => {
    const { exportAnnotations, loadFileAnnotations } = await import('/src/pdf/annotations.ts')
    return exportAnnotations(
      window.__pdfpro.useEditStore.getState().ops,
      await loadFileAnnotations(window.__pdfpro.useAppStore.getState().pdfDoc),
    )
  })
  check('export annotations as json', JSON.parse(exported).annotations.length >= 4)
  // delete the existing sticky note of the file
  await page.evaluate(() =>
    [...document.querySelectorAll('.annot-row')]
      .find((r) => r.textContent.includes('文件中'))
      .querySelector('.change-del')
      .click(),
  )
  const notesLeft = await out(
    page,
    `return (await (await d.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Text').length`,
  )
  check('deleting a file annotation removes it from the output', notesLeft === 0, String(notesLeft))
  // import into a fresh copy
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().reset())
  const imported = await page.evaluate(async (json) => {
    const { importAnnotations } = await import('/src/pdf/annotations.ts')
    const { computePageMap } = await import('/src/pdf/edit/pageOrder.ts')
    const list = importAnnotations(json, computePageMap(3, []))
    window.__pdfpro.useEditStore.getState().pushOps(list)
    return list.length
  }, exported)
  check('import annotations', imported >= 4, String(imported))
  // export variants
  const v = await page.evaluate(async () => {
    const { exportVariant } = await import('/src/pdf/edit/exportVariants.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const app = window.__pdfpro.useAppStore.getState()
    const ops = window.__pdfpro.useEditStore.getState().ops
    const count = async (b) => {
      const d = await pdfjs.getDocument({ data: b.slice() }).promise
      let n = 0
      for (let i = 1; i <= d.numPages; i++)
        n += (await (await d.getPage(i)).getAnnotations()).filter(
          (a) => a.subtype !== 'Link' && a.subtype !== 'Popup',
        ).length
      const t = (await (await d.getPage(1)).getTextContent()).items.length
      return { n, t }
    }
    return {
      normal: await count(await exportVariant(app.fileBytes, ops, 'normal')),
      flatten: await count(await exportVariant(app.fileBytes, ops, 'flatten')),
      clean: await count(await exportVariant(app.fileBytes, ops, 'clean')),
    }
  })
  check(
    'flattened copy has no editable annotations, text intact',
    v.flatten.n === 0 && v.flatten.t === v.normal.t && v.normal.n >= 1,
    JSON.stringify(v),
  )
  check('clean copy drops comments', v.clean.n === 0 && v.clean.t === v.normal.t, JSON.stringify(v))
  await page.close()
}

// ── autosave: edits survive a reload ──
{
  const page = await open('/samples/contract.pdf')
  await page.evaluate(async () => {
    const { newOpId } = await import('/src/pdf/edit/ops.ts')
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'overlay-text',
      id: newOpId(),
      page: 1,
      x: 60,
      y: 300,
      text: 'AUTOSAVED',
      fontSize: 14,
      fontName: 'Helvetica',
      color: '#111111',
    })
  })
  await sleep(3200)
  await page.evaluate(() => window.__pdfpro.useEditStore.setState({ dirty: false }))
  await page.goto(`${ORIGIN}/?file=/samples/contract.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.restore-banner', { timeout: 15000 })
  check('reopen offers to restore unsaved edits', true)
  await page.evaluate(() =>
    [...document.querySelectorAll('.restore-banner .btn')].find((b) => b.textContent.includes('恢复')).click(),
  )
  await sleep(300)
  check(
    'restore brings the edit back',
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.some((o) => o.text === 'AUTOSAVED')),
  )
  // saving clears the draft
  await page.evaluate(async () => {
    const { clearDraft } = await import('/src/utils/autosave.ts')
    await clearDraft()
  })
  await page.close()
}

// ── links ──
{
  const page = await open('/samples/contract.pdf')
  await page.evaluate(() =>
    [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('编辑')).click(),
  )
  await sleep(200)
  await page.evaluate(() =>
    [...document.querySelectorAll('.mt-tool')].find((b) => b.textContent.includes('链接')).click(),
  )
  const box = await (await page.$('.page-box[data-page="1"] .interaction-layer')).boundingBox()
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 260, box.y + 130, { steps: 5 })
  await page.mouse.up()
  await page.waitForSelector('.link-popup input')
  await page.$eval('.link-popup input', (i) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type('.link-popup input', 'example.com/x')
  await page.keyboard.press('Enter')
  await sleep(300)
  const links = await out(
    page,
    `return (await (await d.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Link').map((a) => a.url)`,
  )
  check('link tool writes a URL link', links.includes('https://example.com/x'), JSON.stringify(links))
  await page.close()
}

// ── conversion ──
{
  const page = await open('/samples/contract.pdf')
  const r = await page.evaluate(async () => {
    const { extractStructure } = await import('/src/pdf/convert/structure.ts')
    const { writeFormat, toMarkdown, toLatex } = await import('/src/pdf/convert/writers.ts')
    const a = window.__pdfpro.useAppStore.getState()
    const s = await extractStructure(a.pdfDoc, a.fileBytes, { images: true, pageBreaks: false })
    const md = toMarkdown(s)
    const docx = writeFormat(s, 'docx', 'c')
    return {
      md,
      tex: toLatex(s),
      docxSize: docx.data.length,
      docxMagic: String.fromCharCode(docx.data[0], docx.data[1]),
    }
  })
  check(
    'markdown: headings + list + text',
    /^# 服务合同/m.test(r.md) &&
      /^## 一、服务内容/m.test(r.md) &&
      /^1\. 需求调研报告/m.test(r.md) &&
      r.md.includes('$48,000'),
    r.md.slice(0, 300),
  )
  check(
    'latex: ctex document with sections',
    r.tex.includes('\\documentclass[11pt]{ctexart}') &&
      r.tex.includes('\\subsection*{三、保密条款}') &&
      r.tex.includes('\\$48,000'),
    r.tex.slice(0, 1600),
  )
  check('docx is a zip package', r.docxMagic === 'PK' && r.docxSize > 1500)
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
console.log(failures ? `\n${failures} FAILED` : '\nCHECKLIST TESTS PASS')
process.exit(failures ? 1 : 0)
