/**
 * The system's orbit tree, from journal Parents chains and, where they are missing, the body designations. Split out of systemMap.ts (code review D, 2026-09-27).
 */
import {
  compareParsedDesignations,
  parseDesignationTailFromFullBodyName,
  parseShortDesignation,
  type ParsedDesignation,
} from "../shared/eliteDesignation.js";
import { explorationRecordHasPlanetSlotDesignation } from "../shared/planetSlotDesignation.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import type { ExplorationScanRecord, SystemMapNodeDTO } from "../shared/types.js";
import { explorationRecordIsBeltClusterLike, explorationRecordIsStellar } from "./explorationStellar.js";
import {
  ParsedJournalParent,
  allStarParentIds,
  barycentreSyntheticBodyId,
  directParentPlanetId,
  parseJournalParentEntry,
} from "./orbitUtils.js";

export const isBeltClusterRecord = explorationRecordIsBeltClusterLike;

/** Bodies that act as sun nodes / primary column in the map: stellar but not planet-designation slots. */
export function isStarOnSystemMap(r: ExplorationScanRecord, starSystemName: string): boolean {
  return explorationRecordIsStellar(r) && !explorationRecordHasPlanetSlotDesignation(r, starSystemName);
}

/**
 * Order siblings like the in-game system map: by designation (major index, then moon a…z), not raw
 * `semiMajorAxis` (journal vs synthetic scales differ, so “planet 7 discovered first” wrongly sat beside the star).
 */
/*
  Each record's short label and parsed designation, kept across sorts: the comparator used to parse
  both sides on every comparison of every snapshot (~0.7 ms a refresh, profiled 2026-10-01). Records
  are replaced, not mutated, when a scan changes; the entry also checks the system and body name, and
  is held weakly.
*/
const designationMemo = new WeakMap<
  ExplorationScanRecord,
  { system: string; name: string; short: string; parsed: ParsedDesignation | null; fallback: ParsedDesignation | null }
>();
function designationOf(r: ExplorationScanRecord, starSystemName: string) {
  const hit = designationMemo.get(r);
  if (hit && hit.system === starSystemName && hit.name === r.bodyName) return hit;
  const short = shortBodyLabel(r.bodyName, starSystemName);
  const parsed = parseShortDesignation(short);
  const v = { system: starSystemName, name: r.bodyName, short, parsed, fallback: parsed ?? parseDesignationTailFromFullBodyName(r.bodyName) };
  designationMemo.set(r, v);
  return v;
}

function compareExplorationScanSiblingOrder(
  a: ExplorationScanRecord,
  b: ExplorationScanRecord,
  starSystemName: string,
): number {
  const da = designationOf(a, starSystemName);
  const db = designationOf(b, starSystemName);
  const pa = da.fallback;
  const pb = db.fallback;
  if (!pa && !pb) {
    const semiA = a.semiMajorAxis;
    const semiB = b.semiMajorAxis;
    const finiteA = typeof semiA === "number" && Number.isFinite(semiA);
    const finiteB = typeof semiB === "number" && Number.isFinite(semiB);
    if (finiteA && finiteB && semiA !== semiB) return semiA - semiB;
    return a.bodyId - b.bodyId;
  }
  return compareParsedDesignations(da.parsed, db.parsed, a.bodyId, b.bodyId);
}

const isStarRecord = explorationRecordIsStellar;

/**
 * Journal `BodyName` is `"<StarSystem> <designation>"`. Using `recs[0]` is unsafe: `explorationScans`
 * iteration order is arbitrary, so the first row can be a world with an empty/wrong `StarSystem` while
 * the primary star row has the real name — then prefixes never strip ("System_Name A 1" stays unparsed)
 * and orbit inference can leave worlds disconnected from the star.
 */
export function canonicalStarSystemNameForMap(recs: ExplorationScanRecord[]): string {
  const stellar = recs
    .filter((r) => isStarRecord(r) && !r.isBarycentreJournal)
    .sort((a, b) => a.bodyId - b.bodyId);
  for (const s of stellar) {
    const n = s.starSystem?.trim();
    if (n) return n;
  }
  for (const r of recs) {
    const n = r.starSystem?.trim();
    if (n) return n;
  }
  return "";
}

