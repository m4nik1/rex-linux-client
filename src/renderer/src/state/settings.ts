import { createStore } from 'solid-js/store'
import { createEffect, createSignal } from 'solid-js'
import type { OmarchyTheme } from '../../../shared/ipc'
import { hex } from '../lib/theme'

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
  accent: AccentId
  sidebarOpen: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  backgroundOpacity: 0.25,
  terminalOpacity: 0.3,
  blur: 12,
  desktopBlur: 16,
  fontSize: 13.5,
  accent: 'omarchy',
  sidebarOpen: false,
}

const KEY = 'rex-gui:settings:v2'

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
