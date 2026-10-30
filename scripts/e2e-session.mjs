// Document session details: unsaved-changes prompt (cancel / don't save),
// undo back to clean, ⌘S while typing, selection quick actions, changes list,
// reopening at the last page. Needs the dev server on 5174.
import puppeteer from 'puppeteer-core'

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
const page = await browser.newPage()
page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `/tmp/pdfpro-session-${Date.now()}` })
const open = async (f) => {
  await page.goto(`${ORIGIN}/?file=${f}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
  await new Promise((r) => setTimeout(r, 600))
}
const st = () =>
  page.evaluate(() => ({
    dirty: window.__pdfpro.useEditStore.getState().dirty,
    dialog: !!document.querySelector('.modal'),
    doc: !!window.__pdfpro.useAppStore.getState().pdfDoc,
    title: document.title,
  }))
const edit = () =>
  page.evaluate(() =>
    window.__pdfpro.useEditStore
      .getState()
      .pushOp({ kind: 'redact', id: 'r' + Math.random(), page: 1, x: 100, y: 100, width: 50, height: 20 }),
  )

await open('/samples/links.pdf')
await edit()
let s = await st()
check('edit marks the document dirty (title ●)', s.dirty && s.title.startsWith('●'), JSON.stringify(s))
await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
s = await st()
check('undo back to the saved state is clean', !s.dirty && !s.title.startsWith('●'), JSON.stringify(s))

await edit()
await page.click('button[aria-label="关闭文档"]')
await page.waitForSelector('.modal')
check('closing with edits asks first', true)
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 150))
s = await st()
check('cancel keeps the document and the edit', s.doc && s.dirty && !s.dialog, JSON.stringify(s))
await page.click('button[aria-label="关闭文档"]')
await page.waitForSelector('.modal')
await page.click('.modal .btn:not(.primary)')
await new Promise((r) => setTimeout(r, 300))
s = await st()
check("don't save closes to the home screen", !s.doc && !s.dirty && !!(await page.$('.home')), JSON.stringify(s))

// selection quick actions in read mode
await open('/samples/links.pdf')
const r = await page.evaluate(() => {
  const sp = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Plain line'))
  const rc = sp.getBoundingClientRect()
  return { x0: rc.left + 2, x1: rc.left + rc.width * 0.5, y: rc.top + rc.height / 2 }
})
await page.mouse.move(r.x0, r.y)
await page.mouse.down()
await page.mouse.move(r.x1, r.y, { steps: 8 })
await page.mouse.up()
await new Promise((res) => setTimeout(res, 200))
check('selecting text shows quick actions', !!(await page.$('.selection-menu')))
await page.click('.selection-menu button[aria-label="高亮"]')
const kinds = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.map((o) => o.kind))
check('quick highlight adds a markup', kinds.length === 1 && kinds[0] === 'markup', JSON.stringify(kinds))

// ⌘S while an inline editor is still open keeps the typed text
await page.evaluate(() => window.__pdfpro.useToolStore.getState().setMode('edit'))
await new Promise((res) => setTimeout(res, 300))
const c = await page.evaluate(() => {
  const sp = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Vision Group'))
  const rc = sp.getBoundingClientRect()
  return { x: rc.left + 10, y: rc.top + rc.height / 2 }
})
await page.mouse.click(c.x, c.y)
await page.waitForSelector('.inline-text-editor')
await page.keyboard.press('End')
await page.keyboard.type(' X', { delay: 10 })
await page.keyboard.down('Meta')
await page.keyboard.press('s')
await page.keyboard.up('Meta')
await new Promise((res) => setTimeout(res, 900))
const after = await page.evaluate(() => ({
  texts: window.__pdfpro.useEditStore
    .getState()
    .ops.filter((o) => o.kind === 'text-edit')
    .map((o) => o.newText),
  dirty: window.__pdfpro.useEditStore.getState().dirty,
}))
check(
  '⌘S while typing saves the typed text',
  after.texts[0] === 'Lab: Vision Group X' && !after.dirty,
  JSON.stringify(after),
)

await page.evaluate(() => window.__pdfpro.useAppStore.getState().setSidebar('changes'))
await new Promise((res) => setTimeout(res, 200))
const rows = await page.$$eval('.change-row', (els) => els.map((e) => e.textContent))
check('changes list shows every edit', rows.length === 2 && rows[1].includes('Vision Group X'), JSON.stringify(rows))

// reopen at the last page
await open('/samples/sample.pdf')
await page.evaluate(() => window.__pdfpro.useAppStore.getState().goToPage(4))
await new Promise((res) => setTimeout(res, 700))
await open('/samples/sample.pdf')
await new Promise((res) => setTimeout(res, 500))
const cur = await page.evaluate(() => window.__pdfpro.useAppStore.getState().currentPage)
check('reopening returns to the last page read', cur === 4, String(cur))

await browser.close()
console.log(results.join('\n'))
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nSESSION TESTS PASS')
