import type { TerminalMeta } from '../../shared/ipc'
export interface Parsed {
  data: Buffer[]
  meta: TerminalMeta[]
  boundary: boolean
}
/** Byte-oriented: never decodes program output or cuts UTF-8 characters. Retains only a marker suffix during snapshot scanning. */
export class VTStream {
  private pending = Buffer.alloc(0)
  private snapshot = true
  private readonly marker: Buffer
  constructor(nonce: bigint) {
    this.marker = Buffer.from(`\x1b_rex1;${nonce};`)
  }
  push(chunk: Uint8Array): Parsed {
    const result: Parsed = { data: [], meta: [], boundary: false }
    this.pending = Buffer.concat([this.pending, chunk])
    if (this.snapshot) {
      const i = this.pending.indexOf(this.marker)
      if (i < 0) {
        this.pending = this.pending.subarray(
          Math.max(0, this.pending.length - this.marker.length + 1),
        )
        return result
      }
      this.snapshot = false
      result.boundary = true
      this.pending = this.pending.subarray(i)
    }
    while (this.pending.length) {
      const i = this.pending.indexOf(this.marker)
      if (i < 0) {
        let keep = Math.min(this.marker.length - 1, this.pending.length)
        while (
          keep &&
          !this.pending
            .subarray(this.pending.length - keep)
            .equals(this.marker.subarray(0, keep))
        )
          keep--
        if (this.pending.length > keep)
          result.data.push(this.pending.subarray(0, this.pending.length - keep))
        this.pending = this.pending.subarray(this.pending.length - keep)
        break
      }
      if (i > 0) result.data.push(this.pending.subarray(0, i))
      this.pending = this.pending.subarray(i)
      const end = this.pending.indexOf(
        Buffer.from('\x1b\\'),
        this.marker.length,
      )
      if (end < 0) {
        if (this.pending.length > 1024 * 1024) {
          result.data.push(this.pending.subarray(0, 1))
          this.pending = this.pending.subarray(1)
          continue
        }
        break
      }
      const raw = this.pending.subarray(this.marker.length, end)
      try {
        const m = JSON.parse(raw.toString())
        if (['resize', 'theme', 'child_exited'].includes(m.type))
          result.meta.push(m)
      } catch {
        /* malformed trusted APC: ignore */
      }
      this.pending = this.pending.subarray(end + 2)
    }
    return result
  }
}
