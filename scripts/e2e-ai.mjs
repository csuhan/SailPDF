// AI reader & editor against a live OpenAI-compatible endpoint
// (default http://127.0.0.1:2999/v1). Checks grounded answers with valid,
// clickable citations, edit plans (confirm / reject / undo as one step),
// selection actions. Usage: node scripts/e2e-ai.mjs [model]
import puppeteer from 'puppeteer-core'
const MODEL = process.argv[2] || process.env.SAIL_TEST_MODEL
if (!MODEL) throw new Error('Pass the local test server model ID as an argument or SAIL_TEST_MODEL.')
const ORIGIN = 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--disable-gpu'],
  defaultViewport: { width: 1500, height: 940 },
})
let failures = 0
const results = []
const check = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const page = await browser.newPage()
page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.removeItem('pdfpro.ai'))
await page.goto(`${ORIGIN}/?file=/samples/contract.pdf`, { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro, { timeout: 20000 })
await page.click('[aria-label="AI 助手"]')
// nothing preset: the setup form asks for an endpoint
await page.waitForSelector('.ai-setup', { timeout: 5000 })
check(
  'no endpoint / model is preset',
  !(await page.$('.ai-compose')) && (await page.$eval('.ai-setup input', (i) => i.value)) === '',
)
// a wrong address fails clearly
await page.type('.ai-setup input', '127.0.0.1:1')
await page.evaluate(() =>
  [...document.querySelectorAll('.ai-setup .btn')].find((b) => b.textContent.includes('连接')).click(),
)
await page.waitForSelector('.ai-status.error', { timeout: 30000 })
check(
  'unreachable endpoint shows an error + manual model entry',
  !!(await page.$('.ai-setup input[placeholder^="模型名称"]')),
)
// paste a bare host:port; models are listed automatically
await page.$eval('.ai-setup input', (i) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(i, '')
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.type('.ai-setup input', '127.0.0.1:2999')
await page.keyboard.press('Enter')
await page.waitForSelector('.ai-setup select', { timeout: 30000 })
const opts = await page.$$eval('.ai-setup select option', (o) => o.map((x) => x.value))
check('model list fetched from the endpoint', opts.includes(MODEL) && opts.length >= 2, JSON.stringify(opts))
check(
  'bare host:port normalised to /v1',
  await page.evaluate(() => document.querySelector('.form-hint')?.textContent.includes('http://127.0.0.1:2999/v1')),
)
await page.select('.ai-setup select', MODEL)
await page.evaluate(() =>
  [...document.querySelectorAll('.ai-setup .btn')].find((b) => b.textContent.includes('开始使用')).click(),
)
await page.waitForFunction(
  () => document.querySelector('.ai-compose') && !document.querySelector('.ai-quick .chip:disabled'),
  { timeout: 30000 },
)
check('panel shows local / cloud processing', await page.$eval('.ai-where', (e) => e.textContent.includes('本地模型')))
check(
  'settings persisted',
  await page.evaluate((m) => JSON.parse(localStorage.getItem('pdfpro.ai')).model === m, MODEL),
)

// switching models: one clear flow for every source
await page.click('[aria-label="AI 设置"]')
await page.waitForSelector('.ai-current')
check(
  'settings show the model in use',
  (await page.$eval('.ai-current', (e) => e.textContent)).includes(MODEL.split('/').pop()),
)
await page.waitForSelector('.ai-settings select', { timeout: 30000 })
const mainBtn = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('.ai-settings-actions .btn')].pop()
    return { text: b.textContent, disabled: b.disabled }
  })
let mb = await mainBtn()
check('current model: main button says 正在使用 (disabled)', mb.text === '正在使用' && mb.disabled, JSON.stringify(mb))
const other = await page.$$eval(
  '.ai-settings select option',
  (o, m) => o.map((x) => x.value).find((v) => v !== m),
  MODEL,
)
await page.select('.ai-settings select', other)
mb = await mainBtn()
check('another model: main button says 使用此模型', mb.text === '使用此模型' && !mb.disabled, JSON.stringify(mb))
await page.evaluate(() => [...document.querySelectorAll('.ai-settings-actions .btn')].pop().click())
await page.waitForFunction(() => !document.querySelector('.ai-settings'))
check(
  'switched: header + storage use the new model',
  await page.evaluate(
    (o) =>
      JSON.parse(localStorage.getItem('pdfpro.ai')).model === o &&
      document.querySelector('.ai-where').title.includes(o),
    other,
  ),
)
// switch back (the rest of the suite uses MODEL)
await page.click('[aria-label="AI 设置"]')
await page.waitForSelector('.ai-settings select', { timeout: 30000 })
await page.select('.ai-settings select', MODEL)
await page.evaluate(() => [...document.querySelectorAll('.ai-settings-actions .btn')].pop().click())
await page.waitForFunction(() => !document.querySelector('.ai-settings'))
check('switched back', await page.evaluate((m) => JSON.parse(localStorage.getItem('pdfpro.ai')).model === m, MODEL))

async function ask(q) {
  await page.type('.ai-compose textarea', q)
  await page.keyboard.press('Enter')
  await sleep(300)
  await page.waitForFunction(() => !document.querySelector('.ai-send.stop'), { timeout: 240000 })
  return page.evaluate(() => {
    const m = [...document.querySelectorAll('.ai-msg.bot')].pop()
    return {
      text: m.innerText,
      cites: [...m.querySelectorAll('.cite')].map((c) => c.title),
      plan: m.querySelector('.plan-card')?.className ?? '',
      err: m.querySelector('.ai-error')?.textContent,
    }
  })
}
const apply = () => page.evaluate(() => [...document.querySelectorAll('.plan-card.pending .btn.primary')].pop().click())
const reject = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.plan-card.pending .btn')].find((b) => b.textContent.includes('放弃')).click(),
  )
