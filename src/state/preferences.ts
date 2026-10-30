import { create } from 'zustand'

export interface Preferences {
  palette: 'blue' | 'graphite' | 'forest'
  readingColor: 'auto' | 'original' | 'warm' | 'green' | 'dark'
  defaultViewMode: 'continuous' | 'single' | 'spread'
  defaultFitMode: 'fit-width' | 'fit-page' | 'custom'
  defaultScale: number
  restorePosition: boolean
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  copySuffix: string
}

export const PREFERENCES_KEY = 'pdfpro.preferences.v1'
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  palette: 'blue',
  readingColor: 'auto',
  defaultViewMode: 'continuous',
  defaultFitMode: 'fit-width',
  defaultScale: 1,
  restorePosition: true,
  autosaveEnabled: true,
  autosaveIntervalMs: 2500,
  copySuffix: '_edited',
})

export function sanitizeCopySuffix(value: unknown, fallback = DEFAULT_PREFERENCES.copySuffix): string {
  if (typeof value !== 'string') return fallback
  const clean = value
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 32)
  return clean || fallback
}

/** Stored values are data, never trusted object shapes or unbounded numbers. */
export function normalizePreferences(value: unknown, fallback: Preferences = DEFAULT_PREFERENCES): Preferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const number = (key: keyof Preferences, low: number, high: number): number =>
    typeof input[key] === 'number' && Number.isFinite(input[key])
      ? Math.min(high, Math.max(low, input[key] as number))
      : (fallback[key] as number)
  const boolean = (key: keyof Preferences): boolean =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : (fallback[key] as boolean)
  return {
    palette: ['blue', 'graphite', 'forest'].includes(input.palette as string)
      ? (input.palette as Preferences['palette'])
      : fallback.palette,
    readingColor: ['auto', 'original', 'warm', 'green', 'dark'].includes(input.readingColor as string)
      ? (input.readingColor as Preferences['readingColor'])
      : fallback.readingColor,
    defaultViewMode: ['continuous', 'single', 'spread'].includes(input.defaultViewMode as string)
      ? (input.defaultViewMode as Preferences['defaultViewMode'])
      : fallback.defaultViewMode,
    defaultFitMode: ['fit-width', 'fit-page', 'custom'].includes(input.defaultFitMode as string)
      ? (input.defaultFitMode as Preferences['defaultFitMode'])
      : fallback.defaultFitMode,
    defaultScale: number('defaultScale', 0.1, 8),
    restorePosition: boolean('restorePosition'),
    autosaveEnabled: boolean('autosaveEnabled'),
    autosaveIntervalMs: Math.round(number('autosaveIntervalMs', 1000, 60000)),
    copySuffix: sanitizeCopySuffix(input.copySuffix, fallback.copySuffix),
  }
}

export function readPreferences(storage?: Pick<Storage, 'getItem'>): Preferences {
  try {
    return normalizePreferences(JSON.parse((storage ?? localStorage).getItem(PREFERENCES_KEY) ?? '{}'))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function suggestedPdfName(fileName: string, copy: boolean, suffix = DEFAULT_PREFERENCES.copySuffix): string {
  const stem = fileName.replace(/\.pdf$/i, '')
  return `${stem}${copy ? sanitizeCopySuffix(suffix) : ''}.pdf`
}

interface PreferencesState extends Preferences {
  setPreferences: (patch: Partial<Preferences>) => void
  resetPreferences: () => void
}

function persist(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    /* Session preferences still work when browser storage is unavailable. */
  }
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...readPreferences(),
  setPreferences: (patch) => {
    const current = get()
    const preferences = normalizePreferences({ ...current, ...patch }, current)
    persist(preferences)
    set(preferences)
  },
  resetPreferences: () => {
    persist(DEFAULT_PREFERENCES)
    set({ ...DEFAULT_PREFERENCES })
  },
}))

function applyReadingPreferences(): void {
  if (typeof document === 'undefined') return
  const { palette, readingColor } = usePreferences.getState()
  document.documentElement.dataset.palette = palette
  document.documentElement.dataset.reading = readingColor
}
applyReadingPreferences()
usePreferences.subscribe(applyReadingPreferences)
