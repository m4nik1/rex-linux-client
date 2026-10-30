// Runs the actual packaged renderer/preload/main on the desktop, using only a session it creates.
const { app } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let window, sessionId
const timeout = setTimeout(() => {
  console.error('UI smoke timed out')
  void finish(1)
}, 45000)
async function evaluate(source) {
  return window.webContents.executeJavaScript(source, true)
}
async function finish(code) {
  clearTimeout(timeout)
  if (sessionId && window && !window.isDestroyed()) {
    try {
      await evaluate(
        `window.rex.destroySession('personal', ${JSON.stringify(sessionId)})`,
      )
      console.log('UI DESTROYED', sessionId)
    } catch (e) {
      console.error('UI cleanup failed', e)
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
app.on('browser-window-created', (_event, win) => {
  window = win
  win.webContents.once('did-finish-load', async () => {
    try {
      await delay(800)
      console.log(
        'UI bridge servers',
        await evaluate('window.rex.listServers()'),
      )
      const label = `rexgui-ui-smoke-${Date.now()}`
      sessionId = await evaluate(
        `window.rex.createSession('personal', {label:${JSON.stringify(label)},cwd:'/tmp'})`,
      )
      await delay(300)
      await evaluate(
        `(localStorage.removeItem('rex-gui:last-session:v1'), [...document.querySelectorAll('.sess')].find(b=>b.textContent===${JSON.stringify(label)}).click())`,
      )
      await delay(1200)
      const count = await evaluate(`document.querySelectorAll('.xterm').length`)
      if (count !== 1) throw new Error(`Expected one terminal, got ${count}`)
      await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
      await win.webContents.insertText(
        "echo UI_REXGUI_OK; printf 'TERM=%s\\n' $TERM",
      )
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      await delay(700)
      const outputDir = join(__dirname, '../docs/validation')
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(
        join(outputDir, 'idle.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      console.log('UI idle screenshot saved')
      await win.webContents.insertText('top -d 1')
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      await delay(1300)
      // Select away and back: fresh stream + format while a full-screen application is running.
      await evaluate(
        `window.rex.newWindow('personal',${JSON.stringify(sessionId)})`,
      )
      await delay(600)
      const view = await evaluate(
        `window.rex.getSessionView('personal',${JSON.stringify(sessionId)})`,
      )
      await evaluate(
        `window.rex.focusWindow('personal',${JSON.stringify(sessionId)},${JSON.stringify(view.windows[0].window_id)})`,
      )
      await delay(1600)
      writeFileSync(
        join(outputDir, 'top.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      console.log('UI top reattach screenshot saved')
      const focused = await evaluate(
        `window.rex.getSessionView('personal',${JSON.stringify(sessionId)})`,
      )
      await evaluate(
        `window.rex.split('personal',${JSON.stringify(sessionId)},${JSON.stringify(focused.windows[0].focused_block_id)},'right')`,
      )
      await delay(1000)
      const panes = await evaluate(`document.querySelectorAll('.xterm').length`)
      if (panes !== 2)
        throw new Error(`Expected two terminals after split, got ${panes}`)
      writeFileSync(
        join(outputDir, 'split.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      await evaluate(
        `document.querySelector('.pane [title^="Close pane"]').click()`,
      )
      await delay(700)
      if ((await evaluate(`document.querySelectorAll('.xterm').length`)) !== 1)
        throw new Error('Close pane did not update layout')
      await evaluate(
        `window.rex.closeWindow('personal',${JSON.stringify(sessionId)},${JSON.stringify(view.windows[1].window_id)})`,
      )
      await delay(500)
      const finalView = await evaluate(
        `window.rex.getSessionView('personal',${JSON.stringify(sessionId)})`,
      )
      if (finalView.windows.length !== 1)
        throw new Error('Close window did not update layout')
      console.log('UI PASS close pane + close window')
      const error = await evaluate(
        `[...document.querySelectorAll('.toast.error')].map(t=>t.textContent).join(' | ')`,
      )
      if (error) throw new Error(error)
      console.log(
        'UI PASS: real preload IPC, terminal input, new/focus window, full-screen reattach, split layout; screenshots in docs/validation',
      )
      await finish(0)
    } catch (e) {
      console.error(e)
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
