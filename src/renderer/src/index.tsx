import { render } from 'solid-js/web'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'

render(() => <App />, document.getElementById('root')!)
