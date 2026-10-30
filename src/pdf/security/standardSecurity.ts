import { tr } from '../../i18n/locale'
/**
 * PDF Standard security handler (ISO 32000-2 §7.6.4): open password /
 * permissions password.
 *
 * - decrypt: RC4 40/128 (R2/R3), AES-128 (R4, AESV2), AES-256 (R5/R6, AESV3);
 *   either the user or the owner password unlocks the file.
 * - encrypt: AES-256 (V5/R6), what current Acrobat writes.
 *
 * pdf-lib cannot read encrypted object streams, so the file is parsed with
 * object-stream expansion deferred: everything is decrypted first, then the
 * (now plain) object streams are unpacked into the context.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectStreamParser,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFWriter,
  PDFXRefStreamParser,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib'
import {
  aesCbcDecrypt,
  aesCbcDecryptNoPad,
  aesCbcEncrypt,
  aesCbcEncryptNoPad,
  bytesEqual,
  concat,
  md5,
  randomBytes,
  rc4,
  sha,
  toHex,
} from './crypto'

export interface Permissions {
  print: boolean
  /** high-resolution printing */
  printHigh: boolean
  modify: boolean
  copy: boolean
  annotate: boolean
  fillForms: boolean
  /** insert / rotate / delete pages */
  assemble: boolean
}

export const ALL_PERMISSIONS: Permissions = {
  print: true,
  printHigh: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  assemble: true,
}

export interface EncryptionInfo {
  /** "RC4 40 位" / "AES 128 位" / ... */
  method: string
  revision: number
  permissions: Permissions
  /** permissions were not all granted */
  restricted: boolean
  /** opening requires a password (the user password is not empty) */
  needsPassword: boolean
}

export class PasswordError extends Error {
  constructor(message = tr('密码不正确')) {
    super(message)
    this.name = 'PasswordError'
  }
}

export class UnsupportedEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedEncryptionError'
  }
}

// ── permissions <-> P value ──────────────────────────────────────

export function permissionsFromP(p: number): Permissions {
  const bit = (n: number) => (p & (1 << (n - 1))) !== 0
  return {
    print: bit(3),
    printHigh: bit(3) && bit(12),
    modify: bit(4),
    copy: bit(5),
    annotate: bit(6),
    fillForms: bit(9) || bit(6),
    assemble: bit(11) || bit(4),
  }
}

export function pFromPermissions(perm: Permissions): number {
  // reserved bits 7-8 and 13-32 are 1, bits 1-2 are 0
  let p = 0xfffff0c0 | 0
  const set = (n: number, on: boolean) => {
    if (on) p |= 1 << (n - 1)
  }
  set(3, perm.print)
  set(4, perm.modify)
  set(5, perm.copy)
  set(6, perm.annotate)
  set(9, perm.fillForms)
  // accessibility extraction is always allowed (Acrobat greys it out too)
  set(10, true)
  set(11, perm.assemble)
  set(12, perm.print && perm.printHigh)
  return p | 0
}

const allGranted = (p: Permissions) => Object.values(p).every(Boolean)

// ── parsing without touching object streams ─────────────────────

const ENDOBJ = [0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a]

interface ParsedFile {
  context: PDFContext
  /** object streams found while parsing (unpacked after decryption) */
  objStms: PDFRef[]
}

async function parseDeferred(bytes: Uint8Array): Promise<ParsedFile> {
  const parser = PDFParser.forBytesWithOptions(bytes, Infinity) as unknown as Record<string, unknown> & {
    parseDocument: () => Promise<PDFContext>
    context: PDFContext
  }
  const objStms: PDFRef[] = []
  type P = {
    parseIndirectObjectHeader: () => PDFRef
    skipWhitespaceAndComments: () => void
    parseObject: () => PDFObject
    matchKeyword: (k: number[]) => boolean
    context: PDFContext
  }
  // same as pdf-lib's parseIndirectObject, but object streams are kept as
  // plain objects instead of being unpacked (their content is still encrypted)
  parser.parseIndirectObject = async function (this: P) {
    const ref = this.parseIndirectObjectHeader()
    this.skipWhitespaceAndComments()
    const object = this.parseObject()
    this.skipWhitespaceAndComments()
    this.matchKeyword(ENDOBJ)
    if (object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')) {
      PDFXRefStreamParser.forStream(object).parseIntoContext()
    } else {
      if (object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Type')) === PDFName.of('ObjStm')) {
        objStms.push(ref)
      }
      this.context.assign(ref, object)
    }
    return ref
  }
  const context = await parser.parseDocument()
  return { context, objStms }
}

