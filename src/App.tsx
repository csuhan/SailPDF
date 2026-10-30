import { tr } from './i18n/locale'
import { useCallback, useEffect, useState } from 'react'
import { useRecoveryStatus } from './state/recoveryStatus'
import { useAppStore } from './state/stores'
import { useEditStore } from './state/editStore'
import { Toolbar, ViewControls } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PageViewport } from './components/PageViewport'
import { SearchPanel } from './components/SearchPanel'
import { OrganizePages } from './components/OrganizePages'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { getDesktop } from './desktop/bridge'
import { saveCurrentDocument } from './utils/save'
import { printCurrentDocument } from './utils/print'
import { getViewportController } from './components/viewportController'
import { PasswordDialog, RestoreBanner, UnsavedDialog, Toasts } from './components/Dialogs'
import { startAutosave } from './utils/autosave'
import { openPossiblyEncrypted } from './utils/secureOpen'
import { CreatePdfHost } from './components/CreatePdfDialog'
import { AiPanel } from './components/AiPanel'
import { SelectionMenu } from './components/SelectionMenu'
import { ToolsPanel } from './components/ToolsPanel'
import { onFormModified } from './pdf/document'
import { CommandPalette } from './components/CommandPalette'
import { ExternalFileBanner } from './components/ExternalFileBanner'
import { useExternalFileSync } from './desktop/fileSync'
import { closeDocument, confirmAllDocuments, openDocument, pickAndOpen } from './utils/docSession'
import { DocumentTabs } from './components/DocumentTabs'
import { hasAnyDirtyTab, useTabStore } from './state/tabStore'
import { NavigationRail } from './components/NavigationRail'
import { SettingsDialog } from './components/SettingsDialog'
import { useSettingsStore } from './state/settingsStore'

import { useLocale } from './i18n/react'

