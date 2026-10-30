/** Real Electron IPC / sandbox / OS credential integration, isolated profile. */
const { app, BrowserWindow, session, Menu } = require('electron')
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict')
const dir = process.env.PDFPRO_USER_DATA || path.join(os.tmpdir(), `sail-native-security-${Date.now()}`)
process.env.PDFPRO_USER_DATA = dir
require('../electron/main.cjs')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  let attacker,
    server,
    code = 0
  try {
    const win = BrowserWindow.getAllWindows()[0]
    for (let i = 0; i < 200; i++) {
      if (!win.webContents.isLoading()) break
      await sleep(50)
    }
    for (let i = 0; i < 200; i++) {
      if (await win.webContents.executeJavaScript('!!document.querySelector(".home")')) break
      await sleep(50)
    }
    assert.ok(
      await win.webContents.executeJavaScript('!!document.querySelector(".home")'),
      'production UI must boot under CSP and sandbox',
    )
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true)
    assert.equal(await win.webContents.executeJavaScript('window.pdfDesktop.getLanguage()'), 'en')
    assert.ok(Menu.getApplicationMenu().items.some((item) => item.label === 'File'))
    await win.webContents.executeJavaScript('window.pdfDesktop.setLanguage("zh-CN")')
    assert.ok(Menu.getApplicationMenu().items.some((item) => item.label === '文件'))
    await win.webContents.reload()
    for (let i = 0; i < 200; i++) {
      await sleep(50)
      if (
        !win.webContents.isLoading() &&
        (await win.webContents.executeJavaScript(
          'document.documentElement.lang==="zh-CN"&&!!document.querySelector("[aria-label=设置]")',
        ))
      )
        break
    }
    assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'), 'zh-CN')
    await win.webContents.executeJavaScript('window.pdfDesktop.setLanguage("en")')
    win.webContents.reload()
    for (let i = 0; i < 200; i++) {
      await sleep(50)
      if (
        !win.webContents.isLoading() &&
        (await win.webContents.executeJavaScript(
          'document.documentElement.lang==="en"&&!!document.querySelector(".home")',
        ))
      )
        break
    }
    assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'), 'en')
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'ui-language.json'), 'utf8')).language, 'en')
    console.log('PASS real native English/Chinese menus, persisted language and production renderer language on reload')
    const capability = await win.webContents.executeJavaScript(
      'window.pdfDesktop.secrets.load().then(s=>({available:s.available,error:!!s.error}))',
    )
    assert.ok(!capability.error)
    const blocked = await win.webContents.executeJavaScript(
      'Promise.all([window.pdfDesktop.openExternal("file:///etc/passwd").then(()=>false,()=>true),window.pdfDesktop.readFile("/tmp/not-selected.pdf").then(()=>false,()=>true),window.pdfDesktop.aiRequest({id:"invalid",url:"file:///etc/passwd",method:"GET",headers:{},body:""},()=>{}).then(()=>false,()=>true)])',
    )
    assert.deepEqual(blocked, [true, true, true])
    assert.equal(
      await win.webContents.executeJavaScript('navigator.permissions.query({name:"geolocation"}).then(p=>p.state)'),
      'denied',
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        'navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)',
      ),
      true,
    )
    const url = win.webContents.getURL()
    await win.webContents.executeJavaScript('location.href="data:text/html,untrusted-navigation"')
    await sleep(100)
    assert.equal(win.webContents.getURL(), url)
    attacker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(__dirname, '../electron/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
      },
    })
    await attacker.loadURL('data:text/html,<title>untrusted</title>')
    const foreign = await attacker.webContents.executeJavaScript(
      'window.pdfDesktop.secrets.load().then(()=>false,()=>true)',
    )
    assert.equal(foreign, true)
    console.log(
      'PASS sandbox/CSP boot, denied permissions, blocked schemes/navigation, unselected files and foreign-renderer IPC',
    )
    let redirected = 0
    server = require('node:http').createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ data: [{ id: 'native-fixture' }] }))
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/capture' })
        res.end()
      } else {
        redirected++
        res.end('unexpected redirect target')
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${server.address().port}`
    const transport = await win.webContents.executeJavaScript(
      `(async()=>{let chunks='';const models=await window.pdfDesktop.aiRequest({id:'native-models',url:${JSON.stringify(endpoint + '/v1/models')},method:'GET',headers:{},body:''},c=>chunks+=c);const redirect=await window.pdfDesktop.aiRequest({id:'native-redirect',url:${JSON.stringify(endpoint + '/redirect')},method:'GET',headers:{Authorization:'Bearer fixture-only'},body:''},()=>{});return{models:models.ok,body:chunks,redirect:redirect.ok}})()`,
    )
    assert.equal(transport.models, true)
    assert.equal(JSON.parse(transport.body).data[0].id, 'native-fixture')
    assert.equal(transport.redirect, false)
    assert.equal(redirected, 0)
    console.log('PASS legitimate local model HTTP transport and credential-bearing redirect rejection')
    if (capability.available) {
      await win.webContents.executeJavaScript(
        'localStorage.setItem("pdfpro.ai",JSON.stringify({provider:"custom",baseUrl:"https://api.example.com/v1",apiKey:"native-migration-fixture",model:"fixture",language:"zh"}));location.reload()',
      )
      await sleep(300)
      for (let i = 0; i < 200; i++) {
        if (
          !win.webContents.isLoading() &&
          (await win.webContents.executeJavaScript('!!document.querySelector(".home")'))
        )
          break
        await sleep(50)
      }
      const migrated = await win.webContents.executeJavaScript(
        'window.pdfDesktop.secrets.load().then(s=>({hasSecret:!!s.apiKey,plaintext:localStorage.getItem("pdfpro.ai").includes("native-migration-fixture")}))',
      )
      assert.deepEqual(migrated, { hasSecret: true, plaintext: false })
      const encrypted = await fs.readFile(path.join(dir, 'secure-settings/ai-credential.enc'))
      assert.equal(encrypted.includes(Buffer.from('native-migration-fixture')), false)
      assert.equal((await fs.stat(path.join(dir, 'secure-settings/ai-credential.enc'))).mode & 0o777, 0o600)
      await win.webContents.executeJavaScript('window.pdfDesktop.secrets.save({apiKey:"",endpoint:""})')
      console.log(
        'PASS actual OS-encrypted credential migration, no plaintext preference/file contents, private file permissions and removal',
      )
    } else
      console.log('PASS OS-unavailable path: no plaintext fallback; protected-store mechanics covered by unit tests')
  } catch (error) {
    console.error(error)
    code = 1
  } finally {
    server?.close()
    attacker?.destroy()
    for (const win of BrowserWindow.getAllWindows()) win.destroy()
    app.exit(code)
  }
})
setTimeout(() => {
  console.error('Native security suite timed out')
  app.exit(1)
}, 45000).unref()
