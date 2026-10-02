import { memo, type ComponentType } from "react";
import type { AppSnapshot } from "@shared/types";

/**
 * A component that reads a few fields of the snapshot, re-rendered only when one of those changes
 * (plan 2.2, Fable C5).
 *
 * The header hands the whole snapshot to its children, and the snapshot is a new object on every
 * push — ten a second in flight, for a fuel figure. `useLiveSnapshot` keeps the identity of every
 * field that did not change (`reuseUnchanged`), so a child can skip a push by comparing just its
 * fields. The keys are the type: the component takes `Pick<AppSnapshot, K>`, so reading a field it
 * did not list — itself or in a helper it passes the slice to — does not compile, rather than
 * quietly showing a stale value.
 */
export type SnapSlice<K extends keyof AppSnapshot> = Pick<AppSnapshot, K>;

export function memoOnSnapSlice<K extends keyof AppSnapshot, P extends { snap: SnapSlice<K> }>(
  keys: readonly K[],
  Component: ComponentType<P>,
) {
  return memo(Component, (prev, next) => {
    const a = prev as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    for (const k of Object.keys(b)) if (k !== "snap" && !Object.is(a[k], b[k])) return false;
    for (const k of Object.keys(a)) if (!(k in b)) return false;
    for (const k of keys) if (!Object.is(prev.snap[k], next.snap[k])) return false;
    return true;
  });
}
