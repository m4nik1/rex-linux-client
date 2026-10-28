# Rex GUI backend handoff

## Running and validation

This repository is an Electron + SolidJS + strict TypeScript Linux desktop app. Nothing has been committed. The supplied `docs/rex/` files are preserved.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm smoke
pnpm dev
# Optional desktop integration check (creates and destroys its own session):
pnpm smoke:ui
# Packaging configuration only; packages have not been built:
pnpm dist
```

Here pnpm is `~/.local/share/pnpm/bin/pnpm`. Node is v26.12.1. The first Electron postinstall returned successfully with only a partial `dist/snapshot_blob.bin` and no `path.txt`. `pnpm setup:electron` extracts the checksum-verified Electron archive using Linux `unzip`; use it if Electron reports “Electron uninstall.” The installed binary is now ready. The dev/preview/UI-smoke scripts clear T3's inherited `ELECTRON_RUN_AS_NODE=1` so Electron starts as a GUI application. pnpm's build-script allowlist is in `pnpm-workspace.yaml`.

Validation on the live personal Rex server (0.0.1793195882-gac26dc, requested API revision 7):

- `pnpm typecheck` passed; `pnpm test` passed **13 tests across 3 files**. Protocol and view-store unit tests cover snapshot markers/APCs across chunk boundaries, nonce matching, UTF-8 preservation, HELLO/WELCOME/RESUME, input serialization/coalescing and large pastes, remote account selection, bootstrap seq replay, monotonic view revisions, and destruction during a view fetch.
- `pnpm smoke` creates `rexgui-smoke-<timestamp>`, attaches, claims/resizes, opens the data stream, verifies `REXGUI_OK` in actual post-snapshot program bytes and `TERM_CHECK=xterm-rex`, drops and resumes data without a new snapshot, drops and resumes the control client with a fresh bootstrap, splits and waits for the authoritative event-driven view, checks idle scrollback and a running `top` in xterm headless, and destroys only its created session in `finally`.
- Observed smoke output: `PASS data stream resumed; fresh snapshots: 0`, `PASS split event merged; blocks 2`, `PASS xterm idle redraw retains scrollback: 113 lines`, `PASS xterm full-screen redraw contains Tasks and process headers`, `SMOKE PASS`, followed by `DESTROYED only smoke session ...`.
- `pnpm smoke:ui` launches the actual production main/preload/renderer on the desktop. It creates its own session in `/tmp`, selects it in the sidebar, types through xterm's textarea, opens/switches windows, reattaches to `top`, verifies a two-pane split, closes a pane and the second window, and destroys its session. Screenshots are in `docs/validation/idle.png`, `top.png`, and `split.png`. These were visually inspected: colored fish output, `UI_REXGUI_OK`, `TERM=xterm-rex`, and the full-screen process display render correctly.
- `pnpm dev` has been launched on DISPLAY=:0 / WAYLAND_DISPLAY=wayland-1 (Hyprland). Main reached `[rex-gui] main ready`; the app was then stopped. Missing shared socket is represented as a disconnected server, not a fatal startup failure.
- Captured final logs are in `docs/validation/smoke.txt`, `ui-smoke.txt`, and `dev.txt`. The final server session listing contained only the original `gui-dev`.
- `pnpm dist` and a real remote/shared connection have **not** been tested. Existing session `gui-dev` was never selected, resized, written to, or destroyed by the test scripts.

## Architecture and modules

- `src/main/rex/endpoint.ts`: Unix WebSocket URLs, hostname fallback (HTTPS default port, HTTPS 7297, HTTP 7297), explicit ports, account-qualified login-server addresses. A local HTTP probe of the real CLI established that `https://account@host` becomes the additional WebSocket subprotocol `rex.as.account`, **not HTTP Basic auth**. Both control and data use that selection. Password URLs are rejected. TLS verification remains enabled.
- `src/main/rex/control.ts`: one multiplexed control socket per server, uncompressed hello, strict revision 7 negotiation, request IDs/out-of-order responses, structured Rex errors, request timeouts, ping/pong health checking, reconnect token rotation, exponential backoff with jitter. Pending requests fail on a drop and are never replayed: their outcomes are unknown. Tokens are held in memory and never deliberately logged.
- `src/main/rex/sessions.ts`: bootstrap with `event_scope: all`, buffer events while bootstrap is pending, apply the response, replay only seq values above the result seq. Main owns session lists and full views. Revision comparisons prevent stale responses/events replacing newer views; wanted revisions coalesce refreshes. Tombstones prevent a late view response resurrecting a destroyed session. Control reconnect starts a fresh bootstrap because events during a disconnect are lost. Viewed sessions are reattached; vanished sessions emit null views.
- `src/main/rex/server-registry.ts`: personal socket discovered using `rex whoami` (also autostarts it), shared `/run/rex/server.sock`, personal-server `hosts.list`, and GUI-added hosts. Saved Rex hosts try all supplied endpoints. Every server connects independently, so an unavailable shared/remote server cannot block the personal one. GUI-added hosts persist in Electron userData `hosts.json` with mode 0600; removing them does not change Rex's global saved-host list. Rex-managed hosts are read-only through this API.
- `src/main/rex/handshake.ts`: pure binary data handshake encode/decode; uint64 values use bigint.
- `src/main/rex/vtstream.ts`: incremental byte parser. Skips binary Ghostty snapshot up to the first exact channel marker, retains marker suffixes between chunks, extracts matching Rex APCs, passes other program bytes unchanged (including mismatched APCs). Unknown or malformed matching APCs are skipped. Snapshot scanning retains only a bounded suffix, and incomplete trusted APCs have a 1 MiB bound.
- `src/main/rex/data.ts`: terminal data socket, ticket HELLO, token RESUME, parser lifecycle, format pagination via blob_read, initial redraw buffering, reconnect/fresh stream fallback. The consumed count includes all stream bytes handed to the parser, including retained partial markers, snapshot, and APCs; handshake bytes are excluded. Resuming keeps the same parser and count. Rejected resume gets a new ticket. Normal close/block close stops reconnecting.
- `src/main/rex/input-queue.ts`: one in-flight write per block, same-tick/pending coalescing, UTF-8-safe 64 KiB chunks for pastes. Later keystrokes cannot overtake paste chunks. Failed in-flight and waiting input is rejected, not retried.
- `src/main/index.ts`: Electron lifecycle, IPC allowlist/sender checks, registry, terminal handles, ownership, 8 ms byte batching (early flush at 256 KiB), window controls. All `rex/` modules have no Electron imports.
- `src/preload/index.ts`: bundled CommonJS preload, sandbox-compatible, exposes only `window.rex` through contextBridge. Renderer has neither Node nor raw ipcRenderer access.
- `src/renderer/src/index.tsx`: deliberately plain proof UI. Server/session sidebar, window tabs, one stable xterm per visible block, full layout-tree leaf rectangles, zoom handling, split/close/new-window controls. Uses Fit, WebGL (DOM fallback and context-loss fallback), Unicode11 and WebLinks addons. Hidden windows detach streams and give up claims. Visible panes claim before resize; focus is sent on mouse down.
- `scripts/smoke.ts`, `scripts/ui-smoke.cjs`, `tests/`: repeatable validation using only throwaway sessions.

