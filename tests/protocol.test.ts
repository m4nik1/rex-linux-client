import { describe, it, expect } from 'vitest'
import { VTStream } from '../src/main/rex/vtstream'
import { hello, resume, welcome } from '../src/main/rex/handshake'
import { InputQueue } from '../src/main/rex/input-queue'
const apc = (nonce: number, value: object) =>
  `\x1b_rex1;${nonce};${JSON.stringify(value)}\x1b\\`
describe('VT stream', () => {
  it('finds snapshot boundary and parses APC at every possible two-chunk split', () => {
    const input = Buffer.from(
      'GHOSTSNP\x00binary\xff' +
        apc(123, { type: 'resize', cols: 80, rows: 24 }) +
        'hello 🦖' +
        apc(123, { type: 'child_exited', exit_code: 0 }) +
        'bye',
    )
    for (let i = 0; i <= input.length; i++) {
      const parser = new VTStream(123n)
      const results = [
        parser.push(input.subarray(0, i)),
        parser.push(input.subarray(i)),
      ]
      expect(Buffer.concat(results.flatMap((r) => r.data)).toString()).toBe(
        'hello 🦖bye',
      )
      expect(results.flatMap((r) => r.meta)).toEqual([
        { type: 'resize', cols: 80, rows: 24 },
        { type: 'child_exited', exit_code: 0 },
      ])
      expect(results.filter((r) => r.boundary)).toHaveLength(1)
    }
  })
  it('handles byte-at-a-time chunks, nonce mismatch, partial marker and UTF-8', () => {
    const parser = new VTStream(9n)
    const wrong = apc(10, { type: 'resize', cols: 1 })
    const input = Buffer.from(
      'GHOSTSNP' +
        wrong +
        apc(9, { type: 'theme', background: '000000' }) +
        '🦖' +
        wrong +
        '\x1b[31mred\x1b[0m',
    )
    const results = [...input].map((b) => parser.push(Buffer.from([b])))
    expect(Buffer.concat(results.flatMap((r) => r.data)).toString()).toBe(
      '🦖' + wrong + '\x1b[31mred\x1b[0m',
    )
    expect(results.flatMap((r) => r.meta)).toEqual([
      { type: 'theme', background: '000000' },
    ])
  })
  it('skips unknown and malformed matching APCs without losing program bytes', () => {
    const parser = new VTStream(1n)
    const result = parser.push(
      Buffer.from(
        'GHOSTSNP' + apc(1, { type: 'future' }) + 'A\x1b_rex1;1;{bad}\x1b\\B',
      ),
    )
    expect(Buffer.concat(result.data).toString()).toBe('AB')
    expect(result.meta).toEqual([])
  })
})
describe('data handshake', () => {
  it('encodes HELLO and RESUME little-endian and keeps counts beyond JS integer range', () => {
    const token = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    expect(hello(token.toString('base64url'))).toEqual(
      Buffer.concat([Buffer.from([1]), token]),
    )
    const result = resume(token, 9007199254740993n)
    expect(result.length).toBe(25)
    expect(result[0]).toBe(2)
    expect(result.subarray(1, 17)).toEqual(token)
    expect(result.readBigUInt64LE(17)).toBe(9007199254740993n)
  })
  it('decodes WELCOME and rejects malformed frames/rejects', () => {
    const b = Buffer.alloc(32)
    b[0] = 0x81
    b.fill(3, 1, 17)
    b.writeUInt32LE(60000, 20)
    b.writeBigUInt64LE(987654321n, 24)
    expect(welcome(b)).toEqual({
      token: Buffer.alloc(16, 3),
      resumeWindow: 60000,
      nonce: 987654321n,
    })
    expect(() => welcome(Buffer.from([0x82, 3]))).toThrow('rejected: 3')
    expect(() => welcome(b.subarray(0, 31))).toThrow('Malformed')
    b[17] = 1
    expect(() => welcome(b)).toThrow('Malformed')
    expect(() => hello('bad')).toThrow()
    expect(() => resume(Buffer.alloc(15), 0n)).toThrow()
  })
})
describe('serialized input', () => {
  it('coalesces waiting input while permitting only one in-flight write', async () => {
    const calls: string[] = []
    const releases: (() => void)[] = []
    const q = new InputQueue((data) => {
      calls.push(data)
      return new Promise<void>((resolve) => releases.push(resolve))
    })
    const a = q.write('a')
    await Promise.resolve()
    const b = q.write('b')
    const c = q.write('c')
    expect(calls).toEqual(['a'])
    releases.shift()!()
    await a
    await Promise.resolve()
    expect(calls).toEqual(['a', 'bc'])
    releases.shift()!()
    await Promise.all([b, c])
  })
  it('coalesces same-tick input and rejects queued writes on ambiguous failure', async () => {
    const calls: string[] = []
    const q = new InputQueue(async (data) => {
      calls.push(data)
      throw new Error('lost')
    })
    const outcomes = await Promise.allSettled([q.write('one'), q.write('two')])
    expect(calls).toEqual(['onetwo'])
    expect(outcomes.every((o) => o.status === 'rejected')).toBe(true)
    q.close()
    await expect(q.write('three')).rejects.toThrow('detached')
  })
})

describe('paste boundaries', () => {
  it('does not let later keystrokes overtake a large UTF-8 paste', async () => {
    const calls: string[] = []
    const q = new InputQueue(async (data) => {
      calls.push(data)
    })
    const paste = '🦖'.repeat(40000)
    await Promise.all([q.write(paste), q.write('AFTER')])
    expect(calls.join('')).toBe(paste + 'AFTER')
    expect(calls.every((s) => Buffer.byteLength(s) <= 65536)).toBe(true)
  })
})