function resolveJournalOrbitLinkTarget(
  parsed: ParsedJournalParent,
  byId: Map<number, ExplorationScanRecord>,
  solePrimaryStar: ExplorationScanRecord | null,
): number | null {
  if (parsed.kind === "Null") return barycentreSyntheticBodyId(parsed.id);
  if (byId.has(parsed.id)) return parsed.id;
  if (parsed.kind === "Star" && solePrimaryStar) return solePrimaryStar.bodyId;
  if (parsed.kind === "Planet" && solePrimaryStar) return solePrimaryStar.bodyId;
  return null;
}

/** Does following parents up from `from` arrive at `target` (or is it `target`)? */
function orbitReaches(orbitChild: Map<number, number>, from: number, target: number): boolean {
  const seen = new Set<number>();
  for (let id: number | undefined = from; id !== undefined && !seen.has(id); id = orbitChild.get(id)) {
    if (id === target) return true;
    seen.add(id);
  }
  return false;
}

/**
 * Build `child → parent` edges from journal `Scan.Parents` (Stellar Forge: index 0 is immediate parent;
 * each subsequent entry is further out). `{ Null: n }` → synthetic barycentre node id.
 */
export function buildOrbitChildMapFromJournalChains(
  recs: ExplorationScanRecord[],
  byId: Map<number, ExplorationScanRecord>,
  starSystemName: string,
): Map<number, number> {
  const stars = recs.filter((r) => isStarOnSystemMap(r, starSystemName)).sort((a, b) => a.bodyId - b.bodyId);
  const solePrimary = stars.length === 1 ? stars[0]! : null;
  const orbitChild = new Map<number, number>();

  for (const r of recs) {
    const parents = r.parents;
    if (!Array.isArray(parents) || parents.length === 0) continue;
    let currentChild = r.bodyId;
    for (let i = 0; i < parents.length; i++) {
      const entry = parents[i];
      const parsed = parseJournalParentEntry(entry);
      if (parsed == null) break;
      /*
        A planet we hold no record of (a partial EDSM / Spansh system, a gas giant never scanned) is
        stepped over: the body hangs on the next ancestor we do have. It used to stand in as the sole
        star, and the chain then carried on *from the star* — HIP 87621 6 b ({Planet 39}, {Null 38},
        {Null 32}, {Star 0}) made the star orbit barycentre 38, closed a loop 0 → 38 → 32 → 0, and the
        map came out empty (e2e variety run, 2026-09-28).
      */
      if (parsed.kind === "Planet" && !byId.has(parsed.id)) continue;
      // The same for a star we never scanned, unless it is the last link: a companion star in the
      // middle (HIP 37068 7 d: {Null 50}, {Star 45}, {Null 44}, {Star 0}) stood in for the primary and
      // put the primary inside its own barycentre.
      if (parsed.kind === "Star" && !byId.has(parsed.id) && i < parents.length - 1) continue;
      const parentId = resolveJournalOrbitLinkTarget(parsed, byId, solePrimary);
      if (parentId == null) break;
      // Never close a loop: one bad chain must not take every root, and with it the whole map.
      if (orbitReaches(orbitChild, parentId, currentChild)) break;
      orbitChild.set(currentChild, parentId);
      currentChild = parentId;
    }
  }

  for (const r of recs) {
    if (orbitChild.has(r.bodyId)) continue;
    if (isStarOnSystemMap(r, starSystemName)) continue;
    if (solePrimary && !isBeltClusterRecord(r) && !orbitReaches(orbitChild, solePrimary.bodyId, r.bodyId))
      orbitChild.set(r.bodyId, solePrimary.bodyId);
  }

  const sys = starSystemName.trim();
  if (sys && stars.length > 0) {
    for (const r of recs) {
      if (orbitChild.has(r.bodyId)) continue;
      if (isStarOnSystemMap(r, starSystemName) || isBeltClusterRecord(r) || r.isBarycentreJournal) continue;
      const short = shortBodyLabel(r.bodyName, sys);
      const p = parseShortDesignation(short) ?? parseDesignationTailFromFullBodyName(r.bodyName);
      if (!p || p.moon) continue;
      let targetId: number | null = null;
      if (p.starLetters === "") {
        if (stars.length === 1) targetId = stars[0]!.bodyId;
      } else {
        const letter = p.starLetters[0]!;
        if (letter >= "A" && letter <= "Z") {
          const idx = letter.charCodeAt(0) - 65;
          if (idx >= 0 && idx < stars.length) targetId = stars[idx]!.bodyId;
        }
      }
      if (targetId != null && !orbitReaches(orbitChild, targetId, r.bodyId)) orbitChild.set(r.bodyId, targetId);
    }
  }

  return orbitChild;
}

