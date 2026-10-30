// Password protection (Acrobat "保护"): opening encrypted PDFs (RC4 / AES-256,
// user + owner password), permission restrictions, keeping the protection on
// save, adding / removing protection. Needs the dev server on 5174 and the
// encrypted samples in public/samples (see .scratch generation in README).
import puppeteer from 'puppeteer-core'

const ORIGIN = 'http://127.0.0.1:5174'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})
let failures = 0
const results = []
const check = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function page0(file) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => check(`no page error (${e.message})`, false))
  await page.goto(`${ORIGIN}/${file ? `?file=${file}` : ''}`, { waitUntil: 'networkidle2' })
  return page
}
const typePw = async (page, pw) => {
  await page.waitForSelector('.pw-modal input', { timeout: 8000 })
  await page.type('.pw-modal input', pw)
  await page.click('.pw-modal .btn.primary')
}
const loaded = (page) =>
  page.waitForFunction(() => document.querySelector('.textLayer span') && window.__pdfpro, { timeout: 15000 })
// bytes the app would write to disk, read back with pdf.js
const savedInfo = (page, pw) =>
  page.evaluate(async (pw) => {
    const { savedFileBytes } = await import('/src/utils/output.ts')
    const { pdfjs } = await import('/src/pdf/document.ts')
    const { inspectEncryption } = await import('/src/pdf/security/standardSecurity.ts')
    const bytes = await savedFileBytes()
    const info = await inspectEncryption(bytes.slice())
    let text = null
    let needs = false
    try {
      const d = await pdfjs.getDocument({ data: bytes.slice(), password: pw ?? undefined }).promise
      const tc = await (await d.getPage(1)).getTextContent()
      text = tc.items.map((i) => i.str).join('')
    } catch (e) {
      needs = e.name === 'PasswordException'
    }
    let noPw = true
    try {
      await pdfjs.getDocument({ data: bytes.slice() }).promise
    } catch {
      noPw = false
    }
    return { info, text, needs, opensWithoutPassword: noPw }
  }, pw)