## Initial screen: snapshot / format ordering

The Ghostty binary snapshot is never sent to xterm. The exact first `ESC _ rex1;<decimal nonce>;` marks its end, even across WebSocket messages. The first resize/theme APCs are surfaced separately. Main buffers subsequent program bytes while it calls terminal.format with `format: vt`, all requested `extra_*` flags, and `max_bytes: 49152`. If an id is returned, blob_read uses UTF-8 byte offsets until eof. It then emits **RIS (`ESC c`) + complete format content, followed by buffered program bytes**, and switches to live forwarding.

Empirical findings:

- An idle fish shell reattached cleanly with its colors, prompt, cursor, and earlier output. format(vt) contains scrollback: after a marker and `seq 1 70`, the result was 11,145 bytes, contained `SCROLL_SENTINEL`, and xterm reconstructed 113 lines at a 30-row size.
- `top -d 1` reattachment reconstructed a readable complete process screen. The live format was 14,086 bytes in the smoke run. This top version did not include `CSI ?1049h` in its format result; correctness should not be inferred solely from an alternate-screen flag. xterm headless contained the Tasks/process headers, and the desktop screenshot after window switch showed a correctly positioned top display with subsequent updates.
- The chosen format-then-buffered ordering looked correct for these two cases. It preserves program output received during the format request. It is **not an atomic checkpoint**: format can include changes also present in buffered data, so racing output can duplicate or briefly regress until the next application redraw. The API supplies no shared format/stream byte offset. Discarding all buffered bytes could lose data emitted after format was read, so the implementation keeps them. A Ghostty snapshot decoder or server-provided checkpoint/offset would be needed for exact reconstruction under arbitrary continuous output.
- Initial buffering is capped at 8 MiB; exceeding it fails/reconnects rather than accumulating indefinitely. A successful data RESUME does not repeat format or reset xterm.

