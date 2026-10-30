const { tr } = require('../locale.cjs')
// Resumable, verified model download.
//
// - data goes to "<file>.part"; an interrupted download resumes with a
//   Range request (the bytes already on disk are re-hashed first, so the
//   final SHA-256 covers the whole file)
// - the file is only renamed to its final name after the SHA-256 matches:
//   llama-server can never be pointed at a truncated / corrupted model
// - redirects (Hugging Face → CDN) are followed manually so that each hop
//   keeps the Range header
;('use strict')

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const http = require('node:http')
const crypto = require('node:crypto')
const path = require('node:path')

class DownloadError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

function request(url, headers, signal, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 8) return reject(new DownloadError(tr('重定向次数过多'), 'redirect'))
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'PDF-Pro', ...headers }, timeout: 30000 }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        resolve(request(next, headers, signal, hops + 1))
        return
      }
      resolve(res)
    })
    req.on('timeout', () => req.destroy(new DownloadError(tr('连接超时'), 'timeout')))
    req.on('error', (e) => reject(e))
    if (signal) {
      if (signal.aborted) req.destroy(new DownloadError(tr('已取消'), 'aborted'))
      signal.addEventListener('abort', () => req.destroy(new DownloadError(tr('已取消'), 'aborted')), { once: true })
    }
  })
}

/** feed the bytes already downloaded (resume) into the hash */
async function hashExisting(file, hash) {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return 0
  }
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', resolve)
      .on('error', reject)
  })
  return st.size
}

/**
 * Download `url` to `dest` and verify SHA-256.
 * @param {{ url: string, dest: string, size: number, sha256: string,
 *           signal?: AbortSignal, onProgress?: (done: number, total: number, bps: number) => void }} o
 */
async function downloadVerified(o, attempt = 0) {
  await fsp.mkdir(path.dirname(o.dest), { recursive: true })
  const part = o.dest + '.part'
  const hash = crypto.createHash('sha256')
  let have = await hashExisting(part, hash)
  if (have > o.size) {
    // stale / foreign partial file: start over
    await fsp.unlink(part).catch(() => {})
    if (attempt > 1) throw new DownloadError(tr('无法重新开始下载'), 'restart')
    return downloadVerified(o, attempt + 1)
  }
  if (have < o.size) {
    const res = await request(o.url, have ? { Range: `bytes=${have}-` } : {}, o.signal)
    const code = res.statusCode || 0
    if (code === 200 && have > 0) {
      // server ignored the Range header: restart from zero
      res.resume()
      await fsp.unlink(part).catch(() => {})
      if (attempt > 1) throw new DownloadError(tr('服务器不支持断点续传'), 'range')
      return downloadVerified(o, attempt + 1)
    }
    if (code !== 200 && code !== 206) {
      res.resume()
      throw new DownloadError(tr('下载失败：HTTP {0}', code), 'http')
    }
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' })
    let done = have
    let lastEmit = 0
    let winBytes = done
    let winT = Date.now()
    let bps = 0
    await new Promise((resolve, reject) => {
      let failed = false
      const fail = (e) => {
        if (failed) return
        failed = true
        // a destroyed socket reports itself as "aborted": say why it really ended
        if (o.signal?.aborted) e = new DownloadError(tr('已取消'), 'aborted')
        res.destroy()
        out.destroy()
        reject(e)
      }
      res.on('data', (chunk) => {
        hash.update(chunk)
        done += chunk.length
        if (failed) return
        const now = Date.now()
        if (now - winT >= 1000) {
          bps = ((done - winBytes) * 1000) / (now - winT)
          winBytes = done
          winT = now
        }
        if (now - lastEmit > 250) {
          lastEmit = now
          o.onProgress?.(done, o.size, bps)
        }
        // backpressure: never buffer gigabytes in memory
        if (!out.write(chunk)) {
          res.pause()
          out.once('drain', () => res.resume())
        }
      })
      res.on('end', () => out.end(() => (failed ? null : resolve())))
      res.on('error', fail)
      res.on('aborted', () => fail(new DownloadError(tr('连接中断'), 'aborted')))
      out.on('error', fail)
      o.signal?.addEventListener('abort', () => fail(new DownloadError(tr('已取消'), 'aborted')), { once: true })
    })
    if (done !== o.size) throw new DownloadError(tr('下载不完整（{0}/{1}），可以继续下载', done, o.size), 'incomplete')
  }
  const digest = hash.digest('hex')
  if (digest !== o.sha256) {
    // corrupted: never keep it (resuming would keep the bad bytes)
    await fsp.unlink(part).catch(() => {})
    throw new DownloadError(tr('校验失败，文件已损坏，请重新下载'), 'checksum')
  }
  await fsp.rename(part, o.dest)
  o.onProgress?.(o.size, o.size, 0)
}

module.exports = { downloadVerified, DownloadError }
