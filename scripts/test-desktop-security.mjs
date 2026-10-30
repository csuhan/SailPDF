import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
const require = createRequire(import.meta.url),
  security = require('../electron/security.cjs'),
  { SecretStore } = require('../electron/secret-store.cjs')
test('only the exact application main frame can call privileged APIs', () => {
  const frame = { routingId: 2, processId: 5, url: 'file:///app/dist/index.html' },
    wc = { mainFrame: frame },
    win = { webContents: wc, isDestroyed: () => false }
  assert.ok(security.trustedSender({ sender: wc, senderFrame: frame }, win, '/app/dist/index.html'))
  for (const changed of [
    { routingId: 3 },
    { processId: 6 },
    { url: 'file:///app/dist/other.html' },
    { url: 'https://attacker.example/' },
  ])
    assert.equal(
      security.trustedSender({ sender: wc, senderFrame: { ...frame, ...changed } }, win, '/app/dist/index.html'),
      false,
    )
  assert.equal(security.trustedSender({ sender: {}, senderFrame: frame }, win, '/app/dist/index.html'), false)
  assert.equal(security.trustedUrl('http://127.0.0.1:5174/evil', '/index', 'http://127.0.0.1:5174'), false)
})
test('external protocols, credential URLs and remote cleartext endpoints are blocked', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hello',
    'https://user:pass@example.com/',
    'mailto:a@example.com?subject=x%0aevil',
    '\nhttps://example.com',
  ])
    assert.equal(security.externalUrl(url), null, url)
  assert.ok(security.externalUrl('https://github.com/csuhan/SailPDF/issues'))
  assert.ok(security.externalUrl('mailto:help@example.com'))
  for (const url of ['http://example.com/v1', 'file:///etc/passwd', 'https://user:pass@example.com/v1'])
    assert.equal(security.endpointUrl(url), false, url)
  for (const url of ['http://127.0.0.1:8000/v1', 'http://192.168.1.2:8000/v1', 'https://api.example.com/v1'])
    assert.equal(security.endpointUrl(url), true, url)
})
test('IPC validates channels, file capabilities, images and credential payloads', () => {
  assert.equal(security.validRequest('unknown', []), false)
  assert.equal(security.validRequest('pdfpro:read-file', ['/etc/passwd']), false)
  assert.equal(security.validRequest('pdfpro:read-file', ['relative.pdf']), false)
  assert.equal(security.validRequest('pdfpro:read-file', ['/tmp/file.pdf']), true)
  assert.equal(
    security.validRequest('pdfpro:secret-save', [{ apiKey: 'test', endpoint: 'https://api.example.com/v1' }]),
    true,
  )
  assert.equal(
    security.validRequest('pdfpro:secret-save', [{ apiKey: 'test', endpoint: 'http://example.com/v1' }]),
    false,
  )
  assert.equal(
    security.validRequest('pdfpro:print-pages', [
      { title: 'x', pages: [{ src: 'https://tracker.example/x.png', widthPt: 1, heightPt: 1 }] },
    ]),
    false,
  )
  assert.equal(
    security.validRequest('pdfpro:ai-request', [
      {
        id: 'a',
        method: 'POST',
        url: 'https://api.example.com/v1/chat/completions',
        headers: { Cookie: 'secret' },
        body: '{}',
      },
    ]),
    false,
  )
  assert.equal(
    security.validRequest('pdfpro:ai-request', [
      {
        id: 'a',
        method: 'POST',
        url: 'pdfpro-local://bundled/v1/chat/completions',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    ]),
    true,
  )
})
function protectedStorage() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString: (data) => {
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
      cipher.setAuthTag(data.subarray(12, 28))
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString()
    },
  }
}
test('credentials are encrypted, private, atomic, removable and fail closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sail-secrets-'))
  try {
    const store = new SecretStore({ directory, safeStorage: protectedStorage() }),
      value = { apiKey: 'test-secret-do-not-log', endpoint: 'https://example.com/v1' }
    assert.ok((await store.save(value)).ok)
    assert.equal((await readFile(store.file)).includes(Buffer.from(value.apiKey)), false)
    assert.equal((await stat(store.file)).mode & 0o777, 0o600)
    assert.equal((await store.load()).apiKey, value.apiKey)
    await writeFile(store.file, 'corrupt')
    assert.equal((await store.load()).apiKey, '')
    assert.ok((await store.save({ apiKey: '', endpoint: '' })).ok)
    const unavailable = new SecretStore({ directory, safeStorage: { isEncryptionAvailable: () => false } })
    assert.equal((await unavailable.save(value)).ok, false)
    await assert.rejects(readFile(unavailable.file), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
