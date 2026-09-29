/**
 * Which labels fit on screen: greedy, most important first, never overlapping. Pure so it can be
 * tested without a canvas; the map calls it every rendered frame with a few dozen candidates.
 */
export interface LabelCandidate {
  id: string;
  /** Screen position of the anchor, px. */
  x: number;
  y: number;
  /** Rough text box, px. */
  w: number;
  h: number;
  /** Higher places first. */
  priority: number;
}

export interface PlacedLabel {
  id: string;
  left: number;
  top: number;
}

export function placeLabels(
  candidates: readonly LabelCandidate[],
  viewport: { width: number; height: number },
  gap = 4,
): PlacedLabel[] {
  const taken: { l: number; t: number; r: number; b: number }[] = [];
  const placed: PlacedLabel[] = [];
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of sorted) {
    const l = c.x - c.w / 2;
    const t = c.y - c.h / 2;
    const r = l + c.w;
    const b = t + c.h;
    if (r < 0 || b < 0 || l > viewport.width || t > viewport.height) continue;
    const clash = taken.some((o) => l < o.r + gap && r > o.l - gap && t < o.b + gap && b > o.t - gap);
    if (clash) continue;
    taken.push({ l, t, r, b });
    placed.push({ id: c.id, left: l, top: t });
  }
  return placed;
}
