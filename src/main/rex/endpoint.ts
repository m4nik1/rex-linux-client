import WebSocket from 'ws'
/** Match the CLI: login-server accounts are a rex.as.<account> WebSocket subprotocol. */
export function socket(
  address: string,
  path: 'control' | 'data',
  protocol: string,
): WebSocket {
  if (address.startsWith('unix://'))
    return new WebSocket(
      `ws+unix://${address.slice(7)}:/api/${path}`,
      protocol,
      { perMessageDeflate: false, handshakeTimeout: 8000 },
    )
  const url = new URL(address)
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol))
    throw new Error('Unsupported Rex address')
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:'
  const account = decodeURIComponent(url.username)
  if (url.password)
    throw new Error('Password authentication is not supported by Rex')
  url.username = ''
  url.password = ''
  url.pathname = `/api/${path}`
  url.search = ''
  url.hash = ''
  return new WebSocket(
    url,
    account ? [protocol, `rex.as.${account}`] : protocol,
    { perMessageDeflate: false, handshakeTimeout: 8000 },
  )
}
export function addresses(address: string): string[] {
  if (address.startsWith('unix://') || address.includes('://')) return [address]
  const url = new URL(`https://${address}`)
  if (url.port || /:\d+$/.test(address)) return [url.toString()]
  const secure = new URL(url)
  secure.port = '7297'
  const plain = new URL(secure)
  plain.protocol = 'http:'
  return [url.toString(), secure.toString(), plain.toString()]
}
