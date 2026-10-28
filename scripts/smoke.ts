import { Terminal } from '@xterm/headless'
import { execFileSync } from 'node:child_process'
import { Control } from '../src/main/rex/control'
import { Sessions } from '../src/main/rex/sessions'
import { TerminalStream, formatTerminal } from '../src/main/rex/data'
import { InputQueue } from '../src/main/rex/input-queue'
async function main() {
  const address = execFileSync('/usr/bin/rex', ['whoami'], {
    encoding: 'utf8',
  }).match(/^endpoint: (.+)$/m)![1]
  const control = new Control(address)
  const sessions = new Sessions(control)
  let controlReadies = 0
  let lastWelcome: { client: { id: string; resumed?: boolean } } | undefined
  sessions.on('ready', () => controlReadies++)
  control.on('welcome', (welcome) => {
    lastWelcome = welcome
  })
  control.on('fault', console.error)
  sessions.on('fault', console.error)
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  async function until(check: () => boolean, label: string) {
    const deadline = Date.now() + 15000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
      await delay(30)
    }
  }
  let created: string | undefined
  let stream: TerminalStream | undefined
  const terminal = new Terminal({
    cols: 100,
    rows: 30,
    scrollback: 10000,
    allowProposedApi: true,
  })
  async function renderedText() {
    await new Promise<void>((r) => terminal.write('', r))
    const b = terminal.buffer.active
    return Array.from(
      { length: b.length },
      (_, i) => b.getLine(i)?.translateToString(true) ?? '',
    ).join('\n')
  }
  try {
    await sessions.ready()
    const label = `rexgui-smoke-${Date.now()}`
    const result = await control.call('session.create', {
      label,
      initial_windows: [
        { layout: { block: { flavor: 'com.superlogical.terminal.shell' } } },
      ],
    })
    created = result.session_id
    const sid = created!
    const view = await sessions.attach(sid)
    const blockId = view.windows[0].layers[0].blocks[0].block_id
    console.log('CREATED', label, sid, 'view revision', view.revision)
    await control.call('session.own_block', {
      session_id: sid,
      block_ids: [blockId],
      mode: 'take',
    })
    await control.call('com.superlogical.terminal.resize', {
      session_id: sid,
      block_id: blockId,
      args: { columns: 100, rows: 30 },
    })
    const write = new InputQueue((data) =>
      control.call('com.superlogical.terminal.write', {
        session_id: sid,
        block_id: blockId,
        args: { data },
      }),
    )
    let output = ''
    let rawOutput = ''
    let ready = 0
    stream = new TerminalStream(control, sid, blockId)
    stream.on('data', (b) => {
      output += b.toString()
      terminal.write(b)
    })
    stream.on('meta', (m) => {
      if (m.type === 'connection' && m.error) console.log('DATA', m)
    })
    stream.on('ready', () => ready++)
    await stream.start()
    await until(() => ready > 0, 'initial VT redraw')
    console.log(
      'STREAM initial VT redraw bytes',
      Buffer.byteLength(output),
      'Ghostty binary present:',
      output.includes('GHOSTSNP'),
    )
    // Observe post-snapshot program bytes directly, independently from the format redraw.
    stream.ws!.on('message', (b) => {
      rawOutput += b.toString()
    })
    await write.write("echo REXGUI_OK; printf 'TERM_CHECK=%s\\n' $TERM\n")
    await until(
      () =>
        /REXGUI_OK/.test(rawOutput) && /TERM_CHECK=xterm-rex/.test(rawOutput),
      'post-snapshot output',
    )
    console.log('PASS post-snapshot REXGUI_OK; TERM=xterm-rex')
    const before = output.length
    stream.ws!.terminate()
    await delay(600)
    await write.write('echo REXGUI_RESUMED\n')
    await until(
      () => output.slice(before).includes('REXGUI_RESUMED'),
      'data resume',
    )
    console.log('PASS data stream resumed; fresh snapshots:', ready - 1)
    const previousClient = lastWelcome!.client.id
    const previousReadies = controlReadies
    control.ws!.terminate()
    await until(
      () => controlReadies > previousReadies,
      'control reconnect bootstrap',
    )
    if (
      lastWelcome!.client.id !== previousClient ||
      !lastWelcome!.client.resumed
    )
      throw new Error('Control client did not resume')
    console.log('PASS control client resumed and session views re-bootstrapped')
    const split = await control.call('session.new_split', {
      session_id: sid,
      anchor_id: blockId,
      direction: 'horizontal',
      side: 'after',
      focus: true,
      layout: { block: { flavor: 'com.superlogical.terminal.shell' } },
    })
    await until(
      () =>
        !!sessions.views
          .get(sid)
          ?.windows.flatMap((w) => w.layers.flatMap((l) => l.blocks))
          .some((b) => b.block_id === split.block_ids[0]),
      'session_view_changed merge',
    )
    console.log(
      'PASS split event merged; blocks',
      sessions.views.get(sid)!.windows[0].layers[0].blocks.length,
    )
    // Fill scrollback and attach afresh to exercise format(vt) against an idle shell.
    await write.write("printf 'SCROLL_SENTINEL\\n'; seq 1 70\n")
    await delay(700)
    const idle = await formatTerminal(control, sid, blockId)
    console.log(
      'FORMAT idle bytes',
      Buffer.byteLength(idle),
      'scrollback sentinel:',
      idle.includes('SCROLL_SENTINEL'),
    )
    stream.close()
    output = ''
    ready = 0
    stream = new TerminalStream(control, sid, blockId)
    stream.on('data', (b) => {
      output += b.toString()
      terminal.write(b)
    })
    stream.on('ready', () => ready++)
    await stream.start()
    await until(() => ready > 0, 'idle shell reattach')
    console.log('IDLE reattach bytes', Buffer.byteLength(output))
    const idleRendered = await renderedText()
    if (
      !idleRendered.includes('SCROLL_SENTINEL') ||
      terminal.buffer.active.length <= 30
    )
      throw new Error('xterm lost scrollback')
    console.log(
      'PASS xterm idle redraw retains scrollback:',
      terminal.buffer.active.length,
      'lines',
    )
    // Full-screen top, never send this command to any pre-existing session.
    await write.write('top -d 1\n')
    await delay(1300)
    const top = await formatTerminal(control, sid, blockId)
    console.log(
      'FORMAT top bytes',
      Buffer.byteLength(top),
      'contains top header:',
      top.includes('top -'),
      'alternate screen mode:',
      /\x1b\[\?1049h/.test(top),
    )
    stream.close()
    output = ''
    ready = 0
    stream = new TerminalStream(control, sid, blockId)
    stream.on('data', (b) => {
      output += b.toString()
      terminal.write(b)
    })
    stream.on('ready', () => ready++)
    await stream.start()
    await until(() => ready > 0, 'top reattach')
    await delay(1500)
    console.log(
      'TOP reattach bytes',
      Buffer.byteLength(output),
      'contains top header:',
      output.includes('top -'),
    )
    const topRendered = await renderedText()
    if (!topRendered.includes('Tasks:') || !topRendered.includes('PID USER'))
      throw new Error('xterm top redraw missing header')
    console.log(
      'PASS xterm full-screen redraw contains Tasks and process headers',
    )
    await write.write('q')
    await delay(300)
    write.close()
    console.log('SMOKE PASS')
  } finally {
    stream?.close()
    if (created) {
      await control.call('session.destroy', { session_id: created })
      console.log('DESTROYED only smoke session', created)
    }
    control.close()
    terminal.dispose()
  }
}
void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