## Input and sizing decisions

The renderer sends xterm `onData` strings through `writeTerminal`, including paste and VT key sequences. Main serializes `com.superlogical.terminal.write` per block. This preserves xterm's key encoding, IME, bracketed paste and application cursor modes. `client.key` was examined but is not used: sending both paths duplicates keys; using only physical-key forwarding needs a complete layout/IME/modifier and key-prefix implementation. Rex Lua keybindings therefore do **not** run for terminal typing in this version. Frontend shortcuts call the explicit split/window/focus APIs. Do not add a second keyboard forwarding path without resolving this policy.

`resizeTerminal(handle, cols, rows)` claims only that visible block using `session.own_block` with `block_ids` and `mode: take`, then sends terminal.resize. The **wire method uses `args.columns`**, despite stream resize metadata using `cols`. Resizes are serialized per handle. Detach disowns the block. The renderer fits before starting the data stream, so the initial format uses the intended size. Ownership can be taken from another GUI client when making a pane visible, by design.

## window.rex API

This is the typed contract from `src/shared/ipc.ts` (source of truth). Promise failures reject with a readable Electron-serialized error; Rex error code/status are available in protocol modules but are not preserved as custom properties across Electron invoke. Handles are opaque and scoped to the current renderer lifetime.

```ts
export interface ServerInfo {
  id: string
  label: string
  address: string
  kind: 'personal' | 'shared' | 'remote'
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  error?: string
}
export interface SessionInfo {
  session_id: string
  label: string
}
export interface Layout {
  rect: [number, number, number, number]
  block_id?: string | null
  split?: {
    split_id: string | null
    direction: 'horizontal' | 'vertical'
    ratio: number
    before: Layout
    after: Layout
  } | null
}
export interface Block {
  block_id: string
  label?: string
  creator_name?: string
  flavor?: string
  owner?: string | null
}
export interface Layer {
  layer_id: string
  kind: string
  bounds: [number, number, number, number]
  layout: Layout
  blocks: Block[]
}
export interface RexWindow {
  window_id: string
  label: string
  focused_block_id: string
  zoomed_block_id?: string | null
  layers: Layer[]
}
export interface SessionView extends SessionInfo {
  revision: number
  active_window_id: string | null
  windows: RexWindow[]
}
export type TerminalMeta =
  | {
      type: 'resize'
      cols: number
      rows: number
      cell_width_px: number
      cell_height_px: number
      owner?: string | null
    }
  | {
      type: 'theme'
      foreground?: string
      background?: string
      cursor?: string
      palette?: string[]
      scheme?: string
    }
  | { type: 'child_exited'; exit_code: number }
  | { type: 'connection'; state: string; error?: string }
export interface SessionViewEvent {
  serverId: string
  sessionId: string
  view: SessionView | null
}
export interface ServerEvent {
  serverId: string
  sessionId?: string
  type: string
  payload: Record<string, unknown>
}
export type Unsubscribe = () => void
export interface RexAPI {
  listServers(): Promise<ServerInfo[]>
  connect(serverId: string): Promise<void>
  addHost(label: string, address: string): Promise<ServerInfo>
  removeHost(serverId: string): Promise<void>
  listSessions(serverId: string): Promise<SessionInfo[]>
  getSessionView(serverId: string, sessionId: string): Promise<SessionView>
  createSession(
    serverId: string,
    options: { label: string; cwd?: string },
  ): Promise<string>
  destroySession(serverId: string, sessionId: string): Promise<void>
  renameSession(
    serverId: string,
    sessionId: string,
    label: string,
  ): Promise<void>
  newWindow(serverId: string, sessionId: string): Promise<void>
  closeWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
  ): Promise<void>
  focusWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
  ): Promise<void>
  renameWindow(
    serverId: string,
    sessionId: string,
    windowId: string,
    label: string,
  ): Promise<void>
  split(
    serverId: string,
    sessionId: string,
    blockId: string,
    direction: 'right' | 'down',
  ): Promise<void>
  closeBlock(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<void>
  focusBlock(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<void>
  zoomBlock(serverId: string, sessionId: string, blockId: string): Promise<void>
  resizePane(
    serverId: string,
    sessionId: string,
    beforeBlockId: string,
    afterBlockId: string,
    direction: 'horizontal' | 'vertical',
    ratio: number,
  ): Promise<void>
  attachTerminal(
    serverId: string,
    sessionId: string,
    blockId: string,
  ): Promise<string>
  /** Subscribe before startTerminal: no bytes are emitted until startTerminal is called. */
  startTerminal(handle: string): Promise<void>
  onTerminalData(handle: string, cb: (data: Uint8Array) => void): Unsubscribe
  onTerminalMeta(handle: string, cb: (meta: TerminalMeta) => void): Unsubscribe
  writeTerminal(handle: string, data: string): Promise<void>
  resizeTerminal(handle: string, cols: number, rows: number): Promise<void>
  detachTerminal(handle: string): Promise<void>
  onServerState(cb: (state: ServerInfo) => void): Unsubscribe
  onSessionView(cb: (event: SessionViewEvent) => void): Unsubscribe
  onBlockEvent(cb: (event: ServerEvent) => void): Unsubscribe
  onServerEvent(cb: (event: ServerEvent) => void): Unsubscribe
  minimize(): Promise<void>
  maximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
}
```

