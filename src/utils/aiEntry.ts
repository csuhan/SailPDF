import { useAiStore } from '../ai/aiStore'
import { useAppStore } from '../state/stores'
import { pickAndOpen } from './docSession'

/** Start with a real document; cancellation never creates a pending task. */
export async function startAiTask(prompt = ''): Promise<void> {
  if (!useAppStore.getState().pdfDoc) await pickAndOpen()
  if (!useAppStore.getState().pdfDoc) return
  if (prompt.trim()) useAiStore.getState().ask(prompt.trim())
  else useAiStore.getState().setOpen(true)
}
