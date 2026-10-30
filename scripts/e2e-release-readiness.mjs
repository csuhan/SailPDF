import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
try {
  const page = await browser.newPage(),
    errors = []
  let protectedSecret = { apiKey: '', endpoint: '' }
  page.on('pageerror', (e) => errors.push(e.message))
  await page.exposeFunction('__loadSecret', () => ({ ...protectedSecret, available: true }))
  await page.exposeFunction('__saveSecret', (value) => {
    protectedSecret = value
    return { ok: true }
  })
  await page.evaluateOnNewDocument(() => {
    window.__openedLinks = []
    window.pdfDesktop = {
      isDesktop: true,
      setTitle() {},
      setDirty() {},
      getRecent: async () => [],
      onOpenFile() {},
      onMenu() {},
      onCloseRequest() {},
      consumePendingOpen: async () => null,
      secrets: { load: () => window.__loadSecret(), save: (value) => window.__saveSecret(value) },
      openExternal: async (url) => {
        window.__openedLinks.push(url)
        return true
      },
      aiRequest: async (_request, chunk) => {
        chunk(JSON.stringify({ data: [{ id: 'test-model' }] }))
        return { ok: true, status: 200 }
      },
    }
    if (!localStorage.getItem('migration-test-seeded')) {
      localStorage.setItem('migration-test-seeded', 'true')
      localStorage.setItem(
        'pdfpro.ai',
        JSON.stringify({
          provider: 'custom',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key-migration-never-log',
          model: 'test-model',
          language: 'zh',
        }),
      )
    }
  })
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.home')
  assert.ok(protectedSecret.apiKey)
  assert.equal(await page.evaluate(() => localStorage.getItem('pdfpro.ai').includes('test-key-migration')), false)
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('.home')
  assert.equal(await page.evaluate(async () => !!(await import('/src/ai/client.ts')).loadAiSettings().apiKey), true)
  console.log('PASS legacy credentials migrate out of plaintext preferences and hydrate from protected storage')
  const endpoints = await page.evaluate(async () => {
    const { normalizeBaseUrl, isLocalEndpoint } = await import('/src/ai/client.ts')
    return {
      bad: [
        'http://localhost.example.com',
        'http://127.example.com',
        'http://10.example.com',
        'http://api.example.com',
        'https://user:password@example.com',
      ].map(normalizeBaseUrl),
      local: ['http://localhost:8080', 'http://[::1]:8080', 'server.local:8080', '192.168.1.2:8080'].map(
        normalizeBaseUrl,
      ),
      falseLocal: isLocalEndpoint('https://10.example.com'),
    }
  })
  assert.deepEqual(endpoints.bad, ['', '', '', '', ''])
  assert.ok(endpoints.local.every(Boolean))
  assert.equal(endpoints.falseLocal, false)
  console.log('PASS local endpoint detection rejects lookalike domains and accepts exact local/network hosts')
  await page.evaluate(async () => {
    const { usePreferences } = await import('/src/state/preferences.ts')
    usePreferences
      .getState()
      .setPreferences({ autosaveEnabled: true, autosaveIntervalMs: 60000, restorePosition: false })
    const { clearAllDrafts } = await import('/src/utils/autosave.ts')
    await clearAllDrafts()
    const { openDocument } = await import('/src/utils/docSession.ts')
    const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
    await openDocument({ data: bytes, name: 'recover-A.pdf' })
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'note',
      id: 'recover-note',
      page: 1,
      x: 50,
      y: 50,
      text: 'Recovered A latest edit',
      color: '#f5b400',
      modified: new Date().toISOString(),
    })
    await openDocument({
      data: new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer()),
      name: 'recover-form.pdf',
    })
  })
  await page.waitForSelector('.annotationLayer input[type="text"]')
  await page.type('.annotationLayer input[type="text"]', 'Recovered form value')
  await page.evaluate(async () => {
    const { openDocument } = await import('/src/utils/docSession.ts')
    await openDocument({
      data: new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer()),
      name: 'recover-C.pdf',
    })
  })
  const drafts = await page.evaluate(async () =>
    (await (await import('/src/utils/autosave.ts')).listDrafts()).map((d) => d.name),
  )
  assert.ok(drafts.includes('recover-A.pdf') && drafts.includes('recover-form.pdf'), JSON.stringify(drafts))
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('.home')
  await page.evaluate(async () => {
    await (
      await import('/src/utils/docSession.ts')
    ).openDocument({
      data: new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer()),
      name: 'recover-A.pdf',
    })
  })
  await page.waitForSelector('.restore-banner')
  await page.click('.restore-banner .primary-solid')
  assert.equal(
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops[0]?.text),
    'Recovered A latest edit',
  )
  await page.evaluate(async () => {
    await (
      await import('/src/utils/docSession.ts')
    ).openDocument({
      data: new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer()),
      name: 'recover-form.pdf',
    })
  })
  await page.waitForSelector('.restore-banner')
  await page.click('.restore-banner .primary-solid')
  await page.waitForFunction(
    () => document.querySelector('.annotationLayer input[type="text"]')?.value === 'Recovered form value',
  )
  const savedForm = await page.evaluate(async () => {
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { PDFDocument } = await import('/node_modules/.vite/deps/pdf-lib.js')
    return (await PDFDocument.load(await currentOutputBytes(), { updateMetadata: false }))
      .getForm()
      .getTextField('name')
      .getText()
  })
  assert.equal(savedForm, 'Recovered form value')
  console.log(
    'PASS immediate switch persists multiple documents and forms; renderer reload recovers visible values and saved PDF form data',
  )
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
    bytes[7] = bytes[7] === 55 ? 54 : 55
    await (await import('/src/utils/docSession.ts')).openDocument({ data: bytes, name: 'recover-A.pdf' })
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((e) => e.textContent.includes('另一版本')),
  )
  assert.equal(await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length), 0)
  console.log('PASS recovery snapshots from a different source version are not applied')
  const failed = await page.evaluate(async () => {
    const edits = window.__pdfpro.useEditStore.getState()
    edits.pushOp({
      kind: 'note',
      id: 'error-note',
      page: 1,
      x: 30,
      y: 30,
      text: 'Keep when storage fails',
      color: '#f5b400',
      modified: new Date().toISOString(),
    })
    const original = indexedDB.open.bind(indexedDB)
    indexedDB.open = () => {
      throw new Error('storage unavailable')
    }
    try {
      return await (await import('/src/utils/autosave.ts')).checkpointCurrentDraft()
    } finally {
      indexedDB.open = original
    }
  })
  assert.equal(failed, false)
  await page.waitForSelector('.recovery-warning')
  assert.ok(await page.evaluate(() => window.__pdfpro.useEditStore.getState().dirty))
  await page.evaluate(async () => {
    const { checkpointCurrentDraft, clearAllDrafts } = await import('/src/utils/autosave.ts')
    await checkpointCurrentDraft()
    const pending = checkpointCurrentDraft()
    await clearAllDrafts()
    await pending
  })
  assert.equal(await page.evaluate(async () => (await (await import('/src/utils/autosave.ts')).listDrafts()).length), 0)
  console.log('PASS storage failures remain visible, edits remain intact, and clear cancels queued snapshots')
  await page.click('[aria-label="设置"]')
  await page.click('#settings-nav-help')
  await page.waitForFunction(() => document.querySelector('.help-document')?.textContent.includes('快速上手'))
  for (const [value, expected] of [
    ['project-license', 'Apache License'],
    ['privacy', '隐私说明'],
    ['terms', '测试版条款'],
    ['third-party', '第三方软件许可'],
    ['models', 'Gemma 4'],
    ['chromium', 'Chromium'],
  ]) {
    await page.select('[aria-label="查看帮助与许可"]', value)
    await page.waitForFunction(
      (expected) => document.querySelector('.help-document')?.textContent.includes(expected),
      {},
      expected,
    )
  }
  await page.$$eval('.help-links button', (buttons) => buttons.find((b) => b.textContent === '在 GitHub 反馈').click())
  assert.deepEqual(await page.evaluate(() => window.__openedLinks), [
    'https://github.com/csuhan/SailPDF/issues/new/choose',
  ])
  const report = await page.evaluate(async () => {
    const { feedbackReport } = await import('/src/utils/feedback.ts')
    return feedbackReport('test sk-123456789012345678 /Users/person/private.pdf Bearer abc123')
  })
  assert.ok(
    !report.includes('sk-123456789012345678') &&
      !report.includes('/Users/person') &&
      !report.includes('Bearer abc123') &&
      !report.includes('Recovered A latest edit') &&
      !report.includes('test-key-migration'),
  )
  assert.equal(await page.$('.navigation-brand'), null)
  console.log(
    'PASS offline help/privacy/terms/licenses, explicit GitHub feedback, redacted minimal diagnostics and removed rail wordmark',
  )
  const webContext = await browser.createBrowserContext(),
    web = await webContext.newPage()
  await web.goto(origin, { waitUntil: 'networkidle2' })
  await web.waitForSelector('.home')
  assert.deepEqual(
    await web.evaluate(async () => {
      const { saveAiSettings, loadAiSettings } = await import('/src/ai/client.ts')
      await saveAiSettings({
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'web-session-fixture',
        model: 'fixture',
        language: 'zh',
      })
      return {
        memory: loadAiSettings().apiKey,
        plaintext: localStorage.getItem('pdfpro.ai').includes('web-session-fixture'),
      }
    }),
    { memory: 'web-session-fixture', plaintext: false },
  )
  await web.reload({ waitUntil: 'networkidle2' })
  await web.waitForSelector('.home')
  assert.equal(await web.evaluate(async () => (await import('/src/ai/client.ts')).loadAiSettings().apiKey), '')
  await webContext.close()
  console.log('PASS web API keys remain in memory only and disappear on refresh')
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  const child = browser.process()
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))])
  browser.disconnect()
  child?.kill('SIGKILL')
  for (const stream of child?.stdio ?? []) stream?.destroy?.()
}
process.exit(process.exitCode ?? 0)
