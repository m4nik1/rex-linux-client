import { describe, it, expect } from 'vitest'
import type { RexWindow } from '../src/shared/ipc'
import { windowPanes, windowDividers, ratioAt } from '../src/renderer/src/lib/layout'
import { fuzzyFilter, fuzzyScore, fuzzyIndices } from '../src/renderer/src/lib/fuzzy'
import {
  shortenHome,
  pwdToPath,
  processName,
  processGlyph,
  isDefaultWindowLabel,
  parseHostInput,
} from '../src/renderer/src/lib/format'
import { matchShortcut } from '../src/renderer/src/lib/keys'
import { omarchyTheme, rexTheme, withAlpha } from '../src/renderer/src/lib/theme'
import { parseColors } from '../src/main/omarchy-theme'
import { loadSettings, DEFAULT_SETTINGS } from '../src/renderer/src/state/settings'

const win = (zoom?: string): RexWindow => ({
  window_id: 'w',
  label: 'Window 0123abcd',
  focused_block_id: 'a',
  zoomed_block_id: zoom ?? null,
  layers: [
    {
      layer_id: 'l',
      kind: 'tiled',
      bounds: [0, 0, 1, 1],
      blocks: [],
      layout: {
        rect: [0, 0, 1, 1],
        split: {
          split_id: 's1',
          direction: 'horizontal',
          ratio: 0.5,
          before: { rect: [0, 0, 0.5, 1], block_id: 'a' },
          after: {
            rect: [0.5, 0, 0.5, 1],
            split: {
              split_id: 's2',
              direction: 'vertical',
              ratio: 0.4,
              before: { rect: [0.5, 0, 0.5, 0.4], block_id: 'b' },
              after: { rect: [0.5, 0.4, 0.5, 0.6], block_id: 'c' },
            },
          },
        },
      },
    },
  ],
})

describe('layout', () => {
  it('lists panes and honours zoom', () => {
    expect(windowPanes(win()).map((p) => p.block_id)).toEqual(['a', 'b', 'c'])
    expect(windowPanes(win('c'))).toEqual([{ block_id: 'c', rect: [0, 0, 1, 1] }])
  })
  it('finds dividers with nearest blocks either side', () => {
    const d = windowDividers(win())
    expect(d.map((x) => [x.key, x.direction, x.beforeBlockId, x.afterBlockId])).toEqual([
      ['s1', 'horizontal', 'a', 'b'],
      ['s2', 'vertical', 'b', 'c'],
    ])
    expect(windowDividers(win('a'))).toEqual([])
  })
  it('computes clamped ratios relative to the split rect', () => {
    const [, v] = windowDividers(win())
    expect(ratioAt(v, 0.7, 0.5)).toBeCloseTo(0.5)
    expect(ratioAt(v, 0.7, 0)).toBeCloseTo(0.08)
  })
})

