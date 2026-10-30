// Font fidelity after text editing: edited text must be written with the
// document's ORIGINAL embedded font (no substitute fonts added on save).
// Requires the dev server on 5174 (npx vite --port 5174).
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = 'http://127.0.0.1:5174'
const CASES = [
  // [file, line needle, from, to]
  ['/samples/georgia.pdf', 'Edit this line', '13pt', '14pt'],
  ['/samples/georgia.pdf', 'Italic caption', 'floral', 'calmer'],
  ['/samples/mixed-line.pdf', 'deadline moved', 'moved', 'postponed'],
  ['/samples/chinese.pdf', '本次更新', '若干', '多个'],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})
let failures = 0
for (const [file, needle, from, to] of CASES) {
  const page = await browser.newPage()
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setPermission', { permission: { name: 'local-fonts' }, setting: 'granted', origin: ORIGIN })
  await page.goto(`${ORIGIN}/?file=${file}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
  await new Promise((r) => setTimeout(r, 800))
  await page.evaluate(() => window.__pdfpro.useToolStore.getState().setTool('edit-text'))
  await new Promise((r) => setTimeout(r, 500))
  const pt = await page.evaluate((needle) => {
    const s = Array.from(document.querySelectorAll('.textLayer span')).find((x) => x.textContent?.includes(needle))
    const r = s.getBoundingClientRect()
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }
  }, needle)
  await page.mouse.click(pt.x, pt.y)
  await page.waitForSelector('.inline-text-editor')
  await new Promise((r) => setTimeout(r, 300))
  await page.evaluate(
    ([a, b]) => {
      const ed = document.querySelector('.inline-text-editor')
      ed.innerText = ed.innerText.replace(a, b)
    },
    [from, to],
  )
  await page.keyboard.down('Meta')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Meta')
  await new Promise((r) => setTimeout(r, 400))
  const res = await page.evaluate(
    async ([needleTo]) => {
      const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
      const op = useEditStore.getState().ops.at(-1)
      const fontsOf = async (doc) => {
        const p = await doc.getPage(1)
        // fonts reach commonObjs only once the page has been rendered
        const vp = p.getViewport({ scale: 1 })
        const c = document.createElement('canvas')
        c.width = vp.width
        c.height = vp.height
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
        const tc = await p.getTextContent()
        const names = new Set()
        for (const it of tc.items) names.add(p.commonObjs.get(it.fontName).name)
        return { names: [...names], text: tc.items.map((i) => i.str).join('') }
      }
      const before = await fontsOf(useAppStore.getState().pdfDoc)
      const bytes = await bakePdf(useAppStore.getState().fileBytes, useEditStore.getState().ops)
      useEditStore.getState().reset()
      await useAppStore.getState().openFile(bytes, 'baked.pdf')
      const after = await fontsOf(useAppStore.getState().pdfDoc)
      const pieces = (op?.runs ?? []).flatMap((r) => r.pieces ?? [{ text: r.text }])
      return {
        before: before.names,
        after: after.names,
        hasText: after.text.includes(needleTo),
        fallbackPieces: pieces.filter((p) => !p.hex && !p.glyphs?.length && p.text.trim()).map((p) => p.text),
      }
    },
    [to],
  )
  const added = res.after.filter((n) => !res.before.includes(n))
  const ok = res.hasText && added.length === 0 && res.fallbackPieces.length === 0
  if (!ok) failures++
  console.log(
    ok ? '✅' : '❌',
    `${file} "${from}"→"${to}"`,
    ok ? '' : JSON.stringify({ added, fallback: res.fallbackPieces, hasText: res.hasText }),
  )
  await page.close()
}
await browser.close()
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nFONT FIDELITY PASS')
