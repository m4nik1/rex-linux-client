import { EventEmitter } from 'node:events'
import { it, expect } from 'vitest'
import { Sessions } from '../src/main/rex/sessions'
import type { Control } from '../src/main/rex/control'
const view = (revision: number) => ({
  revision,
  session_id: 's',
  label: 'session',
  active_window_id: null,
  windows: [],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
class Fake extends EventEmitter {
  initialized = false
  boot = deferred<any>()
  requests: (() => Promise<any>)[] = []
  async connect() {
    if (!this.initialized) {
      this.initialized = true
      this.emit('welcome', {})
    }
  }
  request() {
    return this.boot.promise
  }
  async call(method: string) {
    if (method === 'session.attach') return { view: view(5) }
    return this.requests.shift()!()
  }
}
it('buffers bootstrap events and replays only events above the result seq', async () => {
  const c = new Fake()
  const sessions = new Sessions(c as unknown as Control)
  const ready = sessions.ready()
  c.emit(
    'event',
    {
      type: 'session_created',
      payload: { session: { session_id: 'old', label: 'obsolete' } },
    },
    2,
  )
  c.emit(
    'event',
    {
      type: 'session_created',
      payload: { session: { session_id: 'new', label: 'new' } },
    },
    4,
  )
  c.boot.resolve({
    seq: 3,
    payload: {
      attach_all: { sessions: [{ session_id: 's', label: 'session' }] },
      attached_sessions: [{ view: view(5) }],
    },
  })
  await ready
  expect([...sessions.sessions.keys()]).toEqual(['s', 'new'])
  expect(sessions.views.get('s')?.revision).toBe(5)
})
it('coalesces concurrent refreshes and fetches again for a newer event revision', async () => {
  const c = new Fake()
  c.boot.resolve({
    seq: 0,
    payload: {
      attach_all: { sessions: [] },
      attached_sessions: [{ view: view(5) }],
    },
  })
  const sessions = new Sessions(c as unknown as Control)
  await sessions.ready()
  const first = deferred<any>()
  c.requests.push(
    () => first.promise,
    async () => view(8),
  )
  const task = sessions.refresh('s')
  expect(sessions.refresh('s')).toBe(task)
  c.emit(
    'event',
    {
      type: 'session_event',
      payload: {
        session_id: 's',
        event: { type: 'session_view_changed', payload: { revision: 8 } },
      },
    },
    1,
  )
  first.resolve(view(6))
  expect((await task).revision).toBe(8)
  c.requests.push(async () => view(4))
  await sessions.refresh('s')
  expect(sessions.views.get('s')?.revision).toBe(8)
})
it('does not resurrect a destroyed session from an in-flight view response', async () => {
  const c = new Fake()
  c.boot.resolve({
    seq: 0,
    payload: {
      attach_all: { sessions: [] },
      attached_sessions: [{ view: view(5) }],
    },
  })
  const sessions = new Sessions(c as unknown as Control)
  await sessions.ready()
  const result = deferred<any>()
  c.requests.push(() => result.promise)
  const refresh = sessions.refresh('s')
  c.emit(
    'event',
    { type: 'session_destroyed', payload: { session_id: 's' } },
    1,
  )
  result.resolve(view(6))
  await refresh
  expect(sessions.views.has('s')).toBe(false)
  expect(sessions.sessions.has('s')).toBe(false)
})
