import { tr } from '../i18n/locale'
import { useEffect } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { getViewportController } from '../components/viewportController'
import { closeDocument } from '../utils/docSession'
import { runTool } from '../tools/runTool'
import { printCurrentDocument } from '../utils/print'
import { useAiStore } from '../ai/aiStore'
import { notify } from '../utils/save'
import { toggleFullscreen, useTheme } from '../state/theme'
import { toggleBookmark } from '../components/BookmarksPanel'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { useSettingsStore } from '../state/settingsStore'

function isFormTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useAppStore.getState()
      const edits = useEditStore.getState()
      const meta = e.metaKey || e.ctrlKey

      if (meta && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        const settings = useSettingsStore.getState()
        if (settings.open) settings.closeSettings()
        else if (!document.querySelector('[aria-modal="true"]')) settings.openSettings()
        return
      }
      if (useSettingsStore.getState().open) return

      if (meta && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const tools = useToolDiscoveryStore.getState()
        // Keep the active dialog's input and Escape lifecycle intact.
        if (!tools.paletteOpen && document.querySelector('[aria-modal="true"]')) return
        tools.setPaletteOpen(!tools.paletteOpen)
        return
      }
      if (useToolDiscoveryStore.getState().paletteOpen) return

      // global app shortcuts. The page handles them itself (and prevents
      // the default), so on desktop the matching menu accelerator does not
      // fire a second time; the menu items stay for mouse use.
      const desktop = !!(window as unknown as { pdfDesktop?: unknown }).pdfDesktop
      if (meta && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        void runTool('open')
        return
      }
      if (meta && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (app.pdfDoc) void runTool(e.shiftKey ? 'save-as' : 'save')
        return
      }
      if (meta && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        // browsers reserve ⌘W for the tab: only the desktop closes the document
        if (desktop && app.pdfDoc) {
          e.preventDefault()
          void closeDocument()
        }
        return
      }
      if (meta && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        if (app.pdfDoc) void printCurrentDocument()
        return
      }
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        if (isFormTarget(e)) return
        e.preventDefault()
        if (e.shiftKey) edits.redo()
        else edits.undo()
        return
      }
      if (meta && !e.shiftKey && (e.key === 'd' || e.key === 'D') && app.pdfDoc) {
        e.preventDefault()
        const on = toggleBookmark(app.currentPage)
        notify(on ? tr('已为第 {0} 页添加书签', app.currentPage) : tr('已移除书签'))
        return
      }
      if (meta && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        const t = useTheme.getState()
        t.setTheme(t.theme === 'dark' ? 'light' : 'dark')
        return
      }
      if (e.key === 'F11') {
        e.preventDefault()
        toggleFullscreen()
        return
      }
      if (meta && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        if (app.pdfDoc) useAiStore.getState().setOpen(!useAiStore.getState().open)
        return
      }
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        if (app.pdfDoc) app.setSearchOpen(!app.searchOpen)
        return
      }

      if (isFormTarget(e)) return

      if (e.key === 'Escape') {
        if (app.searchOpen) {
          app.setSearchOpen(false)
          return
        }
        if (edits.selectedOpId) {
          edits.setSelectedOp(null)
          return
        }
        useToolStore.getState().setTool('select')
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && edits.selectedOpId) {
        e.preventDefault()
        edits.removeOp(edits.selectedOpId)
        edits.setSelectedOp(null)
        return
      }

      if (!app.pdfDoc) return

      // zoom
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        getViewportController()?.zoomBy(1.15)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        getViewportController()?.zoomBy(1 / 1.15)
        return
      }
      if (e.key === '0' && meta) {
        e.preventDefault()
        app.setFitMode('fit-page')
        return
      }
      if (e.key === '9' && meta) {
        e.preventDefault()
        app.setFitMode('fit-width')
        return
      }

      // rotate view
      if (e.key === 'r' || e.key === 'R') {
        if (meta) return // don't hijack reload
        app.rotateView(e.shiftKey ? -90 : 90)
        return
      }

      // fullscreen
      if (e.key === 'f' && !meta) {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen().catch(() => undefined)
        return
      }

      const vc = getViewportController()
      const single = app.viewMode === 'single'

      switch (e.key) {
        case 'PageDown':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage + 1)
          else vc?.scrollScreen(1)
          break
        case 'PageUp':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage - 1)
          else vc?.scrollScreen(-1)
          break
        case ' ':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage + (e.shiftKey ? -1 : 1))
          else vc?.scrollScreen(e.shiftKey ? -1 : 1)
          break
        case 'ArrowDown':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage + 1)
          else vc?.scrollByPx(64)
          break
        case 'ArrowUp':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage - 1)
          else vc?.scrollByPx(-64)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (single) app.goToPage(app.currentPage - 1)
          break
        case 'Home':
          e.preventDefault()
          if (single) app.goToPage(1)
          else vc?.scrollToStart()
          break
        case 'End':
          e.preventDefault()
          if (single) app.goToPage(app.numPages)
          else vc?.scrollToEnd()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
