import type { BodyComputed } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Keeps body tab strip order stable across journal updates (e.g. auto-select when landing on another planet).
 * Order only resets when the focused system changes. New bodies append by journal bodyId.
 */
export function useStableBioTabOrder(bodies: BodyComputed[], systemFocusKey: number | null): BodyComputed[] {
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const prevSysRef = useRef<number | null>(null);

  useEffect(() => {
    const sysChanged = systemFocusKey !== prevSysRef.current;
    if (sysChanged) prevSysRef.current = systemFocusKey;

    setTabOrder((prev) => {
      if (bodies.length === 0) return [];
      const keys = new Set(bodies.map((b) => b.state.key));
      if (sysChanged || prev.length === 0) {
        return bodies.map((b) => b.state.key);
      }
      const kept = prev.filter((k) => keys.has(k));
      const missing = bodies
        .filter((b) => !kept.includes(b.state.key))
        .sort((a, b) => a.state.bodyId - b.state.bodyId);
      return [...kept, ...missing.map((b) => b.state.key)];
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
