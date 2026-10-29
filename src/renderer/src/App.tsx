import { onCleanup, onMount, Show } from 'solid-js'
import { matchShortcut, type ShortcutAction } from './lib/keys'
import { bindSettings } from './state/settings'
import {
  actions,
  active,
  boot,
  focusedBlockId,
  handleBlockEvent,
  onSessionView,
  refreshSessions,
  upsertServer,
  view,
} from './state/store'
import { terminals } from './state/terminals'
import { report, toast } from './state/toasts'
import { dialog, paletteOpen, setPaletteOpen, setSettingsOpen, settingsOpen } from './state/ui'
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { EmptyState } from './components/EmptyState'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/SettingsDialog'
import { Dialogs } from './components/Dialogs'
import { Toasts } from './components/Toasts'
import { GlassDefs } from './components/GlassDefs'

async function runShortcut(a: ShortcutAction) {
  const term = () => {
    const id = focusedBlockId()
    return id ? terminals.get(id) : undefined
  }
  switch (a) {
    case 'newTab':
      return actions.newTab()
    case 'closePane':
      return actions.closePane()
    case 'splitRight':
      return actions.split('right')
    case 'splitDown':
      return actions.split('down')
    case 'nextTab':
      return actions.cycleTab(1)
    case 'prevTab':
      return actions.cycleTab(-1)
    case 'focusLeft':
      return actions.focusDirection('left')
    case 'focusRight':
      return actions.focusDirection('right')
    case 'focusUp':
      return actions.focusDirection('up')
    case 'focusDown':
      return actions.focusDirection('down')
    case 'zoom':
      return actions.zoom()
    case 'palette':
      return setPaletteOpen(!paletteOpen())
    case 'toggleSidebar':
      return actions.toggleSidebar()
    case 'settings':
      return setSettingsOpen(!settingsOpen())
    case 'copy': {
      const text = term()?.selection()
      if (text) {
        await window.rex.writeClipboard(text)
        toast('Copied selection.', 'info', 1400)
      }
      return
    }
    case 'paste': {
      const text = await window.rex.readClipboard()
      if (text) term()?.paste(text)
      return
    }
    default:
      if (a.startsWith('tab')) return actions.tabAt(Number(a.slice(3)) - 1)
  }
}

export function App() {
  bindSettings()
  onMount(() => {
    const off = [
      window.rex.onServerState(upsertServer),
      window.rex.onSessionView((e) => onSessionView(e.serverId, e.sessionId, e.view)),
      window.rex.onBlockEvent(handleBlockEvent),
      window.rex.onServerEvent((e) => {
        if (['session_created', 'session_destroyed', 'session_moved', 'session_label_changed'].includes(e.type))
          void refreshSessions(e.serverId).catch(() => {})
      }),
    ]
    // Capture phase: app chords are handled before xterm or inputs see them.
    const onKey = (e: KeyboardEvent) => {
      const a = matchShortcut(e)
      if (!a) return
      const inField = (e.target as HTMLElement | null)?.matches?.('input, textarea:not(.xterm-helper-textarea)')
      if (inField && (a === 'copy' || a === 'paste')) return
      if ((dialog() || paletteOpen()) && a !== 'palette') return
      e.preventDefault()
      e.stopPropagation()
      void runShortcut(a)?.catch(report)
    }
    window.addEventListener('keydown', onKey, true)
    off.push(() => window.removeEventListener('keydown', onKey, true))
    onCleanup(() => off.forEach((fn) => fn()))
    void boot().catch(report)
  })

  return (
    <div class="app">
      <GlassDefs />
      <div class="base" aria-hidden="true" />
      <Titlebar />
      <div class="body">
        <Sidebar />
        <main class="main">
          <Show when={active() && view()} fallback={<EmptyState />}>
            <Workspace />
          </Show>
        </main>
      </div>
      <Show when={settingsOpen()}>
        <SettingsDialog />
      </Show>
      <Show when={paletteOpen()}>
        <CommandPalette />
      </Show>
      <Dialogs />
      <Toasts />
    </div>
  )
}