// 1. AES-256 file: wrong password, then right one
{
  const page = await page0('/samples/enc-aes256.pdf')
  await typePw(page, 'nope')
  await page.waitForSelector('.pw-error', { timeout: 8000 })
  check('wrong password shows an error and asks again', !!(await page.$('.pw-modal')))
  await page.$eval('.pw-modal input', (i) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await typePw(page, '123')
  await loaded(page)
  const st = await page.evaluate(() => {
    const a = window.__pdfpro.useAppStore.getState()
    return {
      n: a.numPages,
      enc: !!a.encryption,
      owner: a.encryption?.owner,
      method: a.encryption?.info.method,
      lock: !!document.querySelector('.doc-lock'),
    }
  })
  check(
    'AES-256 opens with the open password',
    st.n === 2 && st.enc && st.owner === false && st.method === 'AES 256 位',
    JSON.stringify(st),
  )
  check('lock badge shown in header', st.lock)
  // restricted (print only) -> edit mode disabled, print allowed
  const modes = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-tab')].map((b) => [b.textContent.trim(), b.disabled]),
  )
  const dis = Object.fromEntries(modes)
  check(
    'restricted: edit / annotate / pages disabled',
    dis['编辑'] && dis['批注'] && dis['页面'] && !dis['阅读'],
    JSON.stringify(modes),
  )
  await page.evaluate(() => window.__pdfpro.useToolStore.getState().setMode('edit'))
  check(
    'mode guard blocks entering edit mode',
    (await page.evaluate(() => window.__pdfpro.useToolStore.getState().mode)) === 'read',
  )
  // unlock with the permissions password in the protect dialog
  await page.evaluate(() =>
    [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('工具')).click(),
  )
  await sleep(200)
  await page.click('[data-tool-id="protect"] .tool-card')
  await page.waitForSelector('.protect-modal')
  await page.type('.protect-modal input[type=password]', 'wrong')
  await page.evaluate(() =>
    [...document.querySelectorAll('.protect-modal .btn')].find((b) => b.textContent.includes('解除限制')).click(),
  )
  await page.waitForSelector('.protect-modal .pw-error')
  check('wrong permissions password rejected', true)
  await page.$eval('.protect-modal input[type=password]', (i) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type('.protect-modal input[type=password]', 'own')
  await page.evaluate(() =>
    [...document.querySelectorAll('.protect-modal .btn')].find((b) => b.textContent.includes('解除限制')).click(),
  )
  await page.waitForFunction(() => window.__pdfpro.useAppStore.getState().encryption?.owner === true, { timeout: 8000 })
  check(
    'permissions password lifts the restrictions',
    !(await page.evaluate(
      () => [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('编辑')).disabled,
    )),
  )
  await page.waitForFunction(
    () =>
      document.querySelector('.protect-modal input[aria-label="打开密码"]')?.value === '123' &&
      document.querySelector('.protect-modal input[aria-label="权限密码"]')?.value === 'own',
    { timeout: 8000 },
  )
  check(
    'unlocked dialog prefills both passwords',
    await page.evaluate(
      () =>
        document.querySelector('.protect-modal input[aria-label="打开密码"]')?.value === '123' &&
        document.querySelector('.protect-modal input[aria-label="权限密码"]')?.value === 'own',
    ),
  )
  await page.keyboard.press('Escape')
  // an edit, then the saved file keeps the original protection
  await page.evaluate(async () => {
    const { newOpId } = await import('/src/pdf/edit/ops.ts')
    window.__pdfpro.useEditStore.getState().pushOp({
      kind: 'overlay-text',
      id: newOpId(),
      page: 1,
      x: 72,
      y: 72,
      text: 'ADDED-AFTER-UNLOCK',
      fontSize: 12,
      fontName: 'Helvetica',
      color: '#111111',
    })
  })
  const out = await savedInfo(page, '123')
  check(
    'saved file still needs the open password',
    out.info?.needsPassword && !out.opensWithoutPassword,
    JSON.stringify(out.info),
  )
  check(
    'saved file keeps the restrictions',
    out.info?.restricted && out.info.permissions.print && !out.info.permissions.modify,
    JSON.stringify(out.info?.permissions),
  )
  check('saved file contains the edit', out.text?.includes('ADDED-AFTER-UNLOCK'), out.text?.slice(0, 80))
  const own = await page.evaluate(async () => {
    const { savedFileBytes } = await import('/src/utils/output.ts')
    const { decryptPdf } = await import('/src/pdf/security/standardSecurity.ts')
    const r = await decryptPdf((await savedFileBytes()).slice(), 'own')
    return r.owner
  })
  check('saved file keeps the permissions password', own)
  await page.close()
}

// 2. RC4 file, opened with the OWNER password (full access)
{
  const page = await page0('/samples/enc-rc4.pdf')
  await typePw(page, 'own')
  await loaded(page)
  const st = await page.evaluate(() => {
    const e = window.__pdfpro.useAppStore.getState().encryption
    return e && { owner: e.owner, info: { method: e.info.method }, userPassword: e.userPassword }
  })
  check(
    'RC4 opens with the permissions password (full access)',
    st?.owner && st.info.method === 'RC4 128 位' && st.userPassword === '123',
    JSON.stringify({ owner: st?.owner, m: st?.info.method, u: st?.userPassword }),
  )
  const dis = await page.evaluate(() => [...document.querySelectorAll('.mode-tab')].some((b) => b.disabled))
  check('owner: no mode is disabled', !dis)
  const out = await savedInfo(page, '123')
  check(
    'RC4 saved file reopens with its open password',
    !!out.text && out.info?.method === 'RC4 128 位',
    JSON.stringify(out.info),
  )
  await page.close()
}

// 3. permissions-only file opens without a prompt but restricted
{
  const page = await page0('/samples/enc-restrict.pdf')
  await loaded(page)
  check('restrict-only file opens without a password prompt', !(await page.$('.pw-modal')))
  const st = await page.evaluate(() => ({
    print: document.querySelector('[aria-label="打印"]').disabled,
    edit: [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('编辑')).disabled,
  }))
  check('restrict-only: print + edit disabled', st.print && st.edit, JSON.stringify(st))
  await page.close()
}

// 4. protect a plain document, then remove the protection again
{
  const page = await page0('/samples/sample.pdf')
  await loaded(page)
  await page.evaluate(() =>
    [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('工具')).click(),
  )
  await sleep(200)
  await page.click('[data-tool-id="protect"] .tool-card')
  await page.waitForSelector('.protect-modal')
  check('apply disabled until a password is chosen', await page.$eval('.protect-modal .btn.primary', (b) => b.disabled))
  await page.click('.protect-modal .check-row input')
  await page.type('.protect-modal input[aria-label="打开密码"]', 'pw中文1')
  await page.type('.protect-modal input[aria-label="确认打开密码"]', 'pw中文2')
  check(
    'mismatched confirmation keeps apply disabled',
    await page.$eval('.protect-modal .btn.primary', (b) => b.disabled),
  )
  await page.$eval('.protect-modal input[aria-label="确认打开密码"]', (i) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type('.protect-modal input[aria-label="确认打开密码"]', 'pw中文1')
  // restrict copying with a permissions password
  const boxes = await page.$$('.protect-modal > .form-body > .check-row input')
  await boxes[1].click()
  await page.type('.protect-modal input[aria-label="权限密码"]', 'boss')
  check(
    'new restriction defaults to print only',
    await page.evaluate(() => {
      const st = Object.fromEntries(
        [...document.querySelectorAll('.perm-grid .check-row')].map((l) => [
          l.textContent.trim(),
          l.querySelector('input').checked,
        ]),
      )
      return st['允许打印'] && !st['允许复制文字和图片'] && !st['允许编辑内容']
    }),
  )
  // allow commenting on top of that
  await page.evaluate(() =>
    [...document.querySelectorAll('.perm-grid .check-row')]
      .find((l) => l.textContent.includes('批注'))
      .querySelector('input')
      .click(),
  )
  await page.click('.protect-modal .btn.primary')
  await sleep(200)
  check(
    'protection counts as an unsaved change',
    await page.evaluate(() => window.__pdfpro.useEditStore.getState().dirty),
  )
  const out = await savedInfo(page, 'pw中文1')
  check(
    'protected output needs the (unicode) password',
    out.info?.needsPassword && !out.opensWithoutPassword && out.info.method === 'AES 256 位',
    JSON.stringify(out.info),
  )
  check(
    'protected output: copying denied, printing + annotating allowed',
    out.info && !out.info.permissions.copy && out.info.permissions.print && out.info.permissions.annotate,
    JSON.stringify(out.info?.permissions),
  )
  check('protected output text intact', out.text?.length > 20, out.text)
  // changes list shows it
  check(
    'changes list mentions the protection',
    await page.evaluate(async () => {
      window.__pdfpro.useToolStore.getState().setMode('read')
      window.__pdfpro.useAppStore.getState().setSidebar('changes')
      await new Promise((r) => setTimeout(r, 200))
      return document.body.textContent.includes('设置密码保护')
    }),
  )
  // remove protection
  await page.evaluate(() =>
    [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('工具')).click(),
  )
  await sleep(200)
  await page.click('[data-tool-id="protect"] .tool-card')
  await page.waitForSelector('.protect-modal')
  await page.evaluate(() =>
    [...document.querySelectorAll('.protect-modal .btn')].find((b) => b.textContent.includes('移除保护')).click(),
  )
  const out2 = await savedInfo(page, null)
  check(
    'after removing: output is not encrypted',
    out2.info === null && out2.opensWithoutPassword,
    JSON.stringify(out2.info),
  )
  // undo -> protected again
  await page.evaluate(() => window.__pdfpro.useEditStore.getState().undo())
  const out3 = await savedInfo(page, 'pw中文1')
  check('undo restores the protection', out3.info?.needsPassword === true)
  await page.close()
}

// 5. cancelling the password prompt leaves the app on the home screen
{
  const page = await page0('')
  await page.evaluate(async () => {
    const r = await fetch('/samples/enc-aes256.pdf')
    const { openDocument } = await import('/src/utils/docSession.ts')
    window.__p = openDocument({ data: new Uint8Array(await r.arrayBuffer()), name: 'enc-aes256.pdf', path: null })
  })
  await page.waitForSelector('.pw-modal')
  await page.keyboard.press('Escape')
  const r = await page.evaluate(async () => ({
    ok: await window.__p,
    doc: !!window.__pdfpro?.useAppStore.getState().pdfDoc,
    modal: !!document.querySelector('.pw-modal'),
  }))
  check('cancel: no document opened, prompt gone', r.ok === false && !r.doc && !r.modal, JSON.stringify(r))
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
console.log(failures ? `\n${failures} FAILED` : '\nSECURITY TESTS PASS')
process.exit(failures ? 1 : 0)