export default function App() {
  useLocale()
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const loading = useAppStore((s) => s.loading)
  const error = useAppStore((s) => s.error)
  const fileName = useAppStore((s) => s.fileName)
  const rotation = useAppStore((s) => s.rotation)
  const [dragOver, setDragOver] = useState(false)
  const recoveryFailures = useRecoveryStatus((s) => s.failures)

  useKeyboardShortcuts()
  useExternalFileSync()

  useEffect(() => startAutosave(), [])

  // filled-in form fields count as unsaved changes
  useEffect(() => onFormModified((m) => useEditStore.getState().setFormDirty(m)), [])

  // PDF.js only emits onSetModified for the first change in a dirty form.
  // Track every user edit too, so pending AI plans/output snapshots expire.
  useEffect(() => {
    const changed = (event: Event) => {
      const el = event.target
      if (el instanceof Element && el.closest('.annotationLayer') && el.matches('input, select, textarea')) {
        useEditStore.getState().setFormDirty(true)
      }
    }
    document.addEventListener('input', changed, true)
    document.addEventListener('change', changed, true)
    return () => {
      document.removeEventListener('input', changed, true)
      document.removeEventListener('change', changed, true)
    }
  }, [])

  // desktop: Finder open + native menu actions + window title
  useEffect(() => {
    const desktop = getDesktop()
    if (!desktop) return
    desktop.onOpenFile((f) => {
      void openDocument(f)
    })
    // cold start: a file may have been opened from Finder before React mounted
    void (async () => {
      for (;;) {
        const file = await desktop.consumePendingOpen()
        if (!file) break
        await openDocument(file)
      }
    })()
    // window close / quit with unsaved edits: ask first
    desktop.onCloseRequest?.(() => {
      useSettingsStore.getState().closeSettings()
      void confirmAllDocuments().then((ok) => desktop.closeResponse?.(ok))
    })
    desktop.onMenu((id) => {
      if (id === 'settings') {
        if (!document.querySelector('[aria-modal="true"]')) useSettingsStore.getState().openSettings()
        return
      }
      if (useSettingsStore.getState().open) return
      const app = useAppStore.getState()
      const edits = useEditStore.getState()
      switch (id) {
        case 'open':
          void pickAndOpen()
          break
        case 'save':
          void saveCurrentDocument()
          break
        case 'save-as':
          void saveCurrentDocument({ saveAs: true })
          break
        case 'close-doc':
          void closeDocument()
          break
        case 'print':
          if (app.pdfDoc) void printCurrentDocument()
          break
        case 'find':
          if (app.pdfDoc) app.setSearchOpen(!app.searchOpen)
          break
        case 'undo':
          edits.undo()
          break
        case 'redo':
          edits.redo()
          break
        case 'zoom-in':
          getViewportController()?.zoomBy(1.15)
          break
        case 'zoom-out':
          getViewportController()?.zoomBy(1 / 1.15)
          break
        case 'actual-size':
          app.setFitMode('custom')
          app.setScale(1, 'custom')
          break
        case 'fit-width':
          app.setFitMode(app.fitMode === 'fit-width' ? 'custom' : 'fit-width')
          break
        case 'fit-page':
          app.setFitMode(app.fitMode === 'fit-page' ? 'custom' : 'fit-page')
          break
        case 'rotate-cw':
          app.rotateView(90)
          break
        case 'rotate-ccw':
          app.rotateView(-90)
          break
        case 'prev-page':
          app.goToPage(app.currentPage - 1)
          break
        case 'next-page':
          app.goToPage(app.currentPage + 1)
          break
        case 'first-page':
          app.goToPage(1)
          break
        case 'last-page':
          app.goToPage(app.numPages)
          break
        default:
          break
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // window title follows the open file; unsaved edits are marked
  const dirty = useEditStore((s) => s.dirty)
  const tabs = useTabStore((s) => s.tabs)
  useEffect(() => {
    const desktop = getDesktop()
    const title = fileName ? `${dirty ? '● ' : ''}${fileName} — Sail PDF` : 'Sail PDF'
    document.title = title
    desktop?.setTitle(title)
    desktop?.setDirty?.(hasAnyDirtyTab())
  }, [fileName, dirty, tabs])

  // browser: warn before leaving the page with unsaved edits
  useEffect(() => {
    if (getDesktop()) return
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!hasAnyDirtyTab()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [])

  // dev/test convenience: ?file=/samples/sample.pdf auto-loads a document
  useEffect(() => {
    const url = new URL(window.location.href)
    const file = url.searchParams.get('file')
    if (!file || useAppStore.getState().pdfDoc || useAppStore.getState().loading) return
    void fetch(file)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        const name = file.split('/').pop() ?? 'document.pdf'
        void openPossiblyEncrypted(new Uint8Array(buf), name, null)
      })
      .catch((e) => console.error('auto-load failed', e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    for (const file of Array.from(e.dataTransfer.files ?? []))
      if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
        const desktop = getDesktop()
        const path = desktop?.getPathForFile?.(file) || (desktop && (file as File & { path?: string }).path) || null
        if (desktop && path) {
          await desktop
            .readFile(path)
            .then(openDocument)
            .catch(() => useAppStore.setState({ error: tr('无法读取拖入的文件，请重新选择') }))
        } else await openDocument({ data: file, name: file.name, path })
      }
  }, [])

  return (
    <div
      className="app-root navigation-layout"
      onDragOver={
        pdfDoc
          ? (e) => {
              e.preventDefault()
              setDragOver(true)
            }
          : undefined
      }
      onDragLeave={
        pdfDoc
          ? (e) => {
              if (e.currentTarget === e.target) setDragOver(false)
            }
          : undefined
      }
      onDrop={pdfDoc ? onDrop : undefined}
    >
      <NavigationRail />
      <div className="workspace-content">
        {Object.keys(recoveryFailures).length > 0 && (
          <div className="recovery-warning" role="alert">
            {Object.values(recoveryFailures).join(' ')}
          </div>
        )}
        {!pdfDoc && <DocumentTabs />}
        {!pdfDoc ? (
          <>
            {loading ? (
              <div className="home loading">
                <div className="spinner" />
                <p className="loading-text">{tr('正在打开 PDF…')}</p>
              </div>
            ) : (
              <WelcomeScreen />
            )}
            {error && <div className="error-banner">{error}</div>}
          </>
        ) : (
          <>
            <Toolbar />
            <DocumentTabs />
            <ExternalFileBanner />
            <div className="app-main" key={useAppStore.getState().docEpoch}>
              <Sidebar />
              <main className="viewport-area">
                <PageViewport />
                <SearchPanel />
                <ViewControls />
                {rotation !== 0 && (
                  <div className="view-chip">
                    {tr('已旋转 ')}
                    {rotation}°
                  </div>
                )}
                <OrganizePages />
                <ToolsPanel />
              </main>
              <AiPanel />
            </div>
          </>
        )}
      </div>
      {dragOver && pdfDoc && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">{tr('松开以打开此 PDF')}</div>
        </div>
      )}
      <SelectionMenu />
      <UnsavedDialog />
      <PasswordDialog />
      <CreatePdfHost />
      <CommandPalette />
      <SettingsDialog />
      <RestoreBanner />
      <Toasts />
    </div>
  )
}
