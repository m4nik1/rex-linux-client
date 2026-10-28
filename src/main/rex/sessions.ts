import { EventEmitter } from 'node:events'
import { Control, RexError, type RexEvent } from './control'
import type { SessionInfo, SessionView } from '../../shared/ipc'
/** Bootstrap buffers events behind the result's seq. Views are monotonic by revision, including out-of-order responses. */
export class Sessions extends EventEmitter {
  readonly sessions = new Map<string, SessionInfo>()
  readonly views = new Map<string, SessionView>()
  private attached = new Set<string>()
  private attaching = new Map<string, Promise<SessionView>>()
  private refreshes = new Map<string, Promise<SessionView>>()
  private wanted = new Map<string, number>()
  private tombstones = new Set<string>()
  private buffering = true
  private events: { event: RexEvent; seq: number }[] = []
  private epoch = 0
  private bootstrap?: Promise<void>
  constructor(readonly control: Control) {
    super()
    control.on('welcome', () => {
      this.bootstrap = this.initialize()
      void this.bootstrap.catch((e) => {
        this.emit('fault', e)
        control.ws?.terminate()
      })
    })
    control.on('event', (event: RexEvent, seq: number) => {
      if (this.buffering) this.events.push({ event, seq })
      else this.apply(event)
    })
    control.on('state', (state: string) => {
      if (state !== 'connected') {
        this.buffering = true
        this.events = []
      }
    })
  }
  async ready() {
    await this.control.connect()
    await this.bootstrap
  }
  private async initialize() {
    const epoch = ++this.epoch
    this.buffering = true
    this.events = []
    this.attached.clear()
    this.attaching.clear()
    this.refreshes.clear()
    this.wanted.clear()
    this.tombstones.clear()
    const { payload: b, seq } = await this.control.request(
      'session.bootstrap',
      { event_scope: 'all', attach_session_ids: [...this.views.keys()] },
    )
    if (epoch !== this.epoch) return
    const oldViews = [...this.views.keys()]
    this.sessions.clear()
    this.views.clear()
    for (const s of b.attach_all.sessions ?? [])
      this.sessions.set(s.session_id, s)
    for (const s of b.attached_sessions ?? []) {
      this.attached.add(s.view.session_id)
      this.accept(s.view)
    }
    for (const queued of this.events)
      if (queued.seq > seq) this.apply(queued.event)
    for (const id of oldViews)
      if (!this.sessions.has(id)) this.emit('view', id, null)
    this.events = []
    this.buffering = false
    this.emit('list', [...this.sessions.values()])
    this.emit('ready')
  }
  private accept(view: SessionView) {
    if (this.tombstones.has(view.session_id)) return
    const current = this.views.get(view.session_id)
    if (current && current.revision >= view.revision) return
    this.views.set(view.session_id, view)
    this.sessions.set(view.session_id, {
      session_id: view.session_id,
      label: view.label,
    })
    this.emit('view', view.session_id, view)
  }
  private apply(event: RexEvent) {
    const p = event.payload
    if (event.type === 'session_created') {
      this.sessions.set(p.session.session_id, p.session)
      this.emit('list', [...this.sessions.values()])
    }
    if (event.type === 'session_moved') {
      const moved = this.sessions.get(p.session_id)
      if (moved) {
        const entries = [...this.sessions.values()].filter(
          (s) => s.session_id !== p.session_id,
        )
        const index = entries.findIndex(
          (s) => s.session_id === p.before_session_id,
        )
        entries.splice(index < 0 ? entries.length : index, 0, moved)
        this.sessions.clear()
        for (const session of entries)
          this.sessions.set(session.session_id, session)
        this.emit('list', entries)
      }
    }
    if (event.type === 'session_destroyed') {
      this.tombstones.add(p.session_id)
      this.sessions.delete(p.session_id)
      this.views.delete(p.session_id)
      this.attached.delete(p.session_id)
      this.emit('view', p.session_id, null)
      this.emit('list', [...this.sessions.values()])
    }
    if (event.type === 'session_event') {
      const e = p.event as RexEvent
      if (e.type === 'session_label_changed') {
        const s = this.sessions.get(p.session_id)
        if (s) s.label = e.payload.label
      }
      if (e.type === 'session_view_changed') {
        this.wanted.set(
          p.session_id,
          Math.max(this.wanted.get(p.session_id) ?? -1, e.payload.revision),
        )
        if ((this.views.get(p.session_id)?.revision ?? -1) < e.payload.revision)
          void this.refresh(p.session_id).catch((e) => {
            if (!(e instanceof RexError && e.code === 'session_not_found'))
              this.emit('fault', e)
          })
      }
      this.emit('event', { sessionId: p.session_id, ...e })
    } else this.emit('event', event)
  }
  async attach(id: string): Promise<SessionView> {
    await this.ready()
    if (this.attached.has(id)) return this.refresh(id)
    const existing = this.attaching.get(id)
    if (existing) return existing
    const epoch = this.epoch
    const promise = this.control
      .call('session.attach', { session_id: id })
      .then((r) => {
        if (epoch === this.epoch) {
          this.attached.add(id)
          this.accept(r.view)
        }
        return this.views.get(id) ?? r.view
      })
      .finally(() => {
        if (this.attaching.get(id) === promise) this.attaching.delete(id)
      })
    this.attaching.set(id, promise)
    return promise
  }
  refresh(id: string): Promise<SessionView> {
    const existing = this.refreshes.get(id)
    if (existing) return existing
    const epoch = this.epoch
    const task = (async () => {
      let view: SessionView
      do {
        view = await this.control.call<SessionView>('session.view', {
          session_id: id,
        })
        if (epoch !== this.epoch) return view
        this.accept(view)
      } while (
        !this.tombstones.has(id) &&
        (this.views.get(id)?.revision ?? -1) < (this.wanted.get(id) ?? 0)
      )
      return this.views.get(id) ?? view
    })().finally(() => {
      if (this.refreshes.get(id) === task) this.refreshes.delete(id)
    })
    this.refreshes.set(id, task)
    return task
  }
}
