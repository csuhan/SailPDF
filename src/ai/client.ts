import { tr } from '../i18n/locale'
/**
 * OpenAI-compatible chat client. Everything document-related is processed
 * locally; only the text that a request explicitly needs is sent to the
 * configured model endpoint (shown to the user as "云端 / 本地模型").
 */
import { getDesktop } from '../desktop/bridge'

export interface AiSettings {
  /** 'bundled' = the model shipped with the app (llama.cpp), 'custom' = any OpenAI-compatible endpoint */
  provider: 'bundled' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  /** reply language / style defaults */
  language: 'auto' | 'zh' | 'en'
}

const KEY = 'pdfpro.ai'
const settingsListeners = new Set<(settings: AiSettings) => void>()
let volatileSettings: AiSettings | null = null
/** nothing is preset: the user points the app at their own endpoint */
export const EMPTY_AI: AiSettings = {
  provider: 'custom',
  baseUrl: '',
  apiKey: '',
  model: '',
  language: 'auto',
}

let credentialMessage = ''
let initialized = false
let secretRevision = 0
export function aiCredentialMessage(): string {
  return (
    credentialMessage ||
    (getDesktop()?.secrets
      ? tr('API Key 使用系统安全存储加密保存，不写入普通设置。')
      : tr('网页版 API Key 仅保留在本次会话内，刷新后需要重新输入。'))
  )
}
function cleanSettings(value: Partial<AiSettings>): AiSettings {
  return {
    provider: value?.provider === 'bundled' ? 'bundled' : 'custom',
    baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : '',
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : '',
    model: typeof value?.model === 'string' ? value.model : '',
    language: value?.language === 'zh' || value?.language === 'en' ? value.language : 'auto',
  }
}
function readStored(): AiSettings {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { ...EMPTY_AI }
  }
}
function persistMetadata(settings: AiSettings): boolean {
  const { apiKey: _secret, ...metadata } = settings
  try {
    localStorage.setItem(KEY, JSON.stringify(metadata))
    return true
  } catch {
    // A failed migration must not leave the old cleartext credential behind.
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* unavailable storage */
    }
    return false
  }
}
export function loadAiSettings(): AiSettings {
  return { ...(volatileSettings ?? readStored()), apiKey: volatileSettings?.apiKey ?? '' }
}
/** Before rendering, migrate legacy cleartext keys, then remove them from preferences. */
export async function initializeAiSettings(): Promise<void> {
  if (initialized) return
  initialized = true
  const stored = readStored(),
    desktop = getDesktop(),
    revision = secretRevision
  let settings = stored
  if (desktop?.secrets) {
    try {
      if (stored.apiKey) {
        const saved = await desktop.secrets.save({ apiKey: stored.apiKey, endpoint: normalizeBaseUrl(stored.baseUrl) })
        if (!saved.ok) credentialMessage = saved.message ?? tr('API Key 仅在本次会话使用，未能安全保存。')
      } else {
        const saved = await desktop.secrets.load()
        if (saved.error) credentialMessage = saved.error
        if (saved.apiKey && saved.endpoint === normalizeBaseUrl(stored.baseUrl))
          settings = { ...stored, apiKey: saved.apiKey }
      }
    } catch {
      credentialMessage = tr('安全存储暂时不可用，API Key 仅在本次会话使用。')
    }
  } else if (stored.apiKey) credentialMessage = tr('旧 API Key 已从普通设置移除，仅在本次会话保留。刷新后请重新输入。')
  // No plaintext fallback, including when the system keychain is unavailable.
  persistMetadata(stored)
  if (revision === secretRevision) volatileSettings = settings
}
export async function saveAiSettings(value: AiSettings): Promise<boolean> {
  secretRevision++
  const settings = cleanSettings(value),
    desktop = getDesktop()
  let protectedSaved = true
  if (desktop?.secrets) {
    try {
      const result = await desktop.secrets.save({
        apiKey: settings.apiKey,
        endpoint: normalizeBaseUrl(settings.baseUrl),
      })
      protectedSaved = result.ok
      credentialMessage = result.ok ? '' : (result.message ?? tr('API Key 仅在本次会话使用，未能安全保存。'))
    } catch {
      protectedSaved = false
      credentialMessage = tr('安全存储暂时不可用，API Key 仅在本次会话使用。')
    }
  }
  const persisted = persistMetadata(settings)
  if (!persisted && protectedSaved) credentialMessage = tr('配置已在本次会话应用，但本机设置未能写入；请稍后重试。')
  volatileSettings = settings
  for (const listener of settingsListeners) listener({ ...settings })
  return persisted && protectedSaved
}

