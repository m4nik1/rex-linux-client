import { EventEmitter } from 'node:events'
import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OmarchyTheme } from '../shared/ipc'

export const OMARCHY_CURRENT = join(homedir(), '.local/state/omarchy/current')

/** Parse the flat `key = "value"` pairs of Omarchy's colors.toml. */
export function parseColors(text: string) {
  const colors: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/)
    if (m) colors[m[1]] = m[2]
  }
  return colors
}

/**
 * Follows the active Omarchy theme. A theme switch swaps the `theme` symlink
 * inside `current` and rewrites files, so both directories are watched and the
 * watchers are re-armed after every change.
 */
export class OmarchyThemeWatcher extends EventEmitter {
  private watchers: FSWatcher[] = []
  private timer?: ReturnType<typeof setTimeout>
  private last = ''

  constructor(
    private readonly current = OMARCHY_CURRENT,
    private readonly rounding: () => Promise<number | undefined> = async () => undefined,
  ) {
    super()
  }

  async read(): Promise<OmarchyTheme | null> {
    let colors: Record<string, string>
    try {
      colors = parseColors(readFileSync(join(this.current, 'theme', 'colors.toml'), 'utf8'))
    } catch {
      return null
    }
    if (!colors.accent) return null
    const rounding = await this.rounding().catch(() => undefined)
    return { colors, ...(rounding === undefined ? {} : { rounding }) }
  }

  start() {
    this.arm()
    void this.read().then((t) => (this.last = JSON.stringify(t)))
  }

  close() {
    clearTimeout(this.timer)
    for (const w of this.watchers) w.close()
    this.watchers = []
  }

  private arm() {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const dir of [this.current, join(this.current, 'theme')]) {
      try {
        const w = watch(dir, () => this.changed())
        w.on('error', () => this.changed())
        this.watchers.push(w)
      } catch {
        /* Omarchy isn't installed, or the theme is mid-switch; re-armed on the next change. */
      }
    }
  }

  private changed() {
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      this.arm()
      const theme = await this.read()
      const key = JSON.stringify(theme)
      if (key === this.last) return
      this.last = key
      this.emit('change', theme)
    }, 150)
  }
}
