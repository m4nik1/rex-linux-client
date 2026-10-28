import { createStore } from 'solid-js/store'
import { createEffect } from 'solid-js'

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
  fontSize: number
  accent: AccentId
  sidebarOpen: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  backgroundOpacity: 0.25,
  terminalOpacity: 0.3,
  blur: 22,
  fontSize: 13.5,
  accent: 'glacier',
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

/** Mirror settings to CSS custom properties and localStorage. */
export function bindSettings() {
  createEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--base-alpha', String(settings.backgroundOpacity))
    root.setProperty('--term-alpha', String(settings.terminalOpacity))
    root.setProperty('--blur', `${settings.blur}px`)
    root.setProperty('--accent', ACCENTS[settings.accent].color)
    localStorage.setItem(KEY, JSON.stringify({ ...settings }))
  })
}