export function parentToChildrenFromOrbitChild(orbitChild: Map<number, number>): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const [child, parent] of orbitChild) {
    let list = m.get(parent);
    if (!list) {
      list = [];
      m.set(parent, list);
    }
    list.push(child);
  }
  return m;
}

export function allIdsInOrbitGraph(recs: ExplorationScanRecord[], orbitChild: Map<number, number>): Set<number> {
  const s = new Set<number>();
  for (const r of recs) s.add(r.bodyId);
  for (const [c, p] of orbitChild) {
    s.add(c);
    s.add(p);
  }
  return s;
}

export function rootBodyIdsFromOrbitGraph(allIds: Set<number>, orbitChild: Map<number, number>): number[] {
  return [...allIds].filter((id) => !orbitChild.has(id)).sort((a, b) => a - b);
}

export function sortChildIdsForSystemMap(
  ids: number[],
  byId: Map<number, ExplorationScanRecord>,
  starSystemName: string,
): number[] {
  return [...ids].sort((a, b) => {
    const ra = byId.get(a);
    const rb = byId.get(b);
    if (ra && rb) return compareExplorationScanSiblingOrder(ra, rb, starSystemName);
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    return a - b;
  });
}

/** Match `inferredSystemMapPlaceholders.designationKey` planet slot: `starLetters|major|` (no moon). */
function orbitPlanetSlotKey(starLetters: string, major: number): string {
  return `${starLetters}|${major}|`;
}

/**
 * Map "A|4|" → bodyId for the **planet** row (no moon letter in the designation).
 * Prefer journal (non-synthetic) over placeholders when both share the same slot.
 */
function buildPlanetSlotToBodyId(
  recs: ExplorationScanRecord[],
  starSystemName: string,
  byId: Map<number, ExplorationScanRecord>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of recs) {
    if (isStarOnSystemMap(r, starSystemName) || isBeltClusterRecord(r)) continue;
    const short = shortBodyLabel(r.bodyName, starSystemName);
    const p = parseShortDesignation(short) ?? parseDesignationTailFromFullBodyName(r.bodyName);
    if (!p || p.moon) continue;
    const key = orbitPlanetSlotKey(p.starLetters, p.major);
    const prev = m.get(key);
    if (prev == null) {
      m.set(key, r.bodyId);
      continue;
    }
    const prevRec = byId.get(prev);
    if (!prevRec) {
      m.set(key, r.bodyId);
      continue;
    }
    if (!r.isSynthetic && prevRec.isSynthetic) m.set(key, r.bodyId);
  }
  return m;
}

/**
 * Moons whose journal `Parents` are missing or not merged yet were parented to the star and drawn as planets.
 * Re-parent from parsed names (`A 4 b` → planet slot `A|4|`) when a planet row exists for that slot.
 */