/** Keep the global settings page and an already open assistant in sync. */
export function subscribeAiSettings(listener: (settings: AiSettings) => void): () => void {
  settingsListeners.add(listener)
  return () => {
    settingsListeners.delete(listener)
  }
}

/** virtual endpoint of the bundled model; only the main process can serve it */
export const BUNDLED_BASE = 'pdfpro-local://bundled/v1'

export function isConfigured(s: AiSettings): boolean {
  if (s.provider === 'bundled') return !!s.model.trim()
  return !!normalizeBaseUrl(s.baseUrl) && !!s.model.trim()
}

/** base url actually used for a configuration */
export function effectiveBase(s: AiSettings): string {
  return s.provider === 'bundled' ? BUNDLED_BASE : normalizeBaseUrl(s.baseUrl)
}

/**
 * Accept host names, local HTTP servers, and HTTPS completion URLs.
 * A missing version segment gets /v1 (the OpenAI-compatible convention).
 */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim()
  if (!u) return ''
  if (u.startsWith('pdfpro-local://')) return BUNDLED_BASE
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `${isLocalHost(u) ? 'http' : 'https'}://${u}`
  u = u.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models)$/i, '')
  try {
    const url = new URL(u)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol === 'http:' && !isLocalHost(url.hostname))
    )
      return ''
    if (!/\/v\d+[a-z]*$/i.test(url.pathname.replace(/\/+$/, '')))
      url.pathname = url.pathname.replace(/\/+$/, '') + '/v1'
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function isLocalHost(hostish: string): boolean {
  try {
    const host = new URL(`http://${hostish}`).hostname
    return /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\]|10(?:\.[0-9]{1,3}){3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|[^/]+\.local)$/i.test(
      host,
    )
  } catch {
    return false
  }
}

/** Classify the configured host; a custom server controls its own processing. */
export function isLocalEndpoint(url: string): boolean {
  if (url.startsWith('pdfpro-local://')) return true
  try {
    return isLocalHost(new URL(url).hostname)
  } catch {
    return false
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
}

let reqSeq = 0
const noTemperature = new Set<string>()

/**
 * transport: desktop main-process proxy, dev-server proxy, or direct fetch.
 * `path` is relative to the base url (e.g. "/chat/completions").
 */
async function request(
  settings: AiSettings,
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const base = effectiveBase(settings)
  if (!base) throw new Error(tr('还没有设置 AI 接口地址'))
  if (base === BUNDLED_BASE && !getDesktop()?.aiRequest) throw new Error(tr('本机模型只能在桌面版中使用'))
  const url = base + path
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  const desktop = getDesktop()
  if (desktop?.aiRequest) {
    const id = `ai-${Date.now()}-${reqSeq++}`
    const onAbort = () => desktop.aiAbort?.(id)
    signal?.addEventListener('abort', onAbort)
    try {
      const r = await desktop.aiRequest(
        { id, url, method, headers, body: method === 'POST' ? JSON.stringify(body) : '' },
        onChunk,
      )
      signal?.throwIfAborted()
      if (!r.ok) throw new Error(httpError(r.status, r.text))
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    return
  }
  // browser: the dev server proxies (local model servers send no CORS headers)
  const target = import.meta.env.DEV ? `/ai-proxy/${encodeURIComponent(base)}${path}` : url
  const res = await fetch(target, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal,
    redirect: 'error',
  })
  if (!res.ok || !res.body) throw new Error(httpError(res.status, await res.text().catch(() => '')))
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(dec.decode(value, { stream: true }))
  }
}

