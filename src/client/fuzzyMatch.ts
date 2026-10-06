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
  /*
    Scattered: the query read as word beginnings, in order — `bacacies` is "bac…" + "acies", `c1b`
    is "c" + "1" + "b". Letters picked from anywhere matched far too much (owner, 2026-10-06:
    "Tecton" found Blatteum Bioluminescent Anemone, t-e-c-t-o-n scattered across its three words).
  */
  const needle = q.replace(/\s+/g, "");
  const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
  const skipped = wordPrefixes(needle, words, 0);
  return skipped == null ? null : 1000 + skipped;
}

/** Words skipped while `needle` is taken as prefixes of `words[from…]` in order; null when it cannot be. */
function wordPrefixes(needle: string, words: readonly string[], from: number): number | null {
  if (!needle) return 0;
  for (let w = from; w < words.length; w++) {
    const word = words[w]!;
    let k = 0;
    while (k < word.length && k < needle.length && word[k] === needle[k]) k++;
    // Longest prefix first: "bacacies" takes "bac" from bacterium, then "acies".
    for (; k > 0; k--) {
      const rest = wordPrefixes(needle.slice(k), words, w + 1);
      if (rest != null) return rest + (w - from);
    }
  }
  return null;
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