async function unpackObjectStreams(file: ParsedFile): Promise<void> {
  for (const ref of file.objStms) {
    const stm = file.context.lookup(ref)
    if (!(stm instanceof PDFRawStream)) continue
    try {
      await PDFObjectStreamParser.forStream(stm).parseIntoContext()
    } catch {
      /* broken object stream: its objects stay missing (as in any reader) */
    }
    file.context.delete(ref)
  }
}

function serialize(context: PDFContext): Promise<Uint8Array> {
  return PDFWriter.forContext(context, Infinity).serializeToBuffer()
}

// ── encryption dictionary ───────────────────────────────────────

interface Params {
  V: number
  R: number
  keyLength: number
  O: Uint8Array
  U: Uint8Array
  OE?: Uint8Array
  UE?: Uint8Array
  P: number
  Perms?: Uint8Array
  id0: Uint8Array
  encryptMetadata: boolean
  /** crypt filter for streams / strings */
  stm: 'none' | 'rc4' | 'aesv2' | 'aesv3'
  str: 'none' | 'rc4' | 'aesv2' | 'aesv3'
}

function bytesOf(o: PDFObject | undefined): Uint8Array {
  if (o instanceof PDFHexString || o instanceof PDFString) return o.asBytes()
  return new Uint8Array(0)
}

function num(o: PDFObject | undefined, d: number): number {
  return o instanceof PDFNumber ? o.asNumber() : d
}

function encryptDictOf(context: PDFContext): { dict: PDFDict; ref: PDFRef | null } | null {
  const e = context.trailerInfo.Encrypt as PDFObject | undefined
  if (!e) return null
  const dict = e instanceof PDFRef ? context.lookup(e) : e
  if (!(dict instanceof PDFDict)) return null
  return { dict, ref: e instanceof PDFRef ? e : null }
}

function readParams(context: PDFContext, dict: PDFDict): Params {
  const filter = dict.lookup(PDFName.of('Filter'))
  if (filter !== PDFName.of('Standard')) {
    throw new UnsupportedEncryptionError(tr('此文档使用证书或其它安全处理程序加密，暂不支持'))
  }
  const V = num(dict.lookup(PDFName.of('V')), 0)
  const R = num(dict.lookup(PDFName.of('R')), 2)
  let keyLength = num(dict.lookup(PDFName.of('Length')), 40) / 8
  if (V === 1) keyLength = 5
  const idArr = context.trailerInfo.ID as PDFObject | undefined
  const ids = idArr instanceof PDFRef ? context.lookup(idArr) : idArr
  const id0 = ids instanceof PDFArray && ids.size() > 0 ? bytesOf(ids.lookup(0)) : new Uint8Array(0)
  const em = dict.lookup(PDFName.of('EncryptMetadata'))
  const encryptMetadata = !(em && em.toString() === 'false')
  const cfm = (name: PDFObject | undefined): Params['stm'] => {
    if (V < 4) return 'rc4'
    if (!(name instanceof PDFName) || name === PDFName.of('Identity')) return 'none'
    const cf = dict.lookup(PDFName.of('CF'))
    const f = cf instanceof PDFDict ? cf.lookup(name) : undefined
    const m = f instanceof PDFDict ? f.lookup(PDFName.of('CFM')) : undefined
    if (m === PDFName.of('AESV2')) return 'aesv2'
    if (m === PDFName.of('AESV3')) return 'aesv3'
    if (m === PDFName.of('V2')) return 'rc4'
    if (m === PDFName.of('None') || !m) return 'none'
    throw new UnsupportedEncryptionError(tr('不支持的加密方式 {0}', m.toString()))
  }
  if (V >= 4) {
    const cf = dict.lookup(PDFName.of('CF'))
    const std = cf instanceof PDFDict ? cf.lookup(PDFName.of('StdCF')) : undefined
    const len = std instanceof PDFDict ? num(std.lookup(PDFName.of('Length')), 0) : 0
    if (V === 4) keyLength = len > 40 ? len / 8 : len > 0 ? len : 16
  }
  if (V >= 5) keyLength = 32
  if (![1, 2, 4, 5].includes(V) || R < 2 || R > 6) {
    throw new UnsupportedEncryptionError(tr('不支持的加密版本 V{0} R{1}', V, R))
  }
  return {
    V,
    R,
    keyLength: Math.max(5, Math.min(32, keyLength)),
    O: bytesOf(dict.lookup(PDFName.of('O'))),
    U: bytesOf(dict.lookup(PDFName.of('U'))),
    OE: dict.has(PDFName.of('OE')) ? bytesOf(dict.lookup(PDFName.of('OE'))) : undefined,
    UE: dict.has(PDFName.of('UE')) ? bytesOf(dict.lookup(PDFName.of('UE'))) : undefined,
    P: num(dict.lookup(PDFName.of('P')), -1) | 0,
    Perms: dict.has(PDFName.of('Perms')) ? bytesOf(dict.lookup(PDFName.of('Perms'))) : undefined,
    id0,
    encryptMetadata,
    stm: cfm(dict.lookup(PDFName.of('StmF'))),
    str: cfm(dict.lookup(PDFName.of('StrF'))),
  }
}

