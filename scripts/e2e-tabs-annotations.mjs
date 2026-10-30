import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1280, height: 900 },
})
try {
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(origin, { waitUntil: 'networkidle2' })
  assert.equal(await page.$eval('h1', (e) => e.textContent), '文档工作台')
  const result = await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit } = window.__pdfpro
    const { openDocument, closeDocument, setUnsavedAsker, confirmAllDocuments, confirmDiscard } = await import(
      '/src/utils/docSession.ts'
    )
    const { useTabStore: tabs, activateTab, hasAnyDirtyTab } = await import('/src/state/tabStore.ts')
    const { useAiStore: ai } = await import('/src/ai/aiStore.ts')
    const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
    const form = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
    await openDocument({ data: bytes.slice(), name: 'A.pdf', path: '/A.pdf' })
    const a = tabs.getState().activeId,
      docA = app.getState().pdfDoc
    app.getState().setScale(1.25, 'custom')
    app.getState().rotateView(90)
    app.getState().goToPage(2)
    edit.getState().pushOp({
      kind: 'note',
      id: 'note-a',
      page: 1,
      x: 30,
      y: 40,
      text: 'A draft',
      color: '#ffd500',
      author: '',
      modified: new Date().toISOString(),
    })
    ai.setState({ open: true, turns: [{ id: 'a', role: 'user', text: 'A history' }] })
    await openDocument({ data: form, name: 'B.pdf', path: '/B.pdf' })
    const b = tabs.getState().activeId,
      docB = app.getState().pdfDoc
    const fields = await docB.getFieldObjects()
    docB.annotationStorage.setValue(fields.name[0].id, { value: 'B form value' })
    activateTab(a)
    const isolation =
      app.getState().pdfDoc === docA &&
      edit.getState().ops[0]?.text === 'A draft' &&
      edit.getState().dirty &&
      app.getState().scale === 1.25 &&
      app.getState().rotation === 90 &&
      app.getState().currentPage === 2 &&
      ai.getState().turns[0]?.text === 'A history'
    edit.getState().undo()
    const cleanA = !edit.getState().dirty
    edit.getState().redo()
    activateTab(b)
    const formRestored =
      app.getState().pdfDoc === docB &&
      docB.annotationStorage.getValue(fields.name[0].id, {}).value === 'B form value' &&
      edit.getState().formDirty &&
      edit.getState().ops.length === 0
    setUnsavedAsker(async () => 'cancel')
    const cancelled = !(await closeDocument(a)) && tabs.getState().activeId === b && tabs.getState().tabs.length === 2
    const allCancelled = !(await confirmAllDocuments()) && tabs.getState().activeId === b
    let answer
    setUnsavedAsker(() => new Promise((resolve) => (answer = resolve)))
    const pendingAnswer = confirmDiscard()
    await openDocument({ data: bytes.slice(), name: 'arrived-during-dialog.pdf' })
    edit.getState().pushOp({ kind: 'redact', id: 'late-edit', page: 1, x: 10, y: 10, width: 5, height: 5 })
    answer('save')
    const staleDialog = !(await pendingAnswer) && edit.getState().dirty
    setUnsavedAsker(async () => 'discard')
    await closeDocument()
    await closeDocument(a)
    const backgroundClosed =
      tabs.getState().activeId === b &&
      tabs.getState().tabs.length === 1 &&
      edit.getState().formDirty &&
      hasAnyDirtyTab()
    await openDocument({ data: form.slice(), name: 'duplicate.pdf', path: '/B.pdf' })
    const dedup = tabs.getState().tabs.length === 1
    const openedTogether = await Promise.all(
      ['C', 'D'].map((name) => openDocument({ data: bytes.slice(), name: `${name}.pdf`, path: `/${name}.pdf` })),
    )
    const concurrent = openedTogether.every(Boolean) && tabs.getState().tabs.length === 3
    activateTab(b)
    for (const tab of [...tabs.getState().tabs]) if (tab.id !== b) await closeDocument(tab.id)
    const failed =
      !(await openDocument({ data: new TextEncoder().encode('broken'), name: 'broken.pdf' })) &&
      tabs.getState().tabs.length === 1 &&
      app.getState().pdfDoc === docB
    await closeDocument()
    return {
      isolation,
      cleanA,
      formRestored,
      cancelled,
      allCancelled,
      staleDialog,
      backgroundClosed,
      dedup,
      concurrent,
      failed,
      empty: tabs.getState().tabs.length === 0 && !app.getState().pdfDoc,
    }
  })
  for (const [name, value] of Object.entries(result)) assert.equal(value, true, name)
  console.log(
    'PASS multi-document isolation, form values, undo, dirty guards, close/cancel, duplicate and failed open',
    JSON.stringify(result),
  )
  // A single document for popup placement and direct markup removal.
  await page.evaluate(async () => {
    const { openDocument } = await import('/src/utils/docSession.ts')
    await openDocument({
      data: new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer()),
      name: 'annotations.pdf',
    })
  })
  await page.waitForSelector('.textLayer span')
  await page.evaluate(() => {
    const a = window.__pdfpro.useAppStore.getState()
    a.setScale(0.7, 'custom')
    a.setSidebar('none')
  })
  await page.waitForFunction(() => window.__pdfpro.useAppStore.getState().scale === 0.7)
  await new Promise((r) => setTimeout(r, 400))
  const note = await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit } = window.__pdfpro
    const { getPageRuntime } = await import('/src/pdf/registry.ts')
    const vp = getPageRuntime(1).viewport
    const [x, y] = vp.convertToPdfPoint(vp.width - 22, vp.height - 22)
    edit.getState().pushOp({
      kind: 'note',
      id: 'edge-note',
      page: 1,
      x,
      y,
      text: 'edge',
      color: '#e8b42a',
      author: '',
      modified: new Date().toISOString(),
    })
    return { x, y }
  })
  await page.$eval('[data-note-id="edge-note"]', (e) => e.scrollIntoView({ block: 'end', inline: 'end' }))
  await page.click('[data-note-id="edge-note"]')
  await page.waitForSelector('.note-popup textarea')
  const bounds = await page.$eval('.note-popup', (e) => {
    const r = e.getBoundingClientRect(),
      v = document.querySelector('.viewport-area').getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      vl: v.left,
      vr: v.right,
      vt: v.top,
      vb: v.bottom,
    }
  })
  assert.ok(
    bounds.left >= bounds.vl && bounds.right <= bounds.vr && bounds.top >= bounds.vt && bounds.bottom <= bounds.vb,
    JSON.stringify(bounds),
  )
  await page.type('.note-popup textarea', ' committed across tabs')
  await page.evaluate(async () => {
    const { openDocument } = await import('/src/utils/docSession.ts')
    await openDocument({
      data: new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer()),
      name: 'second.pdf',
    })
    const { useTabStore, activateTab } = await import('/src/state/tabStore.ts')
    activateTab(useTabStore.getState().tabs[0].id)
  })
  assert.ok(
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops[0].text.includes('committed across tabs')),
  )
  console.log('PASS note popup stays visible at page edge and typing is committed on tab switch', note)
  // Build three session markups, bake, reopen, then remove embedded annotations.
  await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit, bakePdf } = window.__pdfpro
    edit.getState().reset()
    for (const [i, markup] of ['highlight', 'underline', 'strikeout'].entries())
      edit.getState().pushOp({
        kind: 'markup',
        id: markup,
        page: 1,
        markup,
        color: '#ffcc00',
        quads: [{ x: 70, y: 650 - i * 40, width: 180, height: 16 }],
      })
    app.getState().goToPage(1)
  })
  const clickMarkup = async (index) => {
    const point = await page.evaluate(async (index) => {
      const { getPageRuntime } = await import('/src/pdf/registry.ts')
      const r = document.querySelector('.page-box[data-page="1"]').getBoundingClientRect()
      const [x, y] = getPageRuntime(1).viewport.convertToViewportPoint(110, 658 - index * 40)
      return { x: r.left + x, y: r.top + y }
    }, index)
    await page.mouse.click(point.x, point.y)
    await page.waitForSelector('.annotation-actions', { timeout: 5000 }).catch(async (error) => {
      console.log(
        'MARKUP DEBUG',
        await page.evaluate(async (point) => {
          const { loadFileAnnotations } = await import('/src/pdf/annotations.ts')
          return {
            point,
            hit: document.elementFromPoint(point.x, point.y)?.outerHTML,
            selected: window.getSelection()?.toString(),
            tool: window.__pdfpro.useToolStore.getState().activeTool,
            annotations: await loadFileAnnotations(window.__pdfpro.useAppStore.getState().pdfDoc),
          }
        }, point),
      )
      throw error
    })
    await page.click('.annotation-actions .btn')
  }
  await page.$eval('.page-box[data-page="1"]', (e) => e.scrollIntoView({ block: 'start' }))
  await new Promise((r) => setTimeout(r, 250))
  await clickMarkup(0)
  assert.equal(
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.some((o) => o.id === 'highlight')),
    false,
  )
  await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit, bakePdf } = window.__pdfpro
    const bytes = await bakePdf(app.getState().fileBytes, edit.getState().ops)
    await app.getState().openFile(bytes, 'embedded.pdf')
    app.getState().setScale(0.7, 'custom')
  })
  await page.waitForSelector('.textLayer span')
  await new Promise((r) => setTimeout(r, 300))
  await clickMarkup(1)
  assert.equal(
    await page.evaluate(
      () => window.__pdfpro.useEditStore.getState().ops.filter((o) => o.kind === 'annot-delete').length,
    ),
    1,
  )
  // Undo restores both the sidebar row and embedded canvas preview.
  await page.evaluate(() => {
    window.__pdfpro.useAppStore.getState().setSidebar('annots')
  })
  await page.waitForSelector('.annot-row')
  assert.equal((await page.$$('.annot-row')).length, 1)
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
  await page.waitForFunction(() => document.querySelectorAll('.annot-row').length === 2)
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().redo())
  await page.waitForFunction(() => document.querySelectorAll('.annot-row').length === 1)
  await page.click('.annot-row .change-del')
  const persisted = await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit, bakePdf } = window.__pdfpro
    const bytes = await bakePdf(app.getState().fileBytes, edit.getState().ops)
    await app.getState().openFile(bytes, 'deleted.pdf')
    const { loadFileAnnotations } = await import('/src/pdf/annotations.ts')
    return (await loadFileAnnotations(app.getState().pdfDoc)).filter((a) => a.kind === 'markup').length
  })
  assert.equal(persisted, 0)
  console.log('PASS session and embedded markup deletion, undo/redo and baked reopen')
  // Independent UI themes / reading colour, persistence and unchanged PDF bytes.
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/state/settingsStore.ts')
    useSettingsStore.getState().openSettings('appearance')
  })
  await page.waitForSelector('[aria-label="阅读底色"]')
  const before = await page.evaluate(() => Array.from(window.__pdfpro.useAppStore.getState().fileBytes))
  for (const palette of ['专业蓝', '石墨灰', '松林绿'])
    await page.$$eval('.palette-option', (els, name) => els.find((e) => e.textContent === name).click(), palette)
  await page.select('[aria-label="外观主题"]', 'dark')
  await page.select('[aria-label="阅读底色"]', 'original')
  assert.equal(await page.$eval('.page-canvas', (e) => getComputedStyle(e).filter), 'none')
  for (const value of ['warm', 'green', 'dark']) {
    await page.select('[aria-label="阅读底色"]', value)
    assert.notEqual(await page.$eval('.page-canvas', (e) => getComputedStyle(e).filter), 'none')
  }
  assert.deepEqual(await page.evaluate(() => Array.from(window.__pdfpro.useAppStore.getState().fileBytes)), before)
  await mkdir('.scratch/workspace-08', { recursive: true })
  await page.screenshot({ path: '.scratch/workspace-08/settings.png' })
  await page.reload({ waitUntil: 'networkidle2' })
  assert.deepEqual(
    await page.evaluate(() => ({
      palette: document.documentElement.dataset.palette,
      reading: document.documentElement.dataset.reading,
    })),
    { palette: 'forest', reading: 'dark' },
  )
  assert.deepEqual(errors, [])
  console.log('PASS formal homepage, three palettes, independent reading colour, persistence and unchanged PDF bytes')
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
