import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { addresses, socket } from './endpoint'
export interface RexEvent {
  type: string
  payload: Record<string, any>
}
export interface Response<T> {
  payload: T
  seq: number
}
export class RexError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}
export class Control extends EventEmitter {
  ws?: WebSocket
  endpoint: string
  private token?: string
  private serial = 0
  private stopped = false
  private attempt = 0
  private retry?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private opening?: Promise<void>
  private pending = new Map<
    string,
    {
      resolve: (value: Response<any>) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly candidates: string[]
  constructor(
    readonly address: string,
    alternatives?: string[],
  ) {
    super()
    this.candidates = (alternatives?.length ? alternatives : [address]).flatMap(
      addresses,
    )
    this.endpoint = this.candidates[0]
  }
  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && !this.opening)
      return Promise.resolve()
    if (this.opening) return this.opening
    this.stopped = false
    clearTimeout(this.retry)
    this.emit('state', this.attempt ? 'reconnecting' : 'connecting')
    this.opening = this.open().finally(() => {
      this.opening = undefined
    })
    return this.opening
  }
  private async open(): Promise<void> {
    let error: unknown
    for (const endpoint of this.candidates) {
      if (this.stopped) throw new Error('Connection stopped')
      try {
        await this.openAt(endpoint)
        return
      } catch (e) {
        error = e
      }
    }
    if (!this.stopped) {
      this.emit('state', 'disconnected', String(error))
      this.schedule()
    }
    throw error
  }
  private openAt(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = socket(endpoint, 'control', 'rex.control.v1')
      this.ws = ws
      let welcomed = false
      let alive = true
      const timeout = setTimeout(() => {
        reject(new Error('Rex welcome timed out'))
        ws.terminate()
      }, 10000)
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'hello',
            api_revision: 7,
            api_min_revision: 7,
            reconnect_token: this.token,
            client: {
              kind: 'app',
              platform: 'linux',
              name: 'rex-gui',
              version: '0.1.0',
            },
          }),
          { compress: false },
        ),
      )
      ws.on('pong', () => {
        alive = true
      })
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString())
          if (m.type === 'welcome') {
            if (m.protocol !== 'rex.control.v1' || m.api_revision !== 7)
              throw new Error('Unsupported Rex protocol/revision')
            clearTimeout(timeout)
            welcomed = true
            this.endpoint = endpoint
            this.token = m.client?.reconnect_token
            this.attempt = 0
            clearInterval(this.heartbeat)
            this.heartbeat = setInterval(() => {
              if (!alive) ws.terminate()
              else {
                alive = false
                ws.ping()
              }
            }, 120000)
            this.emit('state', 'connected')
            this.emit('welcome', m)
            resolve()
          } else if (m.type === 'response') {
            const p = this.pending.get(m.id)
            if (!p) return
            clearTimeout(p.timer)
            this.pending.delete(m.id)
            m.error
              ? p.reject(
                  new RexError(m.error.code, m.error.message, m.error.status),
                )
              : p.resolve({ payload: m.payload, seq: m.seq })
          } else if (m.type === 'event')
            this.emit('event', m.payload as RexEvent, m.seq as number)
        } catch (e) {
          this.emit('fault', e)
          if (!welcomed) reject(e)
          ws.terminate()
        }
      })
      ws.on('error', (e) => {
        if (!welcomed) reject(e)
        else this.emit('fault', e)
      })
      ws.on('close', (code, reason) => {
        clearTimeout(timeout)
        if (!welcomed) {
          reject(new Error(`Rex closed ${code}: ${reason}`))
          return
        }
        clearInterval(this.heartbeat)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error('Connection lost; outcome unknown'))
        }
        this.pending.clear()
        if (!this.stopped) {
          this.emit('state', 'reconnecting', `${code}: ${reason}`)
          this.schedule()
        }
      })
    })
  }
  private schedule() {
    clearTimeout(this.retry)
    this.retry = setTimeout(
      () => void this.connect().catch(() => {}),
      Math.min(30000, 500 * 2 ** this.attempt++) + Math.random() * 200,
    )
  }
  async request<T = any>(
    method: string,
    payload: unknown = {},
  ): Promise<Response<T>> {
    if (this.ws?.readyState !== WebSocket.OPEN)
      throw new Error('Rex is disconnected')
    const id = String(++this.serial)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Rex request timed out: ${method}; outcome unknown`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(
        JSON.stringify({ type: 'request', id, method, payload }),
        (e) => {
          if (e) {
            clearTimeout(timer)
            this.pending.delete(id)
            reject(e)
          }
        },
      )
    })
  }
  async call<T = any>(method: string, payload: unknown = {}): Promise<T> {
    return (await this.request<T>(method, payload)).payload
  }
  close() {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    this.ws?.close(1000)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }
}
