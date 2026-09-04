/**
 * Subsequence matching with a rank, shared by the Ctrl+K body palette and the encyclopedia search.
 *
 * A plain `includes()` is unforgiving for the names in this app: "bacterium acies" and
 * "Sinuous Tubers" are long, and body labels like "C 1 b" carry spaces the user does not type.
 * Subsequence matching lets `bacacies` find "Bacterium Acies" and `c1b` find "C 1 b", while a
 * contiguous hit still outranks a scattered one so exact typing behaves the way people expect.
 */

/** Lower rank is a better match. `null` means the query does not fit at all. */
export function fuzzyRank(haystack: string, query: string): number | null {
  if (!query) return 0;
  const hay = haystack.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const direct = hay.indexOf(q);
  if (direct >= 0) return direct; // contiguous match always beats a scattered one
  const needle = q.replace(/\s+/g, "");
  let at = 0;
  let spread = 0;
  let last = -1;
  for (const ch of needle) {
    const found = hay.indexOf(ch, at);
    if (found < 0) return null;
    if (last >= 0) spread += found - last - 1;
    last = found;
    at = found + 1;
  }
  return 1000 + spread;
}

/**
 * Best (lowest) rank across several fields, so a genus hit still surfaces a species whose own
 * name does not contain the query.
 */
export function fuzzyRankAny(fields: readonly (string | null | undefined)[], query: string): number | null {
  if (!query.trim()) return 0;
  let best: number | null = null;
  for (const f of fields) {
    if (!f) continue;
    const r = fuzzyRank(f, query);
    if (r != null && (best == null || r < best)) best = r;
  }
  return best;
}
