import { tr, onLocaleChange } from '../i18n/locale'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HelpSettings } from './HelpSettings'
import { useSettingsStore, type SettingsSection } from '../state/settingsStore'
import { usePreferences } from '../state/preferences'
import { useTheme } from '../state/theme'
import { clearAllDrafts, listDrafts, removeDraft, type DraftSummary } from '../utils/autosave'
import {
  isConfigured,
  loadAiSettings,
  saveAiSettings,
  aiCredentialMessage,
  subscribeAiSettings,
  type AiSettings,
} from '../ai/client'
import { ProviderSettings } from './AiPanel'
import { getDesktop } from '../desktop/bridge'
import { IconAI, IconBook, IconClose, IconInfo, IconSave, IconSettings, IconTrash } from './icons'
import '../styles/settings.css'
import { setLocale, getLocale } from '../i18n/locale'
import { useLocale } from '../i18n/react'
import { BrandMark } from './BrandMark'

function createSections(): { id: SettingsSection; label: string; icon: ReactNode }[] {
  return [
    { id: 'appearance', label: tr('外观与阅读'), icon: <IconBook size={17} /> },
    { id: 'saving', label: tr('保存与恢复'), icon: <IconSave size={17} /> },
    { id: 'ai', label: tr('AI 与本地资源'), icon: <IconAI size={17} /> },
    { id: 'help', label: tr('帮助与反馈'), icon: <IconBook size={17} /> },
    { id: 'about', label: tr('快捷键与关于'), icon: <IconInfo size={17} /> },
  ]
}

let SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = createSections()

export function SettingsDialog() {
  const open = useSettingsStore((s) => s.open)
  return open ? <SettingsContent /> : null
}