describe('fuzzy', () => {
  it('matches subsequences and ranks prefixes first', () => {
    expect(fuzzyScore('spr', 'Split right')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Split right')).toBeNull()
    const r = fuzzyFilter(['Close pane', 'New tab', 'Split down'], 'nt', (s) => s)
    expect(r[0]).toBe('New tab')
    expect(fuzzyIndices('sd', 'Split down')).toEqual([0, 6])
  })
})

describe('format', () => {
  it('shortens home and parses OSC 7 pwd', () => {
    expect(shortenHome('/home/manik/src', '/home/manik')).toBe('~/src')
    expect(shortenHome('/home/manikx', '/home/manik')).toBe('/home/manikx')
    expect(pwdToPath('file://host/tmp/a%20b')).toBe('/tmp/a b')
  })
  it('labels processes like Rex', () => {
    expect(processName({ pid: 1, name: 'fish', argv0: '-fish' })).toBe('fish')
    expect(processName({ pid: 1, name: 'node', script: '/x/server.js' })).toBe('Node')
    expect(processGlyph('nvim').tint).toBe('green')
    expect(isDefaultWindowLabel('Window 37fd84a3')).toBe(true)
    expect(isDefaultWindowLabel('build')).toBe(false)
  })
  it('accepts Tailscale names, URLs and account@host for remote hosts', () => {
    const ts = parseHostInput('rex-cachy.tail1234.ts.net')
    expect(ts).toMatchObject({ ok: true, kind: 'tailscale', label: 'rex-cachy', address: 'rex-cachy.tail1234.ts.net' })
    expect(parseHostInput(' https://rex.example.com:7297 ')).toMatchObject({ ok: true, kind: 'url', address: 'https://rex.example.com:7297' })
    expect(parseHostInput('alice@rex-cachy.tail1234.ts.net')).toMatchObject({ ok: true, kind: 'account', label: 'alice@rex-cachy' })
    expect(parseHostInput('box:7297')).toMatchObject({ ok: true, kind: 'host' })
    expect(parseHostInput('ssh://box').ok).toBe(false)
    expect(parseHostInput('https://a:pw@box').ok).toBe(false)
    expect(parseHostInput('').ok).toBe(false)
    expect(parseHostInput('two words').ok).toBe(false)
  })
})

describe('shortcuts', () => {
  const k = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}, code?: string) => ({
    key,
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  })
  it('claims only app chords', () => {
    expect(matchShortcut(k('T', { ctrlKey: true, shiftKey: true }))).toBe('newTab')
    expect(matchShortcut(k('Enter', { ctrlKey: true, shiftKey: true }))).toBe('splitRight')
    expect(matchShortcut(k('Tab', { ctrlKey: true }))).toBe('nextTab')
    expect(matchShortcut(k('PageUp', { ctrlKey: true }))).toBe('prevTab')
    expect(matchShortcut(k('ArrowLeft', { altKey: true }))).toBe('focusLeft')
    expect(matchShortcut(k('2', { altKey: true }, 'Digit2'))).toBe('tab2')
    // Terminal keys pass through.
    expect(matchShortcut(k('c', { ctrlKey: true }))).toBeNull()
    expect(matchShortcut(k('t', { ctrlKey: true }))).toBeNull()
    expect(matchShortcut(k('ArrowLeft', { ctrlKey: true }))).toBeNull()
    expect(matchShortcut(k('b', { altKey: true }))).toBeNull()
  })
})

describe('theme & settings', () => {
  it('maps Rex theme events including the 256 palette', () => {
    const t = rexTheme({ type: 'theme', foreground: 'ffffff', background: '#101010', palette: ['1=ff0000', '17=00ff00'] })
    expect(t.foreground).toBe('#ffffff')
    expect(t.red).toBe('#ff0000')
    expect(t.extendedAnsi?.[1]).toBe('#00ff00')
    expect(withAlpha('#0d1117', 0.5)).toBe('rgba(13,17,23,0.5)')
  })
  it('loads and clamps persisted settings', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings('{"fontSize":99,"accent":"nope","blur":4}')).toMatchObject({ fontSize: 24, accent: 'omarchy', blur: 4 })
    expect(loadSettings('{"desktopBlur":200}').desktopBlur).toBe(64)
    expect(loadSettings('garbage')).toEqual(DEFAULT_SETTINGS)
  })
  it('maps an Omarchy colors.toml onto the terminal, under Rex', () => {
    const c = parseColors(
      'mode = "dark"\n\naccent = "#ff9f0a"\nbackground = "#1c1c1e"\nforeground = "#f5f5f7"\nred = "#ff5f4a"\nbright_red = "#ff8373"\nmuted = "#8e8e93"\n',
    )
    expect(c.accent).toBe('#ff9f0a')
    const base = omarchyTheme(c)
    expect(base).toMatchObject({ background: '#1c1c1e', red: '#ff5f4a', brightRed: '#ff8373', brightBlack: '#8e8e93' })
    // Missing keys keep the built-in palette; Rex's own colors still win.
    expect(base.blue).toBe('#6cb6ff')
    expect(rexTheme({ type: 'theme', palette: ['1=#ff0000'] }, base)).toMatchObject({ red: '#ff0000', background: '#1c1c1e' })
  })
})
