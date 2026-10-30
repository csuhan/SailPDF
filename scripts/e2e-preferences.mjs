import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
const errors = []
let passed = 0
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function check(name, fn) {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => window.__pdfpro)
  await check('reading defaults apply on open, changes do not reset the active reading session', async () => {
    const result = await page.evaluate(async () => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      const app = window.__pdfpro.useAppStore
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      usePreferences.getState().setPreferences({
        defaultViewMode: 'single',
        defaultFitMode: 'custom',
        defaultScale: 1.25,
        restorePosition: false,
      })
      await app.getState().openFile(bytes, 'preferences-first.pdf')
      const first = { mode: app.getState().viewMode, fit: app.getState().fitMode, scale: app.getState().scale }
      usePreferences
        .getState()
        .setPreferences({ defaultViewMode: 'spread', defaultFitMode: 'fit-page', defaultScale: 2 })
      const unchanged = { mode: app.getState().viewMode, fit: app.getState().fitMode, scale: app.getState().scale }
      await app.getState().openFile(bytes, 'preferences-next.pdf')
      return {
        first,
        unchanged,
        next: { mode: app.getState().viewMode, fit: app.getState().fitMode, scale: app.getState().scale },
      }
    })
    assert.deepEqual(result.first, { mode: 'single', fit: 'custom', scale: 1.25 })
    assert.deepEqual(result.unchanged, result.first)
    assert.equal(result.next.mode, 'spread')
    assert.equal(result.next.fit, 'fit-page')
  })
  await check('preferences survive page reload without changing their values', async () => {
    await page.reload({ waitUntil: 'networkidle2' })
    const result = await page.evaluate(async () => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      const s = usePreferences.getState()
      return { mode: s.defaultViewMode, fit: s.defaultFitMode, scale: s.defaultScale, restore: s.restorePosition }
    })
    assert.deepEqual(result, { mode: 'spread', fit: 'fit-page', scale: 2, restore: false })
  })
  await check('restore-reading-position setting controls only newly opened documents', async () => {
    const result = await page.evaluate(async () => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      const app = window.__pdfpro.useAppStore
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      const key = `position-enabled.pdf#${bytes.length}`
      localStorage.setItem('pdfpro.lastPositions', JSON.stringify({ [key]: { page: 5, t: Date.now() } }))
      usePreferences.getState().setPreferences({ restorePosition: false })
      await app.getState().openFile(bytes, 'position-enabled.pdf')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const disabled = app.getState().currentPage
      await app.getState().openFile(bytes, 'elsewhere.pdf')
      localStorage.setItem('pdfpro.lastPositions', JSON.stringify({ [key]: { page: 5, t: Date.now() } }))
      usePreferences.getState().setPreferences({ restorePosition: true })
      await app.getState().openFile(bytes, 'position-enabled.pdf')
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { disabled, enabled: app.getState().currentPage }
    })
    assert.deepEqual(result, { disabled: 1, enabled: 5 })
  })

  const configure = async (name) =>
    page.evaluate(async (name) => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      const { clearAllDrafts } = await import('/src/utils/autosave.ts')
      const app = window.__pdfpro.useAppStore
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      usePreferences
        .getState()
        .setPreferences({ autosaveEnabled: true, autosaveIntervalMs: 1000, restorePosition: false })
      await app.getState().openFile(bytes, name)
      await clearAllDrafts()
      window.__preferencesDraftKey = `${name}#${bytes.length}`
    }, name)
  const push = async (text) =>
    page.evaluate((text) => {
      window.__pdfpro.useEditStore.getState().pushOp({
        kind: 'overlay-text',
        id: 'auto-draft',
        page: 1,
        x: 30,
        y: 100,
        text,
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
    }, text)
  const readDraft = async () =>
    page.evaluate(async () => {
      const { listDrafts } = await import('/src/utils/autosave.ts')
      return (await listDrafts()).find((draft) => draft.key === window.__preferencesDraftKey) ?? null
    })
  const waitDraft = () =>
    page.waitForFunction(async () => {
      const { listDrafts } = await import('/src/utils/autosave.ts')
      return (await listDrafts()).some((draft) => draft.key === window.__preferencesDraftKey)
    })

  await check('configured autosave produces a listed operation draft and disabling keeps it', async () => {
    await configure('autosave-persist.pdf')
    await push('DRAFT ORIGINAL')
    await waitDraft()
    assert.equal((await readDraft()).opCount, 1)
    await page.evaluate(async () => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      usePreferences.getState().setPreferences({ autosaveEnabled: false })
      window.__pdfpro.useEditStore.getState().updateOp('auto-draft', { text: 'DRAFT NEW' })
    })
    await pause(1200)
    const raw = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('pdfpro', 1)
          request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction('drafts', 'readonly')
            const read = transaction.objectStore('drafts').get(window.__preferencesDraftKey)
            read.onsuccess = () => resolve(read.result)
            read.onerror = () => reject(read.error)
            transaction.oncomplete = () => database.close()
          }
          request.onerror = () => reject(request.error)
        }),
    )
    assert.equal(raw.ops[0].text, 'DRAFT ORIGINAL')
  })
  await check('disabling autosave cancels a pending draft timer', async () => {
    await configure('autosave-cancel.pdf')
    await push('DO NOT WRITE')
    await page.evaluate(async () => {
      ;(await import('/src/state/preferences.ts')).usePreferences.getState().setPreferences({ autosaveEnabled: false })
    })
    await pause(1200)
    assert.equal(await readDraft(), null)
  })
  await check('changing the autosave interval reschedules pending work', async () => {
    await configure('autosave-interval.pdf')
    await push('DELAY THIS')
    await page.evaluate(async () => {
      ;(await import('/src/state/preferences.ts')).usePreferences
        .getState()
        .setPreferences({ autosaveIntervalMs: 6000 })
    })
    await pause(1200)
    assert.equal(await readDraft(), null)
    await page.evaluate(async () => {
      ;(await import('/src/state/preferences.ts')).usePreferences
        .getState()
        .setPreferences({ autosaveIntervalMs: 1000 })
    })
    await waitDraft()
    assert.equal((await readDraft()).opCount, 1)
  })
  await check('switching documents cancels the prior draft timer', async () => {
    await configure('autosave-old.pdf')
    await push('OLD DOCUMENT')
    await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      await window.__pdfpro.useAppStore.getState().openFile(bytes, 'autosave-new.pdf')
    })
    await pause(1200)
    assert.equal(await readDraft(), null)
  })
  await check('deleting an active draft does not recreate it until a new edit', async () => {
    await configure('autosave-remove.pdf')
    await push('REMOVE THIS')
    await waitDraft()
    const removed = await page.evaluate(async () =>
      (await import('/src/utils/autosave.ts')).removeDraft(window.__preferencesDraftKey),
    )
    assert.equal(removed, true)
    await pause(1200)
    assert.equal(await readDraft(), null)
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().updateOp('auto-draft', { text: 'NEW CHANGE' }))
    await waitDraft()
    assert.equal((await readDraft()).opCount, 1)
    const cleared = await page.evaluate(async () => (await import('/src/utils/autosave.ts')).clearAllDrafts())
    assert.equal(cleared, true)
  })
  await check('saving preserves active layout and applies the configured copy name', async () => {
    await configure('custom-name.pdf')
    const result = await page.evaluate(async () => {
      const { usePreferences } = await import('/src/state/preferences.ts')
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      const app = window.__pdfpro.useAppStore
      app.getState().setViewMode('single')
      usePreferences.getState().setPreferences({ defaultViewMode: 'spread', copySuffix: '_审核' })
      window.__pdfpro.useEditStore.getState().pushOp({
        kind: 'overlay-text',
        id: 'name',
        page: 1,
        x: 30,
        y: 100,
        text: 'COPY NAME',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      let suggested
      window.pdfDesktop = {
        isDesktop: true,
        setTitle() {},
        setDirty() {},
        saveAs: async (name) => {
          suggested = name
          return '/tmp/preference-test.pdf'
        },
      }
      const saved = await saveCurrentDocument()
      delete window.pdfDesktop
      return { saved, suggested, mode: app.getState().viewMode }
    })
    assert.deepEqual(result, { saved: true, suggested: 'custom-name_审核.pdf', mode: 'single' })
  })
  assert.deepEqual(errors, [])
  await page.close()
  console.log(`PREFERENCES REGRESSIONS PASS (${passed} tests)`)
} catch (error) {
  console.error('PREFERENCES REGRESSIONS FAILED', error)
  process.exitCode = 1
} finally {
  const child = browser.process()
  await Promise.race([browser.close().catch(() => {}), pause(5000)])
  browser.disconnect()
  if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL')
  for (const stream of child?.stdio ?? []) stream?.destroy?.()
  child?.unref()
}
process.exit(process.exitCode ?? 0)
