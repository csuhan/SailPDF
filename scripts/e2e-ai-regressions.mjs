// Deterministic AI editing/lifecycle tests. No model or external AI connection.
// Start the existing dev server, then: node scripts/e2e-ai-regressions.mjs [origin]
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { PDFDocument, StandardFonts } from 'pdf-lib'
const origin = process.argv[2] || 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-gpu'],
  defaultViewport: { width: 1500, height: 940 },
})
const page = await browser.newPage()
page.setDefaultTimeout(15000)
// Vite appends ?t=... after a source update. Import the exact loaded URL so
// tests share the UI's stores instead of creating a second module instance.
await page.evaluateOnNewDocument(() => {
  window.__auditImport = (path) => {
    const loaded = performance.getEntriesByType('resource').find((entry) => new URL(entry.name).pathname === path)
    return import(loaded?.name || path)
  }
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const check = (name, condition) => {
  assert.ok(condition, name)
  console.log(`PASS ${name}`)
}
async function pdf(lines) {
  const doc = await PDFDocument.create()
  const p = doc.addPage([600, 800])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  lines.forEach((text, i) => p.drawText(text, { x: 50, y: 720 - i * 50, size: 18, font }))
  return Array.from(await doc.save())
}
async function open(bytes, name) {
  await page.evaluate(
    async (bytes, name) => {
      window.__pdfpro.useEditStore.getState().reset()
      const { openDocument } = await window.__auditImport('/src/utils/docSession.ts')
      await openDocument({ data: new Uint8Array(bytes), name })
    },
    bytes,
    name,
  )
  await page.waitForFunction(
    (name) => window.__pdfpro.useAppStore.getState().fileName === name && document.querySelector('.textLayer span'),
    {},
    name,
  )
}
async function pendingNote() {
  return page.evaluate(async () => {
    const { runTool } = await window.__auditImport('/src/ai/agentTools.ts')
    const { useAiStore } = await window.__auditImport('/src/ai/aiStore.ts')
    const plan = { steps: [] }
    await runTool('add_note', JSON.stringify({ page: 1, text: 'Only for this document revision' }), { plan })
    window.__auditPlan = plan
    useAiStore.getState().setTurns(() => [{ role: 'assistant', text: 'Note plan', plan, planState: 'pending' }])
    return plan.steps.length
  })
}
async function rejectsStalePlan() {
  return page.evaluate(async () => {
    const { applyPlan } = await window.__auditImport('/src/ai/agentTools.ts')
    try {
      await applyPlan(window.__auditPlan)
      return false
    } catch (error) {
      return /失效/.test(error.message)
    }
  })
}
try {
  await page.goto(origin, { waitUntil: 'networkidle2' })
  await page.evaluate(() =>
    localStorage.setItem(
      'pdfpro.ai',
      JSON.stringify({
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: '',
        model: 'controlled-test',
        language: 'zh',
      }),
    ),
  )
  await page.reload({ waitUntil: 'networkidle2' })
  const docA = await pdf(['Document A'])
  const docB = await pdf(['Document B'])
  await open(docA, 'A.pdf')
  await page.click('[aria-label="AI 助手"]')
  await page.waitForSelector('.ai-compose')
  check('create a bound pending note', (await pendingNote()) === 1)
  await page.waitForSelector('.plan-card.pending .btn.primary')
  await open(docB, 'B.pdf')
  check(
    'document switch clears old conversation and confirmation',
    await page.evaluate(async () => {
      const { useAiStore } = await window.__auditImport('/src/ai/aiStore.ts')
      return useAiStore.getState().turns.length === 0 && !document.querySelector('.plan-card.pending')
    }),
  )
  check('an old plan cannot mutate a different document', await rejectsStalePlan())
  check(
    'new document has no leaked note',
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().ops.length === 0),
  )

  // An update with the same operation ID must invalidate the old snapshot.
  await page.evaluate(() =>
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'note',
      id: 'existing-note',
      page: 1,
      x: 20,
      y: 20,
      text: 'Before',
      color: '#ff0000',
      author: 'Test',
      modified: '',
    }),
  )
  await pendingNote()
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().updateOp('existing-note', { text: 'After' }))
  await page.waitForSelector('.plan-card.stale')
  check('in-place edit invalidates preview and blocks application', await rejectsStalePlan())
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().reset())
  await pendingNote()
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().setFormDirty(true))
  check('form edits invalidate pending plans', await rejectsStalePlan())
  await pendingNote()
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().setFormDirty(true))
  check('further changes to an already-dirty form invalidate plans', await rejectsStalePlan())

  await open(await pdf(['foo foo']), 'single-line.pdf')
  const first = await page.evaluate(async () => {
    const { runTool } = await window.__auditImport('/src/ai/agentTools.ts')
    const plan = { steps: [] }
    await runTool('replace_text', JSON.stringify({ find: 'foo', replace: 'bar', all: false }), { plan })
    return plan.steps[0]?.after
  })
  check('first-only replacement preserves the second occurrence', first === 'bar foo')
  await open(await pdf(['foo', 'foo']), 'duplicate-lines.pdf')
  const duplicate = await page.evaluate(async () => {
    const { runTool, dedupePlan, applyPlan } = await window.__auditImport('/src/ai/agentTools.ts')
    const plan = { steps: [] }
    await runTool('replace_text', JSON.stringify({ find: 'foo', replace: 'bar', all: true }), { plan })
    dedupePlan(plan)
    const count = plan.steps.length
    await applyPlan(plan)
    const { currentOutputBytes } = await window.__auditImport('/src/utils/output.ts')
    const { pdfjs } = await window.__auditImport('/src/pdf/document.ts')
    const doc = await pdfjs.getDocument({ data: (await currentOutputBytes()).slice() }).promise
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((item) => item.str || '').join(' ')
    await doc.destroy()
    window.__pdfpro.useEditStore.getState().undo()
    return { count, text, remaining: window.__pdfpro.useEditStore.getState().ops.length }
  })
  check('identical text on distinct lines retains both edits', duplicate.count === 2)
  check(
    'both replacements survive PDF export',
    duplicate.text.match(/bar/g)?.length === 2 && !duplicate.text.includes('foo'),
  )
  check('confirmed batch remains one undo step', duplicate.remaining === 0)

  await open(docA, 'request-A.pdf')
  // Replace only the AI transport with a controllable stream inside this page.
  await page.evaluate(() => {
    const original = window.fetch
    window.__aiRequests = []
    window.fetch = async (input, init) => {
      if (!String(input).includes('/ai-proxy/')) return original(input, init)
      const request = { signal: init.signal, aborted: false }
      window.__aiRequests.push(request)
      return new Response(
        new ReadableStream({
          start(controller) {
            request.controller = controller
            init.signal.addEventListener(
              'abort',
              () => {
                request.aborted = true
                controller.error(new DOMException('Stopped', 'AbortError'))
              },
              { once: true },
            )
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }
  })
  const ask = async (number) => {
    await page.type('.ai-compose textarea', 'What does the document say?')
    await page.keyboard.press('Enter')
    await page.waitForFunction((number) => window.__aiRequests.length === number, {}, number)
  }
  await ask(1)
  await page.click('[aria-label="关闭 AI 助手"]')
  check(
    'closing the panel aborts its active transport',
    await page.evaluate(() => window.__aiRequests[0].signal.aborted),
  )
  await page.click('[aria-label="AI 助手"]')
  check(
    'reopening does not show a stuck busy state',
    await page.evaluate(async () => !(await window.__auditImport('/src/ai/aiStore.ts')).useAiStore.getState().busy),
  )
  await ask(2)
  await open(docB, 'request-B.pdf')
  check('switching documents aborts an active answer', await page.evaluate(() => window.__aiRequests[1].signal.aborted))
  check(
    'late failure cannot restore old-document messages',
    await page.evaluate(
      async () => (await window.__auditImport('/src/ai/aiStore.ts')).useAiStore.getState().turns.length === 0,
    ),
  )
  await ask(3)
  await page.evaluate(() => {
    const stream = window.__aiRequests[2].controller
    stream.enqueue(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Answer for document B"}}]}\n\ndata: [DONE]\n\n'),
    )
    stream.close()
  })
  await page.waitForFunction(async () => !(await window.__auditImport('/src/ai/aiStore.ts')).useAiStore.getState().busy)
  check(
    'a new request can complete after cancellation',
    await page.evaluate(
      async () =>
        (await window.__auditImport('/src/ai/aiStore.ts')).useAiStore.getState().turns.at(-1)?.text ===
        'Answer for document B',
    ),
  )
  check('no browser errors', errors.length === 0)
} catch (error) {
  console.error(
    'AI regression diagnostic:',
    await page
      .evaluate(async () => ({
        text: document.body.innerText.slice(-5000),
        turns: (await window.__auditImport('/src/ai/aiStore.ts')).useAiStore.getState().turns,
        epoch: window.__pdfpro?.useAppStore.getState().docEpoch,
        revision: window.__pdfpro?.useEditStore.getState().revision,
      }))
      .catch(() => ({})),
  )
  throw error
} finally {
  await browser.close()
}
