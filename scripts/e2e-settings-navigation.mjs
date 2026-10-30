import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'

const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
const errors = []
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}
const settings = async (page, section = 'appearance') => {
  if (!(await page.$('.settings-dialog'))) await page.click('[aria-label="设置"]')
  await page.waitForSelector('.settings-dialog')
  await page.click(`#settings-nav-${section}`)
}
const closeSettings = async (page) => {
  await page.click('[aria-label="关闭设置"]')
  await page.waitForFunction(() => !document.querySelector('.settings-dialog'))
}
const openSample = async (page, name = 'sample.pdf') => {
  await page.evaluate(async (name) => {
    const { openDocument, setUnsavedAsker } = await import('/src/utils/docSession.ts')
    setUnsavedAsker(async () => 'discard')
    await openDocument({ data: new Uint8Array(await (await fetch(`/samples/${name}`)).arrayBuffer()), name })
    setUnsavedAsker(null)
  }, name)
  await page.waitForSelector('.textLayer span')
}

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.app-navigation')
  await check('home has a persistent left rail and settings keyboard entry', async () => {
    assert.equal(await page.$$eval('.app-navigation .mode-tab', (items) => items.length), 5)
    await page.keyboard.down('Control')
    await page.keyboard.press(',')
    await page.keyboard.up('Control')
    await page.waitForSelector('.settings-dialog')
    assert.equal(await page.$eval('.settings-nav', (el) => el.querySelectorAll('[role=tab]').length), 5)
  })
  await check('reading preferences and appearance persist across reload', async () => {
    await page.select('[aria-label="外观主题"]', 'dark')
    await page.select('[aria-label="默认页面布局"]', 'single')
    await page.select('[aria-label="默认缩放方式"]', 'custom')
    await page.select('[aria-label="默认缩放比例"]', '1.5')
    await page.click('[aria-label="打开时恢复上次阅读位置"]')
    await closeSettings(page)
    await page.reload({ waitUntil: 'networkidle2' })
    await settings(page)
    assert.equal(await page.$eval('[aria-label="默认页面布局"]', (el) => el.value), 'single')
    assert.equal(await page.$eval('[aria-label="默认缩放比例"]', (el) => el.value), '1.5')
    assert.equal(await page.$eval('[aria-label="打开时恢复上次阅读位置"]', (el) => el.checked), false)
    assert.equal(await page.$eval('html', (el) => el.dataset.theme), 'dark')
    await closeSettings(page)
  })
  await check('new document adopts defaults; later preference changes leave its view alone', async () => {
    await openSample(page)
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.__pdfpro.useAppStore.getState()
        return [s.viewMode, s.fitMode, s.scale]
      }),
      ['single', 'custom', 1.5],
    )
    await settings(page)
    await page.select('[aria-label="默认页面布局"]', 'continuous')
    await page.select('[aria-label="默认缩放方式"]', 'fit-width')
    await page.select('[aria-label="外观主题"]', 'light')
    await closeSettings(page)
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.__pdfpro.useAppStore.getState()
        return [s.viewMode, s.fitMode, s.scale]
      }),
      ['single', 'custom', 1.5],
    )
    await openSample(page, 'links.pdf')
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.__pdfpro.useAppStore.getState()
        return [s.viewMode, s.fitMode]
      }),
      ['continuous', 'fit-width'],
    )
  })
  await check('work modes live only on the left and retain editing controls', async () => {
    assert.equal(await page.$$eval('.app-header .mode-tab', (els) => els.length), 0)
    await page.click('.app-navigation [data-mode=edit]')
    await page.waitForSelector('.mode-toolbar')
    assert.equal(await page.$eval('.app-navigation [data-mode=edit]', (el) => el.getAttribute('aria-pressed')), 'true')
    await page.click('.app-navigation [data-mode=tools]')
    await page.waitForSelector('.tools-view')
    await page.click('.app-navigation [data-mode=read]')
    await page.waitForFunction(() => !document.querySelector('.tools-view'))
  })
  await check('settings and document actions remain inside a narrow desktop window', async () => {
    await page.setViewport({ width: 1020, height: 720 })
    const bounds = await page.evaluate(() => {
      const save = document.querySelector('.save-btn').getBoundingClientRect()
      const rail = document.querySelector('.app-navigation').getBoundingClientRect()
      const view = document.querySelector('.viewport-area').getBoundingClientRect()
      return {
        saveRight: save.right,
        width: innerWidth,
        railWidth: rail.width,
        viewWidth: view.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        labelsVisible: [...document.querySelectorAll('.app-navigation .mode-tab > span')].every(
          (el) => el.getBoundingClientRect().height > 0,
        ),
      }
    })
    assert.ok(
      bounds.saveRight <= bounds.width &&
        bounds.railWidth >= 60 &&
        bounds.viewWidth > 400 &&
        !bounds.overflow &&
        bounds.labelsVisible,
      JSON.stringify(bounds),
    )
    await settings(page)
    assert.ok(
      await page.$eval('.settings-dialog', (el) => {
        const r = el.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
      }),
    )
    await closeSettings(page)
    await page.setViewport({ width: 1440, height: 1000 })
  })
  await check('settings keyboard input never undoes edits behind the dialog', async () => {
    await page.evaluate(() =>
      window.__pdfpro.useEditStore.getState().pushOp({
        kind: 'overlay-text',
        id: 'settings-edit',
        page: 1,
        x: 30,
        y: 100,
        text: 'KEEP SETTINGS EDIT',
        fontName: 'Helvetica',
        fontSize: 14,
        color: '#000000',
      }),
    )
    await settings(page, 'saving')
    await page.keyboard.down('Control')
    await page.keyboard.press('z')
    await page.keyboard.up('Control')
    assert.equal(await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops[0]?.id), 'settings-edit')
    await page.$eval('[aria-label="副本名称后缀"]', (input) => {
      input.focus()
      input.select()
    })
    await page.type('[aria-label="副本名称后缀"]', '_copy')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.settings-dialog'))
    assert.equal(
      await page.evaluate(async () => (await import('/src/state/preferences.ts')).usePreferences.getState().copySuffix),
      '_copy',
    )
    assert.equal(await page.evaluate(() => window.__pdfpro.useEditStore.getState().dirty), true)
  })
  await check('recovery controls persist without deleting existing drafts when disabled', async () => {
    await settings(page, 'saving')
    await page.select('[aria-label="恢复草稿保存间隔"]', '10000')
    await page.click('[aria-label="自动保存恢复草稿"]')
    assert.equal(await page.$eval('[aria-label="恢复草稿保存间隔"]', (el) => el.disabled), true)
    assert.equal(
      await page.evaluate(
        async () => (await import('/src/state/preferences.ts')).usePreferences.getState().autosaveEnabled,
      ),
      false,
    )
    await closeSettings(page)
    await page.evaluate(async () => {
      const r = indexedDB.open('pdfpro', 1)
      const db = await new Promise((resolve, reject) => {
        r.onupgradeneeded = () => r.result.createObjectStore('drafts')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      await new Promise((resolve, reject) => {
        const t = db.transaction('drafts', 'readwrite')
        t.objectStore('drafts').put(
          { name: 'settings-test.pdf', size: 10, savedAt: Date.now(), ops: [{ id: 'qa' }] },
          'qa-draft',
        )
        t.oncomplete = resolve
        t.onerror = () => reject(t.error)
      })
      db.close()
    })
    await settings(page, 'saving')
    await page.waitForSelector('[aria-label="删除草稿 settings-test.pdf"]')
    await page.click('[aria-label="删除草稿 settings-test.pdf"]')
    await page.waitForSelector('[aria-label="确认删除恢复草稿"]')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[aria-label="确认删除恢复草稿"]'))
    assert.ok(await page.$('.settings-dialog'))
    assert.ok(await page.$('[aria-label="删除草稿 settings-test.pdf"]'))
    await page.click('[aria-label="删除草稿 settings-test.pdf"]')
    await page.$eval('[aria-label="确认删除恢复草稿"]', (el) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除草稿').click(),
    )
    await page.waitForFunction(() => !document.querySelector('[aria-label="删除草稿 settings-test.pdf"]'))
    await closeSettings(page)
  })
  await check('AI settings are available on home and About shows the build version', async () => {
    await page.evaluate(async () => {
      window.__pdfpro.useEditStore.getState().reset()
      await window.__pdfpro.useAppStore.getState().closeFile()
    })
    await settings(page, 'ai')
    await page.waitForSelector('.settings-content .ai-settings')
    assert.match(await page.$eval('.settings-content', (el) => el.textContent), /无需打开 PDF/)
    await page.click('#settings-nav-about')
    assert.match(await page.$eval('.settings-about', (el) => el.textContent), /版本 \d+\.\d+\.\d+/)
    await mkdir('.scratch/settings-navigation-qa', { recursive: true })
    await page.screenshot({ path: '.scratch/settings-navigation-qa/settings.png' })
    await closeSettings(page)
  })
  await check('document permissions still disable restricted left navigation modes', async () => {
    await openSample(page, 'enc-restrict.pdf')
    for (const mode of ['edit', 'annotate', 'pages'])
      assert.equal(await page.$eval(`.app-navigation [data-mode=${mode}]`, (el) => el.disabled), true)
    assert.equal(await page.$eval('.app-navigation [data-mode=tools]', (el) => el.disabled), false)
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().reset())
  })
  assert.deepEqual(errors, [], 'unexpected page errors')
  console.log(`SETTINGS NAVIGATION TESTS PASS (${passed} tests)`)
} catch (error) {
  console.error('SETTINGS NAVIGATION TESTS FAILED', error)
  process.exitCode = 1
} finally {
  const child = browser.process()
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
  browser.disconnect()
  child?.kill('SIGKILL')
  for (const stream of child?.stdio ?? []) stream?.destroy?.()
  child?.unref()
}
await new Promise((r) => process.stdout.write('', r))
process.exit(process.exitCode ?? 0)
