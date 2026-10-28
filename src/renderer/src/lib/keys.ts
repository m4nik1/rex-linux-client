export type ShortcutAction =
  | 'newTab'
  | 'closePane'
  | 'splitRight'
  | 'splitDown'
  | 'nextTab'
  | 'prevTab'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown'
  | 'copy'
  | 'paste'
  | 'zoom'
  | 'palette'
  | 'toggleSidebar'
  | 'settings'
  | `tab${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * Map a keydown to an app shortcut. Only Ctrl+Shift chords, Ctrl+Tab,
 * Ctrl+PageUp/Down, Alt+arrows and Alt+digits are claimed: all of those are
 * either unencodable or very rarely used by terminal programs.
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (e.metaKey) return null
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (e.ctrlKey && !e.altKey) {
    if (k === 'Tab') return e.shiftKey ? 'prevTab' : 'nextTab'
    if (k === 'PageDown' && !e.shiftKey) return 'nextTab'
    if (k === 'PageUp' && !e.shiftKey) return 'prevTab'
    if (e.shiftKey) {
      switch (k) {
        case 't':
          return 'newTab'
        case 'w':
          return 'closePane'
        case 'Enter':
        case 'd':
          return 'splitRight'
        case 'e':
          return 'splitDown'
        case 'c':
          return 'copy'
        case 'v':
          return 'paste'
        case 'z':
          return 'zoom'
        case 'p':
          return 'palette'
        case 'b':
          return 'toggleSidebar'
        case ',':
        case '<':
          return 'settings'
      }
    }
  }
  if (e.altKey && !e.ctrlKey && !e.shiftKey) {
    switch (k) {
      case 'ArrowLeft':
        return 'focusLeft'
      case 'ArrowRight':
        return 'focusRight'
      case 'ArrowUp':
        return 'focusUp'
      case 'ArrowDown':
        return 'focusDown'
    }
    const digit = e.code?.match(/^Digit([1-9])$/)?.[1]
    if (digit) return `tab${digit}` as ShortcutAction
  }
  return null
}

export const SHORTCUT_LABELS: Partial<Record<ShortcutAction, string>> = {
  newTab: 'Ctrl Shift T',
  closePane: 'Ctrl Shift W',
  splitRight: 'Ctrl Shift D',
  splitDown: 'Ctrl Shift E',
  nextTab: 'Ctrl Tab',
  prevTab: 'Ctrl Shift Tab',
  zoom: 'Ctrl Shift Z',
  palette: 'Ctrl Shift P',
  toggleSidebar: 'Ctrl Shift B',
  settings: 'Ctrl Shift ,',
  copy: 'Ctrl Shift C',
  paste: 'Ctrl Shift V',
  focusLeft: 'Alt ←',
  focusRight: 'Alt →',
  focusUp: 'Alt ↑',
  focusDown: 'Alt ↓',
}
