# Rex GUI frontend

This is the SolidJS renderer that sits on top of the backend described in `docs/BACKEND.md`. It aims for the Ghostty and Rex.app look: one slim titlebar row with window dots, a sidebar toggle, pill tabs and icons on the right. Each pane has a small header and the terminal fills the rest. Chrome uses "liquid glass" materials over a dark navy base.

```sh
pnpm typecheck && pnpm test && pnpm build
pnpm screenshots   # drives the real app, writes docs/screenshots/*.png, destroys its own session
pnpm smoke:ui      # backend UI smoke, updated for the new selectors
```

Both desktop scripts run Electron with a throwaway `userData` directory. That means no session is restored from your real profile, so they cannot touch a session they did not create, such as `gui-dev`.

## Component map (`src/renderer/src`)

| File | Role |
| --- | --- |
| `index.tsx` | Mounts `App` and imports the styles. |
| `App.tsx` | Shell layout (base layer, titlebar, sidebar, main, overlays), bridge subscriptions and the global shortcut dispatcher. |
| `components/Titlebar.tsx` | Window dots (close, minimize, maximize via `window.rex`, with maximize state from `onMaximizeChange`), sidebar toggle, tab strip and the right-hand icons. Each **Tab** supports click to focus, middle-click or × to close, double-click to rename inline, and HTML5 drag to reorder (`moveWindow`). |
| `components/Workspace.tsx` | Absolutely positions panes from the layout tree. Draggable **dividers** call `resizePane` live (throttled to about 70 ms) and once more on release; double-click sets 50/50. The workspace is keyed by session only, so view revisions never remount terminals. |
| `components/TerminalPane.tsx` | One xterm per block id, using the WebGL addon with DOM fallback. Fit is debounced by 40 ms plus rAF and only sends a resize when cols×rows actually change. The pane follows the attach, subscribe, size, `startTerminal` order. It applies Rex `theme` meta, including the 256-colour palette through `extendedAnsi`. The **pane header** has a drag handle (drop on another pane to `swapBlocks`), a "process cwd" chip with a hover glass popover (process, full path, terminal title), and split right, split down, zoom and close tools. |
| `components/Sidebar.tsx` | Collapsible glass panel listing servers (personal, shared, remote) with connection dots and their sessions. Supports new, rename (double-click or pencil), end (with confirmation), Start or Connect for disconnected servers, removing GUI-added hosts, and "Add remote host". |
| `components/Dialogs.tsx` | Modal glass dialogs: add host, new session, rename session or tab, and end session. |
| `components/CommandPalette.tsx` | Fuzzy palette covering actions, tabs, sessions on every connected server, and "new session on X". Shows shortcut hints and highlights matched characters. |
| `components/SettingsPopover.tsx` | Appearance popover (eye icon). |
| `components/EmptyState.tsx` | Three states: connecting, no server (Start local server or Add remote host), and pick a session. |
| `components/Toasts.tsx` | Error and info toasts (duplicates collapse, max 4). |
| `components/GlassDefs.tsx` | The SVG `#lens` filter used by `backdrop-filter: url(#lens)`. |
| `components/Icons.tsx` | Inline 16px stroke icons. |
| `state/store.ts` | Servers, sessions per server, active selection, the authoritative `SessionView`, derived panes and dividers, per-block identity (process, cwd, home, title), and every action wrapper. |
| `state/settings.ts` | Persisted appearance settings mirrored to CSS variables. |
| `state/ui.ts`, `state/toasts.ts`, `state/terminals.ts` | Overlay state, toasts, and the live xterm registry used for copy, paste and focus. |
| `lib/layout.ts` | Pure layout helpers: panes (zoom-aware), dividers with the nearest blocks either side, and ratio maths. |
| `lib/format.ts` | Home shortening, OSC 7 pwd parsing, Rex's process-label rule, Nerd Font process glyphs, default window label detection, and `parseHostInput`. |
| `lib/keys.ts` | Shortcut matcher and hint labels. |
| `lib/fuzzy.ts`, `lib/theme.ts` | Palette scoring, the default terminal theme, and the Rex theme mapping. |

