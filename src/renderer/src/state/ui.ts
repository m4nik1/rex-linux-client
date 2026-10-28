import { createSignal } from 'solid-js'

export const [paletteOpen, setPaletteOpen] = createSignal(false)
export const [settingsOpen, setSettingsOpen] = createSignal(false)

export type DialogState =
  | { kind: 'addHost' }
  | { kind: 'newSession'; serverId: string }
  | { kind: 'renameSession'; serverId: string; sessionId: string; label: string }
  | { kind: 'renameTab'; windowId: string; label: string }
  | { kind: 'destroySession'; serverId: string; sessionId: string; label: string }
export const [dialog, setDialog] = createSignal<DialogState | null>(null)
/** Window id currently being renamed inline in the tab strip. */
export const [renamingTab, setRenamingTab] = createSignal<string | null>(null)
