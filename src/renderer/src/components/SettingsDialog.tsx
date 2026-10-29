import {
  createEffect,
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
  cleanFontFamily,
  clearColorOverrides,
  desktopBlurSupported,
  resetColorOverride,
  resetSettings,
  setColorOverride,
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
import { isLocalServer, isShellProcess } from '../lib/format'
import {
  actions,
  activeServer,
  blockMeta,
  focusedBlockId,
} from '../state/store'
import { focusedRexColors, terminals } from '../state/terminals'
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
                aria-pressed={settings.accent === id}
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

/** The focused pane's Rex colours, or the built-in default before any arrive. */
const rexBase = () => focusedRexColors() ?? DEFAULT_THEME

function Preview(props: { id: string }) {
  const theme = () =>
    composeTheme(rexBase(), THEMES[props.id]?.theme, {})
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
              aria-pressed={settings.colorScheme === id}
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

const errText = (e: unknown) =>
  e instanceof Error ? e.message : String(e ?? 'Unknown error')

function FontFamily() {
  let input!: HTMLInputElement
  let timer: ReturnType<typeof setTimeout> | undefined
  const commit = () => {
    clearTimeout(timer)
    const next = cleanFontFamily(input.value)
    if (next !== settings.fontFamily) setSettings('fontFamily', next)
  }
  // Mirror outside changes (e.g. reset) without fighting the person typing.
  createEffect(() => {
    const v = settings.fontFamily
    if (document.activeElement !== input) input.value = v
  })
  onCleanup(commit)
  return (
    <label class="field">
      <span>Font family</span>
      <input
        ref={input}
        placeholder="JetBrainsMono Nerd Font Mono"
        spellcheck={false}
        onInput={() => {
          clearTimeout(timer)
          timer = setTimeout(commit, 300)
        }}
        onBlur={() => {
          commit()
          input.value = settings.fontFamily
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  )
}

function Terminal() {
  const base = () =>
    composeTheme(rexBase(), THEMES[settings.colorScheme]?.theme, {})
  const changed = (k: ColorKey) => settings.colorOverrides[k] !== undefined
  const current = (k: ColorKey) =>
    hex(settings.colorOverrides[k]) ?? hex(base()[k]) ?? '#000000'
  const label = (k: ColorKey) => COLOR_LABELS[k] ?? k
  const Swatch = (p: { k: ColorKey }) => (
    <div class="cpick-wrap">
      <label
        class="cpick"
        classList={{ changed: changed(p.k) }}
        title={`${label(p.k)}${changed(p.k) ? ' (double-click to reset)' : ''}`}
        onDblClick={() => resetColorOverride(p.k)}
      >
        <input
          type="color"
          aria-label={`${label(p.k)} colour`}
          value={current(p.k).slice(0, 7)}
          onInput={(e) => setColorOverride(p.k, e.currentTarget.value)}
        />
        <span style={{ background: current(p.k) }} />
      </label>
      <Show when={changed(p.k)}>
        <button
          class="cpick-reset"
          title={`Reset ${label(p.k)}`}
          aria-label={`Reset ${label(p.k)} colour`}
          onClick={() => resetColorOverride(p.k)}
        >
          ↺
        </button>
      </Show>
    </div>
  )
  return (
    <>
      <Section title="Font">
        <FontFamily />
        <p class="set-hint">
          Fonts you list are tried in order before the built-in fallbacks.
        </p>
        <Slider
          label="Font size"
          k="fontSize"
          min={9}
          max={24}
          step={0.5}
          format={(v) => `${v}px`}
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
        hint="Overrides sit on top of the selected theme. Use ↺ (or double-click a swatch) to reset one."
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
          <button class="link set-reset" onClick={clearColorOverrides}>
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
  // Never read status() while errored: a rejected resource throws on read.
  const data = () => (status.error ? undefined : status())
  const [busy, setBusy] = createSignal(false)
  const [added, setAdded] = createSignal<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = createSignal<string>()
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
  const addHost = async (name: string, dns: string) => {
    setAdding(dns)
    try {
      await actions.addHost(name, dns)
      setAdded((s) => new Set(s).add(dns))
    } catch (e) {
      report(e)
    } finally {
      setAdding(undefined)
    }
  }
  const running = () => data()?.state === 'Running'
  return (
    <Section title="Tailscale">
      <Show
        when={!status.loading}
        fallback={<p class="set-hint">Checking Tailscale…</p>}
      >
        <Show
          when={!status.error}
          fallback={
            <div class="set-row-between">
              <p class="form-error">
                Couldn’t check Tailscale: {errText(status.error)}
              </p>
              <button class="btn ghost" onClick={() => void refetch()}>
                Retry
              </button>
            </div>
          }
        >
          <Show
            when={data()?.installed}
            fallback={
              <p class="set-hint">
                The tailscale CLI wasn’t found on this machine.
              </p>
            }
          >
            <div class="set-row-between">
              <div>
                <div class="set-row-title">
                  <span class="set-dot" classList={{ ok: running() }} />
                  {running()
                    ? 'Connected'
                    : data()?.state === 'NeedsLogin'
                      ? 'Needs login'
                      : (data()?.state ?? 'Unknown')}
                </div>
                <Show when={running()}>
                  <div class="set-meta">
                    {data()?.self?.dns || data()?.self?.name} ·{' '}
                    {data()?.self?.ip}
                    {data()?.tailnet ? ` · ${data()?.tailnet}` : ''}
                  </div>
                </Show>
              </div>
              <div class="set-row-actions">
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
            <Show when={data()?.error}>
              <p class="form-error">{data()?.error}</p>
            </Show>
            <Show when={running() && data()?.peers.length}>
              <h5>Devices</h5>
              <ul class="set-list">
                <For each={data()?.peers ?? []}>
                  {(p) => (
                    <li>
                      <span class="set-dot" classList={{ ok: p.online }} />
                      <div class="set-grow">
                        <div class="set-row-title">{p.name}</div>
                        <div class="set-meta">
                          {p.os} · {p.ip}
                        </div>
                      </div>
                      <button
                        class="btn ghost"
                        disabled={
                          !p.online ||
                          !p.dns ||
                          added().has(p.dns) ||
                          adding() === p.dns
                        }
                        onClick={() => void addHost(p.name, p.dns)}
                      >
                        {added().has(p.dns)
                          ? 'Added'
                          : adding() === p.dns
                            ? 'Adding…'
                            : 'Add as host'}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}

function Agents() {
  const [agents, { refetch }] = createResource(() => window.rex.detectAgents())
  const list = () =>
    [...((agents.error ? undefined : agents()) ?? [])].sort(
      (a, b) => Number(b.installed) - Number(a.installed),
    )
  const launch = (command: string) => {
    const id = focusedBlockId()
    const term = id ? terminals.get(id) : undefined
    if (!id || !term) return toast('Open a terminal pane first.', 'error')
    const server = activeServer()
    if (!isLocalServer(server))
      return toast(
        `Agents run on this machine, but the focused pane is on ${server?.label ?? 'a remote server'}. Focus a Personal or Shared pane first.`,
        'error',
      )
    const proc = blockMeta[id]?.process
    if (proc && !isShellProcess(proc))
      return toast(
        `The focused pane is running ${proc}. Return to a shell prompt first.`,
        'error',
      )
    term.input(command + '\r')
    setSettingsOpen(false)
  }
  return (
    <Section
      title="Coding agents"
      hint="Detected on this machine. Launch types the command into the focused terminal pane."
    >
      <Show when={!agents.loading} fallback={<p class="set-hint">Scanning…</p>}>
        <Show when={agents.error}>
          <p class="form-error">
            Couldn’t scan for agents: {errText(agents.error)}
          </p>
        </Show>
        <ul class="set-list">
          <For each={list()}>
            {(a) => (
              <li classList={{ dim: !a.installed }}>
                <span class="set-dot" classList={{ ok: a.installed }} />
                <div class="set-grow">
                  <div class="set-row-title">{a.name}</div>
                  <div class="set-meta">
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
        <button class="link set-reset" onClick={() => void refetch()}>
          Rescan
        </button>
      </Show>
    </Section>
  )
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SettingsDialog() {
  const [tab, setTab] = createSignal<Tab>('appearance')
  const [confirmReset, setConfirmReset] = createSignal(false)
  let dialogEl!: HTMLDivElement
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  const tabButtons: Partial<Record<Tab, HTMLButtonElement>> = {}

  const onReset = () => {
    clearTimeout(resetTimer)
    if (confirmReset()) {
      setConfirmReset(false)
      resetSettings()
      return
    }
    setConfirmReset(true)
    resetTimer = setTimeout(() => setConfirmReset(false), 3000)
  }

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([id]) => id === tab())
    const next =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    const id = TABS[next][0]
    setTab(id)
    tabButtons[id]?.focus()
  }

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null
    tabButtons[tab()]?.focus()

    const onKey = (e: KeyboardEvent) => {
      // Keystrokes never reach the panes behind the dialog.
      if (!dialogEl.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key !== 'Escape') {
          dialogEl.focus()
          return
        }
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        setSettingsOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = [
        ...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.getClientRects().length)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = !!active && dialogEl.contains(active)
      if (e.shiftKey && (!inside || active === first || active === dialogEl)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(resetTimer)
      // Restore focus once the dialog has left the DOM.
      queueMicrotask(() => {
        if (
          previous?.isConnected &&
          previous !== document.body &&
          !previous.closest('.xterm')
        )
          previous.focus()
        else {
          const id = focusedBlockId()
          if (id) terminals.get(id)?.focus()
        }
      })
    })
  })

  return (
    <div
      class="scrim"
      onMouseDown={(e) =>
        e.target === e.currentTarget && setSettingsOpen(false)
      }
    >
      <div
        ref={dialogEl}
        class="settings-dialog glass lens"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
        tabIndex={-1}
      >
        <nav class="set-nav">
          <h3 id="set-title">Settings</h3>
          <div
            class="set-tabs"
            role="tablist"
            aria-orientation="vertical"
            aria-labelledby="set-title"
            onKeyDown={onTabKey}
          >
            <For each={TABS}>
              {([id, label]) => (
                <button
                  ref={(el) => (tabButtons[id] = el)}
                  id={`set-tab-${id}`}
                  role="tab"
                  aria-selected={tab() === id}
                  aria-controls="set-panel"
                  tabIndex={tab() === id ? 0 : -1}
                  classList={{ on: tab() === id }}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <button
            class="link set-reset"
            classList={{ confirm: confirmReset() }}
            onClick={onReset}
          >
            {confirmReset() ? 'Click again to confirm' : 'Reset to defaults'}
          </button>
        </nav>
        <div
          class="set-body"
          id="set-panel"
          role="tabpanel"
          aria-labelledby={`set-tab-${tab()}`}
        >
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
