import { createStore } from 'solid-js/store'
import { createEffect, createSignal } from 'solid-js'
import { COLOR_KEYS, hex, type ColorKey } from '../lib/theme'
import { THEMES, REX_THEME_ID } from '../lib/themes'

export const ACCENTS = {
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
  blur: 22,
  desktopBlur: 32,
  fontSize: 13.5,
  fontFamily: '',
  lineHeight: 1.12,
  colorScheme: REX_THEME_ID,
  colorOverrides: {},
  accent: 'glacier',
  sidebarOpen: false,
}

const KEY = 'rex-gui:settings:v2'

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
    const s = { ...DEFAULT_SETTINGS, ...parsed } as Settings
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
      fontFamily: typeof s.fontFamily === 'string' ? s.fontFamily.replace(/[;{}\n\r]/g, '').slice(0, 120) : '',
      lineHeight: clamp(s.lineHeight, 1, 2, DEFAULT_SETTINGS.lineHeight),
      colorScheme: s.colorScheme === REX_THEME_ID || s.colorScheme in THEMES ? s.colorScheme : REX_THEME_ID,
      colorOverrides: cleanOverrides(s.colorOverrides),
      accent: s.accent in ACCENTS ? s.accent : DEFAULT_SETTINGS.accent,
      sidebarOpen: !!s.sidebarOpen,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const [settings, setSettings] = createStore<Settings>(
  loadSettings(typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)),
)

/** Whether the compositor accepted desktop blur control (Hyprland only). */
export const [desktopBlurSupported, setDesktopBlurSupported] = createSignal(false)

/** Mirror settings to CSS custom properties, the compositor and localStorage. */
export function bindSettings() {
  createEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--base-alpha', String(settings.backgroundOpacity))
    root.setProperty('--term-alpha', String(settings.terminalOpacity))
    root.setProperty('--blur', `${settings.blur}px`)
    root.setProperty('--accent', ACCENTS[settings.accent].color)
    localStorage.setItem(KEY, JSON.stringify({ ...settings }))
  })
  createEffect(() => {
    void window.rex
      .setDesktopBlur(settings.desktopBlur)
      .then(setDesktopBlurSupported, (e) => console.warn('[desktop blur]', e))
  })
}
