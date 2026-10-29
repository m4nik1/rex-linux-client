// Drives the real built app on the desktop and captures design screenshots into
// docs/screenshots/. Uses ONLY a throwaway session it creates (rexgui-ui-<ts>)
// and destroys it at the end. Run: pnpm build && env -u ELECTRON_RUN_AS_NODE electron scripts/ui-screenshot.cjs
const { app } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const outDir = join(__dirname, '../docs/screenshots')
let win, sessionId
const label = `rexgui-ui-${Date.now()}`
const S = (v) => JSON.stringify(v)

const timeout = setTimeout(() => {
  console.error('ui-screenshot timed out')
  void finish(1)
}, 120000)

const evaluate = (src) => win.webContents.executeJavaScript(src, true)
async function shot(name) {
  await delay(250)
  writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG())
  console.log('saved', name)
}
async function until(src, what, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await evaluate(src)) return
    await delay(100)
  }
  throw new Error('Timed out waiting for ' + what)
}
async function typeLine(text) {
  await win.webContents.insertText(text)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}
const view = () => evaluate(`window.rex.getSessionView('personal', ${S(sessionId)})`)
const focusPane = (i) =>
  evaluate(`document.querySelectorAll('.pane .xterm-helper-textarea')[${i}].focus()`)

async function finish(code) {
  clearTimeout(timeout)
  if (sessionId && win && !win.isDestroyed()) {
    try {
      await evaluate(`window.rex.destroySession('personal', ${S(sessionId)})`)
      console.log('DESTROYED', label, sessionId)
    } catch (e) {
      console.error('cleanup failed', e)
      code = 1
    }
  }
  // Quit normally so the app's before-quit cleanup (Hyprland blur restore) runs first.
  app.once('will-quit', (event) => {
    event.preventDefault()
    app.exit(code)
  })
  app.quit()
}

app.on('browser-window-created', (_e, w) => {
  win = w
  w.setSize(1280, 800)
  w.webContents.once('did-finish-load', async () => {
    try {
      mkdirSync(outDir, { recursive: true })
      // Never auto-restore a session we didn't create.
      await evaluate(`localStorage.removeItem('rex-gui:last-session:v1')`)
      await delay(1500)
      await shot('01-empty.png')

      sessionId = await evaluate(
        `window.rex.createSession('personal', {label: ${S(label)}, cwd: ${S(os.homedir())}})`,
      )
      console.log('CREATED', label, sessionId)
      await until(
        `[...document.querySelectorAll('.empty-sess')].some(b => b.textContent.includes(${S(label)}))`,
        'session in empty list',
      )
      await evaluate(
        `[...document.querySelectorAll('.empty-sess')].find(b => b.textContent.includes(${S(label)})).click()`,
      )
      await until(`document.querySelectorAll('.pane .xterm').length === 1`, 'first terminal')
      await delay(900)
      await focusPane(0)
      await typeLine('clear; command ls --color=always -F /usr/bin | head -40')
      await delay(500)

      // Split right and run top there.
      await key('D', ['control', 'shift'])
      await until(`document.querySelectorAll('.pane .xterm').length === 2`, 'split')
      await delay(1200)
      await focusPane(1)
      await typeLine('top -d 2')
      await delay(800)

      // Second tab running node, so the tab strip shows a process icon.
      await key('T', ['control', 'shift'])
      await until(`document.querySelectorAll('.tab').length === 2`, 'second tab')
      await delay(1200)
      await focusPane(0)
      await typeLine(`cd /tmp; node -e "setInterval(()=>{},1e6)"`)
      await delay(1200)
      // Back to tab 1 (Ctrl+PageUp).
      await key('PageUp', ['control'])
      await until(`document.querySelectorAll('.pane .xterm').length === 2`, 'back to tab 1')
      await delay(2200)
      // Focus the left pane (Alt+Left) to show the focus ring there.
      await key('Left', ['alt'])
      await delay(800)
      await shot('02-split.png')

      // Hover the pane chip: glass popover.
      const chip = await evaluate(
        `(() => { const r = document.querySelector('.pane-chip').getBoundingClientRect(); return {x: r.x + 30, y: r.y + 10} })()`,
      )
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(chip.x), y: Math.round(chip.y) })
      await delay(900)
      await shot('03-popover.png')
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 500 })

      // Sidebar.
      await key('B', ['control', 'shift'])
      await delay(700)
      await shot('04-sidebar.png')
      await key('B', ['control', 'shift'])
      await delay(400)

      // Command palette with a query.
      await key('P', ['control', 'shift'])
      await delay(500)
      await win.webContents.insertText('spl')
      await delay(400)
      await shot('05-palette.png')
      await key('Escape')
      await delay(300)

      // Settings popover.
      await evaluate(`document.querySelector('[aria-label="Appearance settings"]').click()`)
      await delay(700)
      await shot('06-settings.png')
      await key('Escape')
      await delay(300)

      // Add host dialog with a Tailscale name.
      await evaluate(`document.querySelector('.sidebar-add').click()`)
      await delay(400)
      await win.webContents.insertText('rex-cachy.tail1234.ts.net')
      await delay(500)
      await shot('07-add-host.png')
      await key('Escape')
      await delay(300)

      // Zoomed pane.
      await key('Z', ['control', 'shift'])
      await delay(1200)
      await shot('08-zoom.png')
      await key('Z', ['control', 'shift'])
      await delay(600)

      // Divider drag via the real resize API path.
      const v = await view()
      const w = v.windows.find((x) => x.window_id === v.active_window_id)
      const blocks = w.layers[0].layout.split
      console.log('split ratio before', blocks.ratio)
      const d = await evaluate(
        `(() => { const r = document.querySelector('.divider').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`,
      )
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(d.x), y: Math.round(d.y), button: 'left', clickCount: 1 })
      for (let i = 1; i <= 8; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(d.x - i * 20), y: Math.round(d.y), modifiers: ['leftButtonDown'] })
        await delay(30)
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(d.x - 160), y: Math.round(d.y), button: 'left', clickCount: 1 })
      await delay(1200)
      const v2 = await view()
      const w2 = v2.windows.find((x) => x.window_id === v2.active_window_id)
      console.log('split ratio after drag', w2.layers[0].layout.split?.ratio)
      await shot('09-resized.png')

      const toastErr = await evaluate(`[...document.querySelectorAll('.toast.error')].map(t => t.textContent).join(' | ')`)
      if (toastErr) console.log('ERROR TOASTS:', toastErr)
      console.log('UI SCREENSHOTS DONE')
      await finish(0)
    } catch (e) {
      console.error(e)
      try {
        await shot('99-failure.png')
      } catch {}
      await finish(1)
    }
  })
})

// Isolated profile: no restored session (never the user's), no GUI-added hosts.
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(join(require('node:os').tmpdir(), 'rexgui-test-')),
)
// Start on the empty state rather than opening (or creating) one of the user's sessions.
process.env.REX_GUI_AUTO_SESSION = '0'
require('../out/main/index.js')
