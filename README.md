# rex-gui

A Linux desktop client for Rex, built with Electron, SolidJS, TypeScript and xterm.js.

```sh
pnpm install
pnpm dev
```

## Install on Omarchy

```sh
bin/install
```

Builds the app and installs it as the `rex-gui` package (on Arch's `electron39`), so **Rex** shows up in the app launcher (`Super + Space`). Run it again after every change.

On Omarchy the app follows the active theme live: the default accent is the theme's, terminals use its colors (unless Rex sends its own), and window corners match Hyprland's `decoration:rounding`. On Hyprland the desktop blur setting works with both Lua and hyprlang configs.

## Development

Requires `/usr/bin/rex` and a desktop display. If Electron's binary install is incomplete on Node 26, run `pnpm setup:electron` (requires `unzip`).

`pnpm typecheck`, `pnpm test`, `pnpm smoke`, and `pnpm smoke:ui` validate the backend. Smoke tests create and destroy only their own throwaway sessions. `pnpm dist` is configured for AppImage and pacman; package builds have not been verified.

See [docs/BACKEND.md](docs/BACKEND.md) for the architecture, exact preload API, verification evidence, protocol decisions, and frontend handoff notes. The renderer is deliberately minimal.
