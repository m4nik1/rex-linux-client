import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ServerRegistry } from './rex/server-registry'
import { TerminalStream } from './rex/data'
import { InputQueue } from './rex/input-queue'
import { HyprBlur } from './hypr-blur'
import { IPC_METHODS, type IPCMethod, type RexAPI } from '../shared/ipc'
let win: BrowserWindow | undefined
let registry: ServerRegistry
const hyprBlur = new HyprBlur()
let blurRestored = false
let blurRestoring: Promise<void> | undefined
interface Handle {
  serverId: string
  sessionId: string
  blockId: string
  stream: TerminalStream
  input: InputQueue
  chunks: Buffer[]
  bytes: number
  timer?: ReturnType<typeof setTimeout>
  started: boolean
  sizeQueue: Promise<void>
}
const handles = new Map<string, Handle>()
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const layout = (cwd?: string) => ({
  block: {
    flavor: 'com.superlogical.terminal.shell',
    ...(cwd ? { options: { cwd } } : {}),
  },
})
async function action(
  serverId: string,
  sessionId: string,
  method: string,
  args: object = {},
) {
  const server = registry.get(serverId)
  await server.sessions.attach(sessionId)
  await server.control.call(method, { session_id: sessionId, ...args })
}
function getHandle(id: string) {
  const h = handles.get(id)
  if (!h) throw new Error('Unknown terminal handle')
  return h
}
function flush(id: string, h: Handle) {
  clearTimeout(h.timer)
  h.timer = undefined
  if (!h.chunks.length) return
  const data = new Uint8Array(Buffer.concat(h.chunks))
  h.chunks = []
  h.bytes = 0
  send('rex:terminalData', id, data)
}
async function detach(id: string) {
  const h = handles.get(id)
  if (!h) return
  handles.delete(id)
  clearTimeout(h.timer)
  h.stream.close()
  h.input.close()
  try {
    await registry.get(h.serverId).control.call('session.disown_block', {
      session_id: h.sessionId,
      block_ids: [h.blockId],
    })
  } catch {
    /* server or block may already be gone */
  }
}
const api: Omit<
  RexAPI,
  | 'onTerminalData'
  | 'onTerminalMeta'
  | 'onServerState'
  | 'onSessionView'
  | 'onBlockEvent'
  | 'onServerEvent'
  | 'onMaximizeChange'
