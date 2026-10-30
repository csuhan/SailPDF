// Regression coverage for search sessions and page identity. Run the dev
// server first (default http://127.0.0.1:5174; override with PDFPRO_TEST_ORIGIN).
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const origin = process.env.PDFPRO_TEST_ORIGIN || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 1000 },
})
const errors = []
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}
const open = async () => {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/?file=/samples/sample.pdf`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => window.__pdfpro && document.querySelector('.textLayer span'))
  return page
}
const showSearch = async (page) => {
  await page.click('[aria-label="查找"]')
  await page.waitForSelector('.search-panel input')
  // The app selects existing text after focus; finish that before typing.
  await pause(80)
}
const query = async (page, text) => {
  await page.$eval('.search-panel input', (input) => {
    input.focus()
    input.select()
  })
  await page.keyboard.press('Backspace')
  await page.type('.search-panel input', text)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(
    (q) => {
      const s = window.__pdfpro.useAppStore.getState()
      return s.searchQuery === q && document.querySelector('.search-count')?.textContent !== '搜索中…'
    },
    {},
    text,
  )
}
const state = (page) =>
  page.evaluate(() => {
    const s = window.__pdfpro.useAppStore.getState()
    return {
      query: s.searchQuery,
      total: s.searchTotal,
      currentPage: s.currentPage,
      matches: s.searchMatches,
      label: document.querySelector('.search-count')?.textContent,
      error: document.querySelector('.search-count')?.title,
    }
  })
const closeSearch = (page) => page.click('.search-panel button[title="关闭 (Esc)"]')

try {
  const page = await open()
  await check('close / reopen restores the same query and results', async () => {
    await showSearch(page)
    await query(page, 'lorem')
    const first = await state(page)
    assert.ok(first.total > 0, JSON.stringify(first))
    await closeSearch(page)
    await page.waitForFunction(() => window.__pdfpro.useAppStore.getState().searchTotal === 0)
    await showSearch(page)
    await page.waitForFunction((total) => window.__pdfpro.useAppStore.getState().searchTotal === total, {}, first.total)
    assert.equal(await page.$eval('.search-panel input', (input) => input.value), 'lorem')
  })

  await check('real page move makes search navigate the new view page', async () => {
    await closeSearch(page)
    await page.evaluate(() =>
      [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '页面').click(),
    )
    await page.waitForSelector('.org-item:nth-child(6)')
    await page.click('.org-item:nth-child(6)')
    for (let i = 0; i < 5; i++) {
      await page.click('[title="把所选页面前移一位"]')
      await pause(30)
    }
    await page.click('.organize-done')
    await showSearch(page)
    await query(page, 'This is the last page')
    const result = await state(page)
    assert.equal(result.total, 1)
    assert.equal(result.currentPage, 1)
    assert.equal(result.matches[0].page, 1)
  })

  await check('real page deletion removes its search matches', async () => {
    await closeSearch(page)
    await page.evaluate(() =>
      [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.trim() === '页面').click(),
    )
    await page.waitForSelector('.org-item')
    await page.click('.org-item:nth-child(1)')
    await page.click('[title="删除所选页面"]')
    await page.click('.organize-done')
    await showSearch(page)
    await query(page, 'This is the last page.')
    await page.waitForFunction(() => document.querySelector('.search-count')?.textContent === '无结果')
    assert.equal((await state(page)).total, 0)
  })
  await page.close()

  const cancellation = await open()
  await check('closing during debounce cancels a pending scan', async () => {
    await showSearch(cancellation)
    await cancellation.type('.search-panel input', 'This is the last page')
    await closeSearch(cancellation)
    await pause(450)
    const result = await state(cancellation)
    assert.equal(result.query, '')
    assert.equal(result.total, 0)
    assert.equal(result.currentPage, 1)
  })
  await check('closing an in-flight scan cannot restore results or navigate', async () => {
    await cancellation.evaluate(() => {
      const doc = window.__pdfpro.useAppStore.getState().pdfDoc
      const original = doc.getPage.bind(doc)
      window.__searchDelayStarted = false
      doc.getPage = async (n) => {
        if (n === 6) {
          window.__searchDelayStarted = true
          await new Promise((resolve) => {
            window.__releaseSearch = resolve
          })
        }
        return original(n)
      }
      window.__restoreGetPage = () => {
        doc.getPage = original
      }
    })
    await showSearch(cancellation)
    await cancellation.waitForFunction(() => window.__searchDelayStarted)
    await closeSearch(cancellation)
    await cancellation.evaluate(() => {
      window.__releaseSearch()
      window.__restoreGetPage()
    })
    await pause(450)
    const result = await state(cancellation)
    assert.equal(result.query, '')
    assert.equal(result.total, 0)
    assert.equal(result.currentPage, 1)
  })
  await check('switching documents cancels a delayed old-document scan', async () => {
    await showSearch(cancellation)
    await cancellation.evaluate(() => {
      const doc = window.__pdfpro.useAppStore.getState().pdfDoc
      const original = doc.getPage.bind(doc)
      window.__searchDelayStarted = false
      doc.getPage = async (n) => {
        if (n === 6) {
          window.__searchDelayStarted = true
          await new Promise((resolve) => {
            window.__releaseSearch = resolve
          })
        }
        return original(n)
      }
    })
    // Re-enter the query to start a fresh delayed scan.
    await cancellation.$eval('.search-panel input', (input) => {
      input.focus()
      input.select()
    })
    await cancellation.keyboard.press('Backspace')
    await cancellation.type('.search-panel input', 'This is the last page')
    await cancellation.waitForFunction(() => window.__searchDelayStarted)
    await cancellation.evaluate(async () => {
      const { openDocument } = await import('/src/utils/docSession.ts')
      const bytes = new Uint8Array(await (await fetch('/samples/links.pdf')).arrayBuffer())
      await openDocument({ data: bytes, name: 'search-new-document.pdf' })
      window.__releaseSearch()
    })
    await cancellation.waitForFunction(
      () => window.__pdfpro.useAppStore.getState().fileName === 'search-new-document.pdf',
    )
    await pause(450)
    assert.equal((await state(cancellation)).total, 0)
  })
  await cancellation.close()

  const logic = await open()
  await check('duplicate page references count separately and blanks count zero', async () => {
    const result = await logic.evaluate(async () => {
      const { searchDocument } = await import('/src/pdf/search.ts')
      const doc = window.__pdfpro.useAppStore.getState().pdfDoc
      const { matches, pageMatchCounts } = await searchDocument(
        doc,
        'This is the last page',
        undefined,
        undefined,
        [6, -1, 6, 1],
      )
      return { pages: matches.map((m) => m.page), counts: [...pageMatchCounts] }
    })
    assert.deepEqual(result, {
      pages: [1, 3],
      counts: [
        [1, 1],
        [3, 1],
      ],
    })
  })
  await check('equal page numbers in different documents have isolated caches', async () => {
    const result = await logic.evaluate(async () => {
      const { getPageText, clearTextCache } = await import('/src/pdf/search.ts')
      clearTextCache()
      let release
      const oldPage = {
        getTextContent: () =>
          new Promise((resolve) => {
            release = () => resolve({ items: [{ str: 'old secret' }] })
          }),
      }
      const oldResult = getPageText(oldPage)
      clearTextCache()
      const newPage = { getTextContent: async () => ({ items: [{ str: 'new document' }] }) }
      const firstNew = await getPageText(newPage)
      release()
      await oldResult
      return { firstNew, secondNew: await getPageText(newPage) }
    })
    assert.equal(result.firstNew.text.trim(), 'new document')
    assert.equal(result.secondNew.text.trim(), 'new document')
  })
  await logic.close()
  assert.deepEqual(errors, [], 'unexpected page errors')
  console.log(`SEARCH SESSION TESTS PASS (${passed} tests)`)
} catch (error) {
  console.error('SEARCH SESSION TESTS FAILED', error)
  if (errors.length) console.error('Browser errors:', errors)
  process.exitCode = 1
} finally {
  // A failed page may be stuck on a browser event; never leave test-owned
  // Chrome processes alive or hide the actual assertion behind teardown.
  const killTimer = setTimeout(() => browser.process()?.kill('SIGKILL'), 5000)
  try {
    await browser.close()
  } finally {
    clearTimeout(killTimer)
  }
}
