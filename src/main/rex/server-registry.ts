import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Control } from './control'
import { Sessions } from './sessions'
import type { ServerInfo } from '../../shared/ipc'
export interface Server {
  info: ServerInfo
  control: Control
  sessions: Sessions
}
export class ServerRegistry extends EventEmitter {
  readonly servers = new Map<string, Server>()
  private saved: { id: string; label: string; address: string }[] = []
  constructor(private file: string) {
    super()
  }
  async init() {
    let address = `unix:///run/user/${process.getuid!()}/rex/server.sock`
    try {
      const { stdout } = await promisify(execFile)('/usr/bin/rex', ['whoami'], {
        timeout: 8000,
      })
      address = stdout.match(/^endpoint: (.+)$/m)?.[1] ?? address
    } catch (e) {
      this.emit('fault', e)
    }
    this.add({
      id: 'personal',
      label: 'Personal',
      address,
      kind: 'personal',
      state: 'disconnected',
    })
    this.add({
      id: 'shared',
      label: 'Shared',
      address: 'unix:///run/rex/server.sock',
      kind: 'shared',
      state: 'disconnected',
    })
    try {
      this.saved = JSON.parse(await readFile(this.file, 'utf8'))
      for (const host of this.saved)
        this.add({ ...host, kind: 'remote', state: 'disconnected' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.emit('fault', e)
    }
    for (const server of this.servers.values())
      void server.sessions.ready().catch(() => {})
  }
  private add(info: ServerInfo, endpoints?: string[]) {
    const control = new Control(info.address, endpoints)
    const sessions = new Sessions(control)
    const server = { info, control, sessions }
    this.servers.set(info.id, server)
    control.on('state', (state, error) => {
      info.state = state
      info.error = error
      this.emit('state', { ...info })
    })
    control.on('fault', (e) => this.emit('fault', e))
    sessions.on('fault', (e) => this.emit('fault', e))
    sessions.on('view', (sessionId, view) =>
      this.emit('view', { serverId: info.id, sessionId, view }),
    )
    sessions.on('event', (e) => {
      this.emit('event', { serverId: info.id, ...e })
      if (info.id === 'personal' && e.type === 'hosts_changed')
        void this.discover().catch((e) => this.emit('fault', e))
    })
    if (info.id === 'personal')
      sessions.on(
        'ready',
        () => void this.discover().catch((e) => this.emit('fault', e)),
      )
    return server
  }
  async discover() {
    const { hosts } = await this.get('personal').control.call('hosts.list')
    for (const host of hosts ?? []) {
      const id = `saved:${host.id ?? host.label}`
      if (this.servers.has(id) || !host.endpoints?.length) continue
      const server = this.add(
        {
          id,
          label: host.label,
          address: host.endpoints[0],
          kind: 'remote',
          state: 'disconnected',
        },
        host.endpoints,
      )
      this.emit('state', server.info)
      void server.sessions.ready().catch(() => {})
    }
  }
  get(id: string): Server {
    const server = this.servers.get(id)
    if (!server) throw new Error('Unknown server')
    return server
  }
  async connect(id: string) {
    const server = this.get(id)
    if (id === 'personal' && server.info.state !== 'connected')
      await promisify(execFile)('/usr/bin/rex', ['whoami'], { timeout: 8000 })
    await server.sessions.ready()
  }
  list() {
    return [...this.servers.values()].map((s) => ({ ...s.info }))
  }
  private async persist() {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = this.file + '.tmp'
    await writeFile(temp, JSON.stringify(this.saved), { mode: 0o600 })
    await rename(temp, this.file)
  }
  async addHost(label: string, address: string) {
    if (!label.trim() || !address.trim())
      throw new Error('Label and address required')
    if (address.includes('://') && !/^https?:\/\//.test(address))
      throw new Error('Use an HTTP(S) address or hostname')
    const host = { id: randomUUID(), label, address }
    this.saved.push(host)
    await this.persist()
    const server = this.add({ ...host, kind: 'remote', state: 'disconnected' })
    this.emit('state', server.info)
    void server.sessions.ready().catch(() => {})
    return server.info
  }
  async removeHost(id: string) {
    if (!this.saved.some((x) => x.id === id))
      throw new Error('Only GUI-added hosts can be removed here')
    this.get(id).control.close()
    this.servers.delete(id)
    this.saved = this.saved.filter((x) => x.id !== id)
    await this.persist()
  }
  close() {
    for (const s of this.servers.values()) s.control.close()
  }
}