function describe(p: Params): string {
  if (p.V >= 5) return tr('AES 256 位')
  if (p.stm === 'aesv2' || p.str === 'aesv2') return tr('AES 128 位')
  return tr('RC4 {0} 位', p.keyLength * 8)
}

// ── key derivation: revisions 2-4 ───────────────────────────────

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

/** password bytes for the legacy handler (PDFDocEncoding ~ Latin-1) */
function legacyPassword(pw: string): Uint8Array {
  const out: number[] = []
  for (const ch of pw) {
    const c = ch.codePointAt(0)!
    out.push(c <= 0xff ? c : 0x3f)
    if (out.length >= 32) break
  }
  return new Uint8Array(out)
}

function padded(pw: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  out.set(pw.subarray(0, 32))
  out.set(PAD.subarray(0, 32 - Math.min(32, pw.length)), Math.min(32, pw.length))
  return out
}

function le32(n: number): Uint8Array {
  return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255])
}

function legacyKey(pw: Uint8Array, p: Params): Uint8Array {
  const parts = [padded(pw), p.O.subarray(0, 32), le32(p.P), p.id0]
  if (p.R >= 4 && !p.encryptMetadata) parts.push(new Uint8Array([255, 255, 255, 255]))
  let h = md5(concat(...parts))
  const n = p.R === 2 ? 5 : p.keyLength
  if (p.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n))
  return h.slice(0, n)
}

function legacyUserCheck(key: Uint8Array, p: Params): boolean {
  if (p.R === 2) return bytesEqual(rc4(key, PAD), p.U.subarray(0, 32))
  let x = rc4(key, md5(concat(PAD, p.id0)))
  for (let i = 1; i <= 19; i++)
    x = rc4(
      key.map((b) => b ^ i),
      x,
    )
  return bytesEqual(x.subarray(0, 16), p.U.subarray(0, 16))
}

/** recover the user password from the owner password (Algorithm 7) */
function legacyUserFromOwner(owner: Uint8Array, p: Params): Uint8Array {
  let h = md5(padded(owner))
  const n = p.R === 2 ? 5 : p.keyLength
  if (p.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n))
  const key = h.subarray(0, n)
  let x = p.O.subarray(0, 32)
  if (p.R === 2) return rc4(key, x)
  for (let i = 19; i >= 0; i--)
    x = rc4(
      key.map((b) => b ^ i),
      x,
    )
  return x
}

