import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

/**
 * dev only: /ai-proxy/<encoded base url>/... is forwarded to that model
 * server (local OpenAI-compatible servers rarely send CORS headers).
 * The packaged app proxies through the Electron main process instead.
 */
function aiProxy(): Plugin {
  return {
    name: 'pdfpro-ai-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/ai-proxy\/([^/]+)(\/.*)$/.exec(req.url ?? '')
        if (!m) return next()
        // the encoded part is the full base url (incl. /v1)
        const base = decodeURIComponent(m[1]).replace(/\/+$/, '')
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        try {
          const headers: Record<string, string> = { 'content-type': 'application/json' }
          if (req.headers.authorization) headers.authorization = String(req.headers.authorization)
          // timeout only until the response starts (streams may run long)
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 20000)
          const up = await fetch(base + m[2], {
            redirect: 'error',
            method: req.method,
            headers,
            signal: ctrl.signal,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          })
          clearTimeout(timer)
          res.statusCode = up.status
          res.setHeader('content-type', up.headers.get('content-type') ?? 'application/json')
          if (!up.body) return res.end()
          const reader = up.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(Buffer.from(value))
          }
          res.end()
        } catch (e) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: { message: String(e) } }))
        }
      })
    },
  }
}

export default defineConfig({
  server: { watch: { ignored: ['**/website/**', '**/docs/**', '**/.scratch/**', '**/release/**'] } },
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion), '__SAIL_DEFAULT_LANGUAGE__': JSON.stringify(process.env.PDFPRO_TEST_LANGUAGE || 'en') },
  // relative base so the packaged Electron app can load assets via file://
  base: './',
  plugins: [react(), aiProxy(), {
    name: 'exclude-development-fixtures',
    apply: 'build',
    async closeBundle() { await rm(new URL('./dist/samples', import.meta.url), { recursive: true, force: true }) },
  }, {
    name: 'production-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' https: http:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
      return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`)
    },
  }],
  optimizeDeps: {
    include: ['pdfjs-dist', 'pdf-lib'],
  },
  worker: {
    format: 'es',
  },
})
