import { createMemo, createSignal, batch } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type {
  ProcessInfo,
  ServerEvent,
  ServerInfo,
  SessionInfo,
  SessionView,
  RexWindow,
} from '../../../shared/ipc'
import { windowDividers, windowPanes, type PaneRect } from '../lib/layout'
import {
  isDefaultWindowLabel,
  newSessionLabel,
  processName,
  pwdToPath,
  shortenHome,
} from '../lib/format'
import { report, toast } from './toasts'
import { setSettings, settings } from './settings'

const rex = () => window.rex

// ---------- servers & sessions ----------
export const [servers, setServers] = createSignal<ServerInfo[]>([])
export const [sessions, setSessions] = createStore<
  Record<string, SessionInfo[]>
>({})
export const [booted, setBooted] = createSignal(false)

export interface Selection {
  serverId: string
  sessionId: string
}
export const [active, setActive] = createSignal<Selection | null>(null)
export const [view, setView] = createSignal<SessionView>()
let selectionToken = 0

const LAST_KEY = 'rex-gui:last-session:v1'

const ORDER = { personal: 0, shared: 1, remote: 2 } as const
export const sortedServers = createMemo(() =>
  [...servers()].sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label),
  ),
)

export const activeServer = createMemo(() =>
  servers().find((s) => s.id === active()?.serverId),
)

export const activeWindow = createMemo<RexWindow | undefined>(() => {
  const v = view()
  return v?.windows?.find((w) => w.window_id === v.active_window_id)
})