// ── key derivation: revisions 5-6 (AES-256) ─────────────────────

function utf8Password(pw: string): Uint8Array {
  // SASLprep is skipped: NFKC covers the cases that matter in practice
  return new TextEncoder().encode(pw.normalize('NFKC')).subarray(0, 127)
}

/** Algorithm 2.B (R6) / plain SHA-256 (R5) */
async function hash2B(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array, R: number): Promise<Uint8Array> {
  let k = await sha('SHA-256', concat(pw, salt, udata))
  if (R === 5) return k
  for (let round = 0; ; round++) {
    const unit = concat(pw, k, udata)
    const k1 = new Uint8Array(unit.length * 64)
    for (let i = 0; i < 64; i++) k1.set(unit, i * unit.length)
    const e = await aesCbcEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1)
    let mod = 0
    for (let i = 0; i < 16; i++) mod += e[i]
    mod %= 3
    k = await sha(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', e)
    if (round >= 63 && e[e.length - 1] <= round - 31) break
  }
  return k.subarray(0, 32)
}

async function aes256Key(pw: string, p: Params): Promise<{ key: Uint8Array; owner: boolean } | null> {
  const pwb = utf8Password(pw)
  const zero = new Uint8Array(16)
  const U48 = p.U.subarray(0, 48)
  // owner first: it grants all permissions
  if (p.O.length >= 48 && p.OE) {
    if (bytesEqual(await hash2B(pwb, p.O.subarray(32, 40), U48, p.R), p.O.subarray(0, 32))) {
      const ik = await hash2B(pwb, p.O.subarray(40, 48), U48, p.R)
      return { key: await aesCbcDecryptNoPad(ik, zero, p.OE.subarray(0, 32)), owner: true }
    }
  }
  if (p.U.length >= 48 && p.UE) {
    if (bytesEqual(await hash2B(pwb, p.U.subarray(32, 40), new Uint8Array(0), p.R), p.U.subarray(0, 32))) {
      const ik = await hash2B(pwb, p.U.subarray(40, 48), new Uint8Array(0), p.R)
      return { key: await aesCbcDecryptNoPad(ik, zero, p.UE.subarray(0, 32)), owner: false }
    }
  }
  return null
}

interface Unlocked {
  key: Uint8Array
  /** the owner password was given (full access) */
  owner: boolean
  /** recovered / given user password (legacy handlers only) */
  userPassword?: string
}

async function unlock(p: Params, password: string): Promise<Unlocked | null> {
  if (p.R >= 5) return aes256Key(password, p)
  const pw = legacyPassword(password)
  // owner password → user password → file key
  const fromOwner = legacyUserFromOwner(pw, p)
  const ownerKey = legacyKey(fromOwner, p)
  if (legacyUserCheck(ownerKey, p)) {
    let end = fromOwner.length
    // the recovered value is the padded user password: strip the padding
    for (let k = 0; k <= 32; k++) {
      if (bytesEqual(fromOwner.subarray(k), PAD.subarray(0, 32 - k))) {
        end = k
        break
      }
    }
    return { key: ownerKey, owner: true, userPassword: String.fromCharCode(...fromOwner.subarray(0, end)) }
  }
  const key = legacyKey(pw, p)
  if (legacyUserCheck(key, p)) return { key, owner: false, userPassword: password }
  return null
}

// ── object decryption ───────────────────────────────────────────

type Cipher = (data: Uint8Array, ref: PDFRef, kind: 'stm' | 'str') => Promise<Uint8Array>

