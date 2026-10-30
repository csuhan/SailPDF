import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
try {
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('locale-test-initialized')) {
      localStorage.setItem('lumen.ui.language', 'en')
      localStorage.setItem('locale-test-initialized', '1')
    }
  })
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.waitForSelector('[aria-label="Open AI assistant"]')
  assert.equal(await page.$eval('html', (el) => el.lang), 'en')
  await page.click('[aria-label="设置"], [aria-label="Settings"]')
  await page.select('[aria-label="Interface language"]', 'zh-CN')
  await page.waitForSelector('[aria-label="打开 AI 助手"]')
  assert.ok(await page.$('#settings-nav-appearance'))
  assert.equal(await page.$eval('html', (el) => el.lang), 'zh-CN')
  await page.click('[aria-label="关闭设置"]')
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('[aria-label="设置"]')
  console.log('PASS English interface, immediate Chinese switch and persisted language across reload')
  await page.evaluate(async () => {
    const { openDocument } = await import('/src/utils/docSession.ts')
    await openDocument({
      name: '中文原文与批注.pdf',
      data: new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer()),
    })
  })
  await page.waitForSelector('.annotationLayer input[type="text"]')
  await page.type('.annotationLayer input[type="text"]', '保存原文，不翻译')
  await page.evaluate(() => {
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'note',
      id: 'language-note',
      page: 1,
      x: 30,
      y: 30,
      text: '保存',
      color: '#f5b400',
      modified: new Date().toISOString(),
    })
    const app = window.__pdfpro.useAppStore.getState(),
      edits = window.__pdfpro.useEditStore.getState()
    window.__localeSnapshot = {
      bytes: app.fileBytes,
      name: app.fileName,
      epoch: app.docEpoch,
      revision: edits.revision,
      ops: JSON.stringify(edits.ops),
      forms: JSON.stringify(app.pdfDoc.annotationStorage.getAll()),
    }
  })
  await page.click('[aria-label="设置"]')
  await page.waitForSelector('[aria-label="界面语言"]')
  // Opening settings blurs the form field and commits its pending change. Take
  // the baseline afterward so this test isolates the language change itself.
  await page.evaluate(() => {
    const app = window.__pdfpro.useAppStore.getState(),
      edits = window.__pdfpro.useEditStore.getState()
    window.__localeSnapshot = {
      bytes: app.fileBytes,
      name: app.fileName,
      epoch: app.docEpoch,
      revision: edits.revision,
      ops: JSON.stringify(edits.ops),
      forms: JSON.stringify(app.pdfDoc.annotationStorage.getAll()),
    }
  })
  await page.select('[aria-label="界面语言"]', 'en')
  await page.waitForSelector('[aria-label="Close settings"]')
  assert.deepEqual(
    await page.evaluate(() => {
      const app = window.__pdfpro.useAppStore.getState(),
        edits = window.__pdfpro.useEditStore.getState(),
        before = window.__localeSnapshot
      return {
        sameBytes: before.bytes === app.fileBytes,
        sameName: before.name === app.fileName,
        sameEpoch: before.epoch === app.docEpoch,
        sameRevision: before.revision === edits.revision,
        sameOps: before.ops === JSON.stringify(edits.ops),
        sameForms: before.forms === JSON.stringify(app.pdfDoc.annotationStorage.getAll()),
        dirty: edits.dirty,
        note: edits.ops.find((v) => v.id === 'language-note').text,
      }
    }),
    {
      sameBytes: true,
      sameName: true,
      sameEpoch: true,
      sameRevision: true,
      sameOps: true,
      sameForms: true,
      dirty: true,
      note: '保存',
    },
  )
  await page.click('#settings-nav-help')
  await page.waitForFunction(() =>
    document.querySelector('.help-document')?.textContent.includes('Sail PDF quick start'),
  )
  for (const [id, text] of [
    ['privacy', 'privacy notice'],
    ['terms', 'beta terms'],
    ['models', 'on-device models'],
  ]) {
    await page.select('[aria-label="Help and licenses"]', id)
    await page.waitForFunction((text) => document.querySelector('.help-document')?.textContent.includes(text), {}, text)
  }
  await page.click('[aria-label="Close settings"]')
  assert.equal(await page.$eval('.annotationLayer input[type="text"]', (el) => el.value), '保存原文，不翻译')
  assert.equal(await page.$eval('.doc-meta', (el) => el.textContent), '1 page')
  await page.click('[aria-label="Search tools and commands"]')
  await page.type('.command-search input', '编辑文字与图片')
  await page.waitForFunction(() => document.querySelector('.command-row')?.textContent.includes('Edit text'))
  console.log(
    'PASS language changes preserve document identity, source bytes, forms, note text, revisions and unsaved edits; English help and Chinese tool queries remain available',
  )
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  const child = browser.process()
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))])
  browser.disconnect()
  child?.kill('SIGKILL')
  for (const stream of child?.stdio ?? []) stream?.destroy?.()
}
process.exit(process.exitCode ?? 0)