export const panes = createMemo<PaneRect[]>(
  () => windowPanes(activeWindow()),
  [],
  { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
)
export const paneIds = createMemo(() => panes().map((p) => p.block_id), [], {
  equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
})
export const dividers = createMemo(() => windowDividers(activeWindow()), [], {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
})
export const focusedBlockId = () => activeWindow()?.focused_block_id

// ---------- per-block identity ----------
export interface BlockMeta {
  process?: string
  cwd?: string
  home?: string
  title?: string
  exited?: number
  bell?: number
}
export const [blockMeta, setBlockMeta] = createStore<Record<string, BlockMeta>>(
  {},
)
const requested = new Set<string>()

function applyProcess(blockId: string, p?: ProcessInfo | null) {
  if (!p) return
  setBlockMeta(blockId, (m) => ({
    ...m,
    process: processName(p) || m?.process,
    cwd: p.cwd || m?.cwd,
  }))
}

async function loadBlockInfo(sel: Selection, blockId: string) {
  if (requested.has(blockId)) return
  requested.add(blockId)
  try {
    const info = await rex().blockInfo(sel.serverId, sel.sessionId, blockId)
    batch(() => {
      setBlockMeta(blockId, (m) => ({
        ...m,
        home: info.home ?? m?.home,
        title: info.title ?? m?.title,
        cwd: m?.cwd ?? (pwdToPath(info.pwd) || undefined),
      }))
      applyProcess(blockId, info.foreground ?? info.child)
    })
  } catch {
    requested.delete(blockId)
  }
}

/** "<process>", "<cwd with ~>" for a block. */
export function blockTitle(blockId?: string) {
  const m = blockId ? blockMeta[blockId] : undefined
  return {
    process: m?.process || 'shell',
    cwd: m?.cwd ? shortenHome(m.cwd, m.home) : '',
    fullPath: m?.cwd ?? '',
    title: m?.title ?? '',
  }
}

export function tabTitle(w: RexWindow) {
  if (!isDefaultWindowLabel(w.label))
    return { process: w.label, cwd: '', custom: true, blockId: w.focused_block_id }
  return { ...blockTitle(w.focused_block_id), custom: false, blockId: w.focused_block_id }
}

export function handleBlockEvent(e: ServerEvent) {
  const sel = active()
  if (!sel || e.serverId !== sel.serverId) return
  const p = e.payload as {
    block_id?: string
    name?: string
    payload?: Record<string, unknown>
  }
  const id = p.block_id
  if (!id) return
  const data = p.payload ?? {}
  switch (p.name) {
    case 'process_changed':
      applyProcess(id, data.foreground as ProcessInfo | null)
      break
    case 'pwd_changed': {
      const path = pwdToPath(data.pwd as string)
      if (path) setBlockMeta(id, (m) => ({ ...m, cwd: path }))
      break
    }
    case 'title_changed':
      setBlockMeta(id, (m) => ({ ...m, title: String(data.title ?? '') }))
      break
    case 'child_exited':
      setBlockMeta(id, (m) => ({ ...m, exited: Number(data.exit_code) }))
      break
    case 'bell':
      setBlockMeta(id, (m) => ({ ...m, bell: Date.now() }))
      break
  }
}

// ---------- loading ----------
export async function refreshSessions(serverId: string) {
  const server = servers().find((s) => s.id === serverId)
  if (server?.state !== 'connected') return
  const list = await rex().listSessions(serverId)
  setSessions(serverId, reconcile(list, { key: 'session_id' }))
  const sel = active()
  if (sel?.serverId === serverId && !list.some((s) => s.session_id === sel.sessionId)) {
    setActive(null)
    setView(undefined)
  }
}

export function upsertServer(info: ServerInfo) {
  const prev = servers().find((s) => s.id === info.id)
  setServers((list) => [...list.filter((s) => s.id !== info.id), info])
  if (info.state === 'connected' && prev?.state !== 'connected')
    void refreshSessions(info.id).catch(report)
  if (info.state !== 'connected') setSessions(info.id, [])
}

function adoptView(v: SessionView) {
  setView(v)
  const sel = active()
  if (!sel) return
  for (const w of v.windows ?? [])
    for (const l of w.layers ?? [])
      for (const b of l.blocks ?? []) void loadBlockInfo(sel, b.block_id)
}

export async function selectSession(serverId: string, sessionId: string) {
  const token = ++selectionToken
  const v = await rex().getSessionView(serverId, sessionId)
  if (token !== selectionToken) return
  batch(() => {
    setActive({ serverId, sessionId })
    adoptView(v)
  })
  localStorage.setItem(LAST_KEY, JSON.stringify({ serverId, sessionId }))
}

export function onSessionView(serverId: string, sessionId: string, v: SessionView | null) {
  const sel = active()
  if (sel?.serverId === serverId && sel.sessionId === sessionId) {
    if (v) {
      if ((view()?.revision ?? -1) <= v.revision) adoptView(v)
    } else {
      batch(() => {
        setActive(null)
        setView(undefined)
      })
      toast('The session was closed.')
    }
  }
  // Labels may have changed.
  void refreshSessions(serverId).catch(() => {})
}

export async function boot() {
  const list = await rex().listServers()
  setServers(list)
  await Promise.all(
    list
      .filter((s) => s.state === 'connected')
      .map((s) => refreshSessions(s.id).catch(() => {})),
  )
  setBooted(true)
  // Restore the last session the user had open, if it still exists.
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as Selection | null
    if (last && !active()) {
      const s = servers().find((x) => x.id === last.serverId)
      if (s && s.state !== 'connected') await rex().connect(s.id).catch(() => {})
      await refreshSessions(last.serverId).catch(() => {})
      if (sessions[last.serverId]?.some((x) => x.session_id === last.sessionId))
        await selectSession(last.serverId, last.sessionId)
    }
  } catch {
    /* nothing to restore */
  }
  // Otherwise land in a session straight away. A local server that can't start
  // is explained by the empty state, so the error isn't repeated as a toast.
  const auto = new URLSearchParams(location.search).get('autoSession') !== '0'
  if (auto && !active()) await openDefaultSession().catch(() => {})
}

/** The first session on the local server, or a new one when it has none. */
async function openDefaultSession() {
  const id = 'personal'
  if (servers().find((s) => s.id === id)?.state !== 'connected') await rex().connect(id)
  const list = await rex().listSessions(id)
  setSessions(id, reconcile(list, { key: 'session_id' }))
  // The user may have picked a session while the server was starting.
  if (active()) return
  if (list.length) await selectSession(id, list[0].session_id)
  else await actions.createSession(id, newSessionLabel())
}

