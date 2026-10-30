'use strict'
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const MAX_BYTES = 512 * 1024 * 1024
function trustedUrl(raw, indexFile, devUrl) {
  try {
    const url = new URL(raw)
    if (devUrl) {
      const dev = new URL(devUrl)
      return url.origin === dev.origin && (url.pathname === dev.pathname || url.pathname === '/index.html')
    }
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.resolve(indexFile)
  } catch {
    return false
  }
}
function trustedSender(event, window, indexFile, devUrl) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents) return false
  const frame = event.senderFrame,
    main = window.webContents.mainFrame
  return (
    !!frame &&
    frame.routingId === main.routingId &&
    frame.processId === main.processId &&
    trustedUrl(frame.url, indexFile, devUrl)
  )
}
function externalUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href
    if (url.protocol === 'mailto:' && url.pathname && !/%0[ad]/i.test(raw) && !/[\\]/.test(raw)) return url.href
  } catch {
    /* invalid URL */
  }
  return null
}
function endpointUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\u0000-\u0020\u007f]/.test(raw)) return false
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'https:' && url.hostname) return true
    // Plain HTTP is restricted to explicitly local / private network servers.
    return (
      url.protocol === 'http:' &&
      /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\]|10(?:\.[0-9]{1,3}){3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|[^/]+\.local)$/i.test(
        url.hostname,
      )
    )
  } catch {
    return false
  }
}
const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
const string = (v, max = 4096) => typeof v === 'string' && v.length <= max && !v.includes('\0')
const bytes = (v) =>
  (v instanceof Uint8Array || v instanceof ArrayBuffer) && v.byteLength > 0 && v.byteLength <= MAX_BYTES
const file = (v) => string(v) && path.isAbsolute(v) && /\.pdf$/i.test(v)
const fingerprint = (v) =>
  object(v) &&
  typeof v.sha256 === 'string' &&
  /^[a-f0-9]{64}$/i.test(v.sha256) &&
  Number.isFinite(v.size) &&
  v.size >= 0
function validRequest(channel, args) {
  const v = args[0]
  switch (channel) {
    case 'pdfpro:open-dialog':
    case 'pdfpro:get-recent':
    case 'pdfpro:consume-pending-open':
    case 'pdfpro:ocr-available':
    case 'pdfpro:local-ai-state':
    case 'pdfpro:local-ai-stop':
    case 'pdfpro:local-ai-reveal':
    case 'pdfpro:secret-load':
    case 'pdfpro:get-language':
      return args.length === 0
    case 'pdfpro:set-language':
      return args.length === 1 && ['en', 'zh-CN'].includes(v)
    case 'pdfpro:read-file':
    case 'pdfpro:open-recent':
    case 'pdfpro:authorize-dropped-file':
      return file(v)
    case 'pdfpro:check-file':
      return object(v) && file(v.path) && fingerprint(v.expected)
    case 'pdfpro:write-pdf':
      return object(v) && file(v.path) && bytes(v.data) && fingerprint(v.expected)
    case 'pdfpro:write-file':
      return object(v) && file(v.path) && bytes(v.data)
    case 'pdfpro:save-as':
      return object(v) && string(v.name, 1024) && bytes(v.data)
    case 'pdfpro:save-pdf-as':
      return (
        object(v) &&
        string(v.name, 1024) &&
        bytes(v.data) &&
        (!v.guard ||
          (object(v.guard) &&
            (!v.guard.path || file(v.guard.path)) &&
            (!v.guard.fingerprint || fingerprint(v.guard.fingerprint)) &&
            (!v.guard.otherOpenPaths ||
              (Array.isArray(v.guard.otherOpenPaths) &&
                v.guard.otherOpenPaths.length <= 500 &&
                v.guard.otherOpenPaths.every(file)))))
      )
    case 'pdfpro:save-file':
      return (
        object(v) &&
        string(v.name, 1024) &&
        bytes(v.data) &&
        string(v.filterName ?? '', 100) &&
        Array.isArray(v.extensions) &&
        v.extensions.length <= 20 &&
        v.extensions.every((s) => typeof s === 'string' && /^(?:[a-z0-9]{1,10}|\*)$/i.test(s))
      )
    case 'pdfpro:set-dirty':
    case 'pdfpro:close-response':
      return typeof v === 'boolean'
    case 'pdfpro:window-title':
      return string(v, 1024)
    case 'pdfpro:ai-abort':
      return string(v, 100) && /^[\w-]+$/.test(v)
    case 'pdfpro:local-ai-download':
    case 'pdfpro:local-ai-cancel':
    case 'pdfpro:local-ai-remove':
    case 'pdfpro:local-ai-start':
      return string(v, 100) && /^[a-z0-9-]+$/.test(v)
    case 'pdfpro:share':
      return object(v) && string(v.name, 1024) && bytes(v.data)
    case 'pdfpro:secret-save':
      return object(v) && string(v.apiKey, 16384) && (!v.apiKey || endpointUrl(v.endpoint))
    case 'pdfpro:open-external':
      return !!externalUrl(v)
    case 'pdfpro:print-pages':
      return (
        object(v) &&
        string(v.title, 1024) &&
        Array.isArray(v.pages) &&
        v.pages.length > 0 &&
        v.pages.length <= 2000 &&
        v.pages.every(
          (p) =>
            object(p) &&
            typeof p.src === 'string' &&
            /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+$/i.test(p.src) &&
            Number.isFinite(p.widthPt) &&
            p.widthPt > 0 &&
            p.widthPt < 100000 &&
            Number.isFinite(p.heightPt) &&
            p.heightPt > 0 &&
            p.heightPt < 100000,
        ) &&
        v.pages.reduce((n, p) => n + p.src.length, 0) <= MAX_BYTES
      )
    case 'pdfpro:ocr':
      return (
        object(v) &&
        Array.isArray(v.images) &&
        v.images.length > 0 &&
        v.images.length <= 2000 &&
        v.images.every(bytes) &&
        v.images.reduce((n, b) => n + b.byteLength, 0) <= MAX_BYTES
      )
    case 'pdfpro:ai-request': {
      if (
        !object(v) ||
        !string(v.id, 100) ||
        !/^[\w-]+$/.test(v.id) ||
        !['GET', 'POST'].includes(v.method) ||
        !string(v.body, 20 * 1024 * 1024) ||
        !object(v.headers)
      )
        return false
      const local =
        typeof v.url === 'string' && /^pdfpro-local:\/\/bundled\/v1\/(?:models|chat\/completions)$/.test(v.url)
      if (!local && !endpointUrl(v.url)) return false
      return Object.entries(v.headers).every(
        ([k, value]) => /^(?:content-type|authorization)$/i.test(k) && string(value, 16384) && !/[\r\n]/.test(value),
      )
    }
    default:
      return false
  }
}
module.exports = { trustedUrl, trustedSender, externalUrl, endpointUrl, validRequest }
