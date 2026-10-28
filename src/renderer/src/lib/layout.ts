import type { Layout, RexWindow } from '../../../shared/ipc'

export type Rect = [number, number, number, number]
export interface PaneRect {
  block_id: string
  rect: Rect
}
export interface Divider {
  /** Stable key for keyed rendering. */
  key: string
  direction: 'horizontal' | 'vertical'
  /** The split's own rectangle (window-relative fractions). */
  rect: Rect
  ratio: number
  /** Representative blocks either side of the border, nearest to it. */
  beforeBlockId: string
  afterBlockId: string
}

export function leaves(node?: Layout | null): Layout[] {
  if (!node) return []
  if (node.block_id) return [node]
  if (node.split)
    return [...leaves(node.split.before), ...leaves(node.split.after)]
  return []
}

/** Visible panes of a window, honouring zoom. */
export function windowPanes(w?: RexWindow): PaneRect[] {
  if (!w) return []
  const all = (w.layers ?? []).flatMap((l) => leaves(l.layout))
  if (w.zoomed_block_id) {
    const node = all.find((n) => n.block_id === w.zoomed_block_id)
    return node ? [{ block_id: node.block_id!, rect: [0, 0, 1, 1] }] : []
  }
  return all.map((n) => ({ block_id: n.block_id!, rect: n.rect as Rect }))
}

/** Every split border in a window (none while zoomed). */
export function windowDividers(w?: RexWindow): Divider[] {
  if (!w || w.zoomed_block_id) return []
  const out: Divider[] = []
  const walk = (node: Layout | undefined | null) => {
    const s = node?.split
    if (!node || !s) return
    const before = leaves(s.before)
    const after = leaves(s.after)
    if (before.length && after.length)
      out.push({
        key: s.split_id ?? `${before.at(-1)!.block_id}|${after[0].block_id}`,
        direction: s.direction === 'vertical' ? 'vertical' : 'horizontal',
        rect: node.rect as Rect,
        ratio: s.ratio,
        beforeBlockId: before.at(-1)!.block_id!,
        afterBlockId: after[0].block_id!,
      })
    walk(s.before)
    walk(s.after)
  }
  for (const layer of w.layers ?? []) walk(layer.layout)
  return out
}

/** Clamp a proposed ratio so neither side collapses below `min` of the split. */
export function clampRatio(ratio: number, min = 0.08) {
  return Math.min(1 - min, Math.max(min, ratio))
}

/** Ratio for a pointer position (fractions of the window) over a divider. */
export function ratioAt(d: Divider, x: number, y: number) {
  const [rx, ry, rw, rh] = d.rect
  const r = d.direction === 'horizontal' ? (x - rx) / rw : (y - ry) / rh
  return clampRatio(r)
}
