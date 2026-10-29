import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

interface Blur {
  size: number
  passes: number
}
/** Shared by every rex-gui process on this Hyprland instance. */
interface Override {
  pid: number
  baseline: Blur
  applied: Blur
}

/**
 * Heavier compositor blur behind the window on Hyprland.
 *
 * Hyprland has no per-window blur size, only `no_blur`. So while our window is
 * focused we raise the global `decoration:blur:size`/`passes` over the IPC
 * socket, and put the user's own values back on unfocus and on quit.
 *
 * The baseline is re-read at the start of every override, so later edits to the
 * user's config are respected. While an override is active, a small record next to
 * the socket holds the true baseline. If Hyprland still shows the values in that record,
 * they are ours (another rex-gui instance, or one that crashed), not the user's,
 * and the recorded baseline is used instead.
 */
export class HyprBlur {
  private readonly socket?: string
  private readonly record?: string
  private original?: Blur
  private size = 0
  private focused = false
  private applied = false
  private lua?: boolean
  private queue: Promise<void> = Promise.resolve()

  constructor(env = process.env) {
    const sig = env.HYPRLAND_INSTANCE_SIGNATURE
    const runtime = env.XDG_RUNTIME_DIR
    if (sig && runtime) {
      this.socket = join(runtime, 'hypr', sig, '.socket.sock')
      this.record = join(runtime, 'hypr', sig, 'rex-gui-blur.json')
    }
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
      if (!this.applied) this.original = await this.baseline()
      const applied = {
        size: this.size,
        passes: Math.max(this.original!.passes, 4),
      }
      this.writeRecord({ pid: process.pid, baseline: this.original!, applied })
      await this.set(applied)
      this.applied = true
    } else if (this.applied && this.original) {
      await this.set(this.original)
      this.applied = false
      if (this.readRecord()?.pid === process.pid) this.removeRecord()
    }
  }

  private async baseline(): Promise<Blur> {
    const current = {
      size: await this.getInt('decoration:blur:size'),
      passes: await this.getInt('decoration:blur:passes'),
    }
    const rec = this.readRecord()
    if (
      rec &&
      rec.applied.size === current.size &&
      rec.applied.passes === current.passes
    )
      return rec.baseline
    return current
  }

  /**
   * Hyprland configured in Lua (Omarchy's default) rejects `keyword` and takes
   * `eval` instead; hyprlang configs only know `keyword`. Try Lua first and
   * remember which one the compositor speaks.
   */
  private async set({ size, passes }: Blur) {
    if (this.lua !== false) {
      const reply = (
        await this.request(
          `eval hl.config({ decoration = { blur = { size = ${size}, passes = ${passes} } } })`,
        )
      ).trim()
      if (reply === 'ok') {
        this.lua = true
        return
      }
      if (this.lua) throw new Error(`hyprctl: ${reply}`)
      this.lua = false
    }
    await this.batch([
      `keyword decoration:blur:size ${size}`,
      `keyword decoration:blur:passes ${passes}`,
    ])
  }

  private readRecord(): Override | undefined {
    try {
      const rec = JSON.parse(readFileSync(this.record!, 'utf8')) as Override
      const ok = (b: Blur | undefined) =>
        Number.isInteger(b?.size) && Number.isInteger(b?.passes)
      return ok(rec.baseline) && ok(rec.applied) ? rec : undefined
    } catch {
      return undefined
    }
  }

  private writeRecord(rec: Override) {
    writeFileSync(this.record!, JSON.stringify(rec))
  }

  private removeRecord() {
    try {
      unlinkSync(this.record!)
    } catch {}
  }

  async getInt(option: string) {
    const reply = JSON.parse(await this.request(`j/getoption ${option}`)) as {
      int?: number
    }
    if (typeof reply.int !== 'number')
      throw new Error(`Unexpected reply for ${option}`)
    return reply.int
  }

  private async batch(commands: string[]) {
    const reply = await this.request(`[[BATCH]]${commands.join(';')}`)
    if (!/^(ok\s*)+$/.test(reply.trim()))
      throw new Error(`hyprctl: ${reply.trim()}`)
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
