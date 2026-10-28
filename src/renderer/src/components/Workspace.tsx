import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import { ratioAt, type Divider } from '../lib/layout'
import {
  actions,
  active,
  activeWindow,
  dividers,
  focusedBlockId,
  panes,
  paneIds,
  view,
} from '../state/store'
import { TerminalPane } from './TerminalPane'

function DividerHandle(props: { d: Divider; area: () => HTMLDivElement }) {
  const [drag, setDrag] = createSignal<number | null>(null)
  const pos = () => {
    const [x, y, w, h] = props.d.rect
    const r = drag() ?? props.d.ratio
    return props.d.direction === 'horizontal'
      ? { left: `${(x + w * r) * 100}%`, top: `${y * 100}%`, height: `${h * 100}%` }
      : { top: `${(y + h * r) * 100}%`, left: `${x * 100}%`, width: `${w * 100}%` }
  }
  let last = 0
  let pending: number | undefined
  const send = (ratio: number, force = false) => {
    const now = performance.now()
    if (!force && now - last < 70) {
      pending = ratio
      return
    }
    last = now
    pending = undefined
    void actions.resize(props.d.beforeBlockId, props.d.afterBlockId, props.d.direction, ratio)
  }
  return (
    <div
      class="divider"
      classList={{ v: props.d.direction === 'vertical', dragging: drag() !== null }}
      style={pos()}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        setDrag(props.d.ratio)
      }}
      onPointerMove={(e) => {
        if (drag() === null) return
        const box = props.area().getBoundingClientRect()
        const r = ratioAt(props.d, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height)
        setDrag(r)
        send(r)
      }}
      onPointerUp={() => {
        const r = drag()
        if (r !== null) send(pending ?? r, true)
        setDrag(null)
      }}
      onDblClick={() => send(0.5, true)}
      title="Drag to resize · double-click to even out"
    />
  )
}

export function Workspace() {
  let area!: HTMLDivElement
  const rectOf = (id: string) => panes().find((p) => p.block_id === id)?.rect ?? [0, 0, 1, 1]
  // Key on the session only: views change constantly, terminals must not remount.
  const sessionKey = createMemo(() => {
    const a = active()
    return a && view() ? `${a.serverId}\n${a.sessionId}` : undefined
  })
  return (
    <Show when={sessionKey()} keyed>
      {(key) => {
        const [serverId, sessionId] = key.split('\n')
        const sel = { serverId, sessionId }
        return (
          <div class="workspace" ref={area}>
            <For each={paneIds()}>
              {(blockId) => (
                <TerminalPane
                  serverId={sel.serverId}
                  sessionId={sel.sessionId}
                  blockId={blockId}
                  rect={rectOf(blockId)}
                  focused={focusedBlockId() === blockId}
                  multi={paneIds().length > 1}
                  zoomed={activeWindow()?.zoomed_block_id === blockId}
                />
              )}
            </For>
            <Index each={dividers()}>{(d) => <DividerHandle d={d()} area={() => area} />}</Index>
          </div>
        )
      }}
    </Show>
  )
}
