import type { ExplorationScanRecord } from "../shared/types.js";

/**
 * Stable synthetic ids for journal `Parents` entries `{ Null: n }` (barycentre).
 * Keep well above real `BodyID` values and below 32-bit int for JSON safety.
 */
export const JOURNAL_BARYCENTRE_ID_BASE = 2_010_000_000;

export function barycentreSyntheticBodyId(journalNullId: number): number {
  return JOURNAL_BARYCENTRE_ID_BASE + journalNullId;
}

export function isBarycentreSyntheticBodyId(bodyId: number): boolean {
  return bodyId >= JOURNAL_BARYCENTRE_ID_BASE && bodyId < JOURNAL_BARYCENTRE_ID_BASE + 1_000_000;
}

export type ParsedJournalParent = { kind: "Star" | "Planet" | "Null"; id: number };

/** One entry from `Scan.Parents` — `Star`, `Planet`, or `Null` (barycentre). */
export function parseJournalParentEntry(entry: unknown): ParsedJournalParent | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  if (typeof o.Star === "number" && Number.isFinite(o.Star)) return { kind: "Star", id: o.Star };
  if (typeof o.Planet === "number" && Number.isFinite(o.Planet)) return { kind: "Planet", id: o.Planet };
  if (typeof o.Null === "number" && Number.isFinite(o.Null)) return { kind: "Null", id: o.Null };
  return null;
}

/** Journal `Parents[0]` — scannable star or planet only (barycentre returns `null`). */

export function directParentBodyId(parents: unknown): number | null {
  if (!Array.isArray(parents) || parents.length === 0) return null;
  const p0 = parents[0] as Record<string, unknown>;
  if (typeof p0.Planet === "number") return p0.Planet;
  if (typeof p0.Star === "number") return p0.Star;
  return null;
}

/** Immediate orbit body when this object is a moon of a planet — excludes primary-only orbits of a star. */
export function directParentPlanetId(parents: unknown): number | null {
  if (!Array.isArray(parents) || parents.length === 0) return null;
  const p0 = parents[0] as Record<string, unknown>;
  if (typeof p0.Planet === "number") return p0.Planet;
  return null;
}

export function allStarParentIds(parents: unknown): number[] {
  if (!Array.isArray(parents)) return [];
  const out: number[] = [];
  for (const p of parents) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.Star === "number") out.push(o.Star);
  }
  return out;
}

/**
 * Resolve the host star `BodyID` for exobiology context: walk `Parents[0]` planet-chain until `Star`,
 * else smallest star id listed anywhere in `Parents`.
 */
export function resolveHostStarBodyId(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
): number | null {
  const visitedPlanets = new Set<number>();
  let cur: ExplorationScanRecord | null = rec;
  for (let d = 0; d < 24 && cur; d++) {
    const parents = cur.parents;
    if (!Array.isArray(parents) || parents.length === 0) break;
    const im = parseJournalParentEntry(parents[0]);
    if (!im) break;
    if (im.kind === "Star") return im.id;
    if (im.kind === "Planet") {
      if (visitedPlanets.has(im.id)) break;
      visitedPlanets.add(im.id);
      cur = byBodyId.get(im.id) ?? null;
      continue;
    }
    break;
  }
  const stars = allStarParentIds(rec.parents);
  if (!stars.length) return null;
  return stars.reduce((a, b) => Math.min(a, b));
}
