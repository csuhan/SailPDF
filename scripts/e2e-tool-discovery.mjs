import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
const errors = []
const page = await browser.newPage()
page.on('pageerror', (error) => errors.push(error.message))
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}
const search = async (query) => {
  await page.$eval('.command-search input', (input) => {
    input.focus()
    input.select()
  })
  await page.keyboard.press('Backspace')
  if (query) await page.type('.command-search input', query)
  await page.waitForFunction(
    (expected) => document.querySelector('.command-search input')?.value === expected,
    {},
    query,
  )
}
const openPalette = async () => {
  await page.click('[aria-label="搜索工具与命令"], .home-tool-search')
  await page.waitForSelector('.command-palette')
}

try {
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.home-tool-search')
  await page.evaluate(() => localStorage.removeItem('pdfpro.favoriteTools.v1'))
  await page.reload({ waitUntil: 'networkidle2' })
  await check('welcome search finds tasks and explains unavailable native capabilities', async () => {
    await openPalette()
    await search('减小附件')
    assert.equal(await page.$eval('.command-results [data-tool-id]', (row) => row.dataset.toolId), 'optimize')
    assert.match(await page.$eval('.command-results', (list) => list.textContent), /选择 PDF 后使用/)
    await search('扫描识字')
    assert.equal(await page.$eval('[data-tool-id="ocr"] .command-run', (button) => button.disabled), true)
    assert.match(await page.$eval('[data-tool-id="ocr"]', (row) => row.textContent), /macOS 桌面版/)
  })
  await check('favorites persist across reload and can be filtered', async () => {
    await search('减小附件')
    await page.click('[aria-label="收藏压缩 PDF"]')
    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'networkidle2' })
    await openPalette()
    await page.evaluate(() =>
      [...document.querySelectorAll('.command-filter button')]
        .find((button) => button.textContent.startsWith('我的收藏'))
        .click(),
    )
    assert.deepEqual(
      await page.$$eval('.command-results [data-tool-id]', (rows) => rows.map((row) => row.dataset.toolId)),
      ['optimize'],
    )
    assert.equal(
      await page.$eval('[aria-label="取消收藏压缩 PDF"]', (button) => button.getAttribute('aria-pressed')),
      'true',
    )
  })
  await check('choosing a tool before opening a file continues to its dialog', async () => {
    const [chooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click('[data-tool-id="optimize"] .command-run'),
    ])
    await chooser.accept([path.resolve('public/samples/sample.pdf')])
    await page.waitForFunction(() => window.__pdfpro?.useAppStore.getState().pdfDoc)
    await page.waitForSelector('[role="dialog"][aria-label="压缩 PDF"]')
    assert.equal(await page.$('.command-palette'), null)
    await page.keyboard.press('Escape')
  })
  await check('keyboard search runs a catalog tool and Escape preserves the document', async () => {
    const before = await page.evaluate(() => window.__pdfpro.useAppStore.getState().fileName)
    await page.keyboard.down('Control')
    await page.keyboard.press('k')
    await page.keyboard.up('Control')
    await page.waitForSelector('.command-palette')
    await search('页码')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"][aria-label="页码"]')
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => window.__pdfpro.useAppStore.getState().fileName), before)
  })
  await check('tools hub shares search and favorite preferences', async () => {
    await page.evaluate(() => window.__pdfpro.useToolStore.getState().setMode('tools'))
    await page.waitForSelector('[aria-label="搜索工具"]')
    await page.type('[aria-label="搜索工具"]', '减小附件')
    assert.deepEqual(await page.$$eval('.tools-grid [data-tool-id]', (rows) => rows.map((row) => row.dataset.toolId)), [
      'optimize',
    ])
    assert.equal(
      await page.$eval('.tools-grid [aria-label="取消收藏压缩 PDF"]', (button) => button.getAttribute('aria-pressed')),
      'true',
    )
    await page.click('.tools-grid [aria-label="取消收藏压缩 PDF"]')
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pdfpro.favoriteTools.v1'))), [])
  })
  await check('restricted documents disable catalog actions and runner enforces the same checks', async () => {
    await page.evaluate(async () => {
      const { openPossiblyEncrypted } = await import('/src/utils/secureOpen.ts')
      const bytes = new Uint8Array(await (await fetch('/samples/enc-restrict.pdf')).arrayBuffer())
      await openPossiblyEncrypted(bytes, 'restricted.pdf', null)
    })
    await page.waitForFunction(
      () =>
        window.__pdfpro.useAppStore.getState().encryption && !window.__pdfpro.useAppStore.getState().encryption.owner,
    )
    await openPalette()
    await search('水印')
    assert.equal(await page.$eval('[data-tool-id="watermark"] .command-run', (button) => button.disabled), true)
    assert.match(await page.$eval('[data-tool-id="watermark"]', (row) => row.textContent), /文档权限/)
    await page.evaluate(async () => {
      const { runTool } = await import('/src/tools/runTool.ts')
      await runTool('watermark')
    })
    assert.equal(await page.$('[role="dialog"][aria-label="水印"]'), null)
    await search('保护')
    assert.equal(await page.$eval('[data-tool-id="protect"] .command-run', (button) => button.disabled), false)
    await search('文档属性')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"][aria-label="文档属性"]')
    assert.equal(await page.$eval('[aria-label="文档属性"] .btn.primary', (button) => button.disabled), true)
    await page.keyboard.press('Escape')
  })
  await check('restricted PDF copies retain password protection and block transforming variants', async () => {
    await openPalette()
    await search('导出 PDF 副本')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"][aria-label="导出 PDF 副本"]')
    assert.deepEqual(
      await page.$$eval('input[name="exp-variant"]', (inputs) =>
        inputs.map((input) => ({ checked: input.checked, disabled: input.disabled })),
      ),
      [
        { checked: true, disabled: false },
        { checked: false, disabled: true },
        { checked: false, disabled: true },
      ],
    )
    await page.evaluate(() => {
      window.pdfDesktop = {
        isDesktop: true,
        saveFile: async (_name, bytes) => {
          window.__exportedCopy = Array.from(bytes)
          return '/test/restricted-copy.pdf'
        },
      }
    })
    await page.click('[aria-label="导出 PDF 副本"] .btn.primary')
    await page.waitForFunction(() => window.__exportedCopy)
    const result = await page.evaluate(async () => {
      const { inspectEncryption, decryptPdf } = await import('/src/pdf/security/standardSecurity.ts')
      const { pdfjs } = await import('/src/pdf/document.ts')
      const bytes = new Uint8Array(window.__exportedCopy)
      const info = await inspectEncryption(bytes)
      const decrypted = await decryptPdf(bytes, '')
      const doc = await pdfjs.getDocument({ data: decrypted.bytes.slice() }).promise
      const result = {
        encrypted: !!info,
        restricted: info?.restricted,
        owner: decrypted.owner,
        modify: info?.permissions.modify,
        pages: doc.numPages,
      }
      await doc.destroy()
      delete window.pdfDesktop
      return result
    })
    assert.equal(result.encrypted, true)
    assert.equal(result.restricted, true)
    assert.equal(result.owner, false)
    assert.equal(result.modify, false)
    assert.ok(result.pages > 0)
  })
  await check('delayed capability checks cannot open an OCR dialog in a replacement document', async () => {
    const race = await browser.newPage()
    race.on('pageerror', (error) => errors.push(error.message))
    try {
      await race.goto(`${origin}/?file=/samples/sample.pdf`, { waitUntil: 'networkidle2' })
      await race.waitForFunction(() => window.__pdfpro?.useAppStore.getState().pdfDoc)
      const result = await race.evaluate(async () => {
        const { runTool } = await import('/src/tools/runTool.ts')
        const { useToolDiscoveryStore } = await import('/src/state/toolDiscoveryStore.ts')
        const releases = []
        window.pdfDesktop = {
          isDesktop: true,
          setTitle: () => {},
          setDirty: () => {},
          ocr: async () => [],
          ocrAvailable: () =>
            new Promise((resolve) => {
              releases.push(resolve)
            }),
        }
        const pending = runTool('ocr')
        const bytes = new Uint8Array(await (await fetch('/samples/links.pdf')).arrayBuffer())
        await window.__pdfpro.useAppStore.getState().openFile(bytes, 'replacement.pdf')
        for (const release of releases) release(true)
        await pending
        delete window.pdfDesktop
        return {
          name: window.__pdfpro.useAppStore.getState().fileName,
          dialog: useToolDiscoveryStore.getState().dialog,
        }
      })
      assert.deepEqual(result, { name: 'replacement.pdf', dialog: null })
    } finally {
      await race.close()
    }
  })
  assert.deepEqual(errors, [], 'unexpected page errors')
  console.log(`TOOL DISCOVERY TESTS PASS (${passed} tests)`)
} catch (error) {
  console.error('TOOL DISCOVERY TESTS FAILED', error)
  if (errors.length) console.error(errors)
  process.exitCode = 1
} finally {
  const killTimer = setTimeout(() => browser.process()?.kill('SIGKILL'), 5000)
  try {
    await browser.close()
  } finally {
    clearTimeout(killTimer)
  }
}
