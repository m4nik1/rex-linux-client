import { createStore, reconcile } from 'solid-js/store'
import { createEffect, createSignal } from 'solid-js'
import { COLOR_KEYS, hex, type ColorKey } from '../lib/theme'
import { THEMES, REX_THEME_ID } from '../lib/themes'
import type { OmarchyTheme } from '../../../shared/ipc'

/** The active Omarchy theme, or null off Omarchy. Kept live by bindSettings. */
export const [omarchy, setOmarchy] = createSignal<OmarchyTheme | null>(null)

/** Omarchy's own fallback accent, used when its theme can't be read. */
const OMARCHY_FALLBACK = '#FFD60A'

export const ACCENTS = {
  omarchy: { label: 'Omarchy theme', color: OMARCHY_FALLBACK },
  glacier: { label: 'Glacier', color: '#8fd3ff' },
  lilac: { label: 'Lilac', color: '#b9a7ff' },
  mint: { label: 'Mint', color: '#7fe3b5' },
  amber: { label: 'Amber', color: '#ffc66d' },
  coral: { label: 'Coral', color: '#ff8f8f' },
} as const
export type AccentId = keyof typeof ACCENTS

export interface Settings {
  /** Opacity of the painted base layer behind everything (0–1). */
  backgroundOpacity: number
  /** Opacity of the terminal fill on top of the base layer (0–1). */
  terminalOpacity: number
  /** Chrome backdrop blur in px. */
  blur: number
  /** Compositor blur size behind the window while focused (Hyprland); 0 = compositor default. */
  desktopBlur: number
  fontSize: number
  /** Preferred terminal font family; tried before the built-in fallbacks. */
  fontFamily: string
  lineHeight: number
  /** Terminal colour scheme id: 'rex' follows the server, otherwise a preset. */
  colorScheme: string
  /** Per-colour overrides applied over the scheme. */
  colorOverrides: Partial<Record<ColorKey, string>>
  accent: AccentId
  sidebarOpen: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  backgroundOpacity: 0.25,
  terminalOpacity: 0.3,
  blur: 12,
  desktopBlur: 16,
  fontSize: 13.5,
  fontFamily: '',
  lineHeight: 1.12,
  colorScheme: REX_THEME_ID,
  colorOverrides: {},
  accent: 'omarchy',
  sidebarOpen: false,
}

const KEY = 'rex-gui:settings:v2'

/** Fresh defaults; never hand the shared DEFAULT_SETTINGS objects to the store. */
const defaults = (): Settings => ({ ...DEFAULT_SETTINGS, colorOverrides: {} })

/**
 * Sanitise a comma-separated font list: strip quotes, backslashes, semicolons,
 * braces and newlines from each name so it is safe inside a CSS font stack.
 */