function makeDecryptor(p: Params, key: Uint8Array): Cipher {
  const objKey = (ref: PDFRef, aes: boolean) => {
    const n = ref.objectNumber
    const g = ref.generationNumber
    const parts = [key, new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255])]
    if (aes) parts.push(new Uint8Array([0x73, 0x41, 0x6c, 0x54]))
    return md5(concat(...parts)).subarray(0, Math.min(16, key.length + 5))
  }
  return async (data, ref, kind) => {
    const method = kind === 'stm' ? p.stm : p.str
    if (method === 'none') return data
    if (method === 'rc4') return rc4(objKey(ref, false), data)
    if (data.length < 32 || data.length % 16) {
      // empty strings are stored as just an IV; anything else is corrupt
      return data.length <= 16 ? new Uint8Array(0) : data
    }
    const k = method === 'aesv3' ? key : objKey(ref, true)
    try {
      return await aesCbcDecrypt(k, data.subarray(0, 16), data.subarray(16))
    } catch {
      // bad padding: keep the block-aligned plaintext
      return aesCbcDecryptNoPad(k, data.subarray(0, 16), data.subarray(16))
    }
  }
}

/** walk strings in a (direct) object tree, replacing them via `fn` */
async function mapStrings(
  obj: PDFObject,
  fn: (b: Uint8Array) => Promise<Uint8Array>,
  skipSigContents = false,
): Promise<PDFObject> {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(toHex(await fn(obj.asBytes())))
  }
  if (obj instanceof PDFDict) {
    const isSig = skipSigContents || obj.lookup(PDFName.of('Type')) === PDFName.of('Sig')
    for (const [k, v] of obj.entries()) {
      if (isSig && k === PDFName.of('Contents')) continue
      const nv = await mapStrings(v, fn)
      if (nv !== v) obj.set(k, nv)
    }
    return obj
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i)
      const nv = await mapStrings(v, fn)
      if (nv !== v) obj.set(i, nv)
    }
    return obj
  }
  return obj
}

const isXRef = (s: PDFRawStream) => s.dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')
const isMetadata = (s: PDFRawStream) => s.dict.lookup(PDFName.of('Type')) === PDFName.of('Metadata')

// ── public API ──────────────────────────────────────────────────

/** quick check without decrypting (bytes are only scanned + parsed) */
export async function inspectEncryption(bytes: Uint8Array): Promise<EncryptionInfo | null> {
  // cheap pre-check: no /Encrypt keyword anywhere -> not encrypted
  if (!hasEncryptKeyword(bytes)) return null
  const file = await parseDeferred(bytes)
  const e = encryptDictOf(file.context)
  if (!e) return null
  const p = readParams(file.context, e.dict)
  const permissions = permissionsFromP(p.P)
  const empty = await unlock(p, '')
  return {
    method: describe(p),
    revision: p.R,
    permissions,
    restricted: !allGranted(permissions),
    needsPassword: !empty,
  }
}

function hasEncryptKeyword(bytes: Uint8Array): boolean {
  const pat = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74] // "/Encrypt"
  outer: for (let i = 0; i <= bytes.length - pat.length; i++) {
    if (bytes[i] !== 0x2f) continue
    for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) continue outer
    return true
  }
  return false
}

export interface DecryptResult {
  bytes: Uint8Array
  info: EncryptionInfo
  /** opened with the owner (permissions) password */
  owner: boolean
  /** the user (open) password, when known */
  userPassword: string | null
  /** what is needed to write the file again with the very same protection */
  preserved: PreservedSecurity
}

/**
 * The original protection of a decrypted file: re-applying it keeps both
 * passwords and the permissions exactly as they were (same file key, same
 * encryption dictionary, same file ID).
 */
export interface PreservedSecurity {
  key: Uint8Array
  stm: Params['stm']
  str: Params['str']
  encryptMetadata: boolean
  /** the /Encrypt dictionary (direct objects only) */
  dict: PDFDict
  /** trailer /ID entries (hex) */
  id: [string, string]
}

