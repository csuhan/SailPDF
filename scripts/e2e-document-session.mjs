import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.text().startsWith('session:')) console.log(m.text())
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${origin}/?file=/samples/sample.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.textLayer span')
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const result = await page.evaluate(async () => {
    const { useAppStore: app, useEditStore: edit } = window.__pdfpro
    const { openDocument, setUnsavedAsker } = await import('/src/utils/docSession.ts')
    const { setPasswordAsker } = await import('/src/utils/secureOpen.ts')
    const { currentOutputBytes } = await import('/src/utils/output.ts')
    const { saveCurrentDocument } = await import('/src/utils/save.ts')
    const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
    const op = {
      kind: 'overlay-text',
      id: 'pending',
      page: 1,
      x: 30,
      y: 100,
      text: 'PENDING',
      fontName: 'Helvetica',
      fontSize: 14,
      color: '#000000',
    }
    const out = {}
    const oldDoc = app.getState().pdfDoc
    edit.getState().pushOp(op)
    setUnsavedAsker(async () => 'discard')
    out.corruptReturned = await openDocument({ data: new TextEncoder().encode('broken PDF'), name: 'broken.pdf' })
    out.retained =
      app.getState().pdfDoc === oldDoc && edit.getState().ops[0]?.text === 'PENDING' && edit.getState().dirty
    out.readable = !!(
      await Promise.race([
        (async () => (await oldDoc.getPage(2)).getTextContent())(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('old document not readable after failure')), 5000),
        ),
      ])
    ).items.length
    setPasswordAsker(async () => null)
    out.passwordReturned = await openDocument({
      data: new Uint8Array(await (await fetch('/samples/enc-aes256.pdf')).arrayBuffer()),
      name: 'locked.pdf',
    })
    out.passwordRetained = app.getState().pdfDoc === oldDoc && edit.getState().dirty

    let release
    const delayed = new File([bytes], 'late.pdf', { type: 'application/pdf' })
    delayed.arrayBuffer = () => new Promise((r) => (release = () => r(bytes.slice().buffer)))
    const first = app.getState().openFile(delayed, 'late.pdf')
    out.latestOpened = await app.getState().openFile(bytes.slice(), 'latest.pdf')
    release()
    out.obsoleteReturned = await first
    out.latestName = app.getState().fileName

    const closingFile = new File([bytes], 'closing.pdf')
    closingFile.arrayBuffer = () => new Promise((r) => (release = () => r(bytes.slice().buffer)))
    const closingOpen = app.getState().openFile(closingFile, 'closing.pdf')
    await app.getState().closeFile()
    release()
    out.closedReturned = await closingOpen
    out.stillClosed = app.getState().pdfDoc === null && !app.getState().loading

    const formBytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
    await app.getState().openFile(formBytes, 'form.pdf')
    const formDoc = app.getState().pdfDoc
    const fields = await formDoc.getFieldObjects()
    formDoc.annotationStorage.setValue(fields.name[0].id, { value: 'FORM UNSAVED' })
    const formRevision = edit.getState().revision
    await currentOutputBytes()
    out.formExportKeepsDirty = edit.getState().dirty && edit.getState().revision === formRevision
    await app.getState().openFile(bytes.slice(), 'race.pdf')
    const doc = app.getState().pdfDoc
    doc.annotationStorage.setValue('fake-field', { value: 'test' })
    doc.saveDocument = () => new Promise((r) => (release = () => r(bytes.slice())))
    const output = currentOutputBytes().then(
      () => false,
      () => true,
    )
    await app.getState().openFile(bytes.slice(), 'different.pdf')
    release()
    out.outputRejectedMixedDocs = await output

    edit.getState().pushOp(op)
    app.getState().setSavePath('/temporary-test-output.pdf')
    let writeStarted
    const started = new Promise((r) => (writeStarted = r))
    window.pdfDesktop = {
      isDesktop: true,
      setTitle() {},
      setDirty() {},
      writeFile: async (path) => {
        writeStarted()
        await new Promise((r) => (release = r))
        return path
      },
    }
    const saving = saveCurrentDocument()
    await Promise.race([
      started,
      saving.then(() => {
        throw new Error('Save completed before reaching write boundary')
      }),
    ])
    edit.getState().updateOp('pending', { text: 'LATER EDIT' })
    release()
    out.saved = await saving
    out.laterEditsPreserved = edit.getState().dirty && edit.getState().ops[0]?.text === 'LATER EDIT'
    delete window.pdfDesktop
    return out
  })
  assert.equal(result.corruptReturned, false)
  assert.ok(result.retained && result.readable)
  assert.equal(result.passwordReturned, false)
  assert.ok(result.passwordRetained)
  assert.equal(result.latestOpened, true)
  assert.equal(result.obsoleteReturned, false)
  assert.equal(result.latestName, 'latest.pdf')
  assert.equal(result.closedReturned, false)
  assert.ok(result.stillClosed)
  assert.ok(result.formExportKeepsDirty)
  assert.ok(result.outputRejectedMixedDocs)
  assert.ok(result.saved && result.laterEditsPreserved)
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().reset())
  await page.goto(`${origin}/?file=/samples/form.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.annotationLayer input[type="text"]')
  await page.type('.annotationLayer input[type="text"]', 'first')
  const formRevision = await page.evaluate(() => window.__pdfpro.useEditStore.getState().revision)
  await page.type('.annotationLayer input[type="text"]', 'second')
  assert.ok(
    await page.evaluate((revision) => window.__pdfpro.useEditStore.getState().revision > revision, formRevision),
    'Every form edit must invalidate a pending plan, including already-dirty fields',
  )
  assert.deepEqual(errors, [])
  console.log('DOCUMENT SESSION REGRESSIONS PASS', JSON.stringify(result))
} finally {
  await browser.close()
}
