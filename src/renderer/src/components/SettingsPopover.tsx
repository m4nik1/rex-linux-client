import { For, onCleanup, onMount } from 'solid-js'
import { ACCENTS, DEFAULT_SETTINGS, setSettings, settings, type AccentId, type Settings } from '../state/settings'
import { setSettingsOpen } from '../state/ui'

function Slider(props: {
  label: string
  k: keyof Pick<Settings, 'backgroundOpacity' | 'terminalOpacity' | 'blur' | 'fontSize'>
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
        style={{ '--fill': `${((settings[props.k] - props.min) / (props.max - props.min)) * 100}%` }}
        onInput={(e) => setSettings(props.k, Number(e.currentTarget.value))}
      />
    </label>
  )
}

export function SettingsPopover() {
  let el!: HTMLDivElement
  onMount(() => {
    const away = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setSettingsOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false)
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc, true)
    onCleanup(() => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc, true)
    })
  })
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div class="settings glass lens" ref={el} role="dialog" aria-label="Appearance">
      <h3>Appearance</h3>
      <Slider label="Window opacity" k="backgroundOpacity" min={0} max={1} step={0.01} format={pct} />
      <Slider label="Terminal tint" k="terminalOpacity" min={0} max={1} step={0.01} format={pct} />
      <Slider label="Glass blur" k="blur" min={0} max={48} step={1} format={(v) => `${v}px`} />
      <Slider label="Font size" k="fontSize" min={9} max={24} step={0.5} format={(v) => `${v}pt`} />
      <div class="accent-row">
        <span class="slider-label">Accent</span>
        <div class="swatches">
          <For each={Object.entries(ACCENTS) as [AccentId, (typeof ACCENTS)[AccentId]][]}>
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
      </div>
      <button
        class="link reset"
        onClick={() => {
          const { sidebarOpen } = settings
          setSettings({ ...DEFAULT_SETTINGS, sidebarOpen })
        }}
      >
        Reset to defaults
      </button>
    </div>
  )
}
