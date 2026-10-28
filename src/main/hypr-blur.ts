import { createConnection } from 'node:net'
import { join } from 'node:path'

/**
 * Heavier compositor blur behind the window on Hyprland.
 *
 * Hyprland has no per-window blur size, only `no_blur`. So while our window is
 * focused we raise the global `decoration:blur:size`/`passes` over the IPC
 * socket, and put the user's own values back on unfocus and on quit. A crash
 * leaves the raised values in place until `hyprctl reload`.
 */
export class HyprBlur {
  private readonly socket?: string
  private original?: { size: number; passes: number }
  private size = 0
  private focused = false
  private applied = false
  private queue: Promise<void> = Promise.resolve()

  constructor(env = process.env) {
    const sig = env.HYPRLAND_INSTANCE_SIGNATURE
    const runtime = env.XDG_RUNTIME_DIR
    if (sig && runtime) this.socket = join(runtime, 'hypr', sig, '.socket.sock')
  }

  get supported() {
    return !!this.socket
  }

  /** 0 leaves the compositor's own blur untouched. */
  setSize(size: number) {
    this.size = size
    return this.sync()
  }

  setFocused(focused: boolean) {
    this.focused = focused
    return this.sync()
  }

  /** Restore the user's values; resolves once Hyprland has them back. */
  restore() {
    this.focused = false
    return this.sync()
  }

  private sync() {
    this.queue = this.queue
      .then(() => this.apply())
      .catch((e) => console.warn('[hypr-blur]', String(e)))
    return this.queue
  }

  private async apply() {
    if (!this.socket) return
    const want = this.focused && this.size > 0
    if (want) {
      this.original ??= {
        size: await this.getInt('decoration:blur:size'),
        passes: await this.getInt('decoration:blur:passes'),
      }
      const passes = Math.max(this.original.passes, 4)
      await this.batch([`keyword decoration:blur:size ${this.size}`, `keyword decoration:blur:passes ${passes}`])
      this.applied = true
    } else if (this.applied && this.original) {
      const { size, passes } = this.original
      await this.batch([`keyword decoration:blur:size ${size}`, `keyword decoration:blur:passes ${passes}`])
      this.applied = false
    }
  }

  private async getInt(option: string) {
    const reply = JSON.parse(await this.request(`j/getoption ${option}`)) as { int?: number }
    if (typeof reply.int !== 'number') throw new Error(`Unexpected reply for ${option}`)
    return reply.int
  }

  private async batch(commands: string[]) {
    const reply = await this.request(`[[BATCH]]${commands.join(';')}`)
    if (!/^(ok\s*)+$/.test(reply.trim())) throw new Error(`hyprctl: ${reply.trim()}`)
  }

  private request(command: string) {
    return new Promise<string>((resolve, reject) => {
      const s = createConnection(this.socket!)
      let out = ''
      s.setTimeout(1000, () => s.destroy(new Error('Hyprland socket timeout')))
      s.on('data', (d) => (out += d))
      s.on('end', () => resolve(out))
      s.on('error', reject)
      s.write(command)
    })
  }
}
