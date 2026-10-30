import { create } from 'zustand'
import { findTool, type ToolDialog } from '../tools/registry'

export const FAVORITES_KEY = 'pdfpro.favoriteTools.v1'
export function readToolFavorites(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(FAVORITES_KEY) ?? '[]')
    return Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && !!findTool(id)))]
      : []
  } catch {
    return []
  }
}

interface ToolDiscoveryState {
  paletteOpen: boolean
  favorites: string[]
  dialog: ToolDialog | null
  dialogEpoch: number
  busy: string | null
  setPaletteOpen: (open: boolean) => void
  toggleFavorite: (id: string) => void
  setDialog: (dialog: ToolDialog | null, epoch?: number) => void
  setBusy: (busy: string | null) => void
}
export const useToolDiscoveryStore = create<ToolDiscoveryState>((set) => ({
  paletteOpen: false,
  favorites: readToolFavorites(),
  dialog: null,
  dialogEpoch: -1,
  busy: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleFavorite: (id) =>
    set((state) => {
      if (!findTool(id)) return state
      const favorites = state.favorites.includes(id)
        ? state.favorites.filter((item) => item !== id)
        : [...state.favorites, id]
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
      } catch {
        /* preferences still work for this session */
      }
      return { favorites }
    }),
  setDialog: (dialog, dialogEpoch = -1) => set({ dialog, dialogEpoch }),
  setBusy: (busy) => set({ busy }),
}))
