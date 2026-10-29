import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { RexWindow } from '../../../shared/ipc'
import { actions, active, tabTitle, view } from '../state/store'
import { settings } from '../state/settings'
import {
  renamingTab,
  setPaletteOpen,
  setRenamingTab,
  setSettingsOpen,
  settingsOpen,
} from '../state/ui'
import {
  IconClose,
  IconCommand,
  IconEye,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconRestore,
  IconSidebar,
} from './Icons'
import { ProcessTile } from './TerminalPane'

const TAB_TYPE = 'application/x-rex-window'

function WindowControls() {
  const [max, setMaxSignal] = createSignal(false)
  const setMax = (m: boolean) => {
    setMaxSignal(m)
    document.documentElement.classList.toggle('maximized', m)
  }
  onMount(() => {
    void window.rex.isMaximized().then(setMax)
    onCleanup(window.rex.onMaximizeChange(setMax))
  })
  return (
    <div class="wctl" role="group" aria-label="Window">
      <button class="ibtn tb" title="Minimize" aria-label="Minimize" onClick={() => window.rex.minimize()}>
        <IconMinimize size={15} />
      </button>
      <button
        class="ibtn tb"
        title={max() ? 'Restore' : 'Maximize'}
        aria-label={max() ? 'Restore' : 'Maximize'}
        onClick={() => window.rex.maximize()}
      >
        {max() ? <IconRestore size={15} /> : <IconMaximize size={15} />}
      </button>
      <button class="ibtn tb danger" title="Close" aria-label="Close window" onClick={() => window.rex.close()}>
        <IconClose size={15} />
      </button>
    </div>
  )
}

function Tab(props: { w: RexWindow; index: number; active: boolean }) {
  const t = () => tabTitle(props.w)
  const [over, setOver] = createSignal<'before' | 'after' | null>(null)
  let input!: HTMLInputElement
  const commit = (value?: string) => {
    const label = value?.trim()
    setRenamingTab(null)
    if (label && label !== props.w.label) void actions.renameTab(props.w.window_id, label)
  }
  return (
    <div
      class="tab"
      classList={{ active: props.active, 'drop-before': over() === 'before', 'drop-after': over() === 'after' }}
      role="tab"
      aria-selected={props.active}
      draggable={renamingTab() !== props.w.window_id}
      onClick={() => !props.active && actions.focusTab(props.w.window_id)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          void actions.closeTab(props.w.window_id)
        }
      }}
      onDblClick={() => {
        setRenamingTab(props.w.window_id)
        queueMicrotask(() => input?.select())
      }}
      onDragStart={(e) => {
        e.dataTransfer?.setData(TAB_TYPE, props.w.window_id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes(TAB_TYPE)) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        setOver(e.clientX < box.left + box.width / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        const side = over()
        setOver(null)
        const from = e.dataTransfer?.getData(TAB_TYPE)
        if (!from || from === props.w.window_id) return
        e.preventDefault()
        const windows = view()?.windows ?? []
        const before =
          side === 'before' ? props.w.window_id : (windows[props.index + 1]?.window_id ?? null)
        if (before !== from) void actions.moveTab(from, before)
      }}
      title={t().custom ? t().process : `${t().process} ${t().cwd}`}
    >
      <ProcessTile name={t().custom ? 'shell' : t().process} small />
      <Show
        when={renamingTab() === props.w.window_id}
        fallback={
          <span class="tab-text">
            <span class="tab-proc">{t().process}</span>
            <Show when={t().cwd}>
              <span class="tab-cwd">{t().cwd}</span>
            </Show>
          </span>
        }
      >
        <input
          ref={input}
          class="tab-rename"
          value={props.w.label}
          placeholder="Tab name"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            else if (e.key === 'Escape') commit()
            e.stopPropagation()
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      </Show>
      <button
        class="tab-close"
        title="Close tab"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          void actions.closeTab(props.w.window_id)
        }}
      >
        <IconClose size={11} />
      </button>
    </div>
  )
}

export function Titlebar() {
  return (
    <header class="titlebar">
      <button
        class="ibtn tb"
        classList={{ on: settings.sidebarOpen }}
        title="Sessions (Ctrl+Shift+B)"
        aria-label="Toggle sessions sidebar"
        onClick={actions.toggleSidebar}
      >
        <IconSidebar size={17} />
      </button>
      <nav class="tabs" role="tablist">
        <Show
          when={active() && view()}
          fallback={<span class="tb-hint">{active() ? 'Loading…' : 'Rex'}</span>}
        >
          <For each={view()?.windows ?? []}>
            {(w, i) => <Tab w={w} index={i()} active={w.window_id === view()?.active_window_id} />}
          </For>
        </Show>
      </nav>
      <div class="tb-right">
        <button
          class="ibtn tb"
          classList={{ on: settingsOpen() }}
          title="Appearance (Ctrl+Shift+,)"
          aria-label="Appearance settings"
          onClick={(e) => {
            e.stopPropagation()
            setSettingsOpen(!settingsOpen())
          }}
        >
          <IconEye size={17} />
        </button>
        <button
          class="ibtn tb"
          title="Command palette (Ctrl+Shift+P)"
          aria-label="Command palette"
          onClick={() => setPaletteOpen(true)}
        >
          <IconCommand size={16} />
        </button>
        <button
          class="ibtn tb"
          title="New tab (Ctrl+Shift+T)"
          aria-label="New tab"
          disabled={!active()}
          onClick={actions.newTab}
        >
          <IconPlus size={17} />
        </button>
      </div>
      <WindowControls />
    </header>
  )
}