export function attachMoonsByParsedDesignation(
  recs: ExplorationScanRecord[],
  orbitChild: Map<number, number>,
  starSystemName: string,
  byId: Map<number, ExplorationScanRecord>,
): void {
  const slotToPlanet = buildPlanetSlotToBodyId(recs, starSystemName, byId);
  for (const r of recs) {
    if (isStarOnSystemMap(r, starSystemName) || isBeltClusterRecord(r)) continue;
    const short = shortBodyLabel(r.bodyName, starSystemName);
    const p = parseShortDesignation(short) ?? parseDesignationTailFromFullBodyName(r.bodyName);
    if (!p?.moon) continue;
    const planetId = slotToPlanet.get(orbitPlanetSlotKey(p.starLetters, p.major));
    if (planetId == null || !byId.has(planetId)) continue;
    const jp = directParentPlanetId(r.parents);
    if (jp != null && byId.has(jp) && jp !== planetId) {
      if (!orbitReaches(orbitChild, jp, r.bodyId)) orbitChild.set(r.bodyId, jp);
      continue;
    }
    if (!orbitReaches(orbitChild, planetId, r.bodyId)) orbitChild.set(r.bodyId, planetId);
  }
}

/**
 * Stable key for grouping multi-star “belt” bodies on separate map rows: which primaries the body orbits.
 * Prefers journal `Parents` Star ids; otherwise parses `AB 1`-style letters (A → lowest bodyId star, …).
 */
export function orbitPrimaryKeyFromRecord(
  r: ExplorationScanRecord,
  starsOrderedByBodyId: ExplorationScanRecord[],
  starSystemName: string,
): string {
  if (isStarOnSystemMap(r, starSystemName)) return "";
  const allowed = new Set(starsOrderedByBodyId.map((s) => s.bodyId));
  const fromParents = [...new Set(allStarParentIds(r.parents))].filter((id) => allowed.has(id));
  if (fromParents.length > 0) {
    return [...new Set(fromParents)].sort((a, b) => a - b).join(",");
  }
  const short = shortBodyLabel(r.bodyName, starSystemName).trim();
  const m = short.match(/^([A-Z]+)\s+\d+/);
  if (m) {
    const letters = m[1]!.toUpperCase();
    const ids: number[] = [];
    for (const ch of letters) {
      if (ch < "A" || ch > "Z") continue;
      const idx = ch.charCodeAt(0) - 0x41;
      if (idx >= 0 && idx < starsOrderedByBodyId.length) {
        ids.push(starsOrderedByBodyId[idx]!.bodyId);
      }
    }
    const joined = [...new Set(ids)].sort((a, b) => a - b).join(",");
    if (joined) return joined;
  }
  const tail = parseDesignationTailFromFullBodyName(r.bodyName);
  if (tail?.starLetters) {
    const letters = tail.starLetters;
    const ids: number[] = [];
    for (const ch of letters) {
      if (ch < "A" || ch > "Z") continue;
      const idx = ch.charCodeAt(0) - 0x41;
      if (idx >= 0 && idx < starsOrderedByBodyId.length) {
        ids.push(starsOrderedByBodyId[idx]!.bodyId);
      }
    }
    const joined = [...new Set(ids)].sort((a, b) => a - b).join(",");
    if (joined) return joined;
  }
  // Single primary: designations are often "1", "2", "1 a" without an A/B prefix — treat as orbiting A implicitly.
  if (starsOrderedByBodyId.length === 1) {
    return String(starsOrderedByBodyId[0]!.bodyId);
  }
  return "";
}

/** Short tag for a mutual barycentre node (star letters `AB`, or planet majors `1·2`). */
export function inferBarycentreDisplayTag(
  children: SystemMapNodeDTO[],
  starLettersByBodyId: Map<number, string>,
  starSystemName: string,
): string {
  const st = children.filter((c) => c.isStar).sort((a, b) => a.bodyId - b.bodyId);
  if (st.length >= 2) {
    return st.map((s) => starLettersByBodyId.get(s.bodyId) ?? "?").join("");
  }
  const worlds = children.filter((c) => !c.isBarycentre);
  if (worlds.length >= 2 && worlds.every((c) => !c.isStar)) {
    const keys = worlds
      .map((p) => {
        const sh = shortBodyLabel(p.bodyName, starSystemName);
        const d = parseShortDesignation(sh) ?? parseDesignationTailFromFullBodyName(p.bodyName);
        return d ? d.major : p.bodyId;
      })
      .sort((a, b) => Number(a) - Number(b));
    return keys.join("·");
  }
  if (children.some((c) => c.isBarycentre)) return "···";
  return "";
}