const outText = (pg) =>
  page.evaluate(async (pg) => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const d = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    return {
      n: d.numPages,
      t: (await (await d.getPage(Math.min(pg, d.numPages))).getTextContent()).items.map((i) => i.str).join(''),
    }
  }, pg)

// 1. grounded answer with citations
let r = await ask('违约金是多少？请引用原文。')
check('answer states the penalty', /9,?600|20\s*%/.test(r.text), r.text)
check(
  'answer carries valid citations',
  r.cites.length > 0 && r.cites.every((t) => /^第 \d 页/.test(t)),
  JSON.stringify(r.cites),
)
await page.evaluate(() => [...document.querySelectorAll('.ai-msg.bot')].pop().querySelector('.cite')?.click())
await sleep(1200)
check(
  'clicking a citation jumps + highlights',
  (await page.$$('.ai-flash')).length > 0 &&
    (await page.evaluate(() => window.__pdfpro.useAppStore.getState().currentPage)) === 2,
)

// 2. not in the document: no fabrication
r = await ask('这份合同里约定的知识产权归属是怎样的？')
check('says when the document does not cover it', /没有|未(提及|涉及|约定)|不包含|未找到/.test(r.text), r.text)

// 3. edit: change a date -> plan -> apply -> output changed; undo restores
r = await ask('把签订日期改成2026年10月29日')
check('date edit comes back as a pending plan', r.plan.includes('pending'), r.text)
await apply()
await sleep(500)
let o = await outText(1)
check(
  'applied: new date in the file, old one gone',
  o.t.includes('2026年10月29日') && !o.t.includes('2026年3月15日'),
  o.t.slice(0, 200),
)
await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
o = await outText(1)
check('undo reverts the AI edit as one step', o.t.includes('2026年3月15日'), o.t.slice(0, 200))

// 4. reject: nothing changes
const before = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length)
r = await ask('删除第3页')
check('page deletion is planned', r.plan.includes('pending'), r.text)
if (r.plan.includes('pending')) await reject()
await sleep(300)
check(
  'rejected plan changes nothing',
  (await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length)) === before &&
    (await outText(1)).n === 3,
)

// 5. batch markup
r = await ask('把所有美元金额高亮')
await apply()
await sleep(300)
const quads = await page.evaluate(() =>
  window.__pdfpro.useEditStore
    .getState()
    .ops.filter((o) => o.kind === 'markup')
    .reduce((a, o) => a + o.quads.length, 0),
)
check('all dollar amounts highlighted', quads === 4, String(quads))

// 6. selection -> explain
await page.evaluate(() => window.__pdfpro.useAppStore.getState().goToPage(1))
await sleep(800)
const rect = await page.evaluate(() => {
  const span = [...document.querySelectorAll('.page-box[data-page="1"] .textLayer span')].find((s) =>
    s.textContent.includes('滞纳金'),
  )
  span.scrollIntoView({ block: 'center' })
  const r = span.getBoundingClientRect()
  return { x: r.left, y: r.top + r.height / 2, w: r.width }
})
await sleep(300)
const r2 = await page.evaluate(() => {
  const span = [...document.querySelectorAll('.page-box[data-page="1"] .textLayer span')].find((s) =>
    s.textContent.includes('滞纳金'),
  )
  const r = span.getBoundingClientRect()
  return { x: r.left, y: r.top + r.height / 2, w: r.width }
})
await page.mouse.move(r2.x + 2, r2.y)
await page.mouse.down()
await page.mouse.move(r2.x + r2.w - 2, r2.y, { steps: 8 })
await page.mouse.up()
void rect
await page.waitForSelector('.selection-menu', { timeout: 5000 })
await page.evaluate(() =>
  [...document.querySelectorAll('.selection-menu .sm-text')].find((b) => b.textContent === '解释').click(),
)
await sleep(500)
await page.waitForFunction(() => !document.querySelector('.ai-send.stop'), { timeout: 240000 })
r = await page.evaluate(() => ({
  user: [...document.querySelectorAll('.ai-msg.user')].pop().innerText,
  bot: [...document.querySelectorAll('.ai-msg.bot')].pop().innerText,
}))
check(
  'selection action asks about the selected text',
  r.user.includes('滞纳金') && /0\.05|滞纳金|逾期/.test(r.bot),
  JSON.stringify(r).slice(0, 300),
)

// 7. quick summary
await page.evaluate(() =>
  [...document.querySelectorAll('.ai-quick .chip')].find((c) => c.textContent === '总结全文').click(),
)
await sleep(500)
await page.waitForFunction(() => !document.querySelector('.ai-send.stop'), { timeout: 240000 })
r = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.ai-msg.bot')].pop()
  return { text: m.innerText, cites: m.querySelectorAll('.cite').length }
})
check('summary covers the document with citations', r.cites >= 2 && /48,?000/.test(r.text), r.text)

await browser.close()
console.log(`model: ${MODEL}`)
console.log(results.join('\n'))
console.log(failures ? `\n${failures} FAILED` : '\nAI TESTS PASS')
process.exit(failures ? 1 : 0)
