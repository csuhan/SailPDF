// Drives the installed Chrome via puppeteer-core to verify the app end-to-end.
// Usage: node scripts/verify.mjs [url] [scenario]
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://127.0.0.1:5174/?file=/samples/sample.pdf'
const scenario = process.argv[3] ?? 'basic'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

mkdirSync('/tmp/pdfpro-shots', { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
// wait for a rendered page canvas with non-zero size
try {
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas.page-canvas')
      return c && c.width > 100
    },
    { timeout: 30000 },
  )
} catch {
  logs.push('[VERIFY] WARN: no rendered page canvas found within 30s')
}
await new Promise((r) => setTimeout(r, 1200))

// structural report
const report = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const qa = (s) => Array.from(document.querySelectorAll(s))
  const tb = q('.app-header')
  const toolbarButtons = qa('.app-header button').length
  const toolbarRect = tb?.getBoundingClientRect()
  const btnRect = q('.app-header .tb-btn')?.getBoundingClientRect()
  const canvases = qa('canvas.page-canvas').map((c) => ({
    w: c.width,
    h: c.height,
    x: Math.round(c.getBoundingClientRect().x),
    y: Math.round(c.getBoundingClientRect().y),
  }))
  const textSpans = qa('.textLayer span').length
  const thumbs = qa('.thumb canvas').length
  const firstThumb = q('.thumb canvas')
  return {
    title: document.title,
    toolbarButtons,
    toolbarRect: toolbarRect && { x: toolbarRect.x, y: toolbarRect.y, w: toolbarRect.width, h: toolbarRect.height },
    firstBtnRect: btnRect && { x: btnRect.x, y: btnRect.y, w: btnRect.width, h: btnRect.height },
    btnStyles: (() => {
      const b = q('.app-header .tb-btn')
      if (!b) return null
      const cs = getComputedStyle(b)
      return { display: cs.display, visibility: cs.visibility, color: cs.color }
    })(),
    pageCanvases: canvases,
    textSpans,
    thumbs,
    firstThumbSize: firstThumb ? [firstThumb.width, firstThumb.height] : null,
    pageControls: q('.view-controls')?.textContent?.trim(),
  }
})
assert.ok(
  report.pageCanvases.some((c) => c.w > 100 && c.h > 100),
  'PDF must render a nonempty canvas',
)
assert.ok(report.textSpans > 0, 'PDF must expose text')
assert.ok(report.toolbarButtons > 5, 'Toolbar must render')
console.log(JSON.stringify(report, null, 2))
console.log('--- console logs ---')
for (const l of logs.slice(0, 30)) console.log(l)

await page.screenshot({ path: '/tmp/pdfpro-shots/verify.png' })

if (scenario === 'interact') {
  // zoom in via keyboard, then search
  await page.keyboard.press('=')
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: '/tmp/pdfpro-shots/zoomed.png' })
  await page.keyboard.down('Meta')
  await page.keyboard.press('f')
  await page.keyboard.up('Meta')
  await page.type('.search-panel input', 'lorem', { delay: 20 })
  await new Promise((r) => setTimeout(r, 3000))
  await page.screenshot({ path: '/tmp/pdfpro-shots/search.png' })
  const searchInfo = await page.evaluate(() => ({
    highlights: document.querySelectorAll('.search-highlight').length,
    count: document.querySelector('.search-count')?.textContent,
  }))
  assert.ok(searchInfo.highlights > 0 && !searchInfo.count.includes('无结果'), 'Search must find and highlight text')
  console.log('search:', JSON.stringify(searchInfo))
}

await browser.close()
assert.ok(!logs.some((l) => l.includes('[PAGEERROR]')), 'Unexpected page error')
console.log('OK')
