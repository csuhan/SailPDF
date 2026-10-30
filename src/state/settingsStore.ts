import { create } from 'zustand'

export type SettingsSection = 'appearance' | 'saving' | 'ai' | 'about' | 'help'

interface SettingsState {
  open: boolean
  section: SettingsSection
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  setSection: (section: SettingsSection) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  open: false,
  section: 'appearance',
  openSettings: (section = 'appearance') => set({ open: true, section }),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}))