> = {
  async listServers() {
    return registry.list()
  },
  connect: (id) => registry.connect(id),
  addHost: (label, address) => registry.addHost(label, address),
  async removeHost(id) {
    for (const [key, h] of handles) if (h.serverId === id) await detach(key)
    await registry.removeHost(id)
  },
  async listSessions(id) {
    const s = registry.get(id)
    await s.sessions.ready()
    return [...s.sessions.sessions.values()]
  },
  async getSessionView(id, sessionId) {
    return registry.get(id).sessions.attach(sessionId)
  },
  async createSession(id, options) {
    const s = registry.get(id)
    await s.sessions.ready()
    const result = await s.control.call('session.create', {
      label: options.label,
      initial_windows: [{ layout: layout(options.cwd) }],
    })
    await s.sessions.attach(result.session_id)
    return result.session_id
  },
  destroySession: (id, sid) => action(id, sid, 'session.destroy'),
  renameSession: (id, sid, label) =>
    action(id, sid, 'session.set_label', { label }),
  newWindow: (id, sid) =>
    action(id, sid, 'session.new_window', { layout: layout() }),
  closeWindow: (id, sid, window_id) =>
    action(id, sid, 'session.close_window', { window_id }),
  focusWindow: (id, sid, window_id) =>
    action(id, sid, 'session.focus_window', { window_id }),
  renameWindow: (id, sid, window_id, label) =>
    action(id, sid, 'session.set_window_label', { window_id, label }),
  split: (id, sid, anchor_id, direction) =>
    action(id, sid, 'session.new_split', {
      anchor_id,
      direction: direction === 'right' ? 'horizontal' : 'vertical',
      side: 'after',
      layout: layout(),
      focus: true,
    }),
  closeBlock: (id, sid, block_id) =>
    action(id, sid, 'block.close', { block_id }),
  focusBlock: (id, sid, block_id) =>
    action(id, sid, 'session.focus_block', { block_id }),
  zoomBlock: (id, sid, block_id) =>
    action(id, sid, 'session.zoom_block', { block_id }),
  resizePane: (id, sid, before_block_id, after_block_id, direction, ratio) =>
    action(id, sid, 'session.resize_pane', {
      before_block_id,
      after_block_id,
      direction,
      ratio,
    }),
  async attachTerminal(serverId, sessionId, blockId) {
    // Single data source per block/client; close a stale UI handle before replacing it.
    for (const [key, old] of handles)
      if (
        old.serverId === serverId &&
        old.sessionId === sessionId &&
        old.blockId === blockId
      )
        await detach(key)
    const server = registry.get(serverId)
    await server.sessions.attach(sessionId)
    const id = randomUUID()
    const stream = new TerminalStream(server.control, sessionId, blockId)
    const input = new InputQueue((data) =>
      server.control.call('com.superlogical.terminal.write', {
        session_id: sessionId,
        block_id: blockId,
        args: { data },
      }),
    )
    const h: Handle = {
      serverId,
      sessionId,
      blockId,
      stream,
      input,
      chunks: [],
      bytes: 0,
      started: false,
      sizeQueue: Promise.resolve(),
    }
    handles.set(id, h)
    stream.on('data', (data: Buffer) => {
      h.chunks.push(data)
      h.bytes += data.length
      if (h.bytes >= 256 * 1024) flush(id, h)
      else if (!h.timer) h.timer = setTimeout(() => flush(id, h), 8)
    })
    stream.on('meta', (meta) => send('rex:terminalMeta', id, meta))
    return id
  },
  async startTerminal(id) {
    const h = getHandle(id)
    if (h.started) return
    h.started = true
    try {
      await h.stream.start()
    } catch (e) {
      h.started = false
      throw e
    }
  },
  async writeTerminal(id, data) {
    if (typeof data !== 'string') throw new Error('Expected text')
    await getHandle(id).input.write(data)
  },
  async resizeTerminal(id, cols, rows) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      rows < 1 ||
      cols > 1000 ||
      rows > 1000
    )
      throw new Error('Invalid terminal size')
    const h = getHandle(id)
    const server = registry.get(h.serverId)
    const next = h.sizeQueue
      .catch(() => {})
      .then(async () => {
        if (!handles.has(id)) return
        await server.sessions.attach(h.sessionId)
        await server.control.call('session.own_block', {
          session_id: h.sessionId,
          block_ids: [h.blockId],
          mode: 'take',
        })
        await server.control.call('com.superlogical.terminal.resize', {
          session_id: h.sessionId,
          block_id: h.blockId,
          args: { columns: cols, rows },
        })
      })
    h.sizeQueue = next
    await next
  },
  detachTerminal: detach,
  moveWindow: (id, sid, window_id, before_window_id) =>
    action(id, sid, 'session.move_window', {
      window_id,
      ...(before_window_id ? { before_window_id } : {}),
    }),
  focusDirection: (id, sid, direction) => {
    if (!['left', 'right', 'up', 'down'].includes(direction))
      throw new Error('Invalid direction')
    return action(id, sid, 'session.focus_direction', { direction })
  },
  swapBlocks: (id, sid, block_id, other_block_id) =>
    action(id, sid, 'session.swap_blocks', {
      block_id,
      other_block_id,
    }),
  async blockInfo(id, sid, block_id) {
    const server = registry.get(id)
    await server.sessions.attach(sid)
    const call = (method: string) =>
      server.control
        .call(`com.superlogical.terminal.${method}`, {
          session_id: sid,
          block_id,
          args: {},
        })
        .catch(() => ({}))
    const [proc, pwd, title] = await Promise.all([
      call('process'),
      call('pwd'),
      call('title'),
    ])
    return {
      foreground: proc.foreground ?? null,
      child: proc.child ?? null,
      home: typeof proc.home === 'string' ? proc.home : undefined,
      pwd: typeof pwd.pwd === 'string' ? pwd.pwd : undefined,
      title: typeof title.title === 'string' ? title.title : undefined,
    }
  },
  async readClipboard() {
    return clipboard.readText()
  },
  async writeClipboard(text) {
    if (typeof text !== 'string') throw new Error('Expected text')
    clipboard.writeText(text)
  },
  async minimize() {
    win?.minimize()
  },
  async maximize() {
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  },
  async close() {
    win?.close()
  },
  async isMaximized() {
    return win?.isMaximized() ?? false
  },
  async setDesktopBlur(size) {
    if (typeof size !== 'number' || !Number.isFinite(size)) throw new Error('Expected size')
    if (!hyprBlur.supported) return false
    void hyprBlur.setFocused(win?.isFocused() ?? false)
    await hyprBlur.setSize(Math.round(Math.min(64, Math.max(0, size))))
    return true
  },
}
app
  .whenReady()
  .then(async () => {
    registry = new ServerRegistry(join(app.getPath('userData'), 'hosts.json'))
    registry.on('fault', (e) => console.warn('[rex]', String(e)))
    registry.on('state', (info) => send('rex:serverState', info))
    registry.on('view', (event) => send('rex:sessionView', event))
    registry.on('event', (event) => {
      send('rex:serverEvent', event)
      if (event.type === 'block_event') send('rex:blockEvent', event)
    })
    win = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      backgroundMaterial: 'auto',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    win.on('maximize', () => send('rex:maximized', true))
    win.on('unmaximize', () => send('rex:maximized', false))
    win.on('focus', () => void hyprBlur.setFocused(true))
    win.on('blur', () => void hyprBlur.setFocused(false))
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('console-message', (event) =>
      console.log('[renderer]', event.message),
    )
    win.webContents.on('render-process-gone', (_event, details) =>
      console.error('[renderer gone]', details),
    )
    for (const method of IPC_METHODS)
      ipcMain.handle(`rex:${method}`, (event, ...args: unknown[]) => {
        if (!win || win.isDestroyed() || event.sender.isDestroyed()) return
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame
        )
          throw new Error('Untrusted IPC sender')
        return (api[method as IPCMethod] as (...args: unknown[]) => unknown)(
          ...args,
        )
      })
    win.webContents.on(
      'did-start-navigation',
      (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) for (const id of handles.keys()) void detach(id)
      },
    )
    await registry.init()
    if (process.env.ELECTRON_RENDERER_URL)
      await win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await win.loadFile(join(__dirname, '../renderer/index.html'))
    console.log('[rex-gui] main ready')
  })
  .catch((e) => {
    console.error(e)
    app.quit()
  })
app.on('window-all-closed', () => app.quit())
// Ctrl-C in `pnpm dev` or a plain kill should still restore the compositor blur.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit())
app.on('before-quit', (event) => {
  if (!blurRestored && hyprBlur.supported) {
    // Give Hyprland its own blur values back before we exit. Every quit attempt
    // (repeated signals included) waits on the same restore.
    event.preventDefault()
    blurRestoring ??= hyprBlur.restore().finally(() => {
      blurRestored = true
      app.quit()
    })
    return
  }
  for (const h of handles.values()) {
    clearTimeout(h.timer)
    h.stream.close()
    h.input.close()
  }
  handles.clear()
  registry?.close()
})