/**
 * Remove the encryption of `bytes` with `password` (user or owner).
 * Throws PasswordError on a wrong password.
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const file = await parseDeferred(bytes)
  const e = encryptDictOf(file.context)
  if (!e) throw new Error(tr('文档未加密'))
  const p = readParams(file.context, e.dict)
  const u = await unlock(p, password)
  if (!u) throw new PasswordError()
  await decryptObjects(file, e, p, u.key)
  const permissions = permissionsFromP(p.P)
  const userPassword = u.userPassword ?? (u.owner ? null : password)
  const idArr = file.context.trailerInfo.ID as PDFObject | undefined
  const ids = idArr instanceof PDFRef ? file.context.lookup(idArr) : idArr
  const id1 = ids instanceof PDFArray && ids.size() > 1 ? bytesOf(ids.lookup(1)) : p.id0
  return {
    bytes: await serialize(file.context),
    info: {
      method: describe(p),
      revision: p.R,
      permissions,
      restricted: !allGranted(permissions),
      needsPassword: !(await unlock(p, '')),
    },
    owner: u.owner,
    userPassword,
    preserved: {
      key: u.key,
      stm: p.stm,
      str: p.str,
      encryptMetadata: p.encryptMetadata,
      dict: e.dict,
      id: [toHex(p.id0), toHex(id1)],
    },
  }
}

async function decryptObjects(
  file: ParsedFile,
  e: { dict: PDFDict; ref: PDFRef | null },
  p: Params,
  key: Uint8Array,
): Promise<void> {
  const dec = makeDecryptor(p, key)
  for (const [ref, obj] of file.context.enumerateIndirectObjects()) {
    if (e.ref && ref === e.ref) continue
    if (obj instanceof PDFRawStream) {
      if (isXRef(obj)) continue
      const skip = isMetadata(obj) && !p.encryptMetadata
      const data = skip ? obj.contents : await dec(obj.contents, ref, 'stm')
      await mapStrings(obj.dict, (b) => dec(b, ref, 'str'))
      file.context.assign(ref, PDFRawStream.of(obj.dict, data))
    } else {
      const nv = await mapStrings(obj, (b) => dec(b, ref, 'str'))
      if (nv !== obj) file.context.assign(ref, nv)
    }
  }
  if (e.ref) file.context.delete(e.ref)
  delete (file.context.trailerInfo as { Encrypt?: unknown }).Encrypt
  await unpackObjectStreams(file)
}

/** Re-open our own encrypted output with the already unlocked session key. */
export async function decryptWithPreservedSecurity(bytes: Uint8Array, sec: PreservedSecurity): Promise<Uint8Array> {
  const file = await parseDeferred(bytes)
  const e = encryptDictOf(file.context)
  if (!e) throw new Error(tr('保存后的文件缺少预期的密码保护'))
  const p = readParams(file.context, e.dict)
  if (toHex(p.id0) !== sec.id[0] || p.stm !== sec.stm || p.str !== sec.str)
    throw new Error(tr('保存后的密码保护与原文档不一致'))
  await decryptObjects(file, e, p, sec.key)
  return serialize(file.context)
}

export interface EncryptOptions {
  /** password to open the document ('' = opens without a prompt) */
  userPassword: string
  /** password to change permissions/security; random when omitted */
  ownerPassword?: string | null
  permissions?: Permissions
}

function makeEncryptor(key: Uint8Array, stm: Params['stm'], str: Params['str']): Cipher {
  const objKey = (ref: PDFRef, aes: boolean) => {
    const n = ref.objectNumber
    const g = ref.generationNumber
    const parts = [key, new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255])]
    if (aes) parts.push(new Uint8Array([0x73, 0x41, 0x6c, 0x54]))
    return md5(concat(...parts)).subarray(0, Math.min(16, key.length + 5))
  }
  return async (data, ref, kind) => {
    const method = kind === 'stm' ? stm : str
    if (method === 'none') return data
    if (method === 'rc4') return rc4(objKey(ref, false), data)
    const iv = randomBytes(16)
    return concat(iv, await aesCbcEncrypt(method === 'aesv3' ? key : objKey(ref, true), iv, data))
  }
}

