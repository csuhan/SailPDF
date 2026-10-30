/**
 * Crypto primitives for the PDF Standard security handler.
 * MD5 and RC4 are implemented here (legacy handlers, revisions 2-4); AES and
 * SHA-2 go through WebCrypto (available in browsers, Electron and Node 20+).
 */

// ── MD5 ──────────────────────────────────────────────────────────

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const K = new Int32Array(64)
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0

export function md5(data: Uint8Array): Uint8Array {
  const len = data.length
  const padLen = ((len + 8) >> 6) * 64 + 64
  const buf = new Uint8Array(padLen)
  buf.set(data)
  buf[len] = 0x80
  const bits = len * 8
  const dv = new DataView(buf.buffer)
  dv.setUint32(padLen - 8, bits >>> 0, true)
  dv.setUint32(padLen - 4, Math.floor(bits / 2 ** 32), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476
  const M = new Int32Array(16)
  for (let off = 0; off < padLen; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) & 15
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) & 15
      }
      const s = S[(i >> 4) * 4 + (i & 3)]
      const t = (a + f + K[i] + M[g]) | 0
      a = d
      d = c
      c = b
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ov.setInt32(0, a0, true)
  ov.setInt32(4, b0, true)
  ov.setInt32(8, c0, true)
  ov.setInt32(12, d0, true)
  return out
}

// ── RC4 ──────────────────────────────────────────────────────────

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    const t = s[i]
    s[i] = s[j]
    s[j] = t
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    const t = s[i]
    s[i] = s[j]
    s[j] = t
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

// ── WebCrypto helpers ───────────────────────────────────────────

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto?.subtle
  if (!c) throw new Error('WebCrypto is unavailable')
  return c
}

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

export async function sha(alg: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(alg, ab(data)))
}

const keyCache = new Map<string, Promise<CryptoKey>>()
function aesKey(key: Uint8Array): Promise<CryptoKey> {
  let id = ''
  for (let i = 0; i < key.length; i++) id += String.fromCharCode(key[i])
  let p = keyCache.get(id)
  if (!p) {
    if (keyCache.size > 512) keyCache.clear()
    p = subtle().importKey('raw', ab(key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
    keyCache.set(id, p)
  }
  return p
}

/** AES-CBC with PKCS#7 padding */
export async function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: ab(iv) }, await aesKey(key), ab(data)))
}

/** AES-CBC with PKCS#7 padding; throws on bad padding */
export async function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: ab(iv) }, await aesKey(key), ab(data)))
}

/** AES-CBC without padding (data length must be a multiple of 16) */
export async function aesCbcEncryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // WebCrypto always appends one padding block for block-aligned input
  return (await aesCbcEncrypt(key, iv, data)).subarray(0, data.length)
}

/** AES-CBC without padding (data length must be a multiple of 16) */
export async function aesCbcDecryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0 || data.length % 16) throw new Error('AES: bad block length')
  // append the block a PKCS#7 encoder would have produced, so WebCrypto's
  // padding check passes and returns exactly the plaintext
  const last = data.subarray(data.length - 16)
  const padBlock = await aesCbcEncrypt(key, last, new Uint8Array(0))
  const full = new Uint8Array(data.length + 16)
  full.set(data)
  full.set(padBlock, data.length)
  return aesCbcDecrypt(key, iv, full)
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function toHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}
