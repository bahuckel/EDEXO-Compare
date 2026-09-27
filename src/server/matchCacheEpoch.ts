/**
 * Moves whenever cached matcher output stops being valid for reasons outside a body's own data: the
 * species database was reloaded, or the rarity counts moved (snapshot.ts clears its per-body compute
 * cache at the same moments). Memos elsewhere — the system map's — put it in their key.
 */
let epoch = 0;

export function bumpMatchCacheEpoch(): void {
  epoch += 1;
}

export function matchCacheEpoch(): number {
  return epoch;
}
