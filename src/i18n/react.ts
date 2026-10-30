import { useSyncExternalStore } from 'react'
import { getLocale, onLocaleChange } from './locale'
export function useLocale() {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale)
}