function SettingsContent() {
  const section = useSettingsStore((s) => s.section)
  const dialog = useRef<HTMLDivElement>(null)
  const close = () => {
    if (document.activeElement instanceof HTMLElement && dialog.current?.contains(document.activeElement))
      document.activeElement.blur()
    useSettingsStore.getState().closeSettings()
  }
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const cancel = dialog.current?.querySelector<HTMLButtonElement>('[data-cancel-draft-confirmation]')
        if (cancel) {
          cancel.click()
          return
        }
        close()
      } else if (event.key === 'Tab') {
        const items = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
          ) ?? [],
        ).filter((item) => item.offsetParent !== null)
        const first = items[0],
          last = items[items.length - 1]
        if (!first) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialog}>
        <header className="settings-header">
          <div className="settings-heading">
            <IconSettings size={20} />
            <h2 id="settings-title">{tr('设置')}</h2>
          </div>
          <button className="tb-btn" aria-label={tr('关闭设置')} title={tr('关闭设置 (Esc)')} onClick={close}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" role="tablist" aria-label={tr('设置分类')} aria-orientation="vertical">
            {SECTIONS.map((item, index) => (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                type="button"
                role="tab"
                aria-selected={section === item.id}
                aria-controls="settings-content"
                className={section === item.id ? 'active' : ''}
                onClick={() => useSettingsStore.getState().setSection(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                  event.preventDefault()
                  const next =
                    SECTIONS[(index + (event.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length]
                  useSettingsStore.getState().setSection(next.id)
                  document.getElementById(`settings-nav-${next.id}`)?.focus()
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <main
            id="settings-content"
            className="settings-content"
            role="tabpanel"
            aria-labelledby={`settings-nav-${section}`}
          >
            {section === 'appearance' && <AppearanceSettings />}
            {section === 'saving' && <SavingSettings />}
            {section === 'ai' && <AiSettingsSection />}
            {section === 'about' && <AboutSettings />}
            {section === 'help' && <HelpSettings />}
          </main>
        </div>
        <footer className="settings-footer">
          <span>
            {section === 'ai' ? tr('选择模型后，点击“使用此模型”应用。') : tr('偏好更改会自动保存到这台设备。')}
          </span>
          <button className="btn primary" onClick={close}>
            {tr('完成')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{title}</div>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function AppearanceSettings() {
  const locale = useLocale()
  const p = usePreferences()
  const theme = useTheme()
  const scales = [...new Set([0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, p.defaultScale])].sort((a, b) => a - b)
  return (
    <>
      <h3>{tr('外观与阅读')}</h3>
      <p className="settings-intro">{tr('选择适合自己的阅读方式。阅读默认值会在下次打开文档时生效。')}</p>
      <SettingRow title={tr('界面语言')} description={tr('切换界面和菜单语言，不会更改文档、批注或输入的内容。')}>
        <select
          className="form-input"
          aria-label={tr('界面语言')}
          value={locale}
          onChange={(event) => setLocale(event.target.value as 'en' | 'zh-CN')}
        >
          <option value="en">English</option>
          <option value="zh-CN">{tr('简体中文')}</option>
        </select>
      </SettingRow>
      <SettingRow title={tr('外观')} description={tr('选择界面明暗；纸张颜色可在下方单独设置。')}>
        <select
          className="form-input"
          aria-label={tr('外观主题')}
          value={theme.preference}
          onChange={(event) => theme.setPreference(event.target.value as typeof theme.preference)}
        >
          <option value="system">{tr('跟随系统')}</option>
          <option value="light">{tr('浅色')}</option>
          <option value="dark">{tr('深色')}</option>
        </select>
      </SettingRow>
      <SettingRow title={tr('界面配色')} description={tr('仅调整按钮、选中状态等界面强调色。')}>
        <div className="palette-options" role="group" aria-label={tr('界面配色')}>
          {(
            [
              ['blue', tr('专业蓝')],
              ['graphite', tr('石墨灰')],
              ['forest', tr('松林绿')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`palette-option palette-${value}`}
              aria-pressed={p.palette === value}
              onClick={() => p.setPreferences({ palette: value })}
            >
              <i />
              {label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        title={tr('阅读底色')}
        description={tr(
          '立即生效，仅改变屏幕显示，不影响 PDF 保存、打印或导出。彩色图片也会随显示模式变化，核对颜色时请选择原色。',
        )}
      >
        <select
          className="form-input"
          aria-label={tr('阅读底色')}
          value={p.readingColor}
          onChange={(event) => p.setPreferences({ readingColor: event.target.value as typeof p.readingColor })}
        >
          <option value="auto">{tr('跟随界面明暗')}</option>
          <option value="original">{tr('原色')}</option>
          <option value="warm">{tr('暖纸')}</option>
          <option value="green">{tr('护眼绿')}</option>
          <option value="dark">{tr('深色阅读')}</option>
        </select>
      </SettingRow>
      <SettingRow title={tr('默认页面布局')}>
        <select
          className="form-input"
          aria-label={tr('默认页面布局')}
          value={p.defaultViewMode}
          onChange={(event) => p.setPreferences({ defaultViewMode: event.target.value as typeof p.defaultViewMode })}
        >
          <option value="continuous">{tr('连续滚动')}</option>
          <option value="single">{tr('单页')}</option>
          <option value="spread">{tr('双页')}</option>
        </select>
      </SettingRow>
      <SettingRow title={tr('打开文档时的缩放')}>
        <select
          className="form-input"
          aria-label={tr('默认缩放方式')}
          value={p.defaultFitMode}
          onChange={(event) => p.setPreferences({ defaultFitMode: event.target.value as typeof p.defaultFitMode })}
        >
          <option value="fit-width">{tr('适合宽度')}</option>
          <option value="fit-page">{tr('适合页面')}</option>
          <option value="custom">{tr('固定比例')}</option>
        </select>
      </SettingRow>
      {p.defaultFitMode === 'custom' && (
        <SettingRow title={tr('固定缩放比例')}>
          <select
            className="form-input"
            aria-label={tr('默认缩放比例')}
            value={p.defaultScale}
            onChange={(event) => p.setPreferences({ defaultScale: Number(event.target.value) })}
          >
            {scales.map((scale) => (
              <option key={scale} value={scale}>
                {Math.round(scale * 100)}%
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      <SettingRow title={tr('打开时恢复上次阅读位置')} description={tr('再次打开同一份文档时，回到上次阅读的页面。')}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={tr('打开时恢复上次阅读位置')}
            checked={p.restorePosition}
            onChange={(event) => p.setPreferences({ restorePosition: event.target.checked })}
          />
          <span>{p.restorePosition ? tr('已开启') : tr('已关闭')}</span>
        </label>
      </SettingRow>
    </>
  )
}

function SavingSettings() {
  const p = usePreferences()
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<DraftSummary | 'all' | null>(null)
  const [busy, setBusy] = useState(false)
  const [suffix, setSuffix] = useState(p.copySuffix)
  const suffixRef = useRef(suffix)
  suffixRef.current = suffix
  useEffect(() => () => usePreferences.getState().setPreferences({ copySuffix: suffixRef.current }), [])
  const intervals = [...new Set([1000, 2500, 5000, 10000, 30000, 60000, p.autosaveIntervalMs])].sort((a, b) => a - b)
  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      setDrafts(await listDrafts())
    } catch {
      setError(tr('无法读取恢复草稿，请重试。'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  const remove = async () => {
    if (!confirm) return
    setBusy(true)
    const ok = await (confirm === 'all' ? clearAllDrafts() : removeDraft(confirm.key))
    if (ok) {
      setConfirm(null)
      await refresh()
    } else setError(tr('未能删除恢复草稿，请重试。'))
    setBusy(false)
  }
  const commitSuffix = () => {
    p.setPreferences({ copySuffix: suffix })
    setSuffix(usePreferences.getState().copySuffix)
  }
  return (
    <>
      <h3>{tr('保存与恢复')}</h3>
      <p className="settings-intro">{tr('恢复草稿用于意外退出后找回编辑操作，不会自动覆盖原文件。')}</p>
      <SettingRow
        title={tr('自动保存恢复草稿')}
        description={tr('将文字、批注、页面编辑与表单值保存在本机；切换文档时也会保存恢复草稿。')}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={tr('自动保存恢复草稿')}
            checked={p.autosaveEnabled}
            onChange={(event) => p.setPreferences({ autosaveEnabled: event.target.checked })}
          />
          <span>{p.autosaveEnabled ? tr('已开启') : tr('已关闭')}</span>
        </label>
      </SettingRow>
      <SettingRow title={tr('编辑后的备份等待时间')} description={tr('停止编辑后，等待这段时间再保存恢复草稿。')}>
        <select
          className="form-input"
          aria-label={tr('恢复草稿保存间隔')}
          disabled={!p.autosaveEnabled}
          value={p.autosaveIntervalMs}
          onChange={(event) => p.setPreferences({ autosaveIntervalMs: Number(event.target.value) })}
        >
          {intervals.map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000}
              {tr(' 秒')}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        title={tr('编辑副本名称后缀')}
        description={tr('例如：document{0}.pdf。保存时仍可选择其他名称。', p.copySuffix)}
      >
        <input
          className="form-input"
          aria-label={tr('副本名称后缀')}
          maxLength={32}
          value={suffix}
          onChange={(event) => setSuffix(event.target.value)}
          onBlur={commitSuffix}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitSuffix()
              event.currentTarget.blur()
            }
          }}
        />
      </SettingRow>
      <div className="settings-note">{tr('保存前校验与外部修改保护始终开启。')}</div>
      <div className="settings-subhead">
        <h4>{tr('恢复草稿')}</h4>
        <button className="btn small" disabled={loading || busy} onClick={() => void refresh()}>
          {tr('刷新')}
        </button>
        <button className="btn small" disabled={loading || busy || !drafts.length} onClick={() => setConfirm('all')}>
          {tr('清空草稿')}
        </button>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {confirm && (
        <div className="settings-confirm" role="alertdialog" aria-label={tr('确认删除恢复草稿')}>
          <strong>{confirm === 'all' ? tr('删除所有恢复草稿？') : tr('删除“{0}”的恢复草稿？', confirm.name)}</strong>
          <p>{tr('删除后无法从这些草稿恢复编辑。PDF 原文件不受影响。')}</p>
          <div>
            <button
              className="btn small"
              data-cancel-draft-confirmation
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              {tr('取消')}
            </button>
            <button className="btn small danger" disabled={busy} onClick={() => void remove()}>
              {busy ? tr('正在删除…') : tr('删除草稿')}
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <p className="settings-empty" role="status">
          {tr('正在读取恢复草稿…')}
        </p>
      ) : drafts.length ? (
        <ul className="settings-drafts">
          {drafts.map((draft) => (
            <li key={draft.key}>
              <div>
                <strong>{draft.name}</strong>
                <span>
                  {new Date(draft.savedAt).toLocaleString(getLocale())} · {draft.opCount}
                  {tr(' 处编辑')}
                </span>
              </div>
              <button
                className="tb-btn"
                aria-label={tr('删除草稿 {0}', draft.name)}
                disabled={busy}
                onClick={() => setConfirm(draft)}
              >
                <IconTrash size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="settings-empty">{tr('暂无恢复草稿。')}</p>
      )}
    </>
  )
}

function AiSettingsSection() {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
  const [message, setMessage] = useState('')
  const [ocr, setOcr] = useState<boolean | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  useEffect(() => subscribeAiSettings(setSettings), [])
  useEffect(() => {
    let active = true
    const desktop = getDesktop()
    if (!desktop?.ocrAvailable) setOcr(false)
    else
      void desktop.ocrAvailable().then(
        (value) => {
          if (active) setOcr(value)
        },
        () => {
          if (active) setOcr(false)
        },
      )
    return () => {
      active = false
    }
  }, [])
  return (
    <>
      <h3>{tr('AI 与本地资源')}</h3>
      <p className="settings-intro">{tr('这里的模型配置与文档中的 AI 助手共用。无需打开 PDF 即可配置。')}</p>
      <div className="settings-note">
        {tr('文字识别（OCR）：')}
        {ocr === null ? tr('正在检查…') : ocr ? tr('本机可用') : tr('当前环境不可用，需要支持此功能的 macOS 桌面版')}
      </div>
      <ProviderSettings
        key={`${formVersion}:${settings.provider}:${settings.baseUrl}:${settings.model}:${settings.language}`}
        settings={settings}
        onChange={async (value) => {
          const persisted = await saveAiSettings(value)
          setMessage(persisted ? tr('AI 设置已保存。') : aiCredentialMessage())
        }}
        onDone={() => setFormVersion((version) => version + 1)}
        setup={!isConfigured(settings)}
      />
      {message && (
        <p className="settings-feedback" role="status">
          {message}
        </p>
      )}
    </>
  )
}

function AboutSettings() {
  const mac = /Mac/i.test(navigator.platform)
  const meta = mac ? '⌘' : 'Ctrl+'
  const shift = mac ? '⇧' : 'Shift+'
  const shortcuts = [
    [tr('打开文件'), `${meta}O`],
    [tr('保存'), `${meta}S`],
    [tr('另存为'), `${shift}${meta}S`],
    [tr('搜索工具'), `${meta}K`],
    [tr('查找文档内容'), `${meta}F`],
    [tr('设置'), `${meta},`],
    [tr('撤销'), `${meta}Z`],
    [tr('重做'), `${shift}${meta}Z`],
    [tr('打印'), `${meta}P`],
    [tr('AI 助手'), `${meta}J`],
    [tr('切换深浅外观'), `${shift}${meta}D`],
    [tr('旋转视图'), `R / ${shift}R`],
  ]
  return (
    <>
      <h3>{tr('快捷键与关于')}</h3>
      <p className="settings-intro">{tr('常用操作可以直接通过键盘完成。')}</p>
      <dl className="settings-shortcuts">
        {shortcuts.map(([label, keys]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <kbd>{keys}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <div className="settings-about">
        <strong>
          <BrandMark size={25} /> Sail PDF
        </strong>
        <span>
          {tr('版本 ')}
          {import.meta.env.VITE_APP_VERSION ?? tr('开发版')} · {getDesktop() ? tr('桌面版') : tr('网页版')}
        </span>
        <p>{tr('PDF 阅读、编辑与文档处理。')}</p>
      </div>
    </>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  SECTIONS = createSections()
})
