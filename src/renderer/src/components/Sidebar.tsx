import { For, Show } from 'solid-js'
import type { ServerInfo } from '../../../shared/ipc'
import { actions, active, selectSession, sessions, sortedServers } from '../state/store'
import { settings } from '../state/settings'
import { report } from '../state/toasts'
import { setDialog } from '../state/ui'
import {
  IconGlobe,
  IconPencil,
  IconPlug,
  IconPlus,
  IconServer,
  IconTrash,
  IconUsers,
} from './Icons'

const STATE_TEXT: Record<ServerInfo['state'], string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  disconnected: 'Not connected',
}

/** GUI-added hosts are the only ones removeHost accepts. */
const removable = (s: ServerInfo) => s.kind === 'remote' && !s.id.startsWith('saved:')

function ServerSection(props: { s: ServerInfo }) {
  const s = () => props.s
  const list = () => sessions[s().id] ?? []
  const Icon = () =>
    s().kind === 'personal' ? <IconServer size={14} /> : s().kind === 'shared' ? <IconUsers size={14} /> : <IconGlobe size={14} />
  return (
    <section class="srv">
      <div class="srv-head">
        <span class="srv-icon">
          <Icon />
        </span>
        <span class="srv-label" title={s().address}>
          {s().label}
        </span>
        <span class="dot" data-state={s().state} title={s().error ?? STATE_TEXT[s().state]} />
        <div class="srv-tools">
          <Show when={s().state === 'connected'}>
            <button
              class="ibtn"
              title="New session"
              aria-label={`New session on ${s().label}`}
              onClick={() => setDialog({ kind: 'newSession', serverId: s().id })}
            >
              <IconPlus size={13} />
            </button>
          </Show>
          <Show when={removable(s())}>
            <button
              class="ibtn danger"
              title="Remove host"
              aria-label={`Remove ${s().label}`}
              onClick={() => void actions.removeHost(s().id)}
            >
              <IconTrash size={13} />
            </button>
          </Show>
        </div>
      </div>
      <Show
        when={s().state === 'connected'}
        fallback={
          <div class="srv-off">
            <span>{s().state === 'disconnected' ? (s().error ? shortError(s().error!) : 'Not connected') : `${STATE_TEXT[s().state]}…`}</span>
            <Show when={s().state === 'disconnected'}>
              <button class="link" onClick={() => void actions.connect(s().id)}>
                <IconPlug size={12} /> {s().kind === 'personal' ? 'Start' : 'Connect'}
              </button>
            </Show>
          </div>
        }
      >
        <ul class="sess-list">
          <For each={list()} fallback={<li class="sess-empty">No sessions yet</li>}>
            {(x) => {
              const isActive = () => active()?.serverId === s().id && active()?.sessionId === x.session_id
              return (
                <li>
                  <button
                    class="sess"
                    classList={{ active: isActive() }}
                    onClick={() => void selectSession(s().id, x.session_id).catch(report)}
                    onDblClick={() =>
                      setDialog({ kind: 'renameSession', serverId: s().id, sessionId: x.session_id, label: x.label })
                    }
                  >
                    <span class="sess-label">{x.label || 'Untitled'}</span>
                  </button>
                  <div class="sess-tools">
                    <button
                      class="ibtn"
                      title="Rename session"
                      aria-label={`Rename ${x.label}`}
                      onClick={() =>
                        setDialog({ kind: 'renameSession', serverId: s().id, sessionId: x.session_id, label: x.label })
                      }
                    >
                      <IconPencil size={12} />
                    </button>
                    <button
                      class="ibtn danger"
                      title="End session"
                      aria-label={`End ${x.label}`}
                      onClick={() =>
                        setDialog({ kind: 'destroySession', serverId: s().id, sessionId: x.session_id, label: x.label })
                      }
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </section>
  )
}

function shortError(e: string) {
  if (/ENOENT|no such file/i.test(e)) return 'No server running'
  if (/ECONNREFUSED/i.test(e)) return 'Connection refused'
  if (/timed? ?out/i.test(e)) return 'Timed out'
  return e.length > 48 ? e.slice(0, 46) + '…' : e
}

export function Sidebar() {
  return (
    <aside class="sidebar glass" classList={{ open: settings.sidebarOpen }} aria-hidden={!settings.sidebarOpen}>
      <div class="sidebar-scroll">
        <For each={sortedServers()}>{(s) => <ServerSection s={s} />}</For>
      </div>
      <button class="sidebar-add" onClick={() => setDialog({ kind: 'addHost' })}>
        <IconPlus size={13} /> Add remote host
      </button>
    </aside>
  )
}