Titles: a tab shows the focused block's `<process> <cwd>`, or the window label once a person renames it. Rex's default labels look like `Window 37fd84a3`. Process and cwd start from the new `blockInfo` call, which returns the process `home`, so `~` is correct on remote hosts too. They are then kept current by the `process_changed`, `pwd_changed` and `title_changed` block events. Process tiles use JetBrainsMono Nerd Font glyphs (installed here) with tinted squares, for example green for Node, blue for Python and violet for top.

## Design tokens (`styles/tokens.css`)

- **Colour:** `--abyss #05080d` (window floor), `--navy #0d1117` (terminal fill), `--slate #161d29` (glass body), `--frost #e7edf4` (text), `--mist #9aa6b6` (secondary), `--haze #5f6b7c` (tertiary, idle icons). Accent is selectable: Glacier `#8fd3ff` (default), Lilac `#b9a7ff`, Mint `#7fe3b5`, Amber `#ffc66d` or Coral `#ff8f8f`. Traffic lights use the standard red, yellow and green.
- **Type:** UI uses `Adwaita Sans` (an Inter derivative, installed), then Inter, Cantarell and system-ui, at 10.5, 11.5, 12.5 and 15 px. The terminal and paths use `JetBrainsMono Nerd Font Mono`, then JetBrains Mono, DejaVu Sans Mono and ui-monospace.
- **Glass:** a translucent slate tint plus a top-down sheen. The rim is an inset top highlight, a faint left highlight, a 1px inner hairline and a dark bottom edge. Depth comes from two soft shadows. `backdrop-filter: blur(var(--blur)) saturate(1.7)`. Floating panels (`.lens`: palette, dialogs, settings) add the SVG displacement filter so terminal text behind the rim bends slightly. Their body is denser (74%) so their own text stays crisp.
- **Base layer:** a navy gradient with a faint accent aurora, a violet glow at the bottom right, and an SVG film-grain layer. Its opacity is the "Window opacity" setting, so the window looks finished with or without compositor blur.
- **Shape:** radii of 5, 7, 10 and 14 px, plus 12 px for the window (none when maximized).
- **Motion:** `--spring` is a CSS `linear()` spring for popovers, the palette, dialogs, toasts and button presses; `--ease-out` handles tab and sidebar morphs. `prefers-reduced-motion` disables all animation and transitions.

## Shortcuts

App chords are caught in a capture-phase `keydown` listener and also through xterm's `attachCustomKeyEventHandler`, so they never reach the program. Every other key goes to the terminal unchanged.

| Keys | Action |
| --- | --- |
| Ctrl+Shift+T | New tab |
| Ctrl+Shift+W | Close focused pane |
| Ctrl+Shift+D or Ctrl+Shift+Enter | Split right |
| Ctrl+Shift+E | Split down |
| Ctrl+Shift+Z | Zoom or unzoom pane |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageDown, Ctrl+PageUp | Next or previous tab |
| Alt+1 to Alt+9 | Go to tab N |
| Alt+←, Alt+→, Alt+↑, Alt+↓ | Focus a neighbouring pane (`session.focus_direction`) |
| Ctrl+Shift+C, Ctrl+Shift+V | Copy selection, paste (Electron clipboard; paste goes through `term.paste`, so bracketed paste is respected) |
| Ctrl+Shift+P | Command palette |
| Ctrl+Shift+B | Toggle sidebar |
| Ctrl+Shift+, | Appearance settings |

Note that Alt+arrows and Alt+digits are claimed. fish and some editors bind Alt+←/→, and those bindings won't fire inside rex-gui.

## Settings (localStorage `rex-gui:settings:v1`)

