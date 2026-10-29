import {
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js'
import type { TailscaleStatus } from '../../../shared/ipc'
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  desktopBlurSupported,
  setSettings,
  settings,
  type AccentId,
  type Settings,
} from '../state/settings'
import {
  COLOR_KEYS,
  DEFAULT_THEME,
  composeTheme,
  hex,
  type ColorKey,
} from '../lib/theme'
import { REX_THEME_ID, THEMES } from '../lib/themes'
import { actions, focusedBlockId } from '../state/store'
import { terminals } from '../state/terminals'
import { report, toast } from '../state/toasts'
import { setSettingsOpen } from '../state/ui'

type Tab = 'appearance' | 'themes' | 'terminal' | 'tailscale' | 'agents'
const TABS: [Tab, string][] = [
  ['appearance', 'Appearance'],
  ['themes', 'Themes'],
  ['terminal', 'Terminal'],
  ['tailscale', 'Tailscale'],
  ['agents', 'Agents'],
]

type NumberKey = keyof {
  [K in keyof Settings as Settings[K] extends number ? K : never]: 1
}

function Slider(props: {
  label: string
  k: NumberKey
  min: number
  max: number
  step: number
  format: (v: number) => string
}) {
  return (
    <label class="slider">
      <span class="slider-label">{props.label}</span>
      <span class="slider-value">{props.format(settings[props.k])}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={settings[props.k]}
        style={{
          '--fill': `${((settings[props.k] - props.min) / (props.max - props.min)) * 100}%`,
        }}
        onInput={(e) => setSettings(props.k, Number(e.currentTarget.value))}
      />
    </label>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Section(props: {
  title: string
  children: JSX.Element
  hint?: string
}) {
  return (
    <section class="set-section">
      <h4>{props.title}</h4>
      <Show when={props.hint}>
        <p class="set-hint">{props.hint}</p>
      </Show>
      {props.children}
    </section>
  )
}

function Appearance() {
  return (
    <>
      <Section title="Glass">
        <Slider
          label="Window opacity"
          k="backgroundOpacity"
          min={0}
          max={1}
          step={0.01}
          format={pct}
        />
        <Slider
          label="Terminal tint"
          k="terminalOpacity"
          min={0}
          max={1}
          step={0.01}
          format={pct}
        />
        <Slider
          label="Glass blur"
          k="blur"
          min={0}
          max={48}
          step={1}
          format={(v) => `${v}px`}
        />
        <Show when={desktopBlurSupported()}>
          <Slider
            label="Desktop blur"
            k="desktopBlur"
            min={0}
            max={64}
            step={1}
            format={(v) => (v ? `${v}px` : 'System')}
          />
        </Show>
      </Section>
      <Section title="Accent">
        <div class="swatches">
          <For
            each={
              Object.entries(ACCENTS) as [
                AccentId,
                (typeof ACCENTS)[AccentId],
              ][]
            }
          >
            {([id, a]) => (
              <button
                class="swatch"
                classList={{ on: settings.accent === id }}
                style={{ '--c': a.color }}
                title={a.label}
                aria-label={`${a.label} accent`}
                onClick={() => setSettings('accent', id)}
              />
            )}
          </For>
        </div>
      </Section>
    </>
  )
}

function Preview(props: { id: string }) {
  const theme = () =>
    props.id === REX_THEME_ID
      ? DEFAULT_THEME
      : composeTheme(DEFAULT_THEME, THEMES[props.id].theme, {})
  const dots = () => [
    theme().red,
    theme().green,
    theme().yellow,
    theme().blue,
    theme().magenta,
    theme().cyan,
  ]
  return (
    <span
      class="theme-prev"
      style={{ background: theme().background, color: theme().foreground }}
    >
      <b>Aa</b>
      <i>
        <For each={dots()}>{(c) => <u style={{ background: c }} />}</For>
      </i>
    </span>
  )
}

function Themes() {
  const ids = [REX_THEME_ID, ...Object.keys(THEMES)]
  return (
    <Section
      title="Terminal theme"
      hint="“Rex” follows the colours your Rex server sends. Other themes replace them."
    >
      <div class="theme-grid">
        <For each={ids}>
          {(id) => (
            <button
              class="theme-card"
              classList={{ on: settings.colorScheme === id }}
              onClick={() => setSettings('colorScheme', id)}
            >
              <Preview id={id} />
              <span>
                {id === REX_THEME_ID ? 'Rex (default)' : THEMES[id].label}
              </span>
            </button>
          )}
        </For>
      </div>
    </Section>
  )
}

const COLOR_LABELS: Record<string, string> = {
  foreground: 'Text',
  background: 'Background',
  cursor: 'Cursor',
  selectionBackground: 'Selection',
}

function Terminal() {
  const base = () =>
    composeTheme(DEFAULT_THEME, THEMES[settings.colorScheme]?.theme, {})
  const current = (k: ColorKey) =>
    hex(settings.colorOverrides[k]) ?? hex(base()[k]) ?? '#000000'
  const setColor = (k: ColorKey, value: string) =>
    setSettings('colorOverrides', { ...settings.colorOverrides, [k]: value })
  const resetColor = (k: ColorKey) => {
    const { [k]: _drop, ...rest } = settings.colorOverrides
    setSettings('colorOverrides', rest)
  }
  const Swatch = (p: { k: ColorKey }) => (
    <label
      class="cpick"
      classList={{ changed: p.k in settings.colorOverrides }}
      title={`${COLOR_LABELS[p.k] ?? p.k}${p.k in settings.colorOverrides ? ' (double-click to reset)' : ''}`}
      onDblClick={() => resetColor(p.k)}
    >
      <input
        type="color"
        value={current(p.k).slice(0, 7)}
        onInput={(e) => setColor(p.k, e.currentTarget.value)}
      />
      <span style={{ background: current(p.k) }} />
    </label>
  )
  return (
    <>
      <Section title="Font">
        <label class="field">
          <span>Font family</span>
          <input
            value={settings.fontFamily}
            placeholder="JetBrainsMono Nerd Font Mono"
            spellcheck={false}
            onInput={(e) => setSettings('fontFamily', e.currentTarget.value)}
          />
        </label>
        <p class="set-hint">
          Comma-separated; installed monospace fonts are tried first, then
          built-in fallbacks.
        </p>
        <Slider
          label="Font size"
          k="fontSize"
          min={9}
          max={24}
          step={0.5}
          format={(v) => `${v}pt`}
        />
        <Slider
          label="Line height"
          k="lineHeight"
          min={1}
          max={2}
          step={0.02}
          format={(v) => v.toFixed(2)}
        />
      </Section>
      <Section
        title="Colours"
        hint="Overrides sit on top of the selected theme. Double-click a swatch to reset it."
      >
        <div class="color-row">
          <For
            each={
              [
                'foreground',
                'background',
                'cursor',
                'selectionBackground',
              ] as ColorKey[]
            }
          >
            {(k) => (
              <div class="color-item">
                <Swatch k={k} />
                <span>{COLOR_LABELS[k]}</span>
              </div>
            )}
          </For>
        </div>
        <div class="ansi-grid">
          <For each={COLOR_KEYS.slice(4) as unknown as ColorKey[]}>
            {(k) => <Swatch k={k} />}
          </For>
        </div>
        <Show when={Object.keys(settings.colorOverrides).length}>
          <button
            class="link reset"
            onClick={() => setSettings('colorOverrides', {})}
          >
            Clear colour overrides
          </button>
        </Show>
      </Section>
    </>
  )
}

function Tailscale() {
  const [status, { refetch, mutate }] = createResource<TailscaleStatus>(() =>
    window.rex.tailscaleStatus(),
  )
  const [busy, setBusy] = createSignal(false)
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      const next = await window.rex.tailscaleSet(on)
      mutate(next)
      if (next.authUrl) {
        await window.rex.openLoginUrl(next.authUrl).catch(report)
        toast('Finish signing in to Tailscale in your browser, then refresh.')
      }
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  const running = () => status()?.state === 'Running'
  return (
    <Section title="Tailscale">
      <Show
        when={!status.loading}
        fallback={<p class="set-hint">Checking Tailscale…</p>}
      >
        <Show
          when={status()?.installed}
          fallback={
            <p class="set-hint">
              The tailscale CLI wasn’t found on this machine.
            </p>
          }
        >
          <div class="row-between">
            <div>
              <div class="row-title">
                <span class="dot" classList={{ ok: running() }} />
                {running()
                  ? 'Connected'
                  : status()?.state === 'NeedsLogin'
                    ? 'Needs login'
                    : (status()?.state ?? 'Unknown')}
              </div>
              <Show when={running()}>
                <div class="set-hint">
                  {status()?.self?.dns || status()?.self?.name} ·{' '}
                  {status()?.self?.ip}
                  {status()?.tailnet ? ` · ${status()?.tailnet}` : ''}
                </div>
              </Show>
            </div>
            <div class="row-actions">
              <button
                class="btn ghost"
                disabled={busy()}
                onClick={() => void refetch()}
              >
                Refresh
              </button>
              <button
                class="btn"
                disabled={busy()}
                onClick={() => void toggle(!running())}
              >
                {busy() ? 'Working…' : running() ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          </div>
          <Show when={status()?.error}>
            <p class="form-error">{status()?.error}</p>
          </Show>
          <Show when={running() && status()!.peers.length}>
            <h5>Devices</h5>
            <ul class="list">
              <For each={status()!.peers}>
                {(p) => (
                  <li>
                    <span class="dot" classList={{ ok: p.online }} />
                    <div class="grow">
                      <div class="row-title">{p.name}</div>
                      <div class="set-hint">
                        {p.os} · {p.ip}
                      </div>
                    </div>
                    <button
                      class="btn ghost"
                      disabled={!p.online || !p.dns}
                      onClick={() =>
                        void actions.addHost(p.name, p.dns).catch(report)
                      }
                    >
                      Add as host
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}

function Agents() {
  const [agents, { refetch }] = createResource(() => window.rex.detectAgents())
  const launch = (command: string) => {
    const id = focusedBlockId()
    const term = id ? terminals.get(id) : undefined
    if (!term) return toast('Open a terminal pane first.', 'error')
    term.input(command + '\r')
    setSettingsOpen(false)
  }
  return (
    <Section
      title="Coding agents"
      hint="Detected on this machine. Launch types the command into the focused terminal pane."
    >
      <Show when={!agents.loading} fallback={<p class="set-hint">Scanning…</p>}>
        <ul class="list">
          <For
            each={[...(agents() ?? [])].sort(
              (a, b) => Number(b.installed) - Number(a.installed),
            )}
          >
            {(a) => (
              <li classList={{ dim: !a.installed }}>
                <span class="dot" classList={{ ok: a.installed }} />
                <div class="grow">
                  <div class="row-title">{a.name}</div>
                  <div class="set-hint">
                    {a.installed
                      ? (a.version ?? a.path)
                      : `${a.command} not found`}
                  </div>
                </div>
                <Show when={a.installed}>
                  <button class="btn ghost" onClick={() => launch(a.command)}>
                    Launch
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <button class="link reset" onClick={() => void refetch()}>
          Rescan
        </button>
      </Show>
    </Section>
  )
}

export function SettingsDialog() {
  const [tab, setTab] = createSignal<Tab>('appearance')
  onMount(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setSettingsOpen(false)
    }
    window.addEventListener('keydown', esc, true)
    onCleanup(() => window.removeEventListener('keydown', esc, true))
  })
  return (
    <div
      class="scrim"
      onMouseDown={(e) =>
        e.target === e.currentTarget && setSettingsOpen(false)
      }
    >
      <div
        class="settings-dialog glass lens"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <nav class="set-nav">
          <h3>Settings</h3>
          <For each={TABS}>
            {([id, label]) => (
              <button
                classList={{ on: tab() === id }}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            )}
          </For>
          <button
            class="link reset"
            onClick={() => {
              const { sidebarOpen } = settings
              setSettings({ ...DEFAULT_SETTINGS, sidebarOpen })
            }}
          >
            Reset to defaults
          </button>
        </nav>
        <div class="set-body">
          <Show when={tab() === 'appearance'}>
            <Appearance />
          </Show>
          <Show when={tab() === 'themes'}>
            <Themes />
          </Show>
          <Show when={tab() === 'terminal'}>
            <Terminal />
          </Show>
          <Show when={tab() === 'tailscale'}>
            <Tailscale />
          </Show>
          <Show when={tab() === 'agents'}>
            <Agents />
          </Show>
        </div>
        <button
          class="ibtn set-close"
          aria-label="Close settings"
          onClick={() => setSettingsOpen(false)}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