/** encrypt every object of a plain document in place, then serialize */
async function encryptContext(
  context: PDFContext,
  cipher: Cipher,
  encryptDict: PDFDict,
  id: [string, string] | null,
  encryptMetadata: boolean,
): Promise<Uint8Array> {
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const s = obj as unknown as { getContents?: () => Uint8Array; dict?: PDFDict }
    if (obj instanceof PDFDict || obj instanceof PDFArray || obj instanceof PDFString || obj instanceof PDFHexString) {
      const nv = await mapStrings(obj, (b) => cipher(b, ref, 'str'))
      if (nv !== obj) context.assign(ref, nv)
    } else if (s.dict instanceof PDFDict && typeof s.getContents === 'function') {
      // raw streams and pdf-lib's own (flate / content) streams
      if (s.dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')) continue
      const skip = !encryptMetadata && s.dict.lookup(PDFName.of('Type')) === PDFName.of('Metadata')
      await mapStrings(s.dict, (b) => cipher(b, ref, 'str'))
      const raw = obj instanceof PDFRawStream ? obj.contents : s.getContents()
      context.assign(ref, PDFRawStream.of(s.dict, skip ? raw : await cipher(raw, ref, 'stm')))
    }
  }
  const info = context.trailerInfo as { Encrypt?: PDFObject; ID?: PDFObject }
  info.Encrypt = context.register(encryptDict)
  if (id) {
    info.ID = context.obj([PDFHexString.of(id[0]), PDFHexString.of(id[1])])
  } else if (!info.ID) {
    const h = PDFHexString.of(toHex(randomBytes(16)))
    info.ID = context.obj([h, h])
  }
  return serialize(context)
}

async function loadPlain(bytes: Uint8Array): Promise<PDFContext> {
  // a regular parse (object streams expanded); the output never uses them
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  if (encryptDictOf(doc.context)) throw new Error(tr('文档已加密'))
  return doc.context
}

/** write a plain document with the protection it had when it was opened */
export async function reapplySecurity(bytes: Uint8Array, sec: PreservedSecurity): Promise<Uint8Array> {
  const context = await loadPlain(bytes)
  const dict = context.obj({}) as PDFDict
  for (const [k, v] of sec.dict.entries())
    dict.set(k, v instanceof PDFDict || v instanceof PDFArray ? v.clone(context) : v)
  return encryptContext(context, makeEncryptor(sec.key, sec.stm, sec.str), dict, sec.id, sec.encryptMetadata)
}

/** encrypt with AES-256 (PDF 2.0 / Acrobat X+ compatible) */
export async function encryptPdf(bytes: Uint8Array, opts: EncryptOptions): Promise<Uint8Array> {
  const context = await loadPlain(bytes)
  const perms = opts.permissions ?? ALL_PERMISSIONS
  const P = pFromPermissions(perms)
  const fileKey = randomBytes(32)
  const zero = new Uint8Array(16)
  const upw = utf8Password(opts.userPassword)
  const opw = utf8Password(opts.ownerPassword || toHex(randomBytes(16)))
  const uvs = randomBytes(8)
  const uks = randomBytes(8)
  const U = concat(await hash2B(upw, uvs, new Uint8Array(0), 6), uvs, uks)
  const UE = await aesCbcEncryptNoPad(await hash2B(upw, uks, new Uint8Array(0), 6), zero, fileKey)
  const ovs = randomBytes(8)
  const oks = randomBytes(8)
  const O = concat(await hash2B(opw, ovs, U, 6), ovs, oks)
  const OE = await aesCbcEncryptNoPad(await hash2B(opw, oks, U, 6), zero, fileKey)
  const permsBlock = concat(le32(P), new Uint8Array([255, 255, 255, 255, 0x54, 0x61, 0x64, 0x62]), randomBytes(4))
  const Perms = await aesCbcEncryptNoPad(fileKey, zero, permsBlock)
  const encryptDict = context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    P,
    EncryptMetadata: true,
  }) as PDFDict
  encryptDict.set(PDFName.of('O'), PDFHexString.of(toHex(O)))
  encryptDict.set(PDFName.of('U'), PDFHexString.of(toHex(U)))
  encryptDict.set(PDFName.of('OE'), PDFHexString.of(toHex(OE)))
  encryptDict.set(PDFName.of('UE'), PDFHexString.of(toHex(UE)))
  encryptDict.set(PDFName.of('Perms'), PDFHexString.of(toHex(Perms)))
  return encryptContext(context, makeEncryptor(fileKey, 'aesv3', 'aesv3'), encryptDict, null, true)
}