/** models offered by the endpoint (OpenAI-compatible GET /models) */
export async function listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
  let text = ''
  await request(settings, '/models', 'GET', null, (c) => (text += c), signal)
  let j: { data?: { id?: string }[]; models?: ({ id?: string; name?: string } | string)[] }
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error(tr('接口没有返回模型列表（不是 OpenAI 兼容的 /models 接口），请手动填写模型名称'))
  }
  const ids = [
    ...(j.data ?? []).map((m) => m.id),
    // some servers (e.g. Ollama-style) use "models"
    ...(j.models ?? []).map((m) => (typeof m === 'string' ? m : (m.id ?? m.name))),
  ].filter((x): x is string => !!x)
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b))
}

function httpError(status: number, text?: string): string {
  let msg = text ?? ''
  try {
    const j = JSON.parse(msg)
    msg = j.error?.message ?? msg
  } catch {
    /* raw text */
  }
  if (status === 0) return tr('无法连接 AI 服务：{0}（请检查接口地址）', msg || tr('网络错误'))
  if (status === 401 || status === 403) return tr('AI 服务拒绝访问（{0}）：请检查 API Key', status)
  if (status === 404) return tr('接口地址不正确（404）{0}', msg ? `：${msg.slice(0, 120)}` : '')
  return tr('AI 服务返回错误 {0}{1}', status, msg ? `：${msg.slice(0, 200)}` : '')
}

/**
 * Streamed chat completion. `onDelta` receives the content text as it grows
 * (tool call arguments are assembled and returned at the end).
 */
export async function chat(
  settings: AiSettings,
  messages: ChatMessage[],
  opts: {
    tools?: ToolDef[]
    onDelta?: (full: string) => void
    signal?: AbortSignal
    temperature?: number
    maxTokens?: number
  } = {},
): Promise<ChatResult> {
  let buf = ''
  let content = ''
  const calls = new Map<number, ToolCall>()
  const handleLine = (line: string) => {
    const t = line.trim()
    if (!t.startsWith('data:')) return
    const data = t.slice(5).trim()
    if (!data || data === '[DONE]') return
    let j: {
      choices?: {
        delta?: {
          content?: string | null
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
      error?: { message?: string }
    }
    try {
      j = JSON.parse(data)
    } catch {
      return
    }
    if (j.error) throw new Error(j.error.message ?? tr('AI 错误'))
    const d = j.choices?.[0]?.delta
    if (!d) return
    if (d.content) {
      content += d.content
      opts.onDelta?.(content)
    }
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? 0
      const cur = calls.get(i) ?? {
        id: tc.id ?? `call_${i}`,
        type: 'function' as const,
        function: { name: '', arguments: '' },
      }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.function.name += tc.function.name
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
      calls.set(i, cur)
    }
  }
  if (!settings.model.trim()) throw new Error(tr('还没有选择模型，请在 AI 设置里选择或填写'))
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
  }
  // some models only accept their default sampling settings: remember that
  if (!noTemperature.has(settings.model)) body.temperature = opts.temperature ?? 0.3
  const send = () =>
    request(
      settings,
      '/chat/completions',
      'POST',
      body,
      (chunk) => {
        buf += chunk
        let nl = buf.indexOf('\n')
        while (nl >= 0) {
          handleLine(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
          nl = buf.indexOf('\n')
        }
      },
      opts.signal,
    )
  try {
    await send()
  } catch (e) {
    if (body.temperature !== undefined && /temperature/i.test(String(e))) {
      noTemperature.add(settings.model)
      delete body.temperature
      buf = ''
      await send()
    } else throw e
  }
  if (buf) handleLine(buf)
  return { content, toolCalls: Array.from(calls.values()) }
}
