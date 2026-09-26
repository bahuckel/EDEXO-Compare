/**
 * The order of the body tabs (owner, 2026-09-26, Discord batch O-F): a switch under "BODY".
 *
 * - **System order** — what the strip always did: orbit groups, planet and its moons together. The
 *   default.
 * - **Most profitable** — the ×5-aware headline the sell-range card shows, highest first. Pure value
 *   order: bodies already analysed keep their place (he asked for that, 2026-09-26 — the analysed dot
 *   marks them, and sending them to the end hid the next best body in a long strip).
 * - **Alphabetical** — natural order on the tab label, so `1 a` < `1 b` < `2` < `10`.
 * - **Closest** — from where the ship is (`AppSnapshot.shipProximity`): the arrival star after a
 *   jump, then the body it approached or landed on.
 *
 * A sorted strip is only re-sorted on a jump, a landing, a new body or a change of mode — never on
 * an ordinary snapshot — so tabs do not move under the cursor while values tick. "Most profitable"
 * also re-sorts when a body's figure changes: a DSS map narrows the genera and
 * moves the value, and freezing the order before that left a 95 M body behind a 7 M one.
 */
import { useMemo, useRef } from "react";
import type { BodyComputed, ShipProximityDTO } from "@shared/types";
import { payoutHeadline } from "./ExoPayoutRangePanel";

export type BodySortMode = "system" | "profit" | "alpha" | "closest";

export const BODY_SORT_OPTIONS: { value: BodySortMode; label: string }[] = [
  { value: "system", label: "System order" },
  { value: "profit", label: "Most profitable" },
  { value: "alpha", label: "Alphabetical" },
  { value: "closest", label: "Closest" },
];

const PREF_KEY = "edexo.bodySort";

export function readBodySortPref(): BodySortMode {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return BODY_SORT_OPTIONS.some((o) => o.value === v) ? (v as BodySortMode) : "system";
  } catch {
    return "system";
  }
}

export function writeBodySortPref(mode: BodySortMode): void {
  try {
    localStorage.setItem(PREF_KEY, mode);
  } catch {
    /* the choice lasts until the page reloads */
  }
}

/** The figure "Most profitable" ranks by: the sell-range headline, else the best candidate's list price. */
export function bodyProfitValue(b: BodyComputed): number {
  if (b.exoPayoutRange) return payoutHeadline(b.exoPayoutRange).max;
  return b.matches.reduce((m, x) => (x.unlikely ? m : Math.max(m, x.priceCredits ?? 0)), 0);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The bodies in the chosen order. "system" leaves the input as it is. */
export function sortBodies(
  bodies: BodyComputed[],
  mode: BodySortMode,
  proximity: ShipProximityDTO | null | undefined,
): BodyComputed[] {
  if (mode === "system") return bodies;
  const byName = (a: BodyComputed, b: BodyComputed) => collator.compare(a.tabLabel, b.tabLabel);
  const out = [...bodies];
  if (mode === "alpha") return out.sort(byName);
  if (mode === "profit") {
    return out.sort((a, b) => bodyProfitValue(b) - bodyProfitValue(a) || byName(a, b));
  }
  const dist = proximity?.distanceLsByBodyKey ?? {};
  const d = (b: BodyComputed) => dist[b.state.key] ?? Number.POSITIVE_INFINITY;
  // The body the ship is at comes first (distance 0); unknown distances go last.
  return out.sort((a, b) => d(a) - d(b) || byName(a, b));
}

/**
 * The sorted strip, held still between re-sorts.
 *
 * The order is recomputed only when the mode, the system, the ship's body (for Closest and Most
 * profitable) or the set of bodies changes; in between, the held order is filled with the current
 * body objects so the tabs still show fresh numbers.
 */
export function useSortedBodies(
  bodies: BodyComputed[],
  mode: BodySortMode,
  proximity: ShipProximityDTO | null | undefined,
  systemFocusKey: number | null,
): BodyComputed[] {
  const held = useRef<{ sig: string; keys: string[] } | null>(null);
  const keySet = useMemo(
    () =>
      bodies
        .map((b) => b.state.key)
        .sort()
        .join(","),
    [bodies],
  );
  // What the figures are, for "Most profitable": the order follows them when they move, not only on a jump.
  const valueSig = useMemo(
    () =>
      mode === "profit"
        ? bodies.map((b) => `${b.state.key}=${Math.round(bodyProfitValue(b))}`).join(",")
        : "",
    [bodies, mode],
  );
  const sig = `${mode}|${systemFocusKey ?? "-"}|${mode === "system" ? "" : (proximity?.originBodyKey ?? "")}|${keySet}|${valueSig}`;

  return useMemo(() => {
    if (mode === "system") {
      held.current = null;
      return bodies;
    }
    if (!held.current || held.current.sig !== sig) {
      held.current = { sig, keys: sortBodies(bodies, mode, proximity).map((b) => b.state.key) };
    }
    const byKey = new Map(bodies.map((b) => [b.state.key, b]));
    return held.current.keys.map((k) => byKey.get(k)).filter((b): b is BodyComputed => b !== undefined);
    // `proximity` is read only when the signature moves — that is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, mode, sig]);
}
