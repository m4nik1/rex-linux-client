/** Small subsequence fuzzy scorer: higher is better, null when no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    const boundary = found === 0 || /[\s\-_/.:]/.test(t[found - 1])
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (boundary ? 3 : 0) - Math.min(3, found - ti) * 0.2
    ti = found + 1
  }
  if (t.startsWith(q)) score += 6
  return score - t.length * 0.01
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  text: (item: T) => string,
): T[] {
  if (!query.trim()) return items
  return items
    .map((item) => ({ item, s: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item)
}

/** Indices of matched characters for highlighting. */
export function fuzzyIndices(query: string, text: string): number[] {
  const t = text.toLowerCase()
  const out: number[] = []
  let ti = 0
  for (const ch of query.trim().toLowerCase()) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return []
    out.push(found)
    ti = found + 1
  }
  return out
}
