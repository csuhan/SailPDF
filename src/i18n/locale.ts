import english from '../../locales/en.json'
import { getDesktop } from '../desktop/bridge'

export type Locale = 'en' | 'zh-CN'
declare const __SAIL_DEFAULT_LANGUAGE__: string | undefined
// Preserve the existing preference when upgrading from the previous brand.
export const LANGUAGE_KEY = 'lumen.ui.language'
const listeners = new Set<() => void>()
const tables: Record<string, string> = Object.assign(Object.create(null), english)
const canonicalCopy = new Map(Object.entries(tables).map(([source, translated]) => [translated, source]))
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY)
    if (stored === 'en' || stored === 'zh-CN') return stored
  } catch {
    /* Storage can be unavailable. */
  }
  const testing =
    typeof __SAIL_DEFAULT_LANGUAGE__ !== 'undefined'
      ? __SAIL_DEFAULT_LANGUAGE__
      : (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.PDFPRO_TEST_LANGUAGE
  return testing === 'zh-CN' ? 'zh-CN' : 'en'
}
let locale: Locale = initialLocale()
export const getLocale = (): Locale => locale
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function setLocale(value: Locale): void {
  if (value !== 'en' && value !== 'zh-CN') return
  locale = value
  try {
    localStorage.setItem(LANGUAGE_KEY, value)
  } catch {
    /* Keep the session choice. */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = value
  for (const listener of listeners) listener()
  if (typeof window !== 'undefined')
    void getDesktop()
      ?.setLanguage?.(value)
      .catch(() => {})
}
/** Translate interface copy only. Values interpolated into copy remain unchanged. */
export function tr(source: string, ...values: unknown[]): string {
  const key = source.trim().replace(/\s+/g, ' ')
  const translated =
    locale === 'en' && tables[key] !== undefined
      ? (source.match(/^\s*/)?.[0] ?? '') + tables[key] + (source.match(/\s*$/)?.[0] ?? '')
      : source
  return translated.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  )
}
/** For predefined interface labels returned by a cached native/PDF metadata catalog. */
export function interfaceLabel(value: string): string {
  return tr(canonicalCopy.get(value) ?? value)
}
export function searchableCopy(value: string): string {
  const source = canonicalCopy.get(value) ?? value
  return `${source} ${tables[source] ?? ''}`
}
export function formatPageCount(count: number): string {
  return locale === 'zh-CN' ? `${count} 页` : `${count} ${count === 1 ? 'page' : 'pages'}`
}
export async function initializeLocale(): Promise<void> {
  const desktop = typeof window !== 'undefined' ? getDesktop() : undefined
  if (desktop?.getLanguage) {
    try {
      const value = await desktop.getLanguage()
      if (value === 'en' || value === 'zh-CN') setLocale(value)
    } catch {
      /* Browser preference remains usable. */
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