### Event and handle semantics

1. Await `attachTerminal`; register `onTerminalData` and `onTerminalMeta`; request your initial size; then await `startTerminal`. Attach allocates an inert handle and ensures the control attachment. Start resolves when the data handshake succeeds, not when the initial format has finished. Initial bytes and later live output arrive through the data listener; always feed them to `term.write(Uint8Array)` in order. Do not UTF-8 decode each chunk independently.
2. Every event subscription returns an unsubscribe function. Unsubscribe all listeners and call detachTerminal on unmount. Detach is idempotent. A second attach for the same block replaces its old handle. Avoid concurrent attaches for one block.
3. `onTerminalData` batches bytes at roughly 8 ms in main; chunk boundaries carry no meaning. No browser frame scheduling is required to use it. Initial/reset redraws are ordinary VT bytes on this same channel.
4. `onTerminalMeta` provides trusted resize/theme/child_exited APCs and synthetic connection states: connected, reconnecting, error, closed. Unknown APC types are skipped. Theme replaces the previous theme; only the first 16 palette entries are mapped by the minimal renderer, although all entries reach the frontend through IPC. Resize metadata describes server size and ownership, not a request to claim it.
5. `onServerState` emits a complete ServerInfo whenever connection state changes or a host is added. `connected` means the socket welcome succeeded; listSessions/getSessionView await bootstrap. Query listServers initially and after removeHost; there is no host-removed event.
6. `onSessionView` emits complete, monotonic SessionViews per server/session, or null on destruction/removal after reconnect. It is not an incremental layout patch. Fetch the initial view with getSessionView; the same view may be delivered first as an event. Key xterms by block ID so focus/owner revisions do not remount them. Use zoomed_block_id over the normal layout when present; layout leaf rectangles already use window-relative coordinates.
7. `onServerEvent` forwards unwrapped protocol events, including session_created/destroyed/moved, client_joined/left and session events. Session events include sessionId. `onBlockEvent` is the block_event subset; its payload is `{block_id, creator_name, name, payload}` per Rex's schema (title_changed, pwd_changed, process_changed, bell, program_status, etc.); content belongs to the terminal creator and is typed as unknown fields. Session_view_changed in this raw stream still carries only a revision; use onSessionView for the fetched authoritative view. Client events not tied to a session have no sessionId.
8. Window methods act on the single frameless native window. maximize toggles maximize/restore; isMaximized is a query (no maximize-change subscription yet). Mutation methods resolve after Rex acknowledges; the resulting layout is delivered separately by onSessionView. Callers must handle a block/window disappearing between selection and mutation.

