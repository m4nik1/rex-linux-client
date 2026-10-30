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
  isShellProcess,
  isLocalServer,
} from '../src/renderer/src/lib/format'
import { matchShortcut } from '../src/renderer/src/lib/keys'
import { omarchyTheme, rexTheme, withAlpha, composeTheme } from '../src/renderer/src/lib/theme'
import {
  loadSettings,
  DEFAULT_SETTINGS,
  cleanFontFamily,
  settings,
  setSettings,
  setColorOverride,
  resetColorOverride,
  clearColorOverrides,
  resetSettings,
} from '../src/renderer/src/state/settings'
import { parseColors } from '../src/main/omarchy-theme'

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
  it('recognises shells and local servers', () => {
    expect(['fish', 'zsh', 'bash', '-bash', '/bin/sh', 'nu', 'pwsh'].every(isShellProcess)).toBe(true)
    expect(['nvim', 'Node', 'claude', 'ssh', 'htop'].some(isShellProcess)).toBe(false)
    expect(isLocalServer({ kind: 'personal', address: 'unix:///run/user/1000/rex/server.sock' })).toBe(true)
    expect(isLocalServer({ kind: 'shared', address: 'unix:///run/rex/server.sock' })).toBe(true)
    expect(isLocalServer({ kind: 'remote', address: 'box.tail.ts.net' })).toBe(false)
    expect(isLocalServer({ kind: 'personal', address: 'tcp://10.0.0.2:7297' })).toBe(false)
    expect(isLocalServer(undefined)).toBe(false)
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
  it('validates font, line height, scheme and colour overrides', () => {
    const s = loadSettings(
      '{"lineHeight":9,"colorScheme":"nope","fontFamily":"Fira{;}","colorOverrides":{"red":"#f00","bogus":"#fff","cursor":"x"}}',
    )
    expect(s.lineHeight).toBe(2)
    expect(s.colorScheme).toBe('rex')
    expect(s.fontFamily).toBe('Fira')
    expect(s.colorOverrides).toEqual({ red: '#ff0000' })
  })
  it('rejects inherited keys for scheme and accent', () => {
    const s = loadSettings('{"colorScheme":"constructor","accent":"constructor"}')
    expect(s.colorScheme).toBe('rex')
    expect(s.accent).toBe(DEFAULT_SETTINGS.accent)
    expect(loadSettings('{"accent":"toString","colorScheme":"__proto__"}')).toMatchObject({ accent: DEFAULT_SETTINGS.accent, colorScheme: 'rex' })
    expect(loadSettings('{"accent":"mint"}').accent).toBe('mint')
  })
  it('sanitises each font name', () => {
    expect(cleanFontFamily(' "Fira Code" , \'Iosevka\'; , {x}, a\\b ,, ')).toBe('Fira Code, Iosevka, x, ab')
    expect(cleanFontFamily(42)).toBe('')
    expect(loadSettings('{"fontFamily":"\\"Fira\\" }; body{"}').fontFamily).toBe('Fira body')
  })
  it('never shares default objects with loaded settings', () => {
    expect(loadSettings('garbage').colorOverrides).not.toBe(DEFAULT_SETTINGS.colorOverrides)
    expect(loadSettings(null).colorOverrides).not.toBe(DEFAULT_SETTINGS.colorOverrides)
  })
  it('resets single colours, all colours and all settings', () => {
    setColorOverride('red', '#aa0000')
    setColorOverride('blue', '#0000aa')
    resetColorOverride('red')
    expect({ ...settings.colorOverrides }).toEqual({ blue: '#0000aa' })
    setColorOverride('green', '#00aa00')
    clearColorOverrides()
    expect(Object.keys(settings.colorOverrides)).toEqual([])
    setColorOverride('cyan', '#00aaaa')
    setSettings({ fontSize: 20, sidebarOpen: true })
    resetSettings()
    expect(Object.keys(settings.colorOverrides)).toEqual([])
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
    expect(settings.sidebarOpen).toBe(true)
    expect(DEFAULT_SETTINGS.colorOverrides).toEqual({})
  })
  it('composes preset and overrides over the Rex theme', () => {
    const base = rexTheme({ type: 'theme', background: '#101010' })
    const t = composeTheme(base, { background: '#222222', red: '#aa0000' }, { red: '#bb0000', background: '#333333' })
    expect(t.red).toBe('#bb0000')
    expect(t.background).toBe('#333333')
    expect(t.cursorAccent).toBe('#333333')
    expect(composeTheme(base, undefined, {}).background).toBe('#101010')
  })
})

import { parseTailscale, tailscaleStatusFrom, tailscaleSetError, OPERATOR_HINT } from '../src/main/integrations'
describe('tailscale status', () => {
  it('parses peers, online first', () => {
    const s = parseTailscale(
      JSON.stringify({
        BackendState: 'Running',
        Self: { HostName: 'me', DNSName: 'me.tail.ts.net.', TailscaleIPs: ['100.1.1.1'] },
        Peer: {
          a: { HostName: 'zed', DNSName: 'zed.tail.ts.net.', Online: false, OS: 'linux', TailscaleIPs: ['100.1.1.3'] },
          b: { HostName: 'box', DNSName: 'box.tail.ts.net.', Online: true, OS: 'linux', TailscaleIPs: ['100.1.1.2'] },
        },
      }),
    )
    expect(s.state).toBe('Running')
    expect(s.self?.dns).toBe('me.tail.ts.net')
    expect(s.peers.map((p) => p.name)).toEqual(['box', 'zed'])
  })
  const r = (o: Partial<Parameters<typeof tailscaleStatusFrom>[0]>) => ({ stdout: '', stderr: '', code: 1, timedOut: false, ...o })
  it('maps missing CLI, timeouts and errors', () => {
    expect(tailscaleStatusFrom(r({ code: null, errno: 'ENOENT' }))).toMatchObject({ installed: false, state: 'NotInstalled' })
    expect(tailscaleStatusFrom(r({ code: null, timedOut: true }))).toMatchObject({ installed: true, state: 'Error', error: 'tailscale timed out' })
    expect(tailscaleStatusFrom(r({ stderr: 'failed to connect to local tailscaled\nmore' }))).toMatchObject({ state: 'Error', error: 'failed to connect to local tailscaled' })
    expect(tailscaleStatusFrom(r({ stdout: '{"BackendState":"Stopped"}' })).state).toBe('Stopped')
  })
  it('hints at the operator setting when up is denied', () => {
    expect(tailscaleSetError(r({ code: 0 }))).toBeUndefined()
    expect(tailscaleSetError(r({ stderr: 'Access denied: prefs write access denied\nUse sudo tailscale up' }))).toBe(OPERATOR_HINT)
    expect(tailscaleSetError(r({ code: null, timedOut: true }))).toBe('tailscale timed out')
    expect(tailscaleSetError(r({ stderr: 'boom\nlast line' }))).toBe('last line')
  })
})

describe('Omarchy theme', () => {
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