export function cleanFontFamily(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .split(',')
    .map((f) => f.replace(/["'\\;{}]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 120)
}

/** Font names from the setting, in order, ready to quote. */
export const fontNames = (raw: string) =>
  cleanFontFamily(raw)
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)

function cleanOverrides(raw: unknown) {
  const out: Partial<Record<ColorKey, string>> = {}
  if (raw && typeof raw === 'object')
    for (const key of COLOR_KEYS) {
      const color = hex((raw as Record<string, string>)[key])
      if (color?.startsWith('#')) out[key] = color
    }
  return out
}

export function loadSettings(raw: string | null): Settings {
  try {
    const parsed = raw ? JSON.parse(raw) : {}
    const s = { ...defaults(), ...parsed } as Settings
    const clamp = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.min(hi, Math.max(lo, v))
        : d
    return {
      backgroundOpacity: clamp(s.backgroundOpacity, 0, 1, DEFAULT_SETTINGS.backgroundOpacity),
      terminalOpacity: clamp(s.terminalOpacity, 0, 1, DEFAULT_SETTINGS.terminalOpacity),
      blur: clamp(s.blur, 0, 48, DEFAULT_SETTINGS.blur),
      desktopBlur: clamp(s.desktopBlur, 0, 64, DEFAULT_SETTINGS.desktopBlur),
      fontSize: clamp(s.fontSize, 9, 24, DEFAULT_SETTINGS.fontSize),
      fontFamily: cleanFontFamily(s.fontFamily),
      lineHeight: clamp(s.lineHeight, 1, 2, DEFAULT_SETTINGS.lineHeight),
      colorScheme: s.colorScheme === REX_THEME_ID ||
        (typeof s.colorScheme === 'string' && Object.hasOwn(THEMES, s.colorScheme)) ? s.colorScheme : REX_THEME_ID,
      colorOverrides: cleanOverrides(s.colorOverrides),
      accent:
        typeof s.accent === 'string' && Object.hasOwn(ACCENTS, s.accent)
          ? s.accent
          : DEFAULT_SETTINGS.accent,
      sidebarOpen: !!s.sidebarOpen,
    }
  } catch {
    return defaults()
  }
}

export const [settings, setSettings] = createStore<Settings>(
  loadSettings(typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)),
)

// The store setter shallow-merges objects, so deletes must be explicit.
export const setColorOverride = (k: ColorKey, value: string) =>
  setSettings('colorOverrides', k, value)
export const resetColorOverride = (k: ColorKey) =>
  setSettings('colorOverrides', k, undefined)
export const clearColorOverrides = () =>
  setSettings('colorOverrides', reconcile({}))
/** Restore every setting except the sidebar state. */
export function resetSettings() {
  const { sidebarOpen } = settings
  setSettings(reconcile({ ...defaults(), sidebarOpen }))
}

/** Whether the compositor accepted desktop blur control (Hyprland only). */
export const [desktopBlurSupported, setDesktopBlurSupported] = createSignal(false)

/** UI tokens and the colors.toml keys that fill them, first match wins. */
const OMARCHY_TOKENS: [string, string[]][] = [
  ['--abyss', ['darker_background', 'dark_background', 'background']],
  ['--navy', ['background']],
  ['--slate', ['lighter_background', 'background']],
  ['--frost', ['foreground']],
  ['--mist', ['dark_foreground', 'muted']],
  ['--haze', ['muted']],
  ['--danger', ['red']],
  ['--ok', ['green']],
  ['--warn', ['yellow']],
]

export const accentColor = (id: AccentId) =>
  id === 'omarchy' ? (omarchy()?.colors.accent ?? OMARCHY_FALLBACK) : ACCENTS[id].color

/** Mirror settings to CSS custom properties, the compositor and localStorage. */
export function bindSettings() {
  void window.rex.getOmarchyTheme().then(setOmarchy, (e) => console.warn('[omarchy theme]', e))
  window.rex.onOmarchyTheme(setOmarchy)
  createEffect(() => {
    const theme = omarchy()
    const root = document.documentElement.style
    // Match Hyprland's window rounding, which is 0 on Omarchy's default.
    if (theme?.rounding === undefined) root.removeProperty('--r-win')
    else root.setProperty('--r-win', `${theme.rounding}px`)
    // Take the UI palette from the theme; tokens.css holds the fallback.
    for (const [token, keys] of OMARCHY_TOKENS) {
      const color = keys.map((k) => theme?.colors[k]).find((c) => c && hex(c))
      if (color) root.setProperty(token, hex(color)!)
      else root.removeProperty(token)
    }
  })
  createEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--base-alpha', String(settings.backgroundOpacity))
    root.setProperty('--term-alpha', String(settings.terminalOpacity))
    root.setProperty('--blur', `${settings.blur}px`)
    root.setProperty('--accent', accentColor(settings.accent))
    localStorage.setItem(KEY, JSON.stringify({ ...settings }))
  })
  createEffect(() => {
    void window.rex
      .setDesktopBlur(settings.desktopBlur)
      .then(setDesktopBlurSupported, (e) => console.warn('[desktop blur]', e))
  })
}