// ---------- actions ----------
function withSession<T>(fn: (serverId: string, sessionId: string) => Promise<T>) {
  const sel = active()
  if (!sel) {
    toast('Open a session first.')
    return
  }
  return fn(sel.serverId, sel.sessionId).catch(report)
}

export const actions = {
  newTab: () => withSession((s, id) => rex().newWindow(s, id)),
  closeTab: (windowId: string) =>
    withSession((s, id) => rex().closeWindow(s, id, windowId)),
  focusTab: (windowId: string) =>
    withSession((s, id) => rex().focusWindow(s, id, windowId)),
  renameTab: (windowId: string, label: string) =>
    withSession((s, id) => rex().renameWindow(s, id, windowId, label)),
  moveTab: (windowId: string, before: string | null) =>
    withSession((s, id) => rex().moveWindow(s, id, windowId, before)),
  cycleTab(delta: number) {
    const v = view()
    if (!v?.windows.length) return
    const i = v.windows.findIndex((w) => w.window_id === v.active_window_id)
    const next = v.windows[(i + delta + v.windows.length) % v.windows.length]
    return actions.focusTab(next.window_id)
  },
  tabAt(n: number) {
    const w = view()?.windows[n]
    if (w) return actions.focusTab(w.window_id)
  },
  split: (direction: 'right' | 'down', blockId = focusedBlockId()) =>
    blockId && withSession((s, id) => rex().split(s, id, blockId, direction)),
  closePane: (blockId = focusedBlockId()) =>
    blockId && withSession((s, id) => rex().closeBlock(s, id, blockId)),
  zoom: (blockId = focusedBlockId()) =>
    blockId && withSession((s, id) => rex().zoomBlock(s, id, blockId)),
  focusPane: (blockId: string) =>
    withSession((s, id) => rex().focusBlock(s, id, blockId)),
  focusDirection: (dir: 'left' | 'right' | 'up' | 'down') =>
    withSession((s, id) => rex().focusDirection(s, id, dir)),
  swap: (a: string, b: string) => withSession((s, id) => rex().swapBlocks(s, id, a, b)),
  resize: (
    before: string,
    after: string,
    direction: 'horizontal' | 'vertical',
    ratio: number,
  ) => withSession((s, id) => rex().resizePane(s, id, before, after, direction, ratio)),
  async createSession(serverId: string, label: string) {
    try {
      const id = await rex().createSession(serverId, { label })
      await refreshSessions(serverId)
      await selectSession(serverId, id)
      toast(`Created session “${label}”.`)
    } catch (e) {
      report(e)
    }
  },
  async renameSession(serverId: string, sessionId: string, label: string) {
    try {
      await rex().renameSession(serverId, sessionId, label)
      await refreshSessions(serverId)
    } catch (e) {
      report(e)
    }
  },
  async destroySession(serverId: string, sessionId: string) {
    try {
      await rex().destroySession(serverId, sessionId)
      const sel = active()
      if (sel?.serverId === serverId && sel.sessionId === sessionId) {
        setActive(null)
        setView(undefined)
      }
      await refreshSessions(serverId)
    } catch (e) {
      report(e)
    }
  },
  async connect(serverId: string) {
    try {
      await rex().connect(serverId)
      await refreshSessions(serverId)
    } catch (e) {
      report(e)
    }
  },
  async addHost(label: string, address: string) {
    const info = await rex().addHost(label, address)
    upsertServer(info)
    toast(`Added ${label}. Connecting…`)
    return info
  },
  async removeHost(serverId: string) {
    try {
      await rex().removeHost(serverId)
      if (active()?.serverId === serverId) {
        setActive(null)
        setView(undefined)
      }
      setServers(await rex().listServers())
    } catch (e) {
      report(e)
    }
  },
  toggleSidebar: () => setSettings('sidebarOpen', !settings.sidebarOpen),
}
