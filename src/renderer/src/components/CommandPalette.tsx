import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { fuzzyFilter, fuzzyIndices } from '../lib/fuzzy'
import { SHORTCUT_LABELS, type ShortcutAction } from '../lib/keys'
import { actions, active, selectSession, sessions, sortedServers, tabTitle, view } from '../state/store'
import { report } from '../state/toasts'
import { setDialog, setPaletteOpen, setRenamingTab, setSettingsOpen } from '../state/ui'
import { IconSearch } from './Icons'

interface Command {
  id: string
  title: string
  group: string
  hint?: string
  run: () => unknown
}

function commands(): Command[] {
  const has = !!active()
  const out: Command[] = []
  const add = (id: string, title: string, run: () => unknown, key?: ShortcutAction, group = 'Actions') =>
    out.push({ id, title, run, group, hint: key ? SHORTCUT_LABELS[key] : undefined })
  if (has) {
    add('new-tab', 'New tab', actions.newTab, 'newTab')
    add('split-right', 'Split right', () => actions.split('right'), 'splitRight')
    add('split-down', 'Split down', () => actions.split('down'), 'splitDown')
    add('zoom', 'Zoom or unzoom pane', () => actions.zoom(), 'zoom')
    add('close-pane', 'Close pane', () => actions.closePane(), 'closePane')
    const w = view()?.windows.find((x) => x.window_id === view()?.active_window_id)
    if (w) {
      add('rename-tab', 'Rename tab', () => setRenamingTab(w.window_id))
      add('close-tab', 'Close tab', () => actions.closeTab(w.window_id))
    }
    const sel = active()!
    const label = sessions[sel.serverId]?.find((s) => s.session_id === sel.sessionId)?.label ?? ''
    add('rename-session', 'Rename session', () =>
      setDialog({ kind: 'renameSession', serverId: sel.serverId, sessionId: sel.sessionId, label }),
    )
  }
  add('toggle-sidebar', 'Toggle sessions sidebar', actions.toggleSidebar, 'toggleSidebar')
  add('settings', 'Appearance settings', () => setSettingsOpen(true), 'settings')
  add('add-host', 'Add remote host', () => setDialog({ kind: 'addHost' }))
  for (const s of sortedServers())
    if (s.state === 'connected')
      out.push({
        id: `new-session:${s.id}`,
        title: `New session on ${s.label}`,
        group: 'Actions',
        run: () => setDialog({ kind: 'newSession', serverId: s.id }),
      })
  view()?.windows.forEach((w, i) => {
    const t = tabTitle(w)
    out.push({
      id: `tab:${w.window_id}`,
      title: `${t.process} ${t.cwd}`.trim(),
      group: 'Tabs',
      hint: i < 9 ? `Alt ${i + 1}` : undefined,
      run: () => actions.focusTab(w.window_id),
    })
  })
  for (const s of sortedServers())
    for (const x of sessions[s.id] ?? [])
      if (!(active()?.serverId === s.id && active()?.sessionId === x.session_id))
        out.push({
          id: `session:${s.id}:${x.session_id}`,
          title: `${x.label || 'Untitled'}`,
          group: `Sessions on ${s.label}`,
          run: () => selectSession(s.id, x.session_id).catch(report),
        })
  return out
}

function Highlight(props: { text: string; query: string }) {
  const marks = () => new Set(fuzzyIndices(props.query, props.text))
  return (
    <For each={[...props.text]}>{(ch, i) => (marks().has(i()) ? <mark>{ch}</mark> : ch)}</For>
  )
}

export function CommandPalette() {
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)
  const all = commands()
  const items = createMemo(() => fuzzyFilter(all, query(), (c) => c.title))
  let input!: HTMLInputElement
  let list!: HTMLDivElement
  onMount(() => input.focus())
  const close = () => setPaletteOpen(false)
  const run = (c?: Command) => {
    if (!c) return
    close()
    queueMicrotask(() => void c.run())
  }
  const move = (d: number) => {
    const n = items().length
    if (!n) return
    setIndex((i) => (i + d + n) % n)
    list.querySelector(`[data-i="${index()}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <div class="scrim top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="palette glass" role="dialog" aria-label="Command palette">
        <div class="palette-input">
          <IconSearch size={15} />
          <input
            ref={input}
            placeholder="Run a command or jump to a session…"
            value={query()}
            spellcheck={false}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) move(1)
              else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) move(-1)
              else if (e.key === 'Enter') run(items()[index()])
              else if (e.key === 'Escape') close()
              else return
              e.preventDefault()
            }}
          />
        </div>
        <div class="palette-list" ref={list} role="listbox">
          <For each={items()} fallback={<div class="palette-empty">No matching commands</div>}>
            {(c, i) => (
              <>
                <Show when={!query() && (i() === 0 || items()[i() - 1].group !== c.group)}>
                  <div class="palette-group">{c.group}</div>
                </Show>
                <div
                  class="palette-item"
                  classList={{ sel: i() === index() }}
                  data-i={i()}
                  role="option"
                  aria-selected={i() === index()}
                  onMouseMove={() => setIndex(i())}
                  onClick={() => run(c)}
                >
                  <span class="pi-title">
                    <Highlight text={c.title} query={query()} />
                  </span>
                  <Show when={query()}>
                    <span class="pi-group">{c.group}</span>
                  </Show>
                  <Show when={c.hint}>
                    <span class="kbd">
                      <For each={c.hint!.split(' ')}>{(k) => <kbd>{k}</kbd>}</For>
                    </span>
                  </Show>
                </div>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
