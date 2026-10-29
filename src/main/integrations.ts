import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { AgentInfo, TailscalePeer, TailscaleStatus } from '../shared/ipc'

export interface RunResult {
  stdout: string
  stderr: string
  /** Exit status; null when the process could not run or was killed. */
  code: number | null
  /** Spawn errno such as 'ENOENT' when the binary could not be started. */
  errno?: string
  /** True when the process was killed for exceeding its timeout. */
  timedOut: boolean
}

function run(cmd: string, args: string[], timeout: number) {
  return new Promise<RunResult>((resolve) => {
    execFile(
      cmd,
      args,
      { timeout, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => {
        const e = err as
          | (Error & { code?: unknown; killed?: boolean; signal?: unknown })
          | null
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: !e ? 0 : typeof e.code === 'number' ? e.code : null,
          errno: typeof e?.code === 'string' ? e.code : undefined,
          timedOut: !!e?.killed && !!e.signal,
        })
      },
    )
  })
}

const AGENTS: { id: string; name: string; command: string }[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude' },
  { id: 'codex', name: 'OpenAI Codex', command: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode' },
  { id: 'amp', name: 'Amp', command: 'amp' },
  { id: 'cursor-agent', name: 'Cursor Agent', command: 'cursor-agent' },
  { id: 'aider', name: 'Aider', command: 'aider' },
  { id: 'goose', name: 'Goose', command: 'goose' },
  { id: 'crush', name: 'Crush', command: 'crush' },
  { id: 'qwen', name: 'Qwen Code', command: 'qwen' },
]

function searchDirs() {
  const home = homedir()
  return [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    join(home, '.npm-global/bin'),
    join(home, '.bun/bin'),
    join(home, '.cargo/bin'),
    join(home, 'go/bin'),
  ]
}

async function which(command: string, dirs: string[]) {
  for (const dir of dirs) {
    const file = join(dir, command)
    try {
      await access(file, constants.X_OK)
      return file
    } catch {
      /* keep looking */
    }
  }
  return undefined
}

export async function detectAgents(): Promise<AgentInfo[]> {
  const dirs = [...new Set(searchDirs())]
  return Promise.all(
    AGENTS.map(async (a): Promise<AgentInfo> => {
      const path = await which(a.command, dirs)
      if (!path) return { ...a, installed: false }
      const { stdout, stderr } = await run(path, ['--version'], 3000)
      const version =
        (stdout || stderr).split('\n')[0]?.trim().slice(0, 80) || undefined
      return { ...a, installed: true, path, version }
    }),
  )
}

const stripDot = (s?: string) => (s ?? '').replace(/\.$/, '')

export function parseTailscale(json: string): TailscaleStatus {
  const s = JSON.parse(json) as {
    BackendState?: string
    AuthURL?: string
    MagicDNSSuffix?: string
    CurrentTailnet?: { Name?: string }
    Self?: { HostName?: string; DNSName?: string; TailscaleIPs?: string[] }
    Peer?: Record<
      string,
      {
        HostName?: string
        DNSName?: string
        Online?: boolean
        OS?: string
        TailscaleIPs?: string[]
      }
    >
  }
  const peers: TailscalePeer[] = Object.values(s.Peer ?? {})
    .map((p) => ({
      name: p.HostName ?? '',
      dns: stripDot(p.DNSName),
      ip: p.TailscaleIPs?.[0] ?? '',
      online: !!p.Online,
      os: p.OS ?? '',
    }))
    .filter((p) => p.name)
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    )
  return {
    installed: true,
    state: s.BackendState ?? 'Unknown',
    authUrl: s.AuthURL || undefined,
    tailnet: s.CurrentTailnet?.Name ?? s.MagicDNSSuffix,
    self: s.Self
      ? {
          name: s.Self.HostName ?? '',
          dns: stripDot(s.Self.DNSName),
          ip: s.Self.TailscaleIPs?.[0] ?? '',
        }
      : undefined,
    peers,
  }
}

/** Interpret `tailscale status --json`; pure so it can be unit tested. */
export function tailscaleStatusFrom(r: RunResult): TailscaleStatus {
  if (r.errno === 'ENOENT')
    return { installed: false, state: 'NotInstalled', peers: [] }
  if (r.timedOut)
    return {
      installed: true,
      state: 'Error',
      error: 'tailscale timed out',
      peers: [],
    }
  // Exit code is non-zero when stopped, but the JSON is still valid.
  if (r.stdout.trim().startsWith('{')) {
    try {
      return parseTailscale(r.stdout)
    } catch {
      /* fall through */
    }
  }
  return {
    installed: true,
    state: 'Error',
    error:
      r.stderr.trim().split('\n')[0] ||
      (r.errno ? `tailscale failed (${r.errno})` : undefined),
    peers: [],
  }
}

export const OPERATOR_HINT = 'Run: sudo tailscale set --operator=$USER'

/** Error to show for a failed `tailscale up`/`down`, if any. */
export function tailscaleSetError(r: RunResult): string | undefined {
  if (r.code === 0) return undefined
  if (r.errno === 'ENOENT') return 'The tailscale CLI wasn’t found.'
  if (r.timedOut) return 'tailscale timed out'
  const text = r.stderr + r.stdout
  if (/access denied|operator|permission denied/i.test(text))
    return OPERATOR_HINT
  return r.stderr.trim().split('\n').pop() || undefined
}

export async function tailscaleStatus(): Promise<TailscaleStatus> {
  return tailscaleStatusFrom(
    await run('tailscale', ['status', '--json'], 5000),
  )
}

/** Bring Tailscale up or down; returns a login URL when interactive auth is needed. */
export async function tailscaleSet(on: boolean): Promise<TailscaleStatus> {
  let authUrl: string | undefined
  let error: string | undefined
  if (on) {
    const r = await run('tailscale', ['up', '--timeout=8s'], 12000)
    authUrl = /https:\/\/login\.tailscale\.com\/\S+/.exec(
      r.stdout + r.stderr,
    )?.[0]
    if (!authUrl) error = tailscaleSetError(r)
  } else {
    error = tailscaleSetError(await run('tailscale', ['down'], 8000))
  }
  const status = await tailscaleStatus()
  return {
    ...status,
    authUrl: authUrl ?? status.authUrl,
    error: error ?? status.error,
  }
}
