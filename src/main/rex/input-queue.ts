/** At most one write in flight; pending input coalesces, with bounded UTF-8 request size. Never retries ambiguous writes. */
export class InputQueue {
  private pending: {
    data: string
    resolve: () => void
    reject: (error: unknown) => void
  }[] = []
  private running = false
  private closed = false
  constructor(private send: (data: string) => Promise<unknown>) {}
  write(data: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Terminal detached'))
    if (Buffer.byteLength(data) > 65536) {
      const chunks: string[] = []
      let part = ''
      let bytes = 0
      for (const ch of data) {
        const size = Buffer.byteLength(ch)
        if (bytes + size > 65536) {
          chunks.push(part)
          part = ''
          bytes = 0
        }
        part += ch
        bytes += size
      }
      if (part) chunks.push(part)
      return Promise.all(chunks.map((chunk) => this.write(chunk))).then(
        () => {},
      )
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ data, resolve, reject })
      if (!this.running) {
        this.running = true
        queueMicrotask(() => void this.drain())
      }
    })
  }
  private async drain() {
    while (this.pending.length && !this.closed) {
      const batch = [this.pending.shift()!]
      let size = Buffer.byteLength(batch[0].data)
      while (
        this.pending.length &&
        size + Buffer.byteLength(this.pending[0].data) <= 65536
      ) {
        const item = this.pending.shift()!
        size += Buffer.byteLength(item.data)
        batch.push(item)
      }
      try {
        await this.send(batch.map((x) => x.data).join(''))
        batch.forEach((x) => x.resolve())
      } catch (e) {
        batch.forEach((x) => x.reject(e))
        this.pending.splice(0).forEach((x) => x.reject(e))
      }
    }
    this.running = false
  }
  close() {
    this.closed = true
    this.pending
      .splice(0)
      .forEach((x) => x.reject(new Error('Terminal detached')))
  }
}
