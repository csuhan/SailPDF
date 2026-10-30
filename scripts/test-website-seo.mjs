import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { toolData } from '../docs/site-content.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const website = path.join(root, 'docs')
const production = 'https://sailpdf.pages.dev'
const languages = [
  { lang: 'en', route: '/', other: '/zh-CN/', toolLanguage: 'en' },
  { lang: 'zh-CN', route: '/zh-CN/', other: '/', toolLanguage: 'zh' },
]
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
}

// Cloudflare serves the committed docs directory without a build step.
execFileSync(process.execPath, ['scripts/build-website.mjs', '--check'], { cwd: root, stdio: 'inherit' })
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(website, `.${pathname}`)
    if (file !== website && !file.startsWith(website + path.sep)) throw Error('Invalid path')
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const runtimeErrors = []

async function markedContent(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-aria], [data-i18n-placeholder]')].map(
      (el) => ({
        key: el.dataset.i18n || el.dataset.i18nHtml || el.dataset.i18nAria || el.dataset.i18nPlaceholder,
        text:
          el.hasAttribute('data-i18n') || el.hasAttribute('data-i18n-html')
            ? el.textContent.replace(/\s/g, '')
            : undefined,
        aria: el.hasAttribute('data-i18n-aria') ? el.getAttribute('aria-label') : undefined,
        placeholder: el.hasAttribute('data-i18n-placeholder') ? el.getAttribute('placeholder') : undefined,
      }),
    ),
  )
}

async function checkLayout(page, lang, capture = false) {
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 1000 })
    const sizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }))
    assert.ok(sizes.document <= sizes.viewport + 1, `${lang}: overflow at ${width}px`)
    if (capture && process.env.SEO_SCREENSHOTS === '1') {
      const screenshots = path.join(root, '.scratch')
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: path.join(screenshots, `seo-${lang}-${width}.png`) })
    }
  }
}

async function metadata(page) {
  return page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.content || ''
    return {
      lang: document.documentElement.lang,
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      alternates: Object.fromEntries(
        [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((el) => [el.hreflang, el.href]),
      ),
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      ogURL: meta('meta[property="og:url"]'),
      ogImage: meta('meta[property="og:image"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      twitterImage: meta('meta[name="twitter:image"]'),
    }
  })
}

