export interface ServerInfo {
  id: string
  label: string
  address: string
  kind: 'personal' | 'shared' | 'remote'
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  error?: string
}
export interface SessionInfo {
  session_id: string
  label: string
}
export interface Layout {
  rect: [number, number, number, number]
  block_id?: string | null
  split?: {
    split_id: string | null
    direction: 'horizontal' | 'vertical'
    ratio: number
    before: Layout
    after: Layout
  } | null
}
export interface Block {
  block_id: string
  label?: string
  creator_name?: string
  flavor?: string
  owner?: string | null
}
export interface Layer {
  layer_id: string
  kind: string
  bounds: [number, number, number, number]
  layout: Layout
  blocks: Block[]
}
export interface RexWindow {
  window_id: string
  label: string
  focused_block_id: string
  zoomed_block_id?: string | null
  layers: Layer[]
}
export interface SessionView extends SessionInfo {
  revision: number
  active_window_id: string | null
  windows: RexWindow[]
}
export type TerminalMeta =
  | {
      type: 'resize'
      cols: number
      rows: number
      cell_width_px: number
      cell_height_px: number
      owner?: string | null
    }
  | {
      type: 'theme'
      foreground?: string
      background?: string
      cursor?: string
      palette?: string[]
      scheme?: string
    }
  | { type: 'child_exited'; exit_code: number }
  | { type: 'connection'; state: string; error?: string }
export interface SessionViewEvent {
  serverId: string
  sessionId: string
  view: SessionView | null
}
export interface ServerEvent {
  serverId: string
  sessionId?: string
  type: string
  payload: Record<string, unknown>
}
export type Unsubscribe = () => void
/** The active Omarchy theme: colors.toml as-is, plus Hyprland's window rounding. */
export interface OmarchyTheme {
  colors: Record<string, string>
  rounding?: number
}
/** A process as reported by com.superlogical.terminal.process (subset). */
export interface ProcessInfo {
  pid: number
  name: string
  argv0?: string
  script?: string
  path?: string
  cwd?: string
}
/** Frontend addition: one-shot snapshot of a terminal block's identity. */
export interface BlockInfo {
  foreground?: ProcessInfo | null
  child?: ProcessInfo | null
  home?: string
  pwd?: string
  title?: string
}
export interface TailscalePeer {
  name: string
  dns: string
  ip: string
  online: boolean
  os: string
}
export interface TailscaleStatus {
  installed: boolean
  /** BackendState: Running, Stopped, NeedsLogin, NotInstalled, ... */
  state: string
  authUrl?: string
  tailnet?: string
  self?: { name: string; dns: string; ip: string }
  peers: TailscalePeer[]
  error?: string
}
export interface AgentInfo {
  id: string
  name: string
  command: string
  installed: boolean
  path?: string
  version?: string
}
export interface RexAPI {
  listServers(): Promise<ServerInfo[]>
  connect(serverId: string): Promise<void>
  addHost(label: string, address: string): Promise<ServerInfo>
  removeHost(serverId: string): Promise<void>
  listSessions(serverId: string): Promise<SessionInfo[]>
  getSessionView(serverId: string, sessionId: string): Promise<SessionView>
  createSession(
    serverId: string,
    options: { label: string; cwd?: string },
  ): Promise<string>
  destroySession(serverId: string, sessionId: string): Promise<void>
  renameSession(
    serverId: string,
    sessionId: string,
    label: string,
  ): Promise<void>
  newWindow(serverId: string, sessionId: string): Promise<void>
  closeWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
  ): Promise<void>
  focusWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
  ): Promise<void>
  renameWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
    label: string,
  ): Promise<void>
  split(
    serverId: string,
    sessionId: string,
    blockId: string,
    direction: 'right' | 'down',
  ): Promise<void>
  closeBlock(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<void>
  focusBlock(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<void>
  zoomBlock(serverId: string, sessionId: string, blockId: string): Promise<void>
  resizePane(
    serverId: string,
    sessionId: string,
    beforeBlockId: string,
    afterBlockId: string,
    direction: 'horizontal' | 'vertical',
    ratio: number,
  ): Promise<void>
  attachTerminal(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<string>
  /** Subscribe before startTerminal: no bytes are emitted until startTerminal is called. */
  startTerminal(handle: string): Promise<void>
  onTerminalData(handle: string, cb: (data: Uint8Array) => void): Unsubscribe
  onTerminalMeta(handle: string, cb: (meta: TerminalMeta) => void): Unsubscribe
  writeTerminal(handle: string, data: string): Promise<void>
  resizeTerminal(handle: string, cols: number, rows: number): Promise<void>
  detachTerminal(handle: string): Promise<void>
  onServerState(cb: (state: ServerInfo) => void): Unsubscribe
  onSessionView(cb: (event: SessionViewEvent) => void): Unsubscribe
  onBlockEvent(cb: (event: ServerEvent) => void): Unsubscribe
  onServerEvent(cb: (event: ServerEvent) => void): Unsubscribe
  minimize(): Promise<void>
  maximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  // ---- Frontend additions (see docs/FRONTEND.md) ----
  /** session.move_window: place windowId before beforeWindowId (null = end). */
  moveWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
    beforeWindowId: string | null,
  ): Promise<void>
  /** session.focus_direction in the active window. */
  focusDirection(
    serverId: string,
    sessionId: string,
    direction: 'left' | 'right' | 'up' | 'down',
  ): Promise<void>
  /** session.swap_blocks. */
  swapBlocks(
    serverId: string,
    sessionId: string,
    blockId: string,
    otherBlockId: string,
  ): Promise<void>
  /** Terminal process/pwd/title queries; fields are omitted when unavailable. */
  blockInfo(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<BlockInfo>
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  onMaximizeChange(cb: (maximized: boolean) => void): Unsubscribe
  /**
   * Compositor blur size behind the window while it is focused (0 = leave the
   * compositor's own setting). Resolves false when unsupported (Hyprland only).
   */
  setDesktopBlur(size: number): Promise<boolean>
  tailscaleStatus(): Promise<TailscaleStatus>
  /** Run `tailscale up`/`down`; the result may carry a login URL. */
  tailscaleSet(on: boolean): Promise<TailscaleStatus>
  /** Open a Tailscale login URL in the default browser. */
  openLoginUrl(url: string): Promise<void>
  detectAgents(): Promise<AgentInfo[]>
  /** The active Omarchy theme, or null when Omarchy isn't installed. */
  getOmarchyTheme(): Promise<OmarchyTheme | null>
  onOmarchyTheme(cb: (theme: OmarchyTheme | null) => void): Unsubscribe
}
export const IPC_METHODS = [
  'listServers',
  'connect',
  'addHost',
  'removeHost',
  'listSessions',
  'getSessionView',
  'createSession',
  'destroySession',
  'renameSession',
  'newWindow',
  'closeWindow',
  'focusWindow',
  'renameWindow',
  'split',
  'closeBlock',
  'focusBlock',
  'zoomBlock',
  'resizePane',
  'attachTerminal',
  'startTerminal',
  'writeTerminal',
  'resizeTerminal',
  'detachTerminal',
  'minimize',
  'maximize',
  'close',
  'isMaximized',
  'moveWindow',
  'focusDirection',
  'swapBlocks',
  'blockInfo',
  'readClipboard',
  'writeClipboard',
  'setDesktopBlur',
  'tailscaleStatus',
  'tailscaleSet',
  'openLoginUrl',
  'detectAgents',
  'getOmarchyTheme',
] as const
export type IPCMethod = (typeof IPC_METHODS)[number]
declare global {
  interface Window {
    rex: RexAPI
  }
}
