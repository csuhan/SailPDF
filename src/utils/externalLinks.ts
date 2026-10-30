import { getDesktop } from '../desktop/bridge'
export const PROJECT_URL = 'https://github.com/csuhan/SailPDF'
export const FEEDBACK_URL = `${PROJECT_URL}/issues/new/choose`
export const RELEASES_URL = `${PROJECT_URL}/releases`
export function safeExternalUrl(raw: string): string | null {
  if (raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href
    if (url.protocol === 'mailto:' && url.pathname && !/%0[ad]/i.test(raw) && !raw.includes('\\')) return url.href
  } catch {
    /* unsupported URL */
  }
  return null
}
export async function openExternalLink(raw: string): Promise<boolean> {
  const url = safeExternalUrl(raw)
  if (!url) return false
  const desktop = getDesktop()
  if (desktop) return desktop.openExternal ? desktop.openExternal(url) : false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
