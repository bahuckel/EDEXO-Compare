/**
 * The collection marker's thresholds — the shape, shared, because it crosses the wire.
 *
 * The logic and the file handling stay in `server/collectionFocus.ts`; only the contract lives here.
 * It moved out of the server module the moment Options grew a panel for it: a client importing a
 * server file drags `node:fs` into the browser build, and re-declaring the type beside the panel is
 * how two copies of one contract start to disagree.
 */

export interface CollectionFocusConfig {
  formatVersion: 1;
  /** Master switch; the marker disappears entirely when false. */
  enabled: boolean;
  /** Confirmed sightings of your own after which a species stops being asked for. */
  targetScans: number;
  /** Corpus bodies at or above which the envelope is considered well fed. */
  corpusFloor: number;
  /** Species ids you never want marked, whatever the counts say. */
  dismissed: string[];
}

/** Bounds the server clamps to, shared so the panel's inputs cannot offer a rejected value. */
export const COLLECTION_FOCUS_LIMITS = {
  targetScansMin: 1,
  targetScansMax: 20,
  corpusFloorMin: 0,
  corpusFloorMax: 5000,
} as const;

/**
 * Coerce narrowly, then clamp.
 *
 * `Number("")`, `Number(null)` and `Number([])` are all **0**, which is finite and — for the corpus
 * floor — inside the allowed range. A bare `Number(raw)` therefore turns a half-typed box into
 * "never thin" and the marker silently disappears. The poll rates had the same trap; this is the
 * same fix.
 */
function clampNumber(raw: unknown, current: number, min: number, max: number): number {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return current;
  if (!Number.isFinite(n)) return current;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Apply a patch from the Options panel to the stored config.
 *
 * A patch, not a replacement: the panel sends one field at a time, and rebuilding from defaults
 * would reset a threshold the commander had moved earlier in the same sitting. Anything absent or
 * unusable keeps its current value.
 */
export function mergeCollectionFocus(
  current: CollectionFocusConfig,
  patch: Partial<CollectionFocusConfig>,
): CollectionFocusConfig {
  const L = COLLECTION_FOCUS_LIMITS;
  return {
    formatVersion: 1,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    targetScans: clampNumber(patch.targetScans, current.targetScans, L.targetScansMin, L.targetScansMax),
    corpusFloor: clampNumber(patch.corpusFloor, current.corpusFloor, L.corpusFloorMin, L.corpusFloorMax),
    dismissed: Array.isArray(patch.dismissed)
      ? patch.dismissed.filter((x): x is string => typeof x === "string")
      : current.dismissed,
  };
}
