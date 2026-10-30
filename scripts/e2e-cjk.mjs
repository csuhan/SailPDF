import assert from 'node:assert/strict'
// Verify CJK text can be baked via system font embedding (Chrome local-fonts).
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => {
  pageErrors.push(e.message)
  console.error('[PAGEERROR]', e.message)
})
const cdp = await page.createCDPSession()
for (const name of ['local-fonts', 'localFonts']) {
  try {
    await cdp.send('Browser.setPermission', {
      permission: { name },
      setting: 'granted',
      origin: 'http://127.0.0.1:5174',
    })
    console.log('granted permission:', name)
    break
  } catch (e) {
    console.log('permission name failed:', name, String(e).slice(0, 80))
  }
}

await page.goto('http://127.0.0.1:5174/?file=/samples/sample.pdf', { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('canvas.page-canvas')?.width > 100 && window.__pdfpro)
await new Promise((r) => setTimeout(r, 500))

const res = await page.evaluate(async () => {
  const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
  useEditStore.getState().pushOp({
    kind: 'overlay-text',
    id: 'cjk1',
    page: 1,
    x: 72,
    y: 300,
    text: '中文烘焙测试 ✅ CJK_42',
    fontSize: 20,
    fontName: 'Helvetica',
    color: '#c62828',
  })
  const s = useAppStore.getState()
  try {
    const bytes = await bakePdf(s.fileBytes, useEditStore.getState().ops)
    window.__cjkBaked = bytes
    return { ok: true, len: bytes.length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) ?? e) }
  }
})
console.log('bake with CJK:', JSON.stringify(res))
if (!res.ok) {
  await browser.close()
  throw new Error(res.error)
}

if (res.ok) {
  const check = await page.evaluate(async () => {
    const { useAppStore, useEditStore } = window.__pdfpro
    useEditStore.getState().reset()
    await useAppStore.getState().openFile(window.__cjkBaked, 'cjk.pdf')
    const p1 = await useAppStore.getState().pdfDoc.getPage(1)
    const tc = await p1.getTextContent()
    const joined = tc.items.map((i) => i.str).join(' ')
    return { has: joined.includes('中文烘焙测试') && joined.includes('CJK_42'), joined: joined.slice(0, 80) }
  })
  console.log('reopen check:', JSON.stringify(check))
  if (!(check.has ?? check.ok)) {
    await browser.close()
    assert.fail('Exported CJK text did not survive reopening')
  }
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: '/tmp/pdfpro-shots/cjk.png' })
}
await browser.close()
assert.deepEqual(pageErrors, [], 'Unexpected browser error')
