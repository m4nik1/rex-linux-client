/** Live xterm instances by block id, for copy/paste and focus shortcuts. */
export interface TerminalHandle {
  focus(): void
  selection(): string
  paste(text: string): void
}
export const terminals = new Map<string, TerminalHandle>()
