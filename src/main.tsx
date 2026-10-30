import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initializeAiSettings } from './ai/client'
import { initializeLocale } from './i18n/locale'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles/app.css'
import './styles/modern.css'
import './styles/themes.css'
import { useAppStore } from './state/stores'
import { useEditStore } from './state/editStore'
import { useToolStore } from './state/toolStore'
import { bakePdf } from './pdf/edit/applyOps'
import { extractPagesFromBuffer, mergePdfBuffers, splitPdfBuffer } from './pdf/edit/multiDoc'

void Promise.all([initializeLocale(), initializeAiSettings()]).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})

// dev/e2e hooks
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__pdfpro = {
    useAppStore,
    useEditStore,
    useToolStore,
    bakePdf,
    extractPagesFromBuffer,
    mergePdfBuffers,
    splitPdfBuffer,
  }
}
