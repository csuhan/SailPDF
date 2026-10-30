import { tr, onLocaleChange } from '../i18n/locale'
/**
 * AI reader & editor panel (right side).
 * Answers carry clickable citations [p3#2] → jump + highlight; edit
 * requests come back as a plan card: preview → confirm → applied as one
 * undo step (or discarded).
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { beginAiRequest, cancelAiRequest, finishAiRequest, isAiRequestCurrent, useAiStore } from '../ai/aiStore'
import { QUICK_ACTIONS, runAgent, type AgentTurn, type ReplyStyle } from '../ai/agent'
import { applyPlan, type Plan } from '../ai/agentTools'
import { getDocIndex, type DocIndex } from '../ai/docIndex'
import {
  effectiveBase,
  isConfigured,
  isLocalEndpoint,
  listModels,
  loadAiSettings,
  normalizeBaseUrl,
  aiCredentialMessage,
  saveAiSettings,
  subscribeAiSettings,
  type AiSettings,
} from '../ai/client'
import { LocalModelPanel } from './LocalModelPanel'
import { getDesktop } from '../desktop/bridge'
import { jumpToPassage } from '../ai/flash'
import { notify } from '../utils/save'
import {
  IconAI,
  IconBroom,
  IconCheck,
  IconClose,
  IconCloud,
  IconLaptop,
  IconSend,
  IconSettings,
  IconStop,
} from './icons'

function createStyles(): [ReplyStyle, string][] {
  return [
    ['concise', tr('简洁')],
    ['expert', tr('专业')],
    ['simple', tr('通俗')],
  ]
}

let STYLES: [ReplyStyle, string][] = createStyles()

export function AiPanel() {
  const open = useAiStore((s) => s.open)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  if (!open || !pdfDoc) return null
  return <PanelInner />
}

function PanelInner() {
  const pdfDoc = useAppStore((s) => s.pdfDoc)!
  const turns = useAiStore((s) => s.turns)
  const busy = useAiStore((s) => s.busy)
  const style = useAiStore((s) => s.style)
  const selection = useAiStore((s) => s.selection)
  const pending = useAiStore((s) => s.pending)
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
  const [settingsRevision, setSettingsRevision] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')
  const [index, setIndex] = useState<DocIndex | null>(null)
  const [indexing, setIndexing] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const configured = isConfigured(settings)
  const base = effectiveBase(settings)
  const local = isLocalEndpoint(base)
  const bundled = settings.provider === 'bundled'
  useEffect(
    () =>
      subscribeAiSettings((value) => {
        setSettings(value)
        setSettingsRevision((revision) => revision + 1)
      }),
    [],
  )

  // build the passage index once per document (local, no network)
  useEffect(() => {
    let cancelled = false
    setIndex(null)
    void getDocIndex(pdfDoc, (d, t) => !cancelled && setIndexing(tr('正在建立索引 {0}/{1}', d, t)))
      .then((ix) => {
        if (cancelled) return
        setIndex(ix)
        setIndexing(null)
      })
      .catch((e) => {
        if (!cancelled) setIndexing(tr('无法读取文档：{0}', e instanceof Error ? e.message : String(e)))
      })
    return () => {
      cancelled = true
    }
  }, [pdfDoc])

  useEffect(() => () => cancelAiRequest(), [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns])

  const send = async (
    text: string,
    opts: { wholeDoc?: boolean; selection?: { text: string; page: number } | null } = {},
  ) => {
    const q = text.trim()
    if (!q || useAiStore.getState().busy) return
    const st = useAiStore.getState()
    const sel = opts.selection !== undefined ? opts.selection : st.selection
    const history = st.turns.filter((t) => !t.error)
    const userTurn: AgentTurn = {
      role: 'user',
      text: sel ? `${q}\n\n> ${sel.text.slice(0, 200)}${sel.text.length > 200 ? '…' : ''}` : q,
    }
    st.setTurns((t) => [...t, userTurn, { role: 'assistant', text: '', activity: [] }])
    st.setSelection(null)
    setInput('')
    const ctrl = beginAiRequest()
    try {
      await runAgent({
        settings,
        style: st.style,
        history,
        userText: q,
        selection: sel,
        wholeDoc: opts.wholeDoc,
        signal: ctrl.signal,
        onUpdate: (turn) => {
          if (isAiRequestCurrent(ctrl)) useAiStore.getState().setTurns((t) => [...t.slice(0, -1), turn])
        },
      })
    } catch (e) {
      if (isAiRequestCurrent(ctrl)) {
        const msg = e instanceof Error ? e.message : String(e)
        useAiStore.getState().setTurns((t) => {
          const last = t[t.length - 1]
          return [...t.slice(0, -1), { ...last, error: msg }]
        })
      }
    } finally {
      finishAiRequest(ctrl)
    }
  }

  // questions queued from the selection menu
  useEffect(() => {
    if (!pending || busy || !configured) return
    useAiStore.getState().clearPending()
    void send(pending.prompt, { selection: pending.selection })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, busy, configured])

  const decide = async (i: number, accept: boolean) => {
    const turn = useAiStore.getState().turns[i]
    if (!turn?.plan || turn.planState !== 'pending') return
    const update = (state: AgentTurn['planState'], error?: string) =>
      useAiStore
        .getState()
        .setTurns((t) =>
          t.map((x, k) =>
            k === i && x.plan === turn.plan ? { ...x, planState: state, ...(error ? { error } : {}) } : x,
          ),
        )
    // Disable confirmation before an export opens an asynchronous save dialog.
    update(accept ? 'applied' : 'rejected')
    if (accept) {
      try {
        const notes = await applyPlan(turn.plan)
        notify(notes.length ? notes.join('；') : tr('已应用 {0} 项修改，可用 ⌘Z 撤销', turn.plan.steps.length))
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        update('stale', message)
        notify(message, 'error')
      }
    }
  }

  const updateSettings = async (s: AiSettings) => {
    const persisted = await saveAiSettings(s)
    setSettings(loadAiSettings())
    if (!persisted) notify(aiCredentialMessage(), 'error')
  }

  return (
    <aside className="ai-panel" aria-label={tr('AI 助手')}>
      <header className="ai-head">
        <span className="ai-title">
          <IconAI size={16} />
          {tr(' AI 助手')}
        </span>
        {configured && (
          <span
            className={`ai-where ${local ? 'local' : 'cloud'}`}
            title={`${settings.model}\n${bundled ? tr('内置 llama.cpp，在这台电脑上运行，文档内容不会离开本机') : local ? tr('接口位于本机 / 局域网（{0}），文档上下文会发送至该接口，后续处理由该服务决定', base) : tr('会把任务所需的文档上下文发送到 {0}', base)}`}
          >
            {local ? <IconLaptop size={12} /> : <IconCloud size={12} />}
            {bundled ? tr('本机模型') : local ? tr('本地模型') : tr('云端模型')}
          </span>
        )}
        <span className="ai-spacer" />
        <button
          className="tb-btn"
          title={tr('清空对话')}
          aria-label={tr('清空对话')}
          disabled={busy || !turns.length}
          onClick={() => useAiStore.getState().setTurns(() => [])}
        >
          <IconBroom size={15} />
        </button>
        <button
          className={`tb-btn ${showSettings ? 'active' : ''}`}
          title={tr('AI 设置')}
          aria-label={tr('AI 设置')}
          disabled={!configured}
          onClick={() => setShowSettings((v) => !v)}
        >
          <IconSettings size={15} />
        </button>
        <button
          className="tb-btn"
          title={tr('关闭')}
          aria-label={tr('关闭 AI 助手')}
          onClick={() => useAiStore.getState().setOpen(false)}
        >
          <IconClose size={15} />
        </button>
      </header>

      {!configured ? (
        <div className="ai-setup">
          <div className="ai-setup-intro">
            <p className="ai-empty-title">{tr('选择 AI 模型')}</p>
            <p>
              {tr(
                '可以直接在这台电脑上运行 Gemma 4（内置 llama.cpp，首次使用下载模型），也可以连接任何 OpenAI 兼容接口。',
              )}
            </p>
          </div>
          <ProviderSettings
            key={settingsRevision}
            settings={settings}
            onChange={updateSettings}
            onDone={() => undefined}
            setup
          />
        </div>
      ) : (
        <>
          {showSettings && (
            <ProviderSettings
              key={settingsRevision}
              settings={settings}
              onChange={updateSettings}
              onDone={() => setShowSettings(false)}
            />
          )}

          <div className="ai-list" ref={listRef}>
            {turns.length === 0 && (
              <div className="ai-empty">
                <p className="ai-empty-title">{tr('问我关于这份文档的任何问题')}</p>
                <p className="ai-empty-sub">
                  {tr('回答会标注原文出处，点击可跳到对应位置。也可以直接说要怎么改，例如“把第 1 页的日期改成今天”。')}
                </p>
                <p className="ai-privacy">
                  {bundled
                    ? tr(
                        '处理方式：解析、检索和问答全部在这台电脑上完成（内置 llama.cpp），不联网。首次提问需要加载模型，稍等几秒。',
                      )
                    : local
                      ? tr(
                          '处理方式：解析和检索在本机进行，任务所需的文档上下文会发送到 {0}，后续数据处理由该服务决定。',
                          base,
                        )
                      : tr('处理方式：解析和检索在本机进行，任务所需的文档上下文会发送给 {0}。', new URL(base).host)}
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <Turn key={i} turn={t} index={index} onDecide={(ok) => void decide(i, ok)} />
            ))}
          </div>

          <div className="ai-quick" role="group" aria-label={tr('快捷操作')}>
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                className="chip"
                disabled={busy || !index}
                onClick={() => void send(a.prompt, { wholeDoc: a.wholeDoc })}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="ai-compose">
            {selection && (
              <div className="ai-sel">
                <span className="ai-sel-text">
                  {tr('第 ')}
                  {selection.page}
                  {tr(' 页：“')}
                  {selection.text.slice(0, 80)}
                  {selection.text.length > 80 ? '…' : ''}”
                </span>
                <button
                  className="tb-btn"
                  aria-label={tr('移除所选文字')}
                  title={tr('移除')}
                  onClick={() => useAiStore.getState().setSelection(null)}
                >
                  <IconClose size={12} />
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              placeholder={indexing ?? (selection ? tr('就所选文字提问…') : tr('提问，或描述要做的修改…'))}
              aria-label={tr('向 AI 提问')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(input)
                }
              }}
            />
            <div className="ai-compose-bar">
              <div className="seg small" role="group" aria-label={tr('回答风格')}>
                {STYLES.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    className={style === k ? 'active' : ''}
                    aria-pressed={style === k}
                    onClick={() => useAiStore.getState().setStyle(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <span className="ai-spacer" />
              {busy ? (
                <button
                  className="ai-send stop"
                  title={tr('停止')}
                  aria-label={tr('停止')}
                  onClick={() => cancelAiRequest()}
                >
                  <IconStop size={14} />
                </button>
              ) : (
                <button
                  className="ai-send"
                  title={tr('发送 (Enter)')}
                  aria-label={tr('发送')}
                  disabled={!input.trim() || !index}
                  onClick={() => void send(input)}
                >
                  <IconSend size={15} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

/**
 * AI model settings: two sources (bundled model / custom endpoint) with ONE
 * shared footer. Nothing changes until the user presses the main button;
 * the header always says which model is in use right now.
 */
