import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { Control } from './control'
import { socket } from './endpoint'
import { hello, resume, welcome } from './handshake'
import { VTStream } from './vtstream'
export const FORMAT_ARGS = {
  format: 'vt',
  extra_cursor: true,
  extra_modes: true,
  extra_style: true,
  extra_palette: true,
  extra_scrolling_region: true,
  extra_charsets: true,
  extra_keyboard: true,
  extra_kitty_keyboard: true,
  extra_tabstops: true,
  max_bytes: 49152,
}
export async function formatTerminal(
  control: Control,
  session_id: string,
  block_id: string,
): Promise<string> {
  const payload = { session_id, block_id }
  const result = await control.call('com.superlogical.terminal.format', {
    ...payload,
    args: FORMAT_ARGS,
  })
  let content: string = result.content
  if (result.id !== undefined) {
    let eof = false
    while (!eof) {
      const part = await control.call('com.superlogical.terminal.blob_read', {
        ...payload,
        args: {
          id: result.id,
          offset: Buffer.byteLength(content),
          max_bytes: 49152,
        },
      })
      content += part.data
      eof = part.eof
      if (!part.data && !eof) throw new Error('Empty blob page')
    }
  }
  return content
}
export class TerminalStream extends EventEmitter {
  ws?: WebSocket
  private token?: Buffer
  private parser?: VTStream
  private consumed = 0n
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private attempt = 0
  private generation = 0
  private ready = false
  private buffered: Buffer[] = []
  private bufferedSize = 0
  private formatting = false
  constructor(
    readonly control: Control,
    readonly sessionId: string,
    readonly blockId: string,
  ) {
    super()
  }
  async start(): Promise<void> {
    this.stopped = false
    await this.open(false)
  }
  private async open(resuming: boolean): Promise<void> {
    const generation = ++this.generation
    let handshake: Buffer
    if (resuming && this.token) handshake = resume(this.token, this.consumed)
    else {
      const { ticket } = await this.control.call('data.connect', {
        session_id: this.sessionId,
        block_id: this.blockId,
        data_ref_id: 'terminal',
        subprotocol: 'rex.data.terminal.v1',
      })
      handshake = hello(ticket)
      this.consumed = 0n
      this.ready = false
      this.parser = undefined
      this.buffered = []
      this.bufferedSize = 0
      this.formatting = false
    }
    if (this.stopped || generation !== this.generation) return
    return new Promise((resolve, reject) => {
      const ws = socket(this.control.endpoint, 'data', 'rex.data.terminal.v1')
      this.ws = ws
      let welcomed = false
      let rejected = false
      const timeout = setTimeout(() => {
        reject(new Error('Data welcome timed out'))
        ws.terminate()
      }, 10000)
      ws.on('open', () => ws.send(handshake))
      ws.on('message', (raw) => {
        if (this.stopped || generation !== this.generation) return
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer)
        try {
          if (!welcomed) {
            const info = welcome(bytes)
            this.token = info.token
            if (!resuming || !this.parser)
              this.parser = new VTStream(info.nonce)
            welcomed = true
            this.attempt = 0
            clearTimeout(timeout)
            this.emit('meta', { type: 'connection', state: 'connected' })
            resolve()
            return
          }
          // Count snapshot + APC + VT bytes retained by our parser, never WELCOME bytes.
          const parsed = this.parser!.push(bytes)
          this.consumed += BigInt(bytes.length)
          for (const meta of parsed.meta) this.emit('meta', meta)
          if (this.ready)
            for (const data of parsed.data) this.emit('data', data)
          else {
            this.buffered.push(...parsed.data)
            this.bufferedSize += parsed.data.reduce((n, b) => n + b.length, 0)
            if (this.bufferedSize > 8 * 1024 * 1024)
              throw new Error('Initial terminal buffer exceeded 8 MiB')
          }
          if (parsed.boundary && !this.formatting) {
            this.formatting = true
            void this.initialize(generation).catch((e) => {
              if (generation === this.generation) {
                this.emit('meta', {
                  type: 'connection',
                  state: 'error',
                  error: String(e),
                })
                ws.terminate()
              }
            })
          }
        } catch (e) {
          rejected = !welcomed
          if (rejected) this.token = undefined
          reject(e)
          this.emit('meta', {
            type: 'connection',
            state: 'error',
            error: String(e),
          })
          ws.terminate()
        }
      })
      ws.on('error', (e) => {
        reject(e)
        this.emit('meta', {
          type: 'connection',
          state: 'error',
          error: String(e),
        })
      })
      ws.on('close', (code) => {
        clearTimeout(timeout)
        if (!welcomed) reject(new Error(`Data closed ${code}`))
        if (this.stopped || generation !== this.generation) return
        if ([1000, 4000, 1008].includes(code) && !rejected) {
          this.emit('meta', { type: 'connection', state: 'closed' })
          return
        }
        this.emit('meta', { type: 'connection', state: 'reconnecting' })
        if (code === 1013 || rejected || !this.ready) this.token = undefined
        this.timer = setTimeout(
          () => {
            void this.open(!!this.token).catch((e) => this.retry(e))
          },
          Math.min(10000, 300 * 2 ** this.attempt++),
        )
      })
    })
  }
  private retry(error: unknown) {
    if (this.stopped) return
    this.emit('meta', {
      type: 'connection',
      state: 'reconnecting',
      error: String(error),
    })
    clearTimeout(this.timer)
    this.timer = setTimeout(
      () => void this.open(!!this.token).catch((e) => this.retry(e)),
      Math.min(10000, 500 * 2 ** this.attempt++),
    )
  }
  private async initialize(generation: number) {
    const content = await formatTerminal(
      this.control,
      this.sessionId,
      this.blockId,
    )
    if (this.stopped || generation !== this.generation) return
    this.emit('data', Buffer.from('\x1bc' + content))
    for (const chunk of this.buffered) this.emit('data', chunk)
    this.buffered = []
    this.bufferedSize = 0
    this.ready = true
    this.emit('ready')
  }
  close() {
    this.stopped = true
    this.generation++
    clearTimeout(this.timer)
    this.ws?.close(1000)
    this.buffered = []
  }
}
