import { contextBridge, ipcRenderer } from 'electron'
import { IPC_METHODS, type RexAPI } from '../shared/ipc'
const api: Record<string, unknown> = {}
for (const method of IPC_METHODS)
  api[method] = (...args: unknown[]) =>
    ipcRenderer.invoke(`rex:${method}`, ...args)
function subscribe(channel: string, cb: (...args: any[]) => void) {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
    cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
api.onTerminalData = (handle: string, cb: (data: Uint8Array) => void) =>
  subscribe('rex:terminalData', (id, data) => {
    if (id === handle) cb(new Uint8Array(data))
  })
api.onTerminalMeta = (handle: string, cb: (...args: any[]) => void) =>
  subscribe('rex:terminalMeta', (id, meta) => {
    if (id === handle) cb(meta)
  })
for (const [method, channel] of Object.entries({
  onServerState: 'serverState',
  onSessionView: 'sessionView',
  onBlockEvent: 'blockEvent',
  onServerEvent: 'serverEvent',
  onMaximizeChange: 'maximized',
  onOmarchyTheme: 'omarchyTheme',
}))
  api[method] = (cb: (...args: any[]) => void) =>
    subscribe(`rex:${channel}`, cb)
contextBridge.exposeInMainWorld('rex', api as unknown as RexAPI)
