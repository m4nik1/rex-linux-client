import { it, expect } from 'vitest'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { addresses, socket } from '../src/main/rex/endpoint'
it('expands bare hosts and preserves explicit ports', () => {
  expect(addresses('example.test')).toEqual([
    'https://example.test/',
    'https://example.test:7297/',
    'http://example.test:7297/',
  ])
  expect(addresses('example.test:9000')).toEqual(['https://example.test:9000/'])
  expect(addresses('https://account@example.test')).toEqual([
    'https://account@example.test',
  ])
})
it('matches CLI account selection via rex.as subprotocol without HTTP Basic', async () => {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const connection = once(wss, 'connection')
  const client = socket(
    `http://example_account@127.0.0.1:${port}`,
    'control',
    'rex.control.v1',
  )
  try {
    const [peer, request] = await connection
    await once(client, 'open')
    expect(request.headers['sec-websocket-protocol']).toBe(
      'rex.control.v1,rex.as.example_account',
    )
    expect(request.headers.authorization).toBeUndefined()
    expect(request.url).toBe('/api/control')
    peer.close()
    await once(client, 'close')
  } finally {
    client.terminate()
    wss.close()
    server.close()
  }
})