try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    defaultViewport: { width: 1440, height: 1000 },
  })
  const snapshots = new Map()
  const translations = new Map()
  for (const language of languages) {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    const response = await page.goto(origin + language.route, { waitUntil: 'networkidle0' })
    assert.equal(response.status(), 200, `${language.route}: page must be served`)
    const info = await metadata(page)
    snapshots.set(language.lang, info)
    translations.set(language.lang, await markedContent(page))
    assert.equal(info.lang, language.lang)
    assert.match(info.title, /Sail PDF/)
    assert.match(info.title, /PDF.*(?:Reader|阅读|编辑)/)
    assert.ok(info.description.length > 60, `${language.lang}: useful description`)
    assert.equal(info.canonical, production + language.route)
    assert.deepEqual(info.alternates, {
      en: production + '/',
      'zh-CN': production + '/zh-CN/',
      'x-default': production + '/',
    })
    assert.equal(info.ogTitle, info.title)
    assert.ok(info.ogDescription)
    assert.equal(info.ogURL, info.canonical)
    assert.equal(info.twitterCard, 'summary_large_image')
    assert.equal(info.twitterImage, info.ogImage)
    assert.ok(info.ogImage.startsWith(production + '/'))
    const imageResponse = await fetch(origin + new URL(info.ogImage).pathname)
    assert.equal(imageResponse.status, 200, 'Social preview image must exist')
    assert.match(imageResponse.headers.get('content-type'), /^image\//)
    const content = await page.evaluate(() => ({
      headings: [...document.querySelectorAll('h1')].map((el) => el.textContent),
      languageHref: document.querySelector('a[data-language]')?.getAttribute('href'),
      cards: [...document.querySelectorAll('.tool-grid .tool-card')].map((el) => ({
        id: el.dataset.tool,
        title: el.querySelector('h3')?.textContent,
        description: el.querySelector('p')?.textContent,
      })),
      releases: [...document.querySelectorAll('a[href]')].some(
        (el) => el.href === 'https://github.com/csuhan/SailPDF/releases',
      ),
      schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((el) => {
        const data = JSON.parse(el.textContent)
        return data['@graph'] || (Array.isArray(data) ? data : [data])
      }),
    }))
    assert.equal(content.headings.length, 1)
    assert.match(content.headings[0], /Sail PDF/)
    assert.match(content.headings[0], /PDF.*(?:[Rr]eader|阅读|编辑)/)
    assert.equal(content.languageHref, language.other)
    assert.equal(content.releases, true)
    assert.deepEqual(
      content.cards,
      toolData.map((tool) => ({
        id: tool.id,
        title: tool[language.toolLanguage][0],
        description: tool[language.toolLanguage][1],
      })),
      `${language.lang}: complete localized tools without JavaScript`,
    )
    for (const type of ['WebSite', 'SoftwareApplication']) {
      assert.ok(
        content.schemas.some((node) => node['@type'] === type),
        `${language.lang}: ${type} JSON-LD`,
      )
    }
    const software = content.schemas.find((node) => node['@type'] === 'SoftwareApplication')
    assert.match(software.name, /Sail PDF/)
    assert.match(software.operatingSystem, /macOS/)
    assert.equal(software.aggregateRating, undefined, 'No invented ratings')
    await checkLayout(page, language.lang)
    await page.close()
    console.log(
      `PASS ${language.lang}: crawlable metadata, language links, structured data, tools and responsive layout`,
    )
  }

  const robots = await (await fetch(origin + '/robots.txt')).text()
  assert.match(robots, /User-agent:\s*\*/i)
  assert.match(robots, /Sitemap:\s*https:\/\/sailpdf\.pages\.dev\/sitemap\.xml/i)
  assert.ok(!/Disallow:\s*\/\s*$/im.test(robots), 'Robots must allow the website')
  const sitemap = await (await fetch(origin + '/sitemap.xml')).text()
  const parserPage = await browser.newPage()
  const sitemapURLs = await parserPage.evaluate((xml) => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    if (parsed.querySelector('parsererror')) throw Error('Invalid sitemap XML')
    return [...parsed.querySelectorAll('url > loc')].map((el) => el.textContent)
  }, sitemap)
  assert.deepEqual(sitemapURLs.sort(), languages.map((language) => production + language.route).sort())
  await parserPage.goto(origin + '/404.html', { waitUntil: 'networkidle0' })
  assert.match(await parserPage.$eval('meta[name="robots"]', (el) => el.content), /\bnoindex\b/)
  assert.deepEqual(await parserPage.$$eval('main a[href]', (els) => els.map((el) => el.getAttribute('href'))), [
    '/',
    '/zh-CN/',
  ])
  await parserPage.close()
  console.log('PASS robots.txt, sitemap and a noindex 404 fallback with links to both languages')

  for (const language of languages) {
    const page = await browser.newPage()
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sail.site.language', location.pathname === '/' ? 'zh-CN' : 'en')
      localStorage.setItem('lumen.site.language', location.pathname === '/' ? 'zh-CN' : 'en')
    })
    await page.goto(origin + language.route, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.tool-categories [data-category="all"]')
    assert.deepEqual(
      await metadata(page),
      snapshots.get(language.lang),
      'Runtime must preserve static SEO and URL language',
    )
    assert.deepEqual(
      await markedContent(page),
      translations.get(language.lang),
      'Hydration must preserve translated content',
    )
    await checkLayout(page, language.lang, true)
    assert.equal(await page.$$eval('.tool-grid .tool-card', (els) => els.length), toolData.length)
    await page.locator('[data-category="editing"]').click()
    assert.equal(
      await page.$$eval('.tool-grid .tool-card', (els) => els.length),
      toolData.filter((tool) => tool.category === 'editing').length,
    )
    await page.locator('[data-category="all"]').click()
    await page.locator('.tool-search input').fill('OCR')
    assert.equal(await page.$$eval('.tool-grid .tool-card', (els) => els.length), 1)
    await page.locator('.tool-card[data-tool="ocr"]').click()
    await page.waitForSelector('#tool-dialog[open]')
    assert.equal(
      await page.$eval('#tool-dialog-title', (el) => el.textContent),
      toolData.find((tool) => tool.id === 'ocr')[language.toolLanguage][0],
    )
    await page.locator('#tool-dialog [data-close-dialog]').click()
    await page.locator('.workspace-tabs [data-demo="pages"]').click()
    assert.equal(await page.$eval('.page-organizer', (el) => el.hidden), false)
    await page.locator('.hero-actions [data-download]').click()
    await page.waitForSelector('#download-dialog[open]')
    await page.locator('#download-dialog [data-close-dialog]').click()
    const privacy = await readFile(
      path.join(website, 'assets', language.lang === 'en' ? 'privacy.en.txt' : 'privacy.txt'),
      'utf8',
    )
    await page.locator('[data-legal="privacy"]').click()
    await page.waitForSelector('#legal-dialog[open]')
    await page.waitForFunction(
      (expected) => document.querySelector('#legal-dialog pre').textContent === expected,
      {},
      privacy,
    )
    await page.locator('#legal-dialog [data-close-dialog]').click()
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.locator('a[data-language]').click()])
    assert.equal(new URL(page.url()).pathname, language.other)
    assert.equal(await page.$eval('html', (el) => el.lang), language.lang === 'en' ? 'zh-CN' : 'en')
    await page.close()
    console.log(
      `PASS ${language.lang}: URL language, native language navigation, tool search/dialogs, privacy notice and product preview`,
    )
  }
  assert.deepEqual(runtimeErrors, [], 'Website must not have runtime errors')
  console.log('Website SEO verification passed.')
} finally {
  if (browser) await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
