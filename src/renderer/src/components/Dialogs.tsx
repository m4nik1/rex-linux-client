import { createSignal, Match, onMount, Show, Switch, type JSX } from 'solid-js'
import { parseHostInput } from '../lib/format'
import { actions, servers } from '../state/store'
import { errorText } from '../state/toasts'
import { dialog, setDialog, type DialogState } from '../state/ui'

function Frame(props: {
  title: string
  children: JSX.Element
  onSubmit: () => void | Promise<void>
  submit: string
  danger?: boolean
  disabled?: boolean
  error?: string
}) {
  const [busy, setBusy] = createSignal(false)
  let form!: HTMLFormElement
  onMount(() => form.querySelector<HTMLInputElement>('input')?.select() ?? form.querySelector<HTMLButtonElement>('button[type=submit]')?.focus())
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
      <form
        ref={form}
        class="dialog glass lens"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy() || props.disabled) return
          setBusy(true)
          try {
            await props.onSubmit()
          } finally {
            setBusy(false)
          }
        }}
      >
        <h2>{props.title}</h2>
        {props.children}
        <Show when={props.error}>
          <p class="form-error">{props.error}</p>
        </Show>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button type="submit" class="btn" classList={{ danger: props.danger }} disabled={busy() || props.disabled}>
            {busy() ? 'Working…' : props.submit}
          </button>
        </div>
      </form>
    </div>
  )
}

function LabelDialog(props: { title: string; initial: string; submit: string; onSubmit: (v: string) => Promise<unknown> | void }) {
  const [value, setValue] = createSignal(props.initial)
  return (
    <Frame
      title={props.title}
      submit={props.submit}
      disabled={!value().trim()}
      onSubmit={async () => {
        await props.onSubmit(value().trim())
        setDialog(null)
      }}
    >
      <label class="field">
        <span>Name</span>
        <input value={value()} onInput={(e) => setValue(e.currentTarget.value)} spellcheck={false} />
      </label>
    </Frame>
  )
}

const KIND_TEXT = {
  tailscale: 'Tailscale MagicDNS name: connects over HTTPS, trying port 443 then 7297.',
  host: 'Host name: tries HTTPS on 443, then HTTPS and HTTP on 7297.',
  account: 'Account on a login server: signs in as that account over HTTPS.',
  url: 'Full URL: used exactly as written.',
} as const

function AddHostDialog() {
  const [label, setLabel] = createSignal('')
  const [address, setAddress] = createSignal('')
  const [error, setError] = createSignal('')
  const parsed = () => parseHostInput(address())
  return (
    <Frame
      title="Add a remote Rex server"
      submit="Add host"
      disabled={!parsed().ok}
      error={error()}
      onSubmit={async () => {
        setError('')
        const p = parsed()
        try {
          await actions.addHost(label().trim() || p.label, p.address)
          setDialog(null)
        } catch (e) {
          setError(errorText(e))
        }
      }}
    >
      <label class="field">
        <span>Address</span>
        <input
          placeholder="rex-box.tailnet.ts.net"
          value={address()}
          onInput={(e) => setAddress(e.currentTarget.value)}
          spellcheck={false}
          autocapitalize="off"
        />
      </label>
      <p class="hint">
        <Show
          when={address().trim()}
          fallback={
            <>
              A Tailscale name like <code>rex-box.tailnet.ts.net</code>, a URL like <code>https://host:7297</code>, or{' '}
              <code>account@host</code>.
            </>
          }
        >
          <Show when={parsed().ok} fallback={<span class="bad">{parsed().error}</span>}>
            {KIND_TEXT[parsed().kind]}
          </Show>
        </Show>
      </p>
      <label class="field">
        <span>Label</span>
        <input
          placeholder={parsed().ok ? parsed().label : 'Shown in the sidebar'}
          value={label()}
          onInput={(e) => setLabel(e.currentTarget.value)}
          spellcheck={false}
        />
      </label>
    </Frame>
  )
}

export function Dialogs() {
  return (
    <Show when={dialog()} keyed>
      {(d: DialogState) => (
        <Switch>
          <Match when={d.kind === 'addHost'}>
            <AddHostDialog />
          </Match>
          <Match when={d.kind === 'newSession' && d}>
            {(x) => (
              <LabelDialog
                title={`New session on ${servers().find((s) => s.id === x().serverId)?.label ?? 'server'}`}
                initial={`session-${new Date().toTimeString().slice(0, 5).replace(':', '')}`}
                submit="Create session"
                onSubmit={(label) => actions.createSession(x().serverId, label)}
              />
            )}
          </Match>
          <Match when={d.kind === 'renameSession' && d}>
            {(x) => (
              <LabelDialog
                title="Rename session"
                initial={x().label}
                submit="Rename"
                onSubmit={(label) => actions.renameSession(x().serverId, x().sessionId, label)}
              />
            )}
          </Match>
          <Match when={d.kind === 'renameTab' && d}>
            {(x) => (
              <LabelDialog
                title="Rename tab"
                initial={x().label}
                submit="Rename"
                onSubmit={(label) => actions.renameTab(x().windowId, label)}
              />
            )}
          </Match>
          <Match when={d.kind === 'destroySession' && d}>
            {(x) => (
              <Frame
                title={`End “${x().label}”?`}
                submit="End session"
                danger
                onSubmit={async () => {
                  await actions.destroySession(x().serverId, x().sessionId)
                  setDialog(null)
                }}
              >
                <p class="body">Every window and program in this session stops. This can’t be undone.</p>
              </Frame>
            )}
          </Match>
        </Switch>
      )}
    </Show>
  )
}
