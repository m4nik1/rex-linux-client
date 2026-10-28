import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import type { Unsubscribe } from '../../../shared/ipc'
import { settings } from '../state/settings'
import { report, toast } from '../state/toasts'
import { terminals } from '../state/terminals'
import { matchShortcut } from '../lib/keys'
import { DEFAULT_THEME, rexTheme, withAlpha } from '../lib/theme'
import { actions, blockMeta, blockTitle } from '../state/store'
import { paletteOpen, settingsOpen, dialog } from '../state/ui'
import { processGlyph } from '../lib/format'
import {
  IconClose,
  IconMove,
  IconSplitDown,
  IconSplitRight,
  IconUnzoom,
  IconZoom,
} from './Icons'

export const TERMINAL_FONT =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace'

const DRAG_TYPE = 'application/x-rex-block'

export function ProcessTile(props: { name: string; small?: boolean }) {
  const g = () => processGlyph(props.name)
  return (
    <span class="ptile" data-tint={g().tint} classList={{ small: props.small }}>
      {g().glyph}
    </span>
  )
}

export function TerminalPane(props: {
  serverId: string
  sessionId: string
  blockId: string
  rect: number[]
  focused: boolean
  multi: boolean
  zoomed: boolean
}) {
  let host!: HTMLDivElement
  let handle: string | undefined
  let disposed = false
  const cleanups: Unsubscribe[] = []
  const [theme, setTheme] = createSignal<ITheme>(DEFAULT_THEME)
  const [state, setState] = createSignal<'connecting' | 'live' | 'reconnecting' | 'closed'>(
    'connecting',
  )
  const [dropTarget, setDropTarget] = createSignal(false)

  const term = new Terminal({
    allowProposedApi: true,
    allowTransparency: true,
    fontFamily: TERMINAL_FONT,
    fontSize: settings.fontSize,
    lineHeight: 1.12,
    letterSpacing: 0,
    scrollback: 10000,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 1,
    macOptionIsMeta: true,
    theme: { ...DEFAULT_THEME, background: '#00000000' },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
  // App shortcuts never reach the terminal program.
  term.attachCustomKeyEventHandler((e) => !matchShortcut(e))

  let lastSize = ''
  function fitNow() {
    if (disposed || !host.clientWidth || !host.clientHeight) return
    try {
      fit.fit()
    } catch {
      return
    }
    const size = `${term.cols}x${term.rows}`
    if (handle && size !== lastSize) {
      lastSize = size
      void window.rex.resizeTerminal(handle, term.cols, term.rows).catch(() => {})
    }
  }
  let fitTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleFit = () => {
    clearTimeout(fitTimer)
    fitTimer = setTimeout(() => requestAnimationFrame(fitNow), 40)
  }

  terminals.set(props.blockId, {
    focus: () => term.focus(),
    selection: () => term.getSelection(),
    paste: (text) => term.paste(text),
  })

  onMount(() => {
    term.open(host)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* DOM renderer stays active */
    }
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(host)
    cleanups.push(() => ro.disconnect())
    const input = term.onData((data) => {
      if (handle) void window.rex.writeTerminal(handle, data).catch(report)
    })
    cleanups.push(() => input.dispose())
    const focusIn = () => {
      if (!props.focused) void actions.focusPane(props.blockId)
    }
    term.textarea?.addEventListener('focus', focusIn)
    cleanups.push(() => term.textarea?.removeEventListener('focus', focusIn))

    void (async () => {
      const id = await window.rex.attachTerminal(props.serverId, props.sessionId, props.blockId)
      if (disposed) {
        await window.rex.detachTerminal(id)
        return
      }
      handle = id
      // Subscribe before start: no bytes flow until startTerminal.
      cleanups.push(window.rex.onTerminalData(id, (data) => term.write(data)))
      cleanups.push(
        window.rex.onTerminalMeta(id, (meta) => {
          if (meta.type === 'theme') setTheme(rexTheme(meta))
          else if (meta.type === 'child_exited') {
            term.write(`\r\n\x1b[2m[process exited with code ${meta.exit_code}]\x1b[0m\r\n`)
          } else if (meta.type === 'connection') {
            if (meta.state === 'connected') setState('live')
            else if (meta.state === 'reconnecting') setState('reconnecting')
            else if (meta.state === 'closed') setState('closed')
            if (meta.error) toast(meta.error, 'error')
          } else if (meta.type === 'resize' && meta.cols > 0 && meta.rows > 0) {
            if (meta.cols !== term.cols || meta.rows !== term.rows) term.resize(meta.cols, meta.rows)
          }
        }),
      )
      fit.fit()
      lastSize = `${term.cols}x${term.rows}`
      await window.rex.resizeTerminal(id, term.cols, term.rows)
      await window.rex.startTerminal(id)
      setState('live')
      if (props.focused && canTakeFocus()) term.focus()
    })().catch((e) => {
      setState('closed')
      report(e)
    })
  })

  // Theme: keep xterm's own background transparent; the pane paints it at the
  // user's chosen opacity so the glass base shows through.
  createEffect(() => {
    term.options.theme = { ...theme(), background: '#00000000' }
  })
  createEffect(
    on(
      () => settings.fontSize,
      (size) => {
        term.options.fontSize = size
        scheduleFit()
      },
      { defer: true },
    ),
  )
  // Follow Rex's focus (keyboard focus moves, other clients) without stealing
  // focus from dialogs or the palette.
  createEffect(() => {
    if (props.focused && canTakeFocus()) queueMicrotask(() => term.focus())
  })

  onCleanup(() => {
    disposed = true
    clearTimeout(fitTimer)
    terminals.delete(props.blockId)
    cleanups.forEach((fn) => fn())
    if (handle) void window.rex.detachTerminal(handle).catch(() => {})
    term.dispose()
  })

  const title = () => blockTitle(props.blockId)
  const exited = () => blockMeta[props.blockId]?.exited

  return (
    <section
      class="pane"
      classList={{
        focused: props.focused && props.multi,
        drop: dropTarget(),
      }}
      style={{
        left: props.rect[0] * 100 + '%',
        top: props.rect[1] * 100 + '%',
        width: props.rect[2] * 100 + '%',
        height: props.rect[3] * 100 + '%',
        '--pane-bg': withAlpha(theme().background, settings.terminalOpacity),
      }}
      onMouseDown={() => {
        if (!props.focused) void actions.focusPane(props.blockId)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        setDropTarget(false)
        const from = e.dataTransfer?.getData(DRAG_TYPE)
        if (from && from !== props.blockId) {
          e.preventDefault()
          void actions.swap(from, props.blockId)
        }
      }}
    >
      <header class="pane-head">
        <div
          class="pane-chip"
          draggable={props.multi}
          onDragStart={(e) => {
            e.dataTransfer?.setData(DRAG_TYPE, props.blockId)
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
          }}
          title={props.multi ? 'Drag onto another pane to swap' : undefined}
        >
          <IconMove size={12} class="pane-move" />
          <span class="pane-proc">{title().process}</span>
          <span class="pane-cwd">{title().cwd}</span>
          <div class="pane-pop glass" role="tooltip">
            <div class="pop-row">
              <ProcessTile name={title().process} />
              <div>
                <div class="pop-name">{title().process}</div>
                <div class="pop-path">{title().fullPath || 'Directory not reported yet'}</div>
              </div>
            </div>
            <Show when={title().title && title().title !== title().process}>
              <div class="pop-title">{title().title}</div>
            </Show>
          </div>
        </div>
        <Show when={state() === 'reconnecting' || state() === 'connecting'}>
          <span class="pane-state">{state() === 'connecting' ? 'Attaching…' : 'Reconnecting…'}</span>
        </Show>
        <Show when={props.zoomed}>
          <span class="pane-state zoomed">Zoomed</span>
        </Show>
        <Show when={exited() !== undefined}>
          <span class="pane-state warn">Exited {exited()}</span>
        </Show>
        <div class="pane-tools">
          <button class="ibtn" title="Split right (Ctrl+Shift+D)" onClick={() => actions.split('right', props.blockId)}>
            <IconSplitRight size={14} />
          </button>
          <button class="ibtn" title="Split down (Ctrl+Shift+E)" onClick={() => actions.split('down', props.blockId)}>
            <IconSplitDown size={14} />
          </button>
          <Show when={props.multi || props.zoomed}>
            <button
              class="ibtn"
              classList={{ on: props.zoomed }}
              title={props.zoomed ? 'Unzoom (Ctrl+Shift+Z)' : 'Zoom (Ctrl+Shift+Z)'}
              onClick={() => actions.zoom(props.blockId)}
            >
              {props.zoomed ? <IconUnzoom size={13} /> : <IconZoom size={13} />}
            </button>
          </Show>
          <button class="ibtn danger" title="Close pane (Ctrl+Shift+W)" onClick={() => actions.closePane(props.blockId)}>
            <IconClose size={13} />
          </button>
        </div>
      </header>
      <div class="pane-body">
        <div ref={host} class="term-host" />
      </div>
    </section>
  )
}

function canTakeFocus() {
  if (paletteOpen() || settingsOpen() || dialog()) return false
  const a = document.activeElement
  return !a || a === document.body || !!a.closest('.xterm')
}
