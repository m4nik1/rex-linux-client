import { createMemo, For, Show } from 'solid-js'
import { actions, booted, selectSession, servers, sessions, sortedServers } from '../state/store'
import { report } from '../state/toasts'
import { setDialog } from '../state/ui'
import { IconPlus, IconTerminal } from './Icons'

export function EmptyState() {
  const personal = () => servers().find((s) => s.id === 'personal')
  const connected = createMemo(() => sortedServers().filter((s) => s.state === 'connected'))
  const anyConnecting = () => servers().some((s) => s.state === 'connecting' || s.state === 'reconnecting')
  return (
    <div class="empty">
      <div class="empty-card">
        <div class="empty-mark">
          <IconTerminal size={26} />
        </div>
        <Show
          when={booted() && (connected().length || !anyConnecting())}
          fallback={
            <>
              <h1>Connecting to Rex</h1>
              <p>Looking for your local server…</p>
            </>
          }
        >
          <Show
            when={connected().length}
            fallback={
              <>
                <h1>No Rex server is running</h1>
                <p>
                  Start your personal server to open sessions here. From a shell, <code>rex server start</code> does the
                  same.
                </p>
                <Show when={personal()?.error}>
                  <p class="empty-err">{personal()!.error}</p>
                </Show>
                <div class="empty-actions">
                  <button class="btn" onClick={() => void actions.connect('personal')}>
                    Start local server
                  </button>
                  <button class="btn ghost" onClick={() => setDialog({ kind: 'addHost' })}>
                    Add remote host
                  </button>
                </div>
              </>
            }
          >
            <h1>Open a session</h1>
            <p>Pick up where you left off, or start something new.</p>
            <div class="empty-list">
              <For each={connected()}>
                {(s) => (
                  <For each={sessions[s.id] ?? []}>
                    {(x) => (
                      <button class="empty-sess" onClick={() => void selectSession(s.id, x.session_id).catch(report)}>
                        <span>{x.label || 'Untitled'}</span>
                        <small>{s.label}</small>
                      </button>
                    )}
                  </For>
                )}
              </For>
            </div>
            <div class="empty-actions">
              <button class="btn" onClick={() => setDialog({ kind: 'newSession', serverId: connected()[0].id })}>
                <IconPlus size={13} /> New session
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
