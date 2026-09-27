/**
 * Structural reuse for incoming snapshots.
 *
 * The server sends a complete `AppSnapshot` on every push, so `JSON.parse` hands the client a
 * brand-new object graph even when nothing changed. Every `useMemo([snapshot.systemMap])` therefore
 * busts, every `React.memo` misses, and the whole tree reconciles — ten times a second during an
 * FSS sweep.
 *
 * `reuseUnchanged` walks the new value against the previous one and returns the *previous* node
 * wherever the two are deeply equal, so unchanged branches keep their identity all the way down:
 * one changed body no longer invalidates the other nineteen, the system map, or the header.
 *
 * Cost is a single traversal of the parsed snapshot — cheaper than the reconciliation it prevents,
 * and it allocates nothing for branches that are unchanged.
 */
export function reuseUnchanged<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (prev === null || next === null) return next;
  if (typeof prev !== "object" || typeof next !== "object") return next;

  const prevIsArray = Array.isArray(prev);
  if (prevIsArray !== Array.isArray(next)) return next;

  if (prevIsArray) {
    const p = prev as unknown as unknown[];
    const n = next as unknown as unknown[];
    if (p.length !== n.length) {
      // Length changed, so the array itself must be new — but keep element identity where the
      // element at that index is unchanged (appending one body should not re-render the rest).
      const grown = n.map((v, i) => (i < p.length ? reuseUnchanged(p[i], v) : v));
      return grown as unknown as T;
    }
    // Nothing is allocated until the first element that differs (the comment above promised as much).
    let merged: unknown[] | null = null;
    for (let i = 0; i < n.length; i++) {
      const m = reuseUnchanged(p[i], n[i]);
      if (merged) merged[i] = m;
      else if (!Object.is(m, p[i])) {
        merged = p.slice(0, i);
        merged[i] = m;
      }
    }
    return (merged ?? prev) as T;
  }

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const prevKeys = Object.keys(p);
  const nextKeys = Object.keys(n);

  // A key added or dropped means a new object; otherwise one is built only at the first difference.
  let merged: Record<string, unknown> | null = null;
  if (prevKeys.length !== nextKeys.length) merged = {};
  for (let i = 0; i < nextKeys.length; i++) {
    const k = nextKeys[i]!;
    const m = reuseUnchanged(p[k], n[k]);
    if (merged) merged[k] = m;
    else if (!(k in p) || !Object.is(m, p[k])) {
      merged = {};
      for (let j = 0; j < i; j++) merged[nextKeys[j]!] = p[nextKeys[j]!];
      merged[k] = m;
    }
  }
  return (merged ?? prev) as T;
}
