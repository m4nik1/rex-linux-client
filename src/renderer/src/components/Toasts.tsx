import { For } from 'solid-js'
import { dismiss, toasts } from '../state/toasts'
import { IconClose } from './Icons'

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      <For each={toasts()}>
        {(t) => (
          <div class="toast glass" classList={{ error: t.kind === 'error' }}>
            <span class="toast-mark" />
            <span class="toast-text">{t.text}</span>
            <button class="ibtn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <IconClose size={11} />
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