export function ProviderSettings({
  settings,
  onChange,
  onDone,
  setup = false,
}: {
  settings: AiSettings
  onChange: (s: AiSettings) => void | Promise<void>
  onDone: () => void
  setup?: boolean
}) {
  const hasBundled = !!getDesktop()?.localAI
  const [tab, setTab] = useState<'bundled' | 'custom'>(
    settings.provider === 'custom' && settings.baseUrl ? 'custom' : hasBundled ? 'bundled' : 'custom',
  )
  const [localModel, setLocalModel] = useState(settings.provider === 'bundled' ? settings.model : '')
  // the custom form reports its draft (null = not usable yet)
  const [customDraft, setCustomDraft] = useState<AiSettings | null>(
    settings.provider === 'custom' && isConfigured(settings) ? settings : null,
  )
  const [language, setLanguage] = useState(settings.language)
  const [applying, setApplying] = useState(false)
  const local = useLocalAIState()
  // preselect an installed model
  useEffect(() => {
    if (localModel || !local) return
    const inst = local.models.find((m) => m.installed)
    if (inst) setLocalModel(inst.id)
  }, [local, localModel])

  const localInfo = local?.models.find((m) => m.id === localModel)
  const candidate: AiSettings | null =
    tab === 'bundled'
      ? localInfo?.installed
        ? { ...settings, provider: 'bundled', model: localModel, language }
        : null
      : customDraft
        ? { ...customDraft, provider: 'custom', language }
        : null
  const configured = isConfigured(settings)
  const same =
    !!candidate &&
    configured &&
    candidate.provider === settings.provider &&
    candidate.model === settings.model &&
    (candidate.provider === 'bundled' ||
      (normalizeBaseUrl(candidate.baseUrl) === normalizeBaseUrl(settings.baseUrl) &&
        candidate.apiKey === settings.apiKey))
  const languageChanged = language !== settings.language
  const why =
    tab === 'bundled'
      ? !local
        ? ''
        : !localModel
          ? tr('先下载并选择一个模型')
          : !localInfo?.installed
            ? tr('这个模型还没有下载完成')
            : ''
      : tr('先连接接口并选择模型')

  const apply = async () => {
    if (!candidate || applying) return
    setApplying(true)
    try {
      await onChange(candidate)
      onDone()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className={`ai-settings ${setup ? 'setup' : ''}`}>
      {configured && <CurrentModel settings={settings} />}
      <div className="seg ai-provider" role="tablist" aria-label={tr('模型来源')}>
        {hasBundled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bundled'}
            className={tab === 'bundled' ? 'active' : ''}
            onClick={() => setTab('bundled')}
          >
            {tr('本机模型')}
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'custom'}
          className={tab === 'custom' ? 'active' : ''}
          onClick={() => setTab('custom')}
        >
          {tr('自定义接口')}
        </button>
      </div>
      {tab === 'bundled' ? (
        <LocalModelPanel selected={localModel} onSelect={setLocalModel} />
      ) : (
        <CustomEndpointForm
          initial={
            settings.provider === 'custom'
              ? settings
              : { ...settings, provider: 'custom', model: '', baseUrl: '', apiKey: '' }
          }
          autoFetch={!setup && settings.provider === 'custom'}
          setup={setup}
          onDraft={setCustomDraft}
        />
      )}
      <label className="form-field">
        <span className="form-label">{tr('回答语言')}</span>
        <div className="seg small">
          {(
            [
              ['auto', tr('跟随提问')],
              ['zh', tr('中文')],
              ['en', 'English'],
            ] as [AiSettings['language'], string][]
          ).map(([k, l]) => (
            <button key={k} type="button" className={language === k ? 'active' : ''} onClick={() => setLanguage(k)}>
              {l}
            </button>
          ))}
        </div>
      </label>
      <div className="ai-settings-actions">
        {!setup && configured && (
          <button
            className="btn small"
            title={tr('停止使用当前模型，回到未连接状态')}
            onClick={async () => {
              await onChange({ ...settings, provider: 'custom', baseUrl: '', apiKey: '', model: '' })
              onDone()
            }}
          >
            {tr('断开')}
          </button>
        )}
        <span className="modal-spacer" />
        {!setup && (
          <button className="btn small" onClick={onDone}>
            {tr('取消')}
          </button>
        )}
        {same ? (
          languageChanged ? (
            <button className="btn small primary-solid" onClick={apply}>
              {tr('保存')}
            </button>
          ) : (
            <button className="btn small" disabled title={tr('当前正在使用这个模型')}>
              {tr('正在使用')}
            </button>
          )
        ) : (
          <button
            className="btn small primary-solid"
            disabled={!candidate || applying}
            title={candidate ? '' : why}
            onClick={apply}
          >
            {applying ? tr('正在保存…') : setup ? tr('开始使用') : tr('使用此模型')}
          </button>
        )}
      </div>
    </div>
  )
}

/** "当前使用：…" line at the top of the settings */
function CurrentModel({ settings }: { settings: AiSettings }) {
  const local = useLocalAIState()
  const bundled = settings.provider === 'bundled'
  const name = bundled ? (local?.models.find((m) => m.id === settings.model)?.name ?? settings.model) : settings.model
  const where = bundled
    ? tr('本机')
    : (() => {
        try {
          return new URL(normalizeBaseUrl(settings.baseUrl)).host
        } catch {
          return settings.baseUrl
        }
      })()
  return (
    <div
      className="ai-current"
      title={bundled ? tr('内置 llama.cpp，在这台电脑上运行') : normalizeBaseUrl(settings.baseUrl)}
    >
      <span className="ai-current-label">{tr('当前使用')}</span>
      <span className="ai-current-name">{name}</span>
      <span className="ai-current-where">{bundled ? tr('本机模型') : tr('自定义接口 · {0}', where)}</span>
    </div>
  )
}

function useLocalAIState() {
  const [st, setSt] = useState<import('../desktop/bridge').LocalAIState | null>(null)
  useEffect(() => {
    const api = getDesktop()?.localAI
    if (!api) return
    let active = true
    void api
      .state()
      .then((state) => {
        if (active) setSt(state)
      })
      .catch(() => {})
    const unsubscribe = api.onState((state) => {
      if (active) setSt(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return st
}

/**
 * Custom OpenAI-compatible endpoint: address → model list (or manual model
 * name). Only edits a draft; the shared footer applies it.
 */
function CustomEndpointForm({
  initial,
  autoFetch,
  setup,
  onDraft,
}: {
  initial: AiSettings
  autoFetch: boolean
  setup: boolean
  onDraft: (s: AiSettings | null) => void
}) {
  const settings = initial
  // edits stay local until "连接" / "保存": a half-typed address never
  // becomes the active configuration
  const [draft, setDraft] = useState<AiSettings>(settings)
  const [models, setModels] = useState<string[] | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' })
  const [manual, setManual] = useState(false)
  const base = normalizeBaseUrl(draft.baseUrl)

  const fetchModels = async (s = draft) => {
    if (!normalizeBaseUrl(s.baseUrl)) {
      setStatus({ kind: 'error', msg: tr('请填写接口地址，例如 http://127.0.0.1:8000/v1') })
      return
    }
    setStatus({ kind: 'loading' })
    try {
      const list = await listModels(s)
      setModels(list)
      if (!list.length) {
        setManual(true)
        setStatus({ kind: 'error', msg: tr('连接成功，但接口没有列出模型，请手动填写模型名称') })
        return
      }
      setManual(false)
      setStatus({ kind: 'ok', msg: tr('已连接，找到 {0} 个模型', list.length) })
      // keep the current choice when it is offered, else pick the first
      setDraft((d) => ({ ...d, model: list.includes(d.model) ? d.model : list[0] }))
    } catch (e) {
      setModels(null)
      setManual(true)
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  // existing configuration: show its model list right away
  useEffect(() => {
    if (autoFetch && normalizeBaseUrl(settings.baseUrl)) void fetchModels(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canSave = !!base && !!draft.model.trim()
  // report the usable draft to the shared footer
  useEffect(() => {
    onDraft(canSave ? { ...draft, baseUrl: base, model: draft.model.trim() } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.baseUrl, draft.apiKey, draft.model, canSave])

  return (
    <div className="ai-settings-body">
      <label className="form-field">
        <span className="form-label">{tr('接口地址')}</span>
        <div className="ai-url-row">
          <input
            className="form-input"
            placeholder="http://127.0.0.1:8000/v1"
            value={draft.baseUrl}
            spellCheck={false}
            autoFocus={setup}
            onChange={(e) => {
              setDraft({ ...draft, baseUrl: e.target.value, apiKey: '' })
              setModels(null)
              setStatus({ kind: 'idle' })
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void fetchModels()
            }}
          />
          <button
            className="btn small"
            disabled={status.kind === 'loading' || !draft.baseUrl.trim()}
            onClick={() => void fetchModels()}
          >
            {status.kind === 'loading' ? tr('连接中…') : models ? tr('刷新') : tr('连接')}
          </button>
        </div>
        {base && base !== draft.baseUrl.trim() && (
          <span className="form-hint">
            {tr('将使用 ')}
            {base}
          </span>
        )}
      </label>
      <p className="form-note" role="status">
        {aiCredentialMessage()}
      </p>
      <label className="form-field">
        <span className="form-label">{tr('API Key（本地模型通常不需要）')}</span>
        <input
          className="form-input"
          type="password"
          placeholder={tr('可留空')}
          value={draft.apiKey}
          autoComplete="off"
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void fetchModels()
          }}
        />
      </label>
      {status.msg && <p className={`ai-status ${status.kind}`}>{status.msg}</p>}
      {(models?.length || manual) && (
        <label className="form-field">
          <span className="form-label">
            {tr('模型')}
            {models && models.length > 0 && (
              <button type="button" className="link-btn small" onClick={() => setManual((v) => !v)}>
                {manual ? tr('从列表选择') : tr('手动填写')}
              </button>
            )}
          </span>
          {models && models.length > 0 && !manual ? (
            <select
              className="form-input"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="form-input"
              placeholder={tr('模型名称，例如 qwen2.5:14b')}
              value={draft.model}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !canSave) void fetchModels()
              }}
            />
          )}
        </label>
      )}
    </div>
  )
}

/** render model text: light markdown + citation chips */
function RichText({ text, index }: { text: string; index: DocIndex | null }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let table: string[][] = []
  const flushTable = (key: string) => {
    if (!table.length) return
    const rows = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())))
    out.push(
      <table key={key} className="ai-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (i === 0 ? <th key={j}>{inline(c, index)}</th> : <td key={j}>{inline(c, index)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>,
    )
    table = []
  }
  lines.forEach((ln, i) => {
    const t = ln.trim()
    if (/^\|.*\|$/.test(t)) {
      table.push(t.slice(1, -1).split('|'))
      return
    }
    flushTable(`t${i}`)
    if (!t) return
    const h = /^(#{1,4})\s+(.*)$/.exec(t)
    if (h)
      out.push(
        <p key={i} className="ai-h">
          {inline(h[2], index)}
        </p>,
      )
    else if (/^[-*•]\s+/.test(t))
      out.push(
        <p key={i} className="ai-li">
          {inline(t.replace(/^[-*•]\s+/, ''), index)}
        </p>,
      )
    else if (/^\d+[.)、]\s*/.test(t)) {
      const m = /^(\d+)[.)、]\s*(.*)$/.exec(t)!
      out.push(
        <p key={i} className="ai-li num" data-n={m[1]}>
          {inline(m[2], index)}
        </p>,
      )
    } else if (/^>\s?/.test(t))
      out.push(
        <p key={i} className="ai-quote">
          {inline(t.replace(/^>\s?/, ''), index)}
        </p>,
      )
    else out.push(<p key={i}>{inline(t, index)}</p>)
  })
  flushTable('tend')
  return <>{out}</>
}

function inline(s: string, index: DocIndex | null): React.ReactNode[] {
  const parts = s.split(/(\[p\d+#\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    const c = /^\[p(\d+)#(\d+)\]$/.exec(p)
    if (c) {
      const id = `p${c[1]}#${c[2]}`
      const passage = index?.passages.find((x) => x.id === id)
      return (
        <button
          key={i}
          className="cite"
          title={
            passage
              ? tr('第 {0} 页：{1}{2}', passage.page, passage.text.slice(0, 160), passage.text.length > 160 ? '…' : '')
              : id
          }
          onClick={() => passage && jumpToPassage(passage.page, passage.box)}
        >
          {c[1]}
        </button>
      )
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
    return <span key={i}>{p}</span>
  })
}

function Turn({ turn, index, onDecide }: { turn: AgentTurn; index: DocIndex | null; onDecide: (ok: boolean) => void }) {
  if (turn.role === 'user') {
    return (
      <div className="ai-msg user">
        <RichText text={turn.text} index={null} />
      </div>
    )
  }
  const thinking = !turn.text && !turn.error && !turn.plan
  return (
    <div className="ai-msg bot">
      {!!turn.activity?.length && (
        <ul className="ai-activity">
          {turn.activity.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {thinking && (
        <div className="ai-thinking">
          <div className="ai-typing" aria-label={tr('正在思考')}>
            <span />
            <span />
            <span />
          </div>
          <ServerLoadingHint />
        </div>
      )}
      {turn.text && <RichText text={turn.text} index={index} />}
      {turn.plan && <PlanCard plan={turn.plan} state={turn.planState ?? 'pending'} onDecide={onDecide} />}
      {turn.error && <p className="ai-error">{turn.error}</p>}
    </div>
  )
}

/** bundled model still loading into memory: say so (first answer takes longer) */
function ServerLoadingHint() {
  const st = useLocalAIState()
  if (st?.server.state !== 'starting') return null
  return <span className="ai-loading-hint">{tr('正在把模型加载到内存…')}</span>
}

function PlanCard({
  plan,
  state,
  onDecide,
}: {
  plan: Plan
  state: NonNullable<AgentTurn['planState']>
  onDecide: (ok: boolean) => void
}) {
  const ops = useEditStore((s) => s.ops)
  // undone after applying?
  const ids = plan.steps.flatMap((s) => s.ops.map((o) => o.id))
  const stillApplied = state === 'applied' && (ids.length === 0 || ids.some((id) => ops.some((o) => o.id === id)))
  return (
    <div className={`plan-card ${state}`}>
      <div className="plan-head">
        {state === 'pending'
          ? tr('待确认的修改（{0} 项）', plan.steps.length)
          : state === 'applied'
            ? stillApplied
              ? tr('已应用')
              : tr('已应用（已撤销）')
            : state === 'stale'
              ? tr('文档已变化，计划已失效')
              : tr('已放弃')}
      </div>
      <ul className="plan-steps">
        {plan.steps.map((s, i) => (
          <li key={i}>
            <button
              className="plan-step"
              disabled={!s.ref}
              title={s.ref ? tr('在页面上查看位置') : undefined}
              onClick={() => s.ref && jumpToPassage(s.ref, null, s.boxes)}
            >
              <span className="plan-title">{s.title}</span>
              {s.before !== undefined && (
                <span className="plan-diff">
                  <span className="d-del">{s.before}</span>
                  <span className="d-add">{s.after}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {state === 'pending' && (
        <div className="plan-actions">
          <button className="btn small" onClick={() => onDecide(false)}>
            {tr('放弃')}
          </button>
          <button className="btn small primary" onClick={() => onDecide(true)}>
            <IconCheck size={13} />
            {tr(' 应用修改')}
          </button>
        </div>
      )}
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  STYLES = createStyles()
})
