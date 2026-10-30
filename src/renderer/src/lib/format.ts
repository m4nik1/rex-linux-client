import type { ProcessInfo, ServerInfo } from '../../../shared/ipc'

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

/** Replace a leading home directory with ~. */
export function shortenHome(path: string, home?: string) {
  if (!path) return ''
  const h = home?.replace(/\/+$/, '')
  if (h && (path === h || path.startsWith(h + '/')))
    return '~' + path.slice(h.length)
  return path
}

/** Turn an OSC 7 file:// URL (or plain path) into a path. */
export function pwdToPath(pwd?: string) {
  if (!pwd) return ''
  if (pwd.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(pwd).pathname)
    } catch {
      return pwd.replace(/^file:\/\/[^/]*/, '')
    }
  }
  return pwd
}

const PRETTY: Record<string, string> = {
  node: 'Node',
  nodejs: 'Node',
  bun: 'Bun',
  deno: 'Deno',
  python: 'Python',
  python3: 'Python',
}

/** Rex's labelling rule: first of script, argv0, name. Interpreters get a nice name. */
export function processName(p?: ProcessInfo | null): string {
  if (!p) return ''
  const name = base(p.name || '')
  if (PRETTY[name.replace(/[\d.]+$/, '')]) return PRETTY[name.replace(/[\d.]+$/, '')]
  if (p.script) return base(p.script)
  if (p.argv0) return base(p.argv0.replace(/^-/, ''))
  return name
}

export interface Glyph {
  /** Nerd Font glyph */
  glyph: string
  /** tile tint */
  tint: string
}
const TERMINAL: Glyph = { glyph: '', tint: 'neutral' }
const GLYPHS: [RegExp, Glyph][] = [
  [/^(node|nodejs|npm|pnpm|npx|yarn)$/i, { glyph: '', tint: 'green' }],
  [/^(bun)$/i, { glyph: '', tint: 'amber' }],
  [/^(deno)$/i, { glyph: '', tint: 'neutral' }],
  [/^(python|python3|ipython|uv|pip)/i, { glyph: '', tint: 'blue' }],
  [/^(n?vim|vi|helix|hx)$/i, { glyph: '', tint: 'green' }],
  [/^(git|lazygit|tig)$/i, { glyph: '', tint: 'rose' }],
  [/^(cargo|rustc|rust-analyzer)$/i, { glyph: '', tint: 'amber' }],
  [/^(go|gopls)$/i, { glyph: '', tint: 'blue' }],
  [/^(docker|podman)$/i, { glyph: '', tint: 'blue' }],
  [/^(ssh|mosh|et)$/i, { glyph: '\uf0c1', tint: 'violet' }],
  [/^(top|htop|btop|btm|glances)$/i, { glyph: '', tint: 'violet' }],
  [/^(claude|codex|aider)$/i, { glyph: '\uf0eb', tint: 'amber' }],
  [/^(make|cmake|ninja)$/i, { glyph: '', tint: 'neutral' }],
  [/^(less|man|more|bat)$/i, { glyph: '', tint: 'neutral' }],
]
export function processGlyph(name: string): Glyph {
  for (const [re, g] of GLYPHS) if (re.test(name)) return g
  return TERMINAL
}

const SHELLS = /^(ba|z|fi|da|k|mk|tc|c|xon|elvi|o|yash|nu|pw)?sh$|^(nu|elvish|xonsh|pwsh|ion)$/i

/** Whether a block's process label names an interactive shell. */
export function isShellProcess(name: string) {
  return SHELLS.test(base(name).replace(/^-/, ''))
}

/** Servers reached over a local unix socket run on this machine. */
export function isLocalServer(s?: Pick<ServerInfo, 'kind' | 'address'>) {
  return !!s && s.kind !== 'remote' && s.address.startsWith('unix:')
}

/** Rex default window labels look like "Window 37fd84a3". */
export function isDefaultWindowLabel(label: string) {
  return !label || /^Window [0-9a-f]{8}$/i.test(label)
}

export interface HostInput {
  ok: boolean
  /** Address to hand to addHost (unchanged forms the backend understands). */
  address: string
  /** Suggested label when the user left it blank. */
  label: string
  kind: 'tailscale' | 'url' | 'account' | 'host'
  error?: string
}

/**
 * Validate what a person typed into "Add remote host". Accepts a bare host
 * (including Tailscale MagicDNS names like rex-box.tailnet.ts.net), host:port,
 * account@host, or an http(s) URL. The backend resolves ports/schemes.
 */
export function parseHostInput(raw: string): HostInput {
  const address = raw.trim()
  const fail = (error: string): HostInput => ({
    ok: false,
    address,
    label: '',
    kind: 'host',
    error,
  })
  if (!address) return fail('Enter a host name or address.')
  if (/\s/.test(address)) return fail('Addresses cannot contain spaces.')
  let url: URL
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(address)
  if (hasScheme && !/^https?:\/\//i.test(address))
    return fail('Use an https:// or http:// address, or just the host name.')
  try {
    url = new URL(hasScheme ? address : `https://${address}`)
  } catch {
    return fail('That does not look like a host name or URL.')
  }
  if (url.password)
    return fail('Rex does not use passwords in addresses. Use account@host.')
  const host = url.hostname
  if (!host || !/^[a-z0-9.\-_[\]:]+$/i.test(host))
    return fail('That does not look like a host name or URL.')
  const tailscale = /\.ts\.net$/i.test(host)
  const account = decodeURIComponent(url.username)
  const short = tailscale ? host.split('.')[0] : host
  return {
    ok: true,
    address,
    label: account ? `${account}@${short}` : short,
    kind: hasScheme ? 'url' : account ? 'account' : tailscale ? 'tailscale' : 'host',
  }
}

/** Default label for a new session, e.g. "session-0824". */
export const newSessionLabel = (now = new Date()) =>
  `session-${now.toTimeString().slice(0, 5).replace(':', '')}`
