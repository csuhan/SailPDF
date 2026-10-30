import { tr, onLocaleChange } from '../i18n/locale'
/**
 * 本机模型 (bundled llama.cpp): pick a Gemma 4 size, download the weights on
 * first use (resumable, verified), see whether the engine runs.
 */
import { useSettingsStore } from '../state/settingsStore'
import { useEffect, useState } from 'react'
import { getDesktop, type LocalAIState, type LocalModelInfo } from '../desktop/bridge'
import { IconDownload, IconTrash } from './icons'

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`
const mbps = (n: number) => (n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB/s` : `${Math.round(n / 1024)} KB/s`)
const eta = (left: number, bps: number) => {
  if (!bps) return ''
  const s = Math.round(left / bps)
  return s > 3600
    ? tr('约 {0} 小时', Math.round(s / 360) / 10)
    : s > 60
      ? tr('约 {0} 分钟', Math.round(s / 60))
      : tr('约 {0} 秒', s)
}

function useLocalAI(): { state: LocalAIState | null; error: string } {
  const [st, setSt] = useState<LocalAIState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const api = getDesktop()?.localAI
    if (!api) return
    let active = true
    void api.state().then(
      (state) => {
        if (active) setSt(state)
      },
      () => {
        if (active) setError(tr('无法读取本机模型，请稍后重新打开设置。'))
      },
    )
    const unsubscribe = api.onState((state) => {
      if (active) {
        setSt(state)
        setError('')
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return { state: st, error }
}

function createServerLabel(): Record<LocalAIState['server']['state'], string> {
  return {
    stopped: tr('未运行（提问时自动启动）'),
    starting: tr('正在加载模型…'),
    ready: tr('运行中'),
    stopping: tr('正在停止…'),
    crashed: tr('已停止（出错）'),
  }
}

let SERVER_LABEL: Record<LocalAIState['server']['state'], string> = createServerLabel()

export function LocalModelPanel({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const api = getDesktop()?.localAI
  const { state: st, error } = useLocalAI()
  if (!api) {
    return (
      <p className="form-note">{tr('本机模型需要桌面版 Sail PDF（内置 llama.cpp）。网页版请使用“自定义接口”。')}</p>
    )
  }
  if (error)
    return (
      <p className="ai-status error" role="alert">
        {error}
      </p>
    )
  if (!st) return <p className="form-note">{tr('正在读取本机模型…')}</p>
  if (!st.engine) return <p className="ai-status error">{tr('安装包中缺少 llama.cpp 引擎，请重新安装 Sail PDF。')}</p>
  const srv = st.server
  return (
    <div className="local-models">
      <ul className="lm-list">
        {st.models.map((m) => (
          <ModelRow
            key={m.id}
            m={m}
            selected={selected === m.id}
            running={srv.modelId === m.id ? srv.state : null}
            onSelect={() => onSelect(m.id)}
          />
        ))}
      </ul>
      <div className="lm-status">
        <span className={`lm-dot ${srv.state}`} />
        <span>
          {tr('引擎 llama.cpp · ')}
          {SERVER_LABEL[srv.state]}
          {srv.state === 'ready' && srv.modelId
            ? ` · ${st.models.find((x) => x.id === srv.modelId)?.name ?? srv.modelId}`
            : ''}
        </span>
        <span className="ai-spacer" />
        {(srv.state === 'ready' || srv.state === 'starting') && (
          <button className="link-btn small" onClick={() => void api.stop()} title={tr('释放模型占用的内存')}>
            {tr('停止')}
          </button>
        )}
        <button className="link-btn small" onClick={() => void api.reveal()} title={st.modelDir}>
          {tr('模型文件夹')}
        </button>
      </div>
      {srv.state === 'crashed' && srv.error && <pre className="lm-error">{srv.error}</pre>}
      <button className="link-btn small" onClick={() => useSettingsStore.getState().openSettings('help')}>
        {tr('查看隐私与模型许可')}
      </button>
      <p className="lm-directory">
        {tr('模型位置：')}
        <span>{st.modelDir}</span>
      </p>
      <p className="form-note">
        {tr(
          '模型在这台电脑上运行，文档内容不会发送到网络。首次使用需下载一次模型权重（来自 Hugging Face，下载后校验完整性），本机内存 ',
        )}
        {st.ramGB}
        {tr(' GB。空闲 15 分钟后自动释放内存。')}
      </p>
    </div>
  )
}

function ModelRow({
  m,
  selected,
  running,
  onSelect,
}: {
  m: LocalModelInfo
  selected: boolean
  running: string | null
  onSelect: () => void
}) {
  const api = getDesktop()!.localAI!
  const d = m.download
  const downloading = !!d?.active
  const pct = d ? Math.floor((d.done / d.total) * 100) : m.partial ? Math.floor((m.partial / m.size) * 100) : 0
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setConfirmDelete(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('操作未完成，请重试。'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className={`lm-row ${selected ? 'selected' : ''} ${m.installed ? 'installed' : ''}`}>
      <label className="lm-main">
        <input type="radio" name="local-model" checked={selected} disabled={!m.installed} onChange={onSelect} />
        <span className="lm-text">
          <span className="lm-name">
            {m.name}
            {m.recommended && <span className="lm-tag">{tr('推荐')}</span>}
            {running === 'ready' && <span className="lm-tag on">{tr('运行中')}</span>}
          </span>
          <span className="lm-desc">
            {tr(m.desc)} · {gb(m.size)}
            {!m.fits && <span className="lm-warn">{tr(' · 本机内存可能不足')}</span>}
          </span>
        </span>
      </label>
      <div className="lm-actions">
        {m.installed ? (
          <button
            className="tb-btn"
            title={tr('删除模型文件')}
            aria-label={tr('删除 {0}', m.name)}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <IconTrash size={14} />
          </button>
        ) : downloading ? (
          <button className="btn small" disabled={busy} onClick={() => void run(() => api.cancel(m.id))}>
            {tr('暂停')}
          </button>
        ) : (
          <button className="btn small" disabled={busy} onClick={() => void run(() => api.download(m.id))}>
            <IconDownload size={13} /> {m.partial ? tr('继续下载') : tr('下载')}
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="lm-confirm" role="alertdialog" aria-label={tr('确认删除 {0}', m.name)}>
          <p>
            {tr('删除“')}
            {m.name}
            {tr('”的模型文件？之后仍可重新下载，PDF 文件不受影响。')}
          </p>
          <button className="btn small" disabled={busy} onClick={() => setConfirmDelete(false)}>
            {tr('取消')}
          </button>
          <button className="btn small" disabled={busy} onClick={() => void run(() => api.remove(m.id))}>
            {busy ? tr('正在删除…') : tr('确认删除模型')}
          </button>
        </div>
      )}
      {error && (
        <p className="lm-error" role="alert">
          {error}
        </p>
      )}
      {(downloading || (!m.installed && (m.partial > 0 || d?.error))) && (
        <div className="lm-progress">
          <div className="opt-bar">
            <span style={{ width: `${Math.max(1, pct)}%` }} />
          </div>
          <span className="lm-progress-text">
            {d?.error ? (
              <span className="lm-warn">{d.error}</span>
            ) : downloading ? (
              `${pct}% · ${gb(d!.done)} / ${gb(d!.total)} · ${mbps(d!.bps)} ${eta(d!.total - d!.done, d!.bps)}`
            ) : (
              tr('已下载 {0}%，可继续', pct)
            )}
          </span>
        </div>
      )}
    </li>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  SERVER_LABEL = createServerLabel()
})
