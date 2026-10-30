import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createDiskFiles, sameFingerprint } = require('../electron/disk-files.cjs')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpro-disk-files-'))
let passed = 0
const bytes = (text) => new Uint8Array(Buffer.from(text))
const hash = (data) => createHash('sha256').update(data).digest('hex')

async function test(name, run) {
  const folder = path.join(root, String(passed))
  await fs.mkdir(folder)
  const file = path.join(folder, 'sample.pdf')
  await fs.writeFile(file, 'original PDF')
  await run(file, folder)
  passed++
  console.log(`PASS ${name}`)
}

function withHook(method, hook) {
  return {
    ...fs,
    async open(file, ...args) {
      const handle = await fs.open(file, ...args)
      return new Proxy(handle, {
        get(target, key) {
          const value = Reflect.get(target, key)
          if (key === method)
            return (...callArgs) => hook({ target, file, args: callArgs, original: value.bind(target) })
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
}

try {
  await test('snapshot binds hash and identity to exact returned bytes', async (file) => {
    const disk = createDiskFiles()
    const first = await disk.snapshot(file, true)
    assert.equal(Buffer.from(first.data).toString(), 'original PDF')
    assert.equal(first.fingerprint.sha256, hash(first.data))
    assert.equal(first.fingerprint.size, first.data.length)
    assert.ok(first.fingerprint.ino && first.fingerprint.mtimeNs)
    assert.deepEqual(await disk.checkFile(file, first.fingerprint), { status: 'same', fingerprint: first.fingerprint })
  })

  await test('same-size content tampering is found even with restored modification time', async (file) => {
    const disk = createDiskFiles()
    const originalStat = await fs.stat(file)
    const first = await disk.snapshot(file)
    await fs.writeFile(file, 'modified PDF')
    await fs.utimes(file, originalStat.atime, originalStat.mtime)
    const check = await disk.checkFile(file, first.fingerprint)
    assert.equal(check.status, 'changed')
    const result = await disk.writeGuarded(file, bytes('my PDF'), first.fingerprint)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'conflict')
    assert.equal(await fs.readFile(file, 'utf8'), 'modified PDF')
  })

  await test('missing files are distinguished and never silently recreated', async (file) => {
    const disk = createDiskFiles()
    const first = await disk.snapshot(file)
    await fs.unlink(file)
    assert.equal((await disk.checkFile(file, first.fingerprint)).status, 'missing')
    assert.equal((await disk.writeGuarded(file, bytes('my PDF'), first.fingerprint)).reason, 'missing')
    await assert.rejects(fs.stat(file), { code: 'ENOENT' })
  })

  await test('unavailable volumes and permissions are not treated as missing', async (file) => {
    const disk = createDiskFiles({
      ...fs,
      open: async () => {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      },
    })
    assert.equal((await disk.checkFile(file, {})).status, 'unavailable')
  })

  await test('external replacement during staging is caught and temp is removed', async (file, folder) => {
    const first = await createDiskFiles().snapshot(file)
    let injected = false
    const disk = createDiskFiles(
      withHook('writeFile', async ({ file: writing, original, args }) => {
        await original(...args)
        if (writing.endsWith('.tmp') && !injected) {
          injected = true
          const replacement = path.join(folder, 'replacement')
          await fs.writeFile(replacement, 'external PDF')
          await fs.rename(replacement, file)
        }
      }),
    )
    const result = await disk.writeGuarded(file, bytes('my new PDF'), first.fingerprint)
    assert.equal(result.reason, 'conflict')
    assert.equal(await fs.readFile(file, 'utf8'), 'external PDF')
    assert.deepEqual(await fs.readdir(folder), ['sample.pdf'])
  })

  await test('file appearing at a new destination during staging is preserved', async (file, folder) => {
    const target = path.join(folder, 'new.pdf')
    const disk = createDiskFiles(
      withHook('writeFile', async ({ file: writing, original, args }) => {
        await original(...args)
        if (writing.endsWith('.tmp')) await fs.writeFile(target, 'arrived while saving')
      }),
    )
    const result = await disk.writeGuarded(target, bytes('my new PDF'), undefined)
    assert.equal(result.reason, 'conflict')
    assert.equal(await fs.readFile(target, 'utf8'), 'arrived while saving')
    assert.deepEqual((await fs.readdir(folder)).sort(), ['new.pdf', 'sample.pdf'])
  })

  await test('new destinations are committed atomically without stale temporary files', async (_file, folder) => {
    const target = path.join(folder, 'new.pdf')
    const disk = createDiskFiles()
    const result = await disk.writeGuarded(target, bytes('new saved PDF'), undefined)
    assert.equal(result.ok, true)
    assert.equal(await fs.readFile(target, 'utf8'), 'new saved PDF')
    assert.equal(sameFingerprint(result.fingerprint, (await disk.snapshot(target)).fingerprint), true)
    assert.deepEqual((await fs.readdir(folder)).sort(), ['new.pdf', 'sample.pdf'])
  })

  await test('new-file commit never overwrites a file arriving after the last check', async (_file, folder) => {
    const target = path.join(folder, 'new.pdf')
    const disk = createDiskFiles({
      ...fs,
      link: async (...args) => {
        await fs.writeFile(target, 'arrived just before commit')
        return fs.link(...args)
      },
    })
    const result = await disk.writeGuarded(target, bytes('my saved PDF'), undefined)
    assert.equal(result.reason, 'conflict')
    assert.equal(await fs.readFile(target, 'utf8'), 'arrived just before commit')
    assert.deepEqual((await fs.readdir(folder)).sort(), ['new.pdf', 'sample.pdf'])
  })

  await test('successful save returns exact own bytes and a fresh disk baseline', async (file, folder) => {
    const disk = createDiskFiles()
    const first = await disk.snapshot(file)
    const payload = bytes('successfully saved PDF')
    const result = await disk.writeGuarded(file, payload, first.fingerprint)
    assert.equal(result.ok, true)
    assert.equal(result.fingerprint.sha256, hash(payload))
    assert.equal(sameFingerprint(result.fingerprint, (await disk.snapshot(file)).fingerprint), true)
    assert.equal((await disk.checkFile(file, result.fingerprint)).status, 'same')
    assert.deepEqual(await fs.readdir(folder), ['sample.pdf'])
  })

  await test('post-commit external writes are never adopted as our saved bytes', async (file) => {
    const first = await createDiskFiles().snapshot(file)
    const disk = createDiskFiles({
      ...fs,
      rename: async (...args) => {
        await fs.rename(...args)
        await fs.writeFile(file, 'changed immediately after commit')
      },
    })
    const payload = bytes('my saved PDF')
    const result = await disk.writeGuarded(file, payload, first.fingerprint)
    assert.equal(result.ok, true)
    assert.equal(result.fingerprint.sha256, hash(payload))
    assert.equal((await disk.checkFile(file, result.fingerprint)).status, 'changed')
  })

  await test('write failure cleans partial temporary files and preserves original', async (file, folder) => {
    const first = await createDiskFiles().snapshot(file)
    const disk = createDiskFiles(
      withHook('writeFile', async ({ original }) => {
        await original(bytes('partial'))
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }),
    )
    assert.equal((await disk.writeGuarded(file, bytes('my new PDF'), first.fingerprint)).reason, 'unavailable')
    assert.equal(await fs.readFile(file, 'utf8'), 'original PDF')
    assert.deepEqual(await fs.readdir(folder), ['sample.pdf'])
  })

  await test('rename failure preserves original and cleans temporary file', async (file, folder) => {
    const first = await createDiskFiles().snapshot(file)
    const disk = createDiskFiles({
      ...fs,
      rename: async () => {
        throw Object.assign(new Error('read-only folder'), { code: 'EACCES' })
      },
    })
    assert.equal((await disk.writeGuarded(file, bytes('my new PDF'), first.fingerprint)).reason, 'unavailable')
    assert.equal(await fs.readFile(file, 'utf8'), 'original PDF')
    assert.deepEqual(await fs.readdir(folder), ['sample.pdf'])
  })

  await test('snapshot retries a file edited during the read', async (file) => {
    let injected = false
    const disk = createDiskFiles(
      withHook('read', async ({ file: reading, original, args }) => {
        const result = await original(...args)
        if (reading === file && !injected) {
          injected = true
          await fs.writeFile(file, 'revised PDF')
        }
        return result
      }),
    )
    const snap = await disk.snapshot(file, true)
    assert.equal(Buffer.from(snap.data).toString(), 'revised PDF')
    assert.equal(snap.fingerprint.sha256, hash(snap.data))
  })

  await test('an actively changing file fails after bounded retries', async (file) => {
    let changes = 0
    const disk = createDiskFiles(
      withHook('read', async ({ file: reading, original, args }) => {
        const result = await original(...args)
        if (reading === file && args[3] === 0) await fs.writeFile(file, `revision ${++changes}`)
        return result
      }),
    )
    await assert.rejects(disk.snapshot(file, true), (error) => error.reason === 'conflict')
    assert.equal(changes, 3)
  })

  console.log(`${passed} native disk guard tests passed`)
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
