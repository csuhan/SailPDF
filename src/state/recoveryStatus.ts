import { create } from 'zustand'
export const useRecoveryStatus = create<{ failures: Record<string, string> }>(() => ({ failures: {} }))
export function recoveryResult(key: string, error?: string): void {
  useRecoveryStatus.setState((state) => {
    const failures = { ...state.failures }
    if (error) failures[key] = error
    else delete failures[key]
    return { failures }
  })
}
