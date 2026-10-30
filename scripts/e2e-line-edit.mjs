// End-to-end line editing through the real UI (click → type → commit → bake
// → reopen), asserting on the EXACT glyphs of the baked page (text, color,
// font, position) — not on screenshots.
// Needs the dev server on 5174 and public/samples/links.pdf
// (node scripts/make-links.mjs).
import puppeteer from 'puppeteer-core'

const ORIGIN = 'http://127.0.0.1:5174'
const FILE = process.env.LINE_EDIT_FILE ?? '/samples/links.pdf'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})

let failures = 0
const results = []
function check(name, cond, detail = '') {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}

async function openDoc() {
  const page = await browser.newPage()
  // the desktop app grants local-font access (system fallback for glyphs
  // missing from embedded subsets); mirror that here
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setPermission', { permission: { name: 'local-fonts' }, setting: 'granted', origin: ORIGIN })
  page.on('pageerror', (e) => {
    failures++
    results.push(`❌ page error: ${e.message}`)
  })
  await page.goto(`${ORIGIN}/?file=${FILE}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro)
  await new Promise((r) => setTimeout(r, 700))
  await page.evaluate(() => window.__pdfpro.useToolStore.getState().setTool('edit-text'))
  await new Promise((r) => setTimeout(r, 500))
  return page
}

/** client point of a text-layer span (frac along its width) */
async function spanPoint(page, needle, frac = 0.5) {
  return page.evaluate(
    ([needle, frac]) => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'))
      const s = spans.find((x) => x.textContent === needle) ?? spans.find((x) => x.textContent?.includes(needle))
      if (!s) return null
      const r = s.getBoundingClientRect()
      return { x: r.left + r.width * frac, y: r.top + r.height / 2 }
    },
    [needle, frac],
  )
}

async function openEditorAt(page, pt) {
  await page.mouse.click(pt.x, pt.y)
  await page.waitForSelector('.inline-text-editor', { timeout: 3000 }).catch(() => null)
  await new Promise((r) => setTimeout(r, 200))
  return page.evaluate(() => document.querySelector('.inline-text-editor')?.textContent ?? null)
}

/** real keyboard editing: place caret after `after`, then type `insert` */
async function typeAfter(page, after, insert, deleteCount = 0) {
  await page.evaluate((after) => {
    const ed = document.querySelector('.inline-text-editor')
    // the editor holds styled spans: map a plain-text offset to a text node
    let idx = ed.textContent.indexOf(after) + after.length
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && idx > node.data.length) {
      idx -= node.data.length
      node = walker.nextNode()
    }
    const r = document.createRange()
    r.setStart(node, idx)
    r.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
  }, after)
  for (let i = 0; i < deleteCount; i++) await page.keyboard.press('Delete')
  if (insert) await page.keyboard.type(insert, { delay: 5 })
}

async function commit(page) {
  await page.keyboard.down('Meta')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Meta')
  await new Promise((r) => setTimeout(r, 400))
}

/** pdf point → client point on page 1 */
async function clientOfPdf(page, x, y) {
  return page.evaluate(
    ([x, y]) => {
      const il = document.querySelector('.page-box[data-page="1"] .interaction-layer')
      const r = il.getBoundingClientRect()
      const s = window.__pdfpro.useAppStore.getState().scale
      const h = r.height / s
      return { x: r.left + x * s, y: r.top + (h - y) * s }
    },
    [x, y],
  )
}

async function bakeAndReopen(page) {
  await page.evaluate(async () => {
    const { useAppStore, useEditStore, bakePdf } = window.__pdfpro
    const bytes = await bakePdf(useAppStore.getState().fileBytes, useEditStore.getState().ops)
    useEditStore.getState().reset()
    await useAppStore.getState().openFile(bytes, 'baked.pdf')
  })
  await page.waitForFunction(() => document.querySelector('.textLayer span'))
  await new Promise((r) => setTimeout(r, 600))
}

/** visible glyph runs of the line containing `needle` (spaces removed) */
async function lineRuns(page, needle) {
  return page.evaluate(async (needle) => {
    const { getGlyphModel } = await import('/src/pdf/edit/glyphModel.ts')
    const p = await window.__pdfpro.useAppStore.getState().pdfDoc.getPage(1)
    const m = await getGlyphModel(p)
    const lines = new Map()
    for (const g of m.glyphs) {
      if (g.invisible || g.isSpace) continue
      const k = Math.round(g.y * 2) / 2
      if (!lines.has(k)) lines.set(k, [])
      lines.get(k).push(g)
    }
    for (const [y, gs] of lines) {
      gs.sort((a, b) => a.x - b.x)
      const text = gs.map((g) => g.text).join('')
      if (!text.includes(needle.replace(/\s/g, ''))) continue
      const runs = []
      // subset tags/ids differ between the embedded subset and the system
      // fallback of the same family; compare by family + weight
      const fam = (n) =>
        (n ?? '?')
          .replace(/^[A-Z]{6}\+/, '')
          .replace(/-\d+$/, '')
          .replace(/MT$|PS$/, '')
      for (const g of gs) {
        const font = fam(m.fonts.get(g.font)?.name)
        const last = runs[runs.length - 1]
        if (last && last.color === g.color && last.font === font) last.text += g.text
        else runs.push({ text: g.text, color: g.color, font, x: g.x })
      }
      // overlaps: a glyph starting inside the previous one's advance
      let overlaps = 0
      for (let i = 1; i < gs.length; i++) if (gs[i].x < gs[i - 1].x + gs[i - 1].w * 0.7) overlaps++
      return { y, text, runs, overlaps, fonts: [...new Set(gs.map((g) => fam(m.fonts.get(g.font)?.name)))] }
    }
    return null
  }, needle)
}

const BLUE = '#0d54cc'
const isBlue = (c) => c && parseInt(c.slice(5, 7), 16) > 150 && parseInt(c.slice(1, 3), 16) < 60
const isDark = (c) => c && ['#1a1a1a', '#191919', '#000000'].includes(c)

// ── scenario 1: append text to a link, then edit the NEW text again ──
{
  const page = await openDoc()
  const t = await openEditorAt(page, await spanPoint(page, 'Vision Group'))
  check('1a click on link text opens the line', t === 'Lab: Vision Group', JSON.stringify(t))
  await typeAfter(page, 'Vision Group', ' Alpha')
  await commit(page)
  // click on the newly typed word (no text-layer span exists for it)
  const op = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.at(-1))
  const run = op.runs.find((r) => r.text.includes('Alpha'))
  const p = await clientOfPdf(page, run.pieces.at(-1).x + 6, op.baselineY + 4)
  const t2 = await openEditorAt(page, p)
  check('1b clicking newly added text re-opens the edited line', t2 === 'Lab: Vision Group Alpha', JSON.stringify(t2))
  if (t2) {
    await typeAfter(page, 'Alpha', '', 0)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('Beta!', { delay: 5 })
    await commit(page)
  }
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Lab:')
  check('1c baked text', L?.text === 'Lab:VisionGroupAlphBeta!', L?.text)
  const linkRun = L?.runs.find((r) => r.text.includes('Vision'))
  check(
    '1d link color kept for appended text',
    linkRun && isBlue(linkRun.color) && linkRun.text === 'VisionGroupAlphBeta!',
    JSON.stringify(L?.runs),
  )
  check(
    '1e "Lab:" keeps bold + dark color',
    L?.runs[0].text === 'Lab:' && isDark(L.runs[0].color) && /Bold/.test(L.runs[0].font),
    JSON.stringify(L?.runs[0]),
  )
  check(
    '1f no substitute fonts',
    L?.fonts.every((f) => /Georgia/.test(f)),
    JSON.stringify(L?.fonts),
  )
  check('1g no overlapping glyphs', L?.overlaps === 0, String(L?.overlaps))
  await page.close()
}

// ── scenario 2: edit PLAIN text on a line that also has a link ──
{
  const page = await openDoc()
  const t = await openEditorAt(page, await spanPoint(page, 'for help.', 0.6))
  check('2a plain text next to a link opens the line', t === 'Contact support@example.com for help.', JSON.stringify(t))
  await typeAfter(page, 'for ', 'quick ')
  await commit(page)
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Contact')
  check('2b baked text', L?.text === 'Contactsupport@example.comforquickhelp.', L?.text)
  const colors = L?.runs.map((r) => `${r.text}:${isBlue(r.color) ? 'blue' : isDark(r.color) ? 'dark' : r.color}`)
  check(
    '2c only the link is blue; plain text stays dark',
    JSON.stringify(colors) === JSON.stringify(['Contact:dark', 'support@example.com:blue', 'forquickhelp.:dark']),
    JSON.stringify(colors),
  )
  check('2d no overlapping glyphs', L?.overlaps === 0, String(L?.overlaps))
  await page.close()
}

// ── scenario 3: edit text BEFORE a link; the link shifts but keeps color ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'Homepage', 0.3))
  await typeAfter(page, 'Homepage', ' URL')
  await commit(page)
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Homepage')
  check('3a baked text', L?.text === 'HomepageURL:example.comanddocs', L?.text)
  const colors = L?.runs.map((r) => `${r.text}:${isBlue(r.color) ? 'blue' : isDark(r.color) ? 'dark' : r.color}`)
  check(
    '3b styles follow their characters',
    JSON.stringify(colors) === JSON.stringify(['HomepageURL::dark', 'example.com:blue', 'anddocs:dark']),
    JSON.stringify(colors),
  )
  check('3c bold kept for the edited bold word', /Bold/.test(L?.runs[0].font ?? ''), JSON.stringify(L?.runs[0]))
  check('3d no overlapping glyphs', L?.overlaps === 0, String(L?.overlaps))
  await page.close()
}

// ── scenario 4: replace text INSIDE a link ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'example.com', 0.3))
  await typeAfter(page, 'Homepage: ', 'www.', 0)
  await commit(page)
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Homepage')
  const link = L?.runs.find((r) => r.text.includes('example'))
  check(
    '4a typed chars inside the link take the link color',
    link?.text === 'www.example.com' && isBlue(link.color),
    JSON.stringify(L?.runs),
  )
  await page.close()
}

// ── scenario 5: a third color (green) in the middle survives an edit at the end ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'by the board.', 0.5))
  await typeAfter(page, 'board', ' today')
  await commit(page)
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Status')
  const colors = L?.runs.map((r) => r.text)
  const green = L?.runs.find((r) => r.text === 'approved')
  check(
    '5a green word keeps its color',
    !!green && green.color !== null && parseInt(green.color.slice(3, 5), 16) > 120,
    JSON.stringify(L?.runs),
  )
  check('5b text', L?.text === 'Status:approvedbytheboardtoday.', JSON.stringify(colors))
  await page.close()
}

// ── scenario 6: lengthening text before a right-aligned date never overlaps it ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'Senior Engineer', 0.3))
  await typeAfter(page, 'Example Corp', ' International Holdings')
  await commit(page)
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Senior')
  check('6a date kept', L?.text.endsWith('Mar2024-Present'), L?.text)
  check('6b no overlap with the right-aligned date', L?.overlaps === 0, String(L?.overlaps))
  await page.close()
}

// ── scenario 7: unchanged commit adds no op; undo restores the previous state ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'Plain line', 0.3))
  await commit(page)
  const n0 = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length)
  check('7a unchanged commit creates no edit', n0 === 0, String(n0))
  await openEditorAt(page, await spanPoint(page, 'Plain line', 0.3))
  await typeAfter(page, 'lazy', 'ish')
  await commit(page)
  await openEditorAt(page, await spanPoint(page, 'Plain line', 0.3))
  const reopened = await page.evaluate(() => document.querySelector('.inline-text-editor')?.textContent)
  check('7b re-open shows the edited text', reopened?.includes('lazyish'), JSON.stringify(reopened))
  await typeAfter(page, 'lazyish', '', 0)
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await commit(page)
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
  await bakeAndReopen(page)
  const L = await lineRuns(page, 'Plain')
  check('7c undo of the second edit restores the first', L?.text.includes('lazyishdog'), L?.text)
  await page.close()
}

// ── scenario 8: zoomed and rotated views map clicks/edits correctly ──
for (const [scale, rot] of [
  [2.2, 0],
  [0.7, 0],
  [1.3, 90],
  [1, 180],
  [1, 270],
]) {
  const page = await openDoc()
  await page.evaluate(
    ([s, r]) => {
      const a = window.__pdfpro.useAppStore.getState()
      a.setScale(s)
      if (r) a.rotateView(r)
    },
    [scale, rot],
  )
  await new Promise((r) => setTimeout(r, 1000))
  const pt = await spanPoint(page, 'support@example.com')
  const t = await openEditorAt(page, pt)
  check(`8a scale ${scale} rot ${rot}: line opens`, t === 'Contact support@example.com for help.', JSON.stringify(t))
  if (t) {
    await typeAfter(page, 'for ', 'more ')
    await commit(page)
    const t2 = await openEditorAt(page, pt)
    check(
      `8b scale ${scale} rot ${rot}: re-open shows edit`,
      t2 === 'Contact support@example.com for more help.',
      JSON.stringify(t2),
    )
    await page.keyboard.press('Escape')
    await bakeAndReopen(page)
    const L = await lineRuns(page, 'Contact')
    const colors = L?.runs.map((r) => `${r.text}:${isBlue(r.color) ? 'blue' : isDark(r.color) ? 'dark' : r.color}`)
    check(
      `8c scale ${scale} rot ${rot}: baked`,
      JSON.stringify(colors) === JSON.stringify(['Contact:dark', 'support@example.com:blue', 'formorehelp.:dark']),
      JSON.stringify(colors),
    )
  }
  await page.close()
}

// ── scenario 9: Escape discards; undo/redo across re-edits ──
{
  const page = await openDoc()
  await openEditorAt(page, await spanPoint(page, 'Vision Group'))
  await typeAfter(page, 'Group', ' X')
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))
  const n = await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length)
  check('9a Escape discards the edit', n === 0, String(n))
  await openEditorAt(page, await spanPoint(page, 'Vision Group'))
  await typeAfter(page, 'Group', ' One')
  await commit(page)
  await openEditorAt(page, await spanPoint(page, 'Lab:'))
  await typeAfter(page, 'One', ' Two')
  await commit(page)
  await page.evaluate(() => {
    const s = window.__pdfpro.useEditStore.getState()
    s.undo()
    s.undo()
    s.redo()
  })
  const t = await openEditorAt(page, await spanPoint(page, 'Lab:'))
  check('9b undo/undo/redo lands on the first edit', t === 'Lab: Vision Group One', JSON.stringify(t))
  await page.keyboard.press('Escape')
  await page.close()
}

// ── scenario 10: opening a line does not move the text (no "jump") ──
for (const [needle, reopen] of [
  ['Plain line', false],
  ['Contact', false],
  ['Senior Engineer', false],
  ['Contact', true],
]) {
  const page = await openDoc()
  if (reopen) {
    await openEditorAt(page, await spanPoint(page, needle, 0.3))
    await typeAfter(page, 'for ', 'more ')
    await commit(page)
  }
  await openEditorAt(page, await spanPoint(page, needle, 0.3))
  const drift = await page.evaluate(async () => {
    const { getPageRuntime } = await import('/src/pdf/registry.ts')
    const { getGlyphModel } = await import('/src/pdf/edit/glyphModel.ts')
    const { findLine } = await import('/src/pdf/edit/lineModel.ts')
    const rt = getPageRuntime(1)
    const ed = document.querySelector('.inline-text-editor')
    const il = document.querySelector('.page-box[data-page="1"] .interaction-layer').getBoundingClientRect()
    const edXs = []
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      for (let i = 0; i < n.data.length; i++) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        edXs.push({ ch: n.data[i], x: rt.viewport.convertToPdfPoint(r.getBoundingClientRect().left - il.left, 0)[0] })
      }
    }
    // expected positions: the original glyphs, or the planned redraw when re-editing
    const m = await getGlyphModel(rt.page)
    const er = ed.getBoundingClientRect()
    const [px, py] = rt.viewport.convertToPdfPoint(er.left - il.left + 8, er.top - il.top + er.height / 2)
    const L = findLine(m, px, py)
    const op = window.__pdfpro.useEditStore.getState().ops.at(-1)
    let expected = L.chars.map((c) => ({ ch: c.ch, x: c.x }))
    if (op) {
      expected = []
      for (const c of L.chars) if (c.x < op.rect.x) expected.push({ ch: c.ch, x: c.x })
      for (const r of op.runs)
        for (const p of r.pieces ?? []) {
          if (p.glyphs)
            Array.from(p.text).forEach((ch, i) => p.glyphs[i] && expected.push({ ch, x: p.x + p.glyphs[i].dx }))
        }
    }
    // compare every expected visible char with the editor char of the same text order
    const vis = edXs.filter((e) => e.ch.trim())
    const exp = expected.filter((e) => e.ch.trim())
    let max = 0
    for (let i = 0; i < Math.min(vis.length, exp.length); i++) max = Math.max(max, Math.abs(vis[i].x - exp[i].x))
    return { max, n: Math.min(vis.length, exp.length), same: vis.length === exp.length }
  })
  check(
    `10 ${reopen ? 're-opened ' : ''}"${needle}": editor glyphs stay where the page drew them`,
    drift.same && drift.max < 0.5,
    JSON.stringify(drift),
  )
  await page.keyboard.press('Escape')
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nLINE EDIT TESTS PASS')