| Setting | Range | Default | Effect |
| --- | --- | --- | --- |
| Window opacity | 35–100% | 88% | Opacity of the base layer behind everything |
| Terminal tint | 0–100% | 55% | Pane fill in the theme background colour; xterm itself renders transparent |
| Glass blur | 0–48 px | 22 px | Chrome backdrop blur |
| Font size | 9–24 | 13.5 | Live refit |
| Accent | 5 swatches | Glacier | Focus glow, dividers, buttons, selection marks |

Sidebar visibility is persisted too. The last opened session is remembered in `rex-gui:last-session:v1` and reopened on launch if it still exists.

## Backend additions (small, typed in `src/shared/ipc.ts`, implemented in `src/main/index.ts`)

No `src/main/rex/*` files were changed.

| Method | Rex call |
| --- | --- |
| `moveWindow(server, session, windowId, beforeWindowId \| null)` | `session.move_window` |
| `focusDirection(server, session, dir)` | `session.focus_direction` |
| `swapBlocks(server, session, a, b)` | `session.swap_blocks` (`block_id`, `other_block_id`) |
| `blockInfo(server, session, block)` | `com.superlogical.terminal.process`, `.pwd`, `.title` in parallel; each failure is tolerated and returns `{foreground, child, home, pwd, title}` |
| `readClipboard()` / `writeClipboard(text)` | Electron `clipboard` |
| `onMaximizeChange(cb)` | BrowserWindow `maximize` and `unmaximize` events on channel `rex:maximized` |

"Start local server" calls the existing `connect('personal')`, which runs `rex whoami` and autostarts the server.

### Remote hosts and Tailscale

The add-host dialog validates input with `parseHostInput` (unit-tested) and explains how each form will connect. The address goes to `addHost` unchanged, and the backend's `endpoint.ts` resolves it.

- `rex-cachy.<tailnet>.ts.net`, a Tailscale MagicDNS name, tries HTTPS on 443, then HTTPS and HTTP on 7297. The suggested label is the machine name.
- `account@host` uses the login-server account, sent as the `rex.as.<account>` subprotocol.
- `https://host:7297` is used exactly as written.
- `ssh://`, passwords, and input with spaces are rejected with a reason.

## Verification

- `pnpm typecheck`, `pnpm test` (adds `tests/renderer.test.ts`, which covers layout, dividers, fuzzy matching, formatting, Tailscale and host parsing, shortcuts, theme and settings) and `pnpm build` all pass.
- `pnpm screenshots` writes `docs/screenshots/01-empty.png` through `09-resized.png`, covering the empty state, a two-tab split running `ls` and `top`, the pane popover, sidebar, palette, settings, add-host dialog, zoom, and divider drag. The divider drag moved the real split ratio from 0.5 to 0.416.
- `pnpm smoke:ui` (the backend's UI smoke) still passes against the new renderer.

## Known gaps

- Compositor blur behind the window is not requested. On Hyprland, add a `windowrule` or layerrule for blur; on KDE, the KWin blur effect with "blur behind" rules. The base layer keeps the app legible either way.
- The `#lens` displacement depends on Chromium's support for `backdrop-filter: url()`. It is subtle on purpose. Where it is unsupported, the plain blur still applies.
- Hidden tabs detach their terminals (backend design), so switching tabs re-attaches and redraws from `format`. xterm instances survive layout and focus changes within a tab, but not tab switches.
- Split-pane drag is pointer-based. Pane swap and tab reorder use HTML5 drag and drop, which has no keyboard equivalent yet; the palette covers the other actions.
- Window rename with an empty label is ignored, because Rex has no documented "reset to default".
- Non-terminal blocks (for example onboarding) render as terminals that fail to attach. Floating layers are positioned from their rectangles but get no special floating chrome.
- Bell and desktop-notification events are recorded but not yet shown. Progress reports and program status are not surfaced.
- Copy uses an explicit chord only; there is no copy-on-select.
