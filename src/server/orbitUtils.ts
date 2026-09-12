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

/**
 * Every host-star `BodyID` for a body, walking the same `Parents[0]` chain as
 * {@link resolveHostStarBodyId} but keeping **all** the stars it names rather than the first.
 *
 * A body orbiting a star *pair* lists only `{Null: n}` and has no star in its chain at all. Picking
 * one of the pair invents an answer, and the invented answer has already cost us: the shipped
 * Electricae pluma profile carries an `M3` host taken from a body orbiting an M + L barycentre in a
 * system whose primary is a neutron star, and that one row licensed pluma on every M-class body in
 * the game. `ABSTRACT-COND.md` §6.3 reaches the same rule from the ingest side after 35 Anemone
 * bodies were missed the same way: when the chain names no star, fall back to every star in the
 * system.
 *
 * Returns an empty array when the system holds no scanned star, which callers must read as "we do
 * not know" rather than as a failed condition.
 */
export function hostStarBodyIdsForExobiology(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
): number[] {
  const found = new Set<number>();
  const visitedPlanets = new Set<number>();
  let cur: ExplorationScanRecord | null = rec;
  for (let d = 0; d < 24 && cur; d++) {
    for (const id of allStarParentIds(cur.parents)) found.add(id);
    if (found.size > 0) break;
    const parents = cur.parents;
    if (!Array.isArray(parents) || parents.length === 0) break;
    const im = parseJournalParentEntry(parents[0]);
    if (!im || im.kind !== "Planet") break;
    if (visitedPlanets.has(im.id)) break;
    visitedPlanets.add(im.id);
    cur = byBodyId.get(im.id) ?? null;
  }
  if (found.size > 0) return [...found];

  /*
    No star in the chain, so read the body's own designation.

    `... ABC 2 a` orbits the A+B+C barycentre and `... AB 1` orbits A and B, with C no part of it
    however close it sits. Both name `{Null: n}` and no star at all, so the designation is the only
    thing that tells them apart — and a system can carry ten stars, which makes "every star in the
    system" a wild over-reach rather than a cautious one.
  */
  const wanted = new Set(starLettersFromDesignation(rec));
  if (wanted.size > 0) {
    const named: number[] = [];
    for (const [bodyId, r] of byBodyId) {
      if (!r.starType?.trim()) continue;
      const letters = starLettersFromDesignation(r);
      // A star is a single letter; anything longer is a barycentre label, not a host.
      if (letters.length === 1 && wanted.has(letters[0]!)) named.push(bodyId);
    }
    if (named.length > 0) return named;
  }

  // Nothing to go on: every star in the system is a candidate host.
  const all: number[] = [];
  for (const [bodyId, r] of byBodyId) {
    if (r.starType?.trim()) all.push(bodyId);
  }
  return all;
}

/**
 * The star letters a body's designation names, e.g. `BCD 3` -> B, C, D.
 *
 * The system name is stripped first, because a system can itself end in letters. Bodies with no
 * letter group — `Sol 4` — return nothing, and the caller falls back.
 */
export function starLettersFromDesignation(rec: {
  bodyName?: string | null;
  starSystem?: string | null;
}): string[] {
  const system = (rec.starSystem ?? "").trim();
  let name = (rec.bodyName ?? "").trim();
  if (system && name.toLowerCase().startsWith(system.toLowerCase())) {
    name = name.slice(system.length).trim();
  }
  const first = name.split(/\s+/)[0] ?? "";
  return /^[A-Z]+$/.test(first) ? [...first] : [];
}
