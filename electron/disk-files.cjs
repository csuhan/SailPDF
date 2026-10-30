const { tr } = require('./locale.cjs')
// File snapshots and guarded atomic replacement. Kept separate from Electron
// so races and failure paths can be exercised against real temporary files.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { fileURLToPath } = require('node:url')

class DiskFileError extends Error {
  constructor(reason, message) {
    super(message)
    this.reason = reason
  }
}

function cleanPath(value) {
  if (typeof value !== 'string' || !value) throw new DiskFileError('unavailable', tr('文件路径无效'))
  return path.resolve(value.startsWith('file://') ? fileURLToPath(value) : value)
}

function sameStat(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

function fingerprint(stat, sha256) {
  return {
    sha256,
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeNs) / 1e6,
    ctimeMs: Number(stat.ctimeNs) / 1e6,
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
  }
}

function sameFingerprint(a, b) {
  return (
    !!a &&
    !!b &&
    a.sha256 === b.sha256 &&
    a.size === b.size &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    (a.mtimeNs && b.mtimeNs ? a.mtimeNs === b.mtimeNs : a.mtimeMs === b.mtimeMs) &&
    (a.ctimeNs && b.ctimeNs ? a.ctimeNs === b.ctimeNs : a.ctimeMs === b.ctimeMs)
  )
}

function failure(error) {
  if (error instanceof DiskFileError) return { ok: false, reason: error.reason, message: error.message }
  if (error?.code === 'ENOENT')
    return { ok: false, reason: 'missing', message: tr('磁盘上的文件已被移动或删除，请另存副本') }
  return { ok: false, reason: 'unavailable', message: tr('暂时无法访问文件：{0}', error?.message || String(error)) }
}

function createDiskFiles(io = fs) {
  // Hash through a bounded buffer, so background checks do not duplicate a
  // large PDF in memory. A snapshot is accepted only if both the open handle
  // and the pathname still refer to the same unchanged file after the read.
  async function snapshot(input, includeData = false) {
    const p = cleanPath(input)
    for (let attempt = 0; attempt < 3; attempt++) {
      let handle
      try {
        handle = await io.open(p, 'r')
        const before = await handle.stat({ bigint: true })
        if (!before.isFile()) throw new DiskFileError('unavailable', tr('所选路径不是文件'))
        if (before.size > BigInt(Number.MAX_SAFE_INTEGER))
          throw new DiskFileError('unavailable', tr('文件过大，无法安全读取'))
        const hash = createHash('sha256')
        const chunks = []
        const buffer = Buffer.allocUnsafe(1024 * 1024)
        let position = 0
        while (position < Number(before.size)) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, Number(before.size) - position),
            position,
          )
          if (!bytesRead) break
          hash.update(buffer.subarray(0, bytesRead))
          if (includeData) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
          position += bytesRead
        }
        const after = await handle.stat({ bigint: true })
        const atPath = await io.stat(p, { bigint: true })
        if (!sameStat(before, after) || !sameStat(after, atPath) || BigInt(position) !== after.size) continue
        return {
          path: p,
          fingerprint: fingerprint(after, hash.digest('hex')),
          ...(includeData ? { data: new Uint8Array(Buffer.concat(chunks, position)) } : {}),
        }
      } finally {
        await handle?.close()
      }
    }
    throw new DiskFileError('conflict', tr('文件正在被其他程序修改，请稍后重试'))
  }

  async function checkFile(p, expected) {
    try {
      const current = await snapshot(p)
      // Re-saving identical bytes elsewhere may change metadata; this does
      // not change the document. Return the refreshed token to the caller.
      const same =
        expected && expected.sha256 === current.fingerprint.sha256 && expected.size === current.fingerprint.size
      return { status: same ? 'same' : 'changed', fingerprint: current.fingerprint }
    } catch (error) {
      const result = failure(error)
      return { status: result.reason === 'missing' ? 'missing' : 'unavailable', message: result.message }
    }
  }

  async function existingSnapshot(p) {
    try {
      return await snapshot(p)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function assertExpected(p, expected) {
    const current = await existingSnapshot(p)
    if (expected === null) {
      if (current) throw new DiskFileError('conflict', tr('此位置出现了新的文件，请重新选择保存位置'))
    } else {
      if (!current) throw new DiskFileError('missing', tr('磁盘上的文件已被移动或删除，请另存副本'))
      if (!sameFingerprint(current.fingerprint, expected)) {
        throw new DiskFileError('conflict', tr('磁盘上的文件已被其他程序修改，请先处理文件冲突或另存副本'))
      }
    }
    return current
  }

  async function writeGuarded(input, bytes, expected) {
    let p
    let temp
    let handle
    try {
      p = cleanPath(input)
      if (!(bytes instanceof Uint8Array)) throw new DiskFileError('unavailable', tr('保存数据无效'))
      // undefined is used only for a newly selected Save As destination: it
      // captures that destination now, then guards it again before replacing.
      const initial = expected === undefined ? await existingSnapshot(p) : await assertExpected(p, expected)
      const token = expected === undefined ? (initial?.fingerprint ?? null) : expected
      temp = path.join(path.dirname(p), `.${path.basename(p)}.pdfpro-${randomUUID()}.tmp`)
      const mode = initial ? Number((await io.stat(p, { bigint: true })).mode & 0o777n) : 0o600
      handle = await io.open(temp, 'wx', mode)
      await handle.writeFile(bytes)
      await handle.sync()
      // Detect replacements, deletions and writes that occur while the new
      // PDF is being produced, including same-size/same-mtime modifications.
      await assertExpected(p, token)
      if (token === null) {
        // A new file must stay exclusive even if another process creates its
        // own file between the last check and commit. link() never replaces
        // an existing destination, while a plain rename() would overwrite it.
        try {
          await io.link(temp, p)
        } catch (error) {
          if (error?.code === 'EEXIST')
            throw new DiskFileError('conflict', tr('此位置出现了新的文件，请重新选择保存位置'))
          throw error
        }
        await io.unlink(temp)
      } else {
        await io.rename(temp, p)
      }
      temp = null
      const written = fingerprint(await handle.stat({ bigint: true }), createHash('sha256').update(bytes).digest('hex'))
      // Never adopt bytes read after the commit as our saved baseline: another
      // application could already have written its own version at this point.
      return { ok: true, path: p, fingerprint: written }
    } catch (error) {
      return failure(error)
    } finally {
      await handle?.close().catch(() => {})
      if (temp) await io.unlink(temp).catch(() => {})
    }
  }

  return { snapshot, checkFile, writeGuarded }
}

module.exports = { createDiskFiles, cleanPath, failure, sameFingerprint }