## Transparency / compositor behavior

BrowserWindow uses frame:false, transparent:true, backgroundColor:'#00000000', contextIsolation:true, nodeIntegration:false, sandbox:true. `backgroundMaterial: auto` is set as a best-effort Electron hint. The current proof renderer paints a mostly opaque dark background for legibility; replace that CSS for glass visuals.

Actual Linux backdrop blur is compositor-owned. This configuration does not install KWin blur hints or Hyprland rules, and Electron's backgroundMaterial does not guarantee Wayland blur. The session here is Hyprland; the app launches and the native surface permits transparency. KDE Plasma blur was not tested. A frontend may document a user compositor rule or add a carefully scoped native integration later. Do not promise cross-compositor blur based on this scaffold.

## Known gaps / next work

- Remote and shared live connections are untested; endpoint/account transport has a local protocol test and a real-CLI header probe. No interactive Tailscale login, certificate exceptions, or client_call_requested / client_perform_requested action responder is implemented.
- hosts_changed discovers newly added Rex-managed hosts. Editing/removing an existing Rex-managed host does not reconcile its already-created registry connection until restart. GUI-added hosts persist separately and only those may be removed via removeHost.
- The snapshot/format race remains best effort as described above. Ghostty-only terminal extensions, Kitty keyboard encoding, all 256 theme colors, non-UTF-8 legacy mouse output and terminal clipboard integration need further fidelity work. TERM is confirmed as xterm-rex; xterm.js is not a complete Ghostty replacement.
- The main batch queue is bounded per initial redraw, but live renderer consumption has no explicit acknowledgement/backpressure protocol. A stalled renderer and sustained huge output can build an Electron message backlog; add ACK/credit flow control before claiming arbitrary-rate streaming support.
- No swap/move helpers, pane-border drag UI, rename UI, host-edit UI, or Lua keybinding forwarding. The bridge already supports renaming sessions/windows and resizePane for the visual frontend. Non-terminal blocks (e.g. onboarding) need a dedicated renderer; the proof UI assumes terminal panes.
- Tokens and resume parser state are in memory only; an app restart attaches afresh. No crash-session restoration, multi-native-window support, accessibility polish, maximize event, or packaged installer verification yet.
- Input outcomes after a connection loss or request timeout are intentionally ambiguous; no automatic retry. The UI shows the failure and the next session bootstrap restores structure. Do not automatically resubmit create/split/write calls.
