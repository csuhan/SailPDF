import { useEffect, useState } from 'react'
import { useAppStore } from '../state/stores'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { getDesktop } from '../desktop/bridge'
import { docPermissions } from '../utils/secureOpen'
import type { ToolContext } from './registry'

export function useToolContext(): ToolContext {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const loading = useAppStore((s) => s.loading)
  const encryption = useAppStore((s) => s.encryption)
  const busy = useToolDiscoveryStore((s) => s.busy)
  const [ocr, setOcr] = useState<ToolContext['ocr']>('checking')
  useEffect(() => {
    let live = true
    const desktop = getDesktop()
    if (!desktop?.ocr || !desktop.ocrAvailable) setOcr('unavailable')
    else
      void desktop.ocrAvailable().then(
        (ok) => {
          if (live) setOcr(ok ? 'available' : 'unavailable')
        },
        () => {
          if (live) setOcr('unavailable')
        },
      )
    return () => {
      live = false
    }
  }, [])
  return { hasDocument: !!pdfDoc, loading, permissions: docPermissions(encryption), ocr, busy: !!busy }
}
