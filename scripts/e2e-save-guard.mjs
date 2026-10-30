// Save validation and external-file regression tests. Owns only in-memory
// desktop stubs; no user files are written. Run with Vite on 127.0.0.1:5174.
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
let suitePassed = false
async function check(name, run, timeoutMs = 30000) {
  let timer
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  passed++
  console.log(`PASS ${name}`)
}
async function open() {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/?file=/samples/sample.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => window.__pdfpro && document.querySelector('.textLayer span'))
  return page
}

try {
  const validation = await open()
  await check('save validator accepts real sample and form PDFs without replacing the active viewer', async () => {
    const result = await validation.evaluate(async () => {
      const { validatePdfOutput } = await import('/src/pdf/validateOutput.ts')
      const old = window.__pdfpro.useAppStore.getState().pdfDoc
      const reports = []
      for (const name of ['sample.pdf', 'form.pdf']) {
        const bytes = new Uint8Array(await (await fetch(`/samples/${name}`)).arrayBuffer())
        reports.push(await validatePdfOutput(bytes))
      }
      const stillReadable = (await (await old.getPage(1)).getTextContent()).items.length > 0
      return { reports, sameViewer: old === window.__pdfpro.useAppStore.getState().pdfDoc, stillReadable }
    })
    assert.deepEqual(
      result.reports.map((r) => r.pageCount),
      [6, 1],
    )
    assert.ok(result.sameViewer && result.stillReadable)
  })
  await check('save validator rejects empty, malformed, truncated, and unexpected page-count outputs', async () => {
    const result = await validation.evaluate(async () => {
      const { validatePdfOutput } = await import('/src/pdf/validateOutput.ts')
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      const cases = [new Uint8Array(), new TextEncoder().encode('not a PDF'), bytes.slice(0, 100), bytes]
      const rejected = []
      for (let i = 0; i < cases.length; i++) {
        try {
          await validatePdfOutput(cases[i], i === 3 ? 7 : undefined)
          rejected.push(false)
        } catch {
          rejected.push(true)
        }
      }
      return rejected
    })
    assert.deepEqual(result, [true, true, true, true])
  })
  await check('validation stops when its document version expires during an asynchronous parse', async () => {
    const result = await validation.evaluate(async () => {
      const { validatePdfOutput } = await import('/src/pdf/validateOutput.ts')
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      let current = true
      const pending = validatePdfOutput(bytes, 6, () => current).then(
        () => false,
        () => true,
      )
      current = false
      return pending
    })
    assert.equal(result, true)
  })
  await validation.close()

  const page = await open()
  const setup = async () =>
    page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const bytes = new Uint8Array(await (await fetch('/samples/sample.pdf')).arrayBuffer())
      await app.getState().openFile(bytes, 'guard.pdf', '/tmp/pdfpro-memory-guard.pdf')
      const fingerprint = {
        size: bytes.length,
        mtimeMs: 100,
        ctimeMs: 100,
        mtimeNs: '100000000',
        ctimeNs: '100000000',
        dev: '1',
        ino: '1',
        sha256: 'original',
      }
      app.setState({
        savePath: '/tmp/pdfpro-memory-guard.pdf',
        diskFingerprint: fingerprint,
        externalFile: null,
        diskDetached: false,
      })
      window.__saveGuard = {
        writes: [],
        saves: [],
        fingerprint,
        bytes,
        writeResult: null,
        saveResult: null,
        checkResult: null,
        readPayload: null,
      }
      window.pdfDesktop = {
        isDesktop: true,
        setTitle() {},
        setDirty() {},
        onOpenFile() {},
        onMenu() {},
        onCloseRequest() {},
        consumePendingOpen: async () => null,
        checkFile: async (_path, expected) => {
          const result = window.__saveGuard.checkResult
          if (result?.status === 'changed' && result.fingerprint?.sha256 === expected?.sha256)
            return { status: 'same', fingerprint: expected }
          return result ?? { status: 'same', fingerprint: expected }
        },
        readFile: async () =>
          window.__saveGuard.readPayload ?? {
            name: 'guard.pdf',
            path: '/tmp/pdfpro-memory-guard.pdf',
            data: bytes.slice(),
            fingerprint,
          },
        writeFile: async (path, data) => {
          window.__saveGuard.writes.push({ path, bytes: data.slice(), legacy: true })
          return path
        },
        saveAs: async (name, data) => {
          window.__saveGuard.saves.push({ name, bytes: data.slice(), legacy: true })
          return '/tmp/pdfpro-memory-copy.pdf'
        },
        writePdf: async (path, data, expected) => {
          const s = window.__saveGuard
          s.writes.push({ path, bytes: data.slice(), expected })
          return s.writeResult ?? { ok: true, path, fingerprint: { ...s.fingerprint, sha256: 'saved', mtimeMs: 101 } }
        },
        savePdfAs: async (name, data, guard) => {
          const s = window.__saveGuard
          s.saves.push({ name, bytes: data.slice(), guard })
          return (
            s.saveResult ?? {
              ok: true,
              path: '/tmp/pdfpro-memory-copy.pdf',
              fingerprint: { ...s.fingerprint, sha256: 'copy', mtimeMs: 102 },
            }
          )
        },
      }
      edit.getState().reset()
    })

  await check('malformed output never reaches any native write and does not mark edits saved', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      app.setState({ fileBytes: new TextEncoder().encode('broken output') })
      edit.getState().setFormDirty(true)
      const saved = await saveCurrentDocument()
      return {
        saved,
        writes: window.__saveGuard.writes.length,
        copies: window.__saveGuard.saves.length,
        dirty: edit.getState().dirty,
      }
    })
    assert.deepEqual(result, { saved: false, writes: 0, copies: 0, dirty: true })
  })

  await check('malformed PDF tool export is rejected before opening a native save dialog', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { saveBlobFile } = await import('/src/utils/save.ts')
      let saves = 0
      window.pdfDesktop.saveFile = async () => {
        saves++
        return '/tmp/should-not-be-written.pdf'
      }
      const saved = await saveBlobFile(
        'invalid.pdf',
        new TextEncoder().encode('bad export'),
        'application/pdf',
        'PDF',
        ['pdf'],
      )
      return { saved, saves, guardedDialogs: window.__saveGuard.saves.length }
    })
    assert.deepEqual(result, { saved: false, saves: 0, guardedDialogs: 0 })
  })

  await check('valid PDF tool export forwards the source guard to the protected save dialog', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { saveBlobFile } = await import('/src/utils/save.ts')
      let unguarded = 0
      window.pdfDesktop.saveFile = async () => {
        unguarded++
        return '/tmp/unguarded.pdf'
      }
      const saved = await saveBlobFile('copy.pdf', window.__saveGuard.bytes, 'application/pdf', 'PDF', ['pdf'])
      return { saved, unguarded, copies: window.__saveGuard.saves.length, guard: window.__saveGuard.saves[0]?.guard }
    })
    assert.equal(result.saved, true)
    assert.equal(result.unguarded, 0)
    assert.equal(result.copies, 1)
    assert.equal(result.guard.path, '/tmp/pdfpro-memory-guard.pdf')
    assert.equal(result.guard.fingerprint.sha256, 'original')
  })

  await check(
    'page deletion validates the resulting page count and forwards the expected disk fingerprint',
    async () => {
      await setup()
      const result = await page.evaluate(async () => {
        const { useAppStore: app, useEditStore: edit } = window.__pdfpro
        const { saveCurrentDocument } = await import('/src/utils/save.ts')
        edit.getState().pushOp({ kind: 'page-delete', id: 'delete', page: 0, pageIndex: 5 })
        const saved = await saveCurrentDocument()
        return {
          saved,
          pages: app.getState().pdfDoc.numPages,
          writes: window.__saveGuard.writes.length,
          expected: window.__saveGuard.writes[0]?.expected,
        }
      })
      assert.equal(result.saved, true)
      assert.equal(result.pages, 5)
      assert.equal(result.writes, 1)
      assert.equal(result.expected.sha256, 'original')
    },
  )

  await check('page insertion validates the new count instead of the original document count', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      edit
        .getState()
        .pushOp({ kind: 'page-insert-blank', id: 'insert', page: 0, pageIndex: 2, width: 300, height: 400 })
      const saved = await saveCurrentDocument()
      return { saved, pages: app.getState().pdfDoc.numPages, writes: window.__saveGuard.writes.length }
    })
    assert.deepEqual(result, { saved: true, pages: 7, writes: 1 })
  })

  await check('new password protection is validated then written as an encrypted PDF', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      const { decryptPdf, inspectEncryption, ALL_PERMISSIONS } = await import('/src/pdf/security/standardSecurity.ts')
      const { validatePdfOutput } = await import('/src/pdf/validateOutput.ts')
      edit.getState().pushOp({
        kind: 'security',
        id: 'security',
        page: 0,
        protect: { userPassword: 'test-open', ownerPassword: 'test-owner', permissions: ALL_PERMISSIONS },
      })
      const saved = await saveCurrentDocument()
      const written = new Uint8Array(window.__saveGuard.writes[0]?.bytes ?? [])
      const info = written.length ? await inspectEncryption(written) : null
      const plain = info ? await decryptPdf(written, 'test-open') : null
      return { saved, encrypted: !!info, report: plain ? await validatePdfOutput(plain.bytes, 6) : null }
    })
    assert.equal(result.saved, true)
    assert.equal(result.encrypted, true)
    assert.equal(result.report.pageCount, 6)
  })

  for (const fixture of [
    {
      name: 'enc-aes256.pdf',
      openPassword: '123',
      readPassword: '123',
      ownerPassword: 'own',
      owner: false,
      edit: false,
    },
    { name: 'enc-aes256.pdf', openPassword: 'own', readPassword: '123', ownerPassword: 'own', owner: true, edit: true },
    { name: 'enc-rc4.pdf', openPassword: 'own', readPassword: '123', ownerPassword: 'own', owner: true, edit: true },
    { name: 'enc-restrict.pdf', openPassword: '', readPassword: '', ownerPassword: null, owner: false, edit: false },
  ]) {
    await check(
      `original encryption roundtrip: ${fixture.name}, ${fixture.owner ? 'owner' : 'user'} session`,
      async () => {
        await setup()
        const result = await page.evaluate(async (sample) => {
          const { useAppStore: app, useEditStore: edit } = window.__pdfpro
          const { openPossiblyEncrypted, setPasswordAsker } = await import('/src/utils/secureOpen.ts')
          const { decryptPdf, decryptWithPreservedSecurity, inspectEncryption } = await import(
            '/src/pdf/security/standardSecurity.ts'
          )
          const { saveCurrentDocument } = await import('/src/utils/save.ts')
          const { validatePdfOutput } = await import('/src/pdf/validateOutput.ts')
          const input = new Uint8Array(await (await fetch(`/samples/${sample.name}`)).arrayBuffer())
          const fingerprint = {
            ...window.__saveGuard.fingerprint,
            sha256: `${sample.name}-original`,
            size: input.length,
          }
          const path = `/tmp/${sample.name}`
          window.__saveGuard.fingerprint = fingerprint
          let prompts = 0
          setPasswordAsker(async () => {
            prompts++
            return sample.openPassword
          })
          try {
            const opened = await openPossiblyEncrypted(input, sample.name, path, fingerprint)
            if (!opened) throw new Error(`Could not open encrypted fixture ${sample.name}`)
            const original = app.getState().encryption
            const pages = app.getState().pdfDoc.numPages
            app.getState().setSavePath(path)
            if (sample.edit)
              edit.getState().pushOp({
                kind: 'overlay-text',
                id: 'encrypted-edit',
                page: 1,
                x: 30,
                y: 100,
                text: 'ENCRYPTED ROUNDTRIP',
                fontName: 'Helvetica',
                fontSize: 14,
                color: '#000000',
              })
            const saved = await saveCurrentDocument()
            const entry = window.__saveGuard.writes[0]
            if (!saved || !entry) throw new Error(`Encrypted save did not produce output: ${sample.name}`)
            const written = new Uint8Array(entry?.bytes ?? [])
            const info = await inspectEncryption(written)
            const unlocked = await decryptPdf(written, sample.readPassword)
            const ownerUnlocked = sample.ownerPassword ? await decryptPdf(written, sample.ownerPassword) : null
            // AES owner sessions intentionally do not retain the user's password.
            // This verifies that the preserved key independently validates output.
            const withKey = await decryptWithPreservedSecurity(written, original.preserved)
            const report = await validatePdfOutput(withKey, pages)
            const { pdfjs } = await import('/src/pdf/document.ts')
            const readTask = pdfjs.getDocument({ data: unlocked.bytes.slice() })
            let text
            try {
              text = (await (await readTask.promise).getPage(1)).getTextContent()
              text = (await text).items.map((x) => x.str ?? '').join(' ')
            } finally {
              await readTask.destroy()
            }
            return {
              saved,
              encrypted: !!info,
              expected: entry?.expected?.sha256,
              openedOwner: original.owner,
              userPassword: original.userPassword,
              prompts,
              permissions: info?.permissions,
              originalPermissions: original.info.permissions,
              method: info?.method,
              originalMethod: original.info.method,
              ownerRetained: ownerUnlocked?.owner ?? null,
              pageCount: report.pageCount,
              pages,
              hasEdit: text.includes('ENCRYPTED ROUNDTRIP'),
            }
          } finally {
            setPasswordAsker(null)
          }
        }, fixture)
        assert.equal(result.saved, true)
        assert.equal(result.encrypted, true)
        assert.equal(result.expected, `${fixture.name}-original`)
        assert.equal(result.openedOwner, fixture.owner)
        assert.equal(result.prompts, fixture.openPassword ? 1 : 0)
        assert.deepEqual(result.permissions, result.originalPermissions)
        assert.equal(result.method, result.originalMethod)
        if (fixture.ownerPassword) assert.equal(result.ownerRetained, true)
        assert.equal(result.pageCount, result.pages)
        assert.equal(result.hasEdit, fixture.edit)
        if (fixture.name === 'enc-aes256.pdf' && fixture.owner) assert.equal(result.userPassword, null)
      },
      fixture.name === 'enc-restrict.pdf' ? 90000 : 30000,
    )
  }

  await check('native conflict keeps the active document dirty and preserves its edits', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      edit.getState().pushOp({
        kind: 'overlay-text',
        id: 'local',
        page: 1,
        x: 30,
        y: 100,
        text: 'LOCAL CHANGES',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      window.__saveGuard.writeResult = { ok: false, reason: 'conflict', message: 'changed externally' }
      const oldDoc = app.getState().pdfDoc
      const saved = await saveCurrentDocument()
      return {
        saved,
        same: oldDoc === app.getState().pdfDoc,
        dirty: edit.getState().dirty,
        text: edit.getState().ops[0]?.text,
        external: app.getState().externalFile?.status,
      }
    })
    assert.deepEqual(result, { saved: false, same: true, dirty: true, text: 'LOCAL CHANGES', external: 'changed' })
  })

  await check('editing while a write is pending preserves the later changes', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      edit.getState().pushOp({
        kind: 'overlay-text',
        id: 'pending',
        page: 1,
        x: 30,
        y: 100,
        text: 'FIRST VERSION',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      let release, started
      const boundary = new Promise((resolve) => {
        started = resolve
      })
      window.pdfDesktop.writePdf = async (path) => {
        started()
        await new Promise((resolve) => {
          release = resolve
        })
        return { ok: true, path, fingerprint: { ...window.__saveGuard.fingerprint, sha256: 'first-version' } }
      }
      const saving = saveCurrentDocument()
      await Promise.race([
        boundary,
        saving.then(() => {
          throw new Error('save ended before reaching guarded write')
        }),
      ])
      edit.getState().updateOp('pending', { text: 'LATER VERSION' })
      release()
      return { saved: await saving, dirty: edit.getState().dirty, text: edit.getState().ops[0]?.text }
    })
    assert.deepEqual(result, { saved: true, dirty: true, text: 'LATER VERSION' })
  })

  await check('saving an unchanged document adopts the committed disk version', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      const { checkExternalFile } = await import('/src/desktop/fileSync.ts')
      const saved = await saveCurrentDocument()
      const token = app.getState().diskFingerprint?.sha256
      await checkExternalFile()
      return { saved, token, issue: app.getState().externalFile, detached: app.getState().diskDetached }
    })
    assert.deepEqual(result, { saved: true, token: 'saved', issue: null, detached: false })
  })

  await check('external change shows a conflict and keeps local edits until the user chooses', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { checkExternalFile } = await import('/src/desktop/fileSync.ts')
      const old = app.getState().pdfDoc
      edit.getState().pushOp({
        kind: 'overlay-text',
        id: 'local',
        page: 1,
        x: 30,
        y: 100,
        text: 'KEEP ME',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      window.__saveGuard.checkResult = {
        status: 'changed',
        fingerprint: { ...window.__saveGuard.fingerprint, sha256: 'outside' },
      }
      await checkExternalFile()
      return {
        same: old === app.getState().pdfDoc,
        text: edit.getState().ops[0]?.text,
        dirty: edit.getState().dirty,
        issue: app.getState().externalFile?.status,
      }
    })
    assert.deepEqual(result, { same: true, text: 'KEEP ME', dirty: true, issue: 'changed' })
    await page.waitForSelector('.external-file-banner')
    assert.match(await page.$eval('.external-file-banner', (el) => el.textContent), /你的编辑仍保留/)
    await page.$eval('.external-file-banner', (el) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent === '保留当前编辑').click(),
    )
    const kept = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      const before = {
        detached: app.getState().diskDetached,
        savePath: app.getState().savePath,
        text: edit.getState().ops[0]?.text,
        token: app.getState().diskFingerprint?.sha256,
      }
      const saved = await saveCurrentDocument()
      return {
        before,
        saved,
        writes: window.__saveGuard.writes.length,
        copies: window.__saveGuard.saves.length,
        guard: window.__saveGuard.saves[0]?.guard,
      }
    })
    assert.deepEqual(kept.before, { detached: true, savePath: null, text: 'KEEP ME', token: 'original' })
    assert.equal(kept.saved, true)
    assert.equal(kept.writes, 0)
    assert.equal(kept.copies, 1)
    assert.equal(
      kept.guard.fingerprint.sha256,
      'original',
      'save-copy must not authorize overwriting the unseen external version',
    )
  })

  await check('clean external reload adopts fresh bytes, version, and page count', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app } = window.__pdfpro
      const { checkExternalFile, reloadExternalFile } = await import('/src/desktop/fileSync.ts')
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      const fresh = { ...window.__saveGuard.fingerprint, sha256: 'external-form', size: bytes.length }
      window.__saveGuard.checkResult = { status: 'changed', fingerprint: fresh }
      window.__saveGuard.readPayload = {
        name: 'guard.pdf',
        path: '/tmp/pdfpro-memory-guard.pdf',
        data: bytes,
        fingerprint: fresh,
      }
      await checkExternalFile()
      const reloaded = await reloadExternalFile()
      return {
        reloaded,
        pages: app.getState().pdfDoc.numPages,
        token: app.getState().diskFingerprint?.sha256,
        issue: app.getState().externalFile,
      }
    })
    assert.deepEqual(result, { reloaded: true, pages: 1, token: 'external-form', issue: null })
  })

  await check('canceling dirty external reload leaves edits and the old document intact', async () => {
    await setup()
    await page.evaluate(async () => {
      const { useEditStore: edit } = window.__pdfpro
      const { checkExternalFile } = await import('/src/desktop/fileSync.ts')
      edit.getState().pushOp({
        kind: 'overlay-text',
        id: 'cancel-reload',
        page: 1,
        x: 30,
        y: 100,
        text: 'DO NOT DISCARD',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      window.__saveGuard.checkResult = { status: 'changed' }
      await checkExternalFile()
    })
    await page.waitForSelector('.external-file-banner')
    await page.$eval('.external-file-banner', (el) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent === '重新载入').click(),
    )
    await page.waitForSelector('[role="alertdialog"]')
    await page.$eval('[role="alertdialog"]', (el) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click(),
    )
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'))
    const result = await page.evaluate(() => ({
      text: window.__pdfpro.useEditStore.getState().ops[0]?.text,
      dirty: window.__pdfpro.useEditStore.getState().dirty,
      token: window.__pdfpro.useAppStore.getState().diskFingerprint?.sha256,
    }))
    assert.deepEqual(result, { text: 'DO NOT DISCARD', dirty: true, token: 'original' })
  })

  await check('missing source keeps the document readable and saves a copy', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app } = window.__pdfpro
      const { checkExternalFile } = await import('/src/desktop/fileSync.ts')
      const { saveCurrentDocument } = await import('/src/utils/save.ts')
      window.__saveGuard.checkResult = { status: 'missing' }
      await checkExternalFile()
      const issue = app.getState().externalFile?.status
      const readable = (await (await app.getState().pdfDoc.getPage(1)).getTextContent()).items.length > 0
      const saved = await saveCurrentDocument()
      return {
        issue,
        readable,
        saved,
        writes: window.__saveGuard.writes.length,
        copies: window.__saveGuard.saves.length,
      }
    })
    assert.deepEqual(result, { issue: 'missing', readable: true, saved: true, writes: 0, copies: 1 })
  })

  await check('late external checks cannot publish a conflict into another document', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app } = window.__pdfpro
      const { checkExternalFile } = await import('/src/desktop/fileSync.ts')
      let release
      window.pdfDesktop.checkFile = () =>
        new Promise((resolve) => {
          release = resolve
        })
      const pending = checkExternalFile()
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      await app.getState().openFile(bytes, 'other-document.pdf', '/tmp/other-document.pdf')
      release({ status: 'changed' })
      await pending
      return {
        name: app.getState().fileName,
        issue: app.getState().externalFile,
        pages: app.getState().pdfDoc.numPages,
      }
    })
    assert.deepEqual(result, { name: 'other-document.pdf', issue: null, pages: 1 })
  })

  await check('late external reload cannot replace a document opened while disk reading', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app } = window.__pdfpro
      const { reloadExternalFile } = await import('/src/desktop/fileSync.ts')
      let release, started
      const boundary = new Promise((resolve) => {
        started = resolve
      })
      window.pdfDesktop.readFile = () =>
        new Promise((resolve) => {
          release = resolve
          started()
        })
      const pending = reloadExternalFile()
      await boundary
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      await app.getState().openFile(bytes, 'newer-document.pdf')
      release({
        name: 'obsolete.pdf',
        data: window.__saveGuard.bytes,
        path: '/tmp/pdfpro-memory-guard.pdf',
        fingerprint: window.__saveGuard.fingerprint,
      })
      return { reloaded: await pending, name: app.getState().fileName, pages: app.getState().pdfDoc.numPages }
    })
    assert.deepEqual(result, { reloaded: false, name: 'newer-document.pdf', pages: 1 })
  })

  await check('edits typed during an external reload prevent stale disk bytes from replacing them', async () => {
    await setup()
    const result = await page.evaluate(async () => {
      const { useAppStore: app, useEditStore: edit } = window.__pdfpro
      const { reloadExternalFile } = await import('/src/desktop/fileSync.ts')
      let release, started
      const boundary = new Promise((resolve) => {
        started = resolve
      })
      window.pdfDesktop.readFile = () =>
        new Promise((resolve) => {
          release = resolve
          started()
        })
      const pending = reloadExternalFile()
      await boundary
      edit.getState().pushOp({
        kind: 'overlay-text',
        id: 'during-read',
        page: 1,
        x: 30,
        y: 100,
        text: 'TYPED DURING READ',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      })
      release({
        name: 'guard.pdf',
        data: window.__saveGuard.bytes,
        path: '/tmp/pdfpro-memory-guard.pdf',
        fingerprint: window.__saveGuard.fingerprint,
      })
      return {
        reloaded: await pending,
        name: app.getState().fileName,
        text: edit.getState().ops[0]?.text,
        dirty: edit.getState().dirty,
      }
    })
    assert.deepEqual(result, { reloaded: false, name: 'guard.pdf', text: 'TYPED DURING READ', dirty: true })
  })

  await check('desktop drop reads the native snapshot and retains its conflict-detection fingerprint', async () => {
    await setup()
    await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      const path = '/tmp/pdfpro-native-drop.pdf'
      window.pdfDesktop.getPathForFile = () => path
      window.__saveGuard.dropReads = 0
      window.pdfDesktop.readFile = async (requested) => {
        if (requested !== path) throw new Error('wrong native drop path')
        window.__saveGuard.dropReads++
        return {
          name: 'native-drop.pdf',
          path,
          data: bytes,
          fingerprint: { ...window.__saveGuard.fingerprint, sha256: 'native-drop', size: bytes.length },
        }
      }
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'browser-drop.pdf', { type: 'application/pdf' }))
      document
        .querySelector('.app-root')
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForFunction(() => window.__pdfpro.useAppStore.getState().fileName === 'native-drop.pdf')
    const result = await page.evaluate(() => ({
      reads: window.__saveGuard.dropReads,
      path: window.__pdfpro.useAppStore.getState().filePath,
      token: window.__pdfpro.useAppStore.getState().diskFingerprint?.sha256,
    }))
    assert.deepEqual(result, { reads: 1, path: '/tmp/pdfpro-native-drop.pdf', token: 'native-drop' })
  })

  await check('dirty form close dialog describes unsaved edits and cancel preserves the form', async () => {
    await setup()
    await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/samples/form.pdf')).arrayBuffer())
      await window.__pdfpro.useAppStore.getState().openFile(bytes, 'dirty-form.pdf')
    })
    await page.waitForSelector('.annotationLayer input[type="text"]')
    await page.type('.annotationLayer input[type="text"]', 'UNSAVED FORM VALUE')
    await page.waitForFunction(() => window.__pdfpro.useEditStore.getState().dirty)
    await page.evaluate(async () => {
      const { closeDocument } = await import('/src/utils/docSession.ts')
      window.__formClosing = closeDocument()
    })
    await page.waitForSelector('[role="alertdialog"]')
    const message = await page.$eval('#unsaved-desc', (el) => el.textContent)
    assert.match(message, /文档有尚未保存的修改/)
    assert.doesNotMatch(message, /0\s*处修改/)
    await page.$eval('[role="alertdialog"]', (el) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click(),
    )
    const result = await page.evaluate(async () => ({
      closed: await window.__formClosing,
      name: window.__pdfpro.useAppStore.getState().fileName,
      dirty: window.__pdfpro.useEditStore.getState().dirty,
      ops: window.__pdfpro.useEditStore.getState().ops.length,
      value: document.querySelector('.annotationLayer input[type="text"]').value,
    }))
    assert.deepEqual(result, {
      closed: false,
      name: 'dirty-form.pdf',
      dirty: true,
      ops: 0,
      value: 'UNSAVED FORM VALUE',
    })
  })

  await page.close()
  assert.deepEqual(errors, [], 'unexpected browser errors')
  suitePassed = true
} catch (error) {
  console.error('SAVE GUARD REGRESSIONS FAILED', error)
  if (errors.length) console.error('Browser errors:', errors)
  process.exitCode = 1
} finally {
  // Chromium helpers can inherit a child-process pipe after the browser has
  // exited. Bound shutdown and release the transport/stdio explicitly, rather
  // than letting a successful CLI sit alive until the outer runner times out.
  const child = browser.process()
  const bounded = async (promise, ms) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const exited =
    child && (child.exitCode !== null || child.signalCode !== null)
      ? Promise.resolve(true)
      : new Promise((resolve) => child?.once('exit', () => resolve(true)))
  const closed = await bounded(
    browser.close().then(
      () => true,
      () => false,
    ),
    5000,
  )
  if (!closed) {
    child?.kill('SIGKILL')
    browser.disconnect()
    await bounded(exited, 2000)
  }
  browser.disconnect()
  for (const stream of child?.stdio ?? []) stream?.destroy?.()
  child?.unref()
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(child.pid, 0)
      console.error('Test browser did not exit during bounded cleanup')
      process.exitCode = 1
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(error)
        process.exitCode = 1
      }
    }
  }
}
if (suitePassed && !process.exitCode) console.log(`SAVE GUARD REGRESSIONS PASS (${passed} tests)`)
// This file is an isolated CLI, not a library. Flush the verdict before
// terminating any remaining Puppeteer bookkeeping handles.
await Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
])
process.exit(process.exitCode ?? 0)
