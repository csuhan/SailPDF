import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174', { waitUntil: 'networkidle2' })
  await page.waitForSelector('.home-ai-composer')
  await mkdir('.scratch/ai-ui', { recursive: true })
  await page.screenshot({ path: '.scratch/ai-ui/home.png' })
  await page.type('#home-ai-task', '请总结合同的付款时间。')
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.home-ai-composer button')])
  await chooser.accept([path.resolve('public/samples/form.pdf')])
  await page.waitForSelector('.ai-panel')
  assert.equal(await page.evaluate(() => window.__pdfpro.useAppStore.getState().fileName), 'form.pdf')
  const pending = await page.evaluate(async () => (await import('/src/ai/aiStore.ts')).useAiStore.getState().pending)
  assert.equal(pending?.prompt, '请总结合同的付款时间。', 'unconfigured AI must retain the user task')
  console.log('PASS home task selects a real document and preserves the prompt through AI setup')
  await page.click('[aria-label="关闭 AI 助手"]')
  await page.click('[aria-label="打开 AI 助手"]')
  await page.waitForSelector('.ai-panel')
  assert.equal(await page.$eval('.ai-toggle', (el) => el.textContent.trim()), '')
  await page.click('.navigation-ai')
  await page.waitForFunction(() => !document.querySelector('.ai-panel'))
  await page.click('.navigation-ai')
  await page.waitForSelector('.ai-panel')
  console.log('PASS rail toggles the assistant and topbar contains only the star icon')
  await page.screenshot({ path: '.scratch/ai-ui/workspace.png' })
  await page.setViewport({ width: 1020, height: 720 })
  const bounds = await page.$eval('.ai-toggle', (el) => {
    const r = el.getBoundingClientRect()
    return { width: r.width, right: r.right, screen: innerWidth }
  })
  assert.ok(bounds.width >= 30 && bounds.width <= 40 && bounds.right <= bounds.screen)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  console.log('PASS AI star remains compact and reachable in a narrow desktop window')
  assert.deepEqual(errors, [])
  console.log('AI ENTRY TESTS PASS (3 tests)')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  const child = browser.process()
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))])
  browser.disconnect()
  child?.kill('SIGKILL')
  for (const s of child?.stdio ?? []) s?.destroy?.()
}
process.exit(process.exitCode ?? 0)
