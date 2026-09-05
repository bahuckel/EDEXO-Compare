import type { BodyComputed } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Keeps body tab strip order stable across journal updates (e.g. auto-select when landing on another
 * planet). Order only resets when the focused system changes. New bodies append by journal bodyId.
 *
 * The state it holds is a *derived* list of keys, which is why {@link sameOrder} exists. An updater
 * that builds its answer with `map` and spread returns a new array every single time, and a new
 * array is never `Object.is`-equal to the old one, so React re-renders — and if `bodies` is also a
 * fresh reference that render, the effect runs again and the two chase each other until React gives
 * up at its update-depth cap. That is exactly what the app did on every cold load (§49): before the
 * first snapshot arrives the caller passes `snapshot?.bodies ?? []`, a brand-new empty array per
 * render, and this hook answered each one with a brand-new empty array of its own.
 *
 * So the rule here is the one every derived-state effect needs: **compute the next value, and hand
 * back the previous one unless it actually changed.**
 */
/** Element-wise, because the whole point is that the two arrays are never the same object. */
export function sameOrder(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The order this render wants: reset on a system change, otherwise keep what is still present. */
export function nextOrder(prev: string[], bodies: BodyComputed[], sysChanged: boolean): string[] {
  if (bodies.length === 0) return [];
  if (sysChanged || prev.length === 0) return bodies.map((b) => b.state.key);

  const keys = new Set(bodies.map((b) => b.state.key));
  const kept = prev.filter((k) => keys.has(k));
  const keptSet = new Set(kept);
  const missing = bodies
    .filter((b) => !keptSet.has(b.state.key))
    .sort((a, b) => a.state.bodyId - b.state.bodyId);
  return [...kept, ...missing.map((b) => b.state.key)];
}

export function useStableBioTabOrder(bodies: BodyComputed[], systemFocusKey: number | null): BodyComputed[] {
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const prevSysRef = useRef<number | null>(null);

  useEffect(() => {
    const sysChanged = systemFocusKey !== prevSysRef.current;
    if (sysChanged) prevSysRef.current = systemFocusKey;

    setTabOrder((prev) => {
      const next = nextOrder(prev, bodies, sysChanged);
      return sameOrder(prev, next) ? prev : next;
    });
  }, [bodies, systemFocusKey]);

  return useMemo(() => {
    if (bodies.length === 0) return bodies;
    if (tabOrder.length === 0) return bodies;
    const byKey = new Map(bodies.map((b) => [b.state.key, b]));
    const out: BodyComputed[] = [];
    for (const k of tabOrder) {
      const b = byKey.get(k);
      if (b) out.push(b);
    }
    if (out.length < bodies.length) {
      const have = new Set(out.map((x) => x.state.key));
      for (const b of bodies) {
        if (!have.has(b.state.key)) out.push(b);
      }
    }
    return out;
  }, [bodies, tabOrder]);
}
