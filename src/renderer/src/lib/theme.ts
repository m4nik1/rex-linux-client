import type { ITheme } from '@xterm/xterm'
import type { TerminalMeta } from '../../../shared/ipc'

/** Ghostty-flavoured dark default, tuned for the navy base. */
export const DEFAULT_THEME: ITheme = {
  foreground: '#dfe6ee',
  background: '#0d1117',
  cursor: '#e8eef5',
  cursorAccent: '#0d1117',
  selectionBackground: '#3a4a63',
  selectionForeground: '#ffffff',
  black: '#1d1f21',
  red: '#ff6b6b',
  green: '#8fd47b',
  yellow: '#f2c66d',
  blue: '#6cb6ff',
  magenta: '#d59cf6',
  cyan: '#6fd8d0',
  white: '#c5ccd6',
  brightBlack: '#666f7c',
  brightRed: '#ff8f8f',
  brightGreen: '#a7e394',
  brightYellow: '#ffd88a',
  brightBlue: '#8ccbff',
  brightMagenta: '#e3b6fb',
  brightCyan: '#90ebe3',
  brightWhite: '#ffffff',
}

const NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

export const hex = (value?: string) => {
  if (!value) return undefined
  const v = value.trim()
  if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return '#' + v.replace(/^#/, '')
  if (/^#?[0-9a-f]{3}$/i.test(v)) {
    const s = v.replace(/^#/, '')
    return '#' + [...s].map((c) => c + c).join('')
  }
  if (/^rgb/i.test(v)) return v
  return undefined
}

/** Convert a Rex theme meta event into an xterm theme over the default. */
export function rexTheme(meta: Extract<TerminalMeta, { type: 'theme' }>): ITheme {
  const theme: ITheme = { ...DEFAULT_THEME }
  if (hex(meta.foreground)) theme.foreground = hex(meta.foreground)
  if (hex(meta.background)) {
    theme.background = hex(meta.background)
    theme.cursorAccent = hex(meta.background)
  }
  if (hex(meta.cursor)) theme.cursor = hex(meta.cursor)
  const extended: string[] = []
  ;(meta.palette ?? []).forEach((entry, i) => {
    // Rex sends "index=color"; tolerate bare colors in order too.
    const [a, b] = entry.includes('=') ? entry.split('=') : [String(i), entry]
    const index = Number(a)
    const color = hex(b)
    if (!color || !Number.isInteger(index) || index < 0 || index > 255) return
    if (index < 16) (theme as Record<string, string>)[NAMES[index]] = color
    else extended[index - 16] = color
  })
  if (extended.length) theme.extendedAnsi = extended
  return theme
}

/** "#rrggbb" + alpha → rgba() */
export function withAlpha(color: string | undefined, alpha: number) {
  const c = hex(color)
  if (!c || !c.startsWith('#')) return `rgba(13,17,23,${alpha})`
  const n = parseInt(c.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Override keys the user may set individually in Settings. */
export const COLOR_KEYS = ['foreground', 'background', 'cursor', 'selectionBackground', ...NAMES] as const
export type ColorKey = (typeof COLOR_KEYS)[number]

/**
 * Final terminal theme: the base (a preset, or the Rex-provided theme when
 * `preset` is undefined) with the user's individual colour overrides on top.
 */
export function composeTheme(
  base: ITheme,
  preset: ITheme | undefined,
  overrides: Partial<Record<ColorKey, string>>,
): ITheme {
  const theme: ITheme = preset ? { ...base, ...preset, extendedAnsi: undefined } : { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const color = hex(value)
    if (!color || !(COLOR_KEYS as readonly string[]).includes(key)) continue
    ;(theme as Record<string, string>)[key] = color
    if (key === 'background') theme.cursorAccent = color
  }
  return theme
}
