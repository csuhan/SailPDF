import { tr, onLocaleChange } from '../i18n/locale'
import { useAppStore } from '../state/stores'
import { useToolStore, type AppMode } from '../state/toolStore'
import { useSettingsStore } from '../state/settingsStore'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { docPermissions, modeAllowed, RESTRICTED_HINT } from '../utils/secureOpen'
import { pickAndOpen } from '../utils/docSession'
import { getDesktop } from '../desktop/bridge'
import { IconAI, IconBook, IconMarker, IconPages, IconPenLine, IconSettings, IconTools } from './icons'
import { useAiStore } from '../ai/aiStore'
import { startAiTask } from '../utils/aiEntry'
import '../styles/navigation.css'

function createModes(): { id: AppMode; label: string; icon: typeof IconBook; hint: string }[] {
  return [
    { id: 'read', label: tr('阅读'), icon: IconBook, hint: tr('阅读与浏览') },
    { id: 'edit', label: tr('编辑'), icon: IconPenLine, hint: tr('编辑文字与图片') },
    { id: 'annotate', label: tr('批注'), icon: IconMarker, hint: tr('高亮、画笔、图形与涂黑') },
    { id: 'pages', label: tr('页面'), icon: IconPages, hint: tr('排序、旋转、拆分与合并') },
    { id: 'tools', label: tr('工具'), icon: IconTools, hint: tr('搜索、收藏及全部工具') },
  ]
}

let MODES: { id: AppMode; label: string; icon: typeof IconBook; hint: string }[] = createModes()

export function NavigationRail() {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const loading = useAppStore((s) => s.loading)
  const encryption = useAppStore((s) => s.encryption)
  const mode = useToolStore((s) => s.mode)
  const settingsOpen = useSettingsStore((s) => s.open)
  const aiOpen = useAiStore((s) => s.open)
  const desktopMac = !!getDesktop() && /Mac/i.test(navigator.platform)
  const permissions = docPermissions(encryption)
  const navigate = async (next: AppMode) => {
    if (!useAppStore.getState().pdfDoc) {
      if (next === 'tools') {
        useToolDiscoveryStore.getState().setPaletteOpen(true)
        return
      }
      await pickAndOpen()
      if (!useAppStore.getState().pdfDoc) return
    }
    useToolStore.getState().setMode(next)
  }
  return (
    <aside className={`app-navigation ${desktopMac ? 'navigation-mac' : ''}`} aria-label={tr('应用导航')}>
      <div className="navigation-window-space" aria-hidden="true" />
      <button
        className={`navigation-ai ${aiOpen && pdfDoc ? 'active' : ''}`}
        aria-label={tr('打开 AI 助手')}
        title={tr('AI 助手：提问、总结和修改文档')}
        disabled={loading}
        aria-pressed={!!pdfDoc && aiOpen}
        onClick={() => {
          if (pdfDoc && aiOpen) useAiStore.getState().setOpen(false)
          else void startAiTask()
        }}
      >
        <IconAI size={23} />
        <span>{tr('AI 助手')}</span>
      </button>
      <nav className="navigation-modes" aria-label={tr('工作模式')}>
        {MODES.map(({ id, label, icon: Icon, hint }) => {
          const allowed = !pdfDoc || modeAllowed(id, permissions)
          return (
            <button
              key={id}
              className={`mode-tab navigation-item ${mode === id && !settingsOpen ? 'active' : ''}`}
              data-mode={id}
              aria-pressed={mode === id && !settingsOpen}
              disabled={loading || !allowed}
              title={!allowed ? RESTRICTED_HINT : !pdfDoc && id !== 'tools' ? tr('选择 PDF 后{0}', label) : hint}
              onClick={() => void navigate(id)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
      <div className="navigation-bottom">
        <button
          className={`navigation-item ${settingsOpen ? 'active' : ''}`}
          title={tr('设置 (⌘,)')}
          aria-label={tr('设置')}
          aria-pressed={settingsOpen}
          onClick={() => useSettingsStore.getState().openSettings()}
        >
          <IconSettings size={21} />
          <span>{tr('设置')}</span>
        </button>
      </div>
    </aside>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  MODES = createModes()
})
