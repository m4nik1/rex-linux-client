export function hello(ticket: string): Buffer {
  const bytes = Buffer.from(ticket, 'base64url')
  if (bytes.length !== 16) throw new Error('Invalid data ticket')
  return Buffer.concat([Buffer.from([1]), bytes])
}
export function resume(token: Uint8Array, consumed: bigint): Buffer {
  if (token.length !== 16 || consumed < 0n) throw new Error('Invalid resume')
  const out = Buffer.alloc(25)
  out[0] = 2
  out.set(token, 1)
  out.writeBigUInt64LE(consumed, 17)
  return out
}
export function welcome(raw: Uint8Array) {
  const b = Buffer.from(raw)
  if (b[0] === 0x82 && b.length === 2)
    throw new Error(`Data handshake rejected: ${b[1]}`)
  if (
    b.length !== 32 ||
    b[0] !== 0x81 ||
    b[17] ||
    b[18] ||
    b[19] ||
    !b.readBigUInt64LE(24)
  )
    throw new Error('Malformed data WELCOME')
  return {
    token: b.subarray(1, 17),
    resumeWindow: b.readUInt32LE(20),
    nonce: b.readBigUInt64LE(24),
  }
}
