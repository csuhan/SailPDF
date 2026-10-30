// Generate crawlable pages ahead of deployment; Cloudflare serves docs/ without a build step.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { zh, toolData } from '../docs/site-content.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const docs = path.join(root, 'docs')
const SITE_URL = 'https://sailpdf.pages.dev/'
const REPO = 'https://github.com/csuhan/SailPDF'
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const check = process.argv.includes('--check')
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Supported option: --check')
if (pkg.homepage !== SITE_URL) throw new Error('Website origin must match package.json homepage.')
const pages = [
  {
    lang: 'en',
    route: '',
    title: 'Sail PDF — Open-source PDF Reader & Editor for Mac',
    description:
      'Sail PDF is an open-source PDF reader and editor for Apple Silicon Macs. Annotate, merge, split and OCR PDFs locally, with optional on-device AI.',
    imageAlt: 'Sail PDF workspace on Mac with PDF reading, editing and an optional AI assistant',
    ogLocale: 'en_US',
    alternateLocale: 'zh_CN',
  },
  {
    lang: 'zh-CN',
    route: 'zh-CN/',
    title: 'Sail PDF — Mac 开源 PDF 阅读器与编辑器，支持本地 AI',
    description:
      'Sail PDF 是适用于 Apple Silicon Mac 的开源 PDF 阅读器与编辑器。支持本地 PDF 阅读、批注、文字编辑、合并拆分、表单填写和 OCR 文字识别，可选本机 AI 文档助手，无需注册应用账号。',
    imageAlt: 'Sail PDF Mac 工作空间，支持 PDF 阅读、编辑与可选 AI 文档助手',
    ogLocale: 'zh_CN',
    alternateLocale: 'en_US',
  },
]
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const absolute = (route) => new URL(route, SITE_URL).href

function structuredData(page) {
  const url = absolute(page.route)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}#website`,
        url: SITE_URL,
        name: 'Sail PDF',
        inLanguage: pages.map((item) => item.lang),
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: page.lang,
        isPartOf: { '@id': `${SITE_URL}#website` },
        about: { '@id': `${url}#software` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${url}#software`,
        name: 'Sail PDF',
        url,
        description: page.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'macOS (Apple Silicon)',
        softwareVersion: `${pkg.version} Beta`,
        inLanguage: ['en', 'zh-CN'],
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        downloadUrl: `${REPO}/releases`,
        releaseNotes: `${REPO}/releases`,
        sameAs: REPO,
        image: absolute('images/logo.png'),
        screenshot: absolute('images/workspace.png'),
        featureList: toolData.map((tool) => tool[page.lang === 'en' ? 'en' : 'zh'][0]),
      },
    ],
  }
}

function head(page) {
  return `<!-- SEO:START -->
    <title>${escape(page.title)}</title>
    <meta name="description" content="${escape(page.description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${absolute(page.route)}" />
    ${pages.map((item) => `<link rel="alternate" hreflang="${item.lang}" href="${absolute(item.route)}" />`).join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${SITE_URL}" />
    <meta property="og:site_name" content="Sail PDF" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${absolute(page.route)}" />
    <meta property="og:title" content="${escape(page.title)}" />
    <meta property="og:description" content="${escape(page.description)}" />
    <meta property="og:locale" content="${page.ogLocale}" />
    <meta property="og:locale:alternate" content="${page.alternateLocale}" />
    <meta property="og:image" content="${absolute('images/social-card.png')}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escape(page.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(page.title)}" />
    <meta name="twitter:description" content="${escape(page.description)}" />
    <meta name="twitter:image" content="${absolute('images/social-card.png')}" />
    <meta name="twitter:image:alt" content="${escape(page.imageAlt)}" />
    <script type="application/ld+json">${JSON.stringify(structuredData(page)).replaceAll('<', '\\u003c')}</script>
    <!-- SEO:END -->`
}

function translate(html) {
  // Only marked, controlled template elements are translated. Keep arbitrary markup untouched.
  const value = (key) => {
    if (!Object.hasOwn(zh, key)) throw new Error(`Missing Chinese translation: ${key}`)
    return zh[key]
  }
  for (const attribute of ['data-i18n', 'data-i18n-html']) {
    const pattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\s${attribute}="([^"]+)"[^>]*>)[\\s\\S]*?(</\\2\\s*>)`, 'g')
    html = html.replace(
      pattern,
      (_, open, tag, key, close) => `${open}${attribute === 'data-i18n' ? escape(value(key)) : value(key)}${close}`,
    )
  }
  for (const [marker, attribute] of [
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
  ]) {
    html = html.replace(/<[a-z][^>]*>/g, (tag) => {
      const key = tag.match(new RegExp(`\\s${marker}="([^"]+)"`))?.[1]
      if (!key) return tag
      return tag.replace(new RegExp(`\\s${attribute}="[^"]*"`), ` ${attribute}="${escape(value(key))}"`)
    })
  }
  return html
}

function tools(page) {
  return `<!-- TOOLS:START -->\n${toolData
    .map((tool) => {
      const [name, description] = tool[page.lang === 'en' ? 'en' : 'zh']
      return `<button class="tool-card" data-tool="${tool.id}"><span class="tool-card-icon"><i data-icon="${tool.icon}"></i></span><span class="tool-card-arrow"><i data-icon="arrow-up-right"></i></span><h3>${escape(name)}</h3><p>${escape(description)}</p></button>`
    })
    .join('\n')}\n<!-- TOOLS:END -->`
}

async function output(relative, content, parser) {
  const file = path.join(docs, relative)
  if (parser)
    content = await format(content, { parser, semi: false, singleQuote: true, printWidth: 120, trailingComma: 'all' })
  let current
  try {
    current = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (current === content) return
  if (check) throw new Error(`${relative} is out of date. Run npm run build:website.`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  console.log(`Generated docs/${relative}`)
}

const source = await readFile(path.join(docs, 'index.html'), 'utf8')
for (const marker of ['SEO', 'TOOLS']) {
  if (!source.includes(`<!-- ${marker}:START -->`) || !source.includes(`<!-- ${marker}:END -->`))
    throw new Error(`Missing ${marker} generation markers in docs/index.html.`)
}
for (const page of pages) {
  let html = page.lang === 'en' ? source : translate(source)
  html = html.replace(/<html lang="[^"]+">/, `<html lang="${page.lang}">`)
  html = html.replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, () => head(page))
  html = html.replace(/<!-- TOOLS:START -->[\s\S]*?<!-- TOOLS:END -->/, () => tools(page))
  if (page.lang === 'zh-CN') {
    html = html.replace(
      /<a\b[^>]*\bdata-language\b[^>]*>[\s\S]*?<\/a\s*>/,
      '<a class="language-switch" data-language href="/" lang="en" hreflang="en" aria-label="Switch to English">EN <span class="lang-divider">/</span> <strong>中</strong></a>',
    )
    // Root assets are shared by both URLs; document section links remain relative.
    html = html.replace(/((?:href|src)=["'])(assets\/|styles\.css|site\.js)/g, '$1../$2')
  }
  await output(`${page.route}index.html`, html, 'html')
}
await output('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${absolute('sitemap.xml')}\n`)
await output(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pages.map((page) => `  <url>\n    <loc>${absolute(page.route)}</loc>\n${[...pages.map((item) => [item.lang, absolute(item.route)]), ['x-default', SITE_URL]].map(([lang, url]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}" />`).join('\n')}\n  </url>`).join('\n')}\n</urlset>\n`,
)
console.log(check ? 'Website generated files are up to date.' : 'Website ready in docs/.')
