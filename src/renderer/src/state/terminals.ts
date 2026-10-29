import { createSignal } from 'solid-js'
import type { ITheme } from '@xterm/xterm'

/** Live xterm instances by block id, for copy/paste and focus shortcuts. */
export interface TerminalHandle {
  focus(): void
  selection(): string
  paste(text: string): void
  /** Type text into the program as if the user had. */
  input(text: string): void
}
export const terminals = new Map<string, TerminalHandle>()

/** Colours the Rex server sent for the focused pane (undefined until known). */
export const [focusedRexColors, setFocusedRexColors] = createSignal<ITheme>()
