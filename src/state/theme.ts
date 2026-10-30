/**
 * Appearance: light / dark UI. In dark mode the page canvas is shown
 * inverted (paper becomes dark, text light) while images keep their look
 * through a hue rotation — the same approach as "dark reading" modes of
 * other readers. The PDF file itself is never changed.
 */
import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'
const KEY = 'pdfpro.theme'

function initial(): ThemePreference {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'dark' || t === 'light' || t === 'system') return t
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

const systemTheme = (): Theme =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
const resolveTheme = (preference: ThemePreference): Theme => (preference === 'system' ? systemTheme() : preference)

function apply(t: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
}

interface ThemeState {
  theme: Theme
  preference: ThemePreference
  setTheme: (t: Theme) => void
  setPreference: (t: ThemePreference) => void
}

export const useTheme = create<ThemeState>((set) => {
  const preference = initial()
  const t = resolveTheme(preference)
  apply(t)
  const setPreference = (value: ThemePreference) => {
    if (value !== 'light' && value !== 'dark' && value !== 'system') return
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* storage unavailable */
    }
    const theme = resolveTheme(value)
    apply(theme)
    set({ preference: value, theme })
  }
  return {
    theme: t,
    preference,
    setTheme: setPreference,
    setPreference,
  }
})

// Follow later OS changes only while the user selected the system setting.
if (typeof matchMedia !== 'undefined') {
  const query = matchMedia('(prefers-color-scheme: dark)')
  const changed = () => {
    if (useTheme.getState().preference !== 'system') return
    const theme = query.matches ? 'dark' : 'light'
    apply(theme)
    useTheme.setState({ theme })
  }
  query.addEventListener?.('change', changed)
  if (import.meta.hot) import.meta.hot.dispose(() => query.removeEventListener?.('change', changed))
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.()
}
