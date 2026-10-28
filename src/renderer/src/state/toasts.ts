import { createSignal } from 'solid-js'

export interface Toast {
  id: number
  kind: 'error' | 'info'
  text: string
}
const [toasts, setToasts] = createSignal<Toast[]>([])
let next = 1
export { toasts }

export function dismiss(id: number) {
  setToasts((t) => t.filter((x) => x.id !== id))
}

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
  // Collapse duplicate messages instead of stacking them.
  if (toasts().some((t) => t.text === text)) return
  const id = next++
  setToasts((t) => [...t.slice(-3), { id, kind, text }])
  if (ms) setTimeout(() => dismiss(id), ms)
}

/** Readable message from an Electron-serialized IPC error. */
export function errorText(e: unknown) {
  const s = e instanceof Error ? e.message : String(e)
  return s.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}

export const report = (e: unknown) => {
  console.error(e)
  toast(errorText(e), 'error', 7000)
}
