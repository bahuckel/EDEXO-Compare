/**
 * Infers undiscovered sibling planets/moons from Elite body designations (FSS / Scan names)
 * and adds synthetic `ExplorationScanRecord` rows for the system map until the full honk resolves them.
 */
import type { ExplorationScanRecord } from "../shared/types.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import type { ParsedDesignation } from "../shared/eliteDesignation.js";
import { parseShortDesignation } from "../shared/eliteDesignation.js";
import type { GameStateStore } from "./gameState.js";
import { directParentPlanetId } from "./orbitUtils.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { explorationRecordHasPlanetSlotDesignation } from "../shared/planetSlotDesignation.js";

/** Re-export for callers that depended on this module. */
export { parseShortDesignation, type ParsedDesignation } from "../shared/eliteDesignation.js";

/** Stellar hub rows only — excludes bodies journaled as stars but named in a planet slot (e.g. `A 3`). */
function recordIsStellarMapHub(r: ExplorationScanRecord, starSystemName: string): boolean {
  return explorationRecordIsStellar(r) && !explorationRecordHasPlanetSlotDesignation(r, starSystemName);
}

function isBeltExplorationRecord(r: ExplorationScanRecord): boolean {
  const bt = (r.bodyType ?? "").replace(/\s+/g, "").toLowerCase();
  if (bt === "asteroidcluster") return true;
  const pc = (r.planetClass ?? "").toLowerCase();
  if (pc.includes("belt cluster") || pc.includes("asteroid cluster")) return true;
  const bn = (r.bodyName ?? "").toLowerCase();
  if (bn.includes("belt cluster")) return true;
  return false;
}

const PHANTOM_ID_START = -40_000;

/** Normalized map key for a designation, e.g. "A|3|" or "AB|2|a". */
function designationKey(d: ParsedDesignation): string {
  return `${d.starLetters}|${d.major}|${d.moon ?? ""}`;
}

function formatDesignationShort(d: ParsedDesignation): string {
  const core = d.starLetters ? `${d.starLetters} ${d.major}` : `${d.major}`;
  return d.moon ? `${core} ${d.moon}` : core;
}

function inferenceGroupKey(starLetters: string): string {
  return starLetters || "__single__";
}

function dedupeDesignations(list: ParsedDesignation[]): ParsedDesignation[] {
  const seen = new Set<string>();
  const out: ParsedDesignation[] = [];
  for (const d of list) {
    const k = designationKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/** All inferred designations implied by one discovery (siblings before, parent planet, earlier moons). */
function inferRequiredFromParsed(p: ParsedDesignation): ParsedDesignation[] {
  const req: ParsedDesignation[] = [];
  for (let i = 1; i < p.major; i++) {
    req.push({ starLetters: p.starLetters, major: i });
  }
  if (p.moon) {
    req.push({ starLetters: p.starLetters, major: p.major });
    const end = p.moon.charCodeAt(0);
    for (let c = "a".charCodeAt(0); c < end; c++) {
      req.push({ starLetters: p.starLetters, major: p.major, moon: String.fromCharCode(c) });
    }
  }
  return dedupeDesignations(req);
}

function collectRequiredPlaceholders(
  recs: ExplorationScanRecord[],
  starSystemName: string,
): ParsedDesignation[] {
  const all: ParsedDesignation[] = [];
  for (const r of recs) {
    if (r.isSynthetic) continue;
    if (recordIsStellarMapHub(r, starSystemName) || isBeltExplorationRecord(r)) continue;
    const short = shortBodyLabel(r.bodyName, starSystemName);
    const p = parseShortDesignation(short);
    if (!p) continue;
    all.push(...inferRequiredFromParsed(p));
  }
  return dedupeDesignations(all);
}

/** Map designation key (no moon / with moon) → journal parent planet bodyId when a moon references an unscanned planet. */
function journalPlanetIdByParentDesignation(
  recs: ExplorationScanRecord[],
  starSystemName: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of recs) {
    if (r.isSynthetic) continue;
    const short = shortBodyLabel(r.bodyName, starSystemName);
    const p = parseShortDesignation(short);
    if (!p?.moon) continue;
    const pid = directParentPlanetId(r.parents);
    if (pid == null) continue;
    const parentDesig: ParsedDesignation = { starLetters: p.starLetters, major: p.major };
    const key = designationKey(parentDesig);
    if (!map.has(key)) map.set(key, pid);
  }
  return map;
}

function sortPlaceholderOrder(a: ParsedDesignation, b: ParsedDesignation): number {
  const moonA = a.moon ? 1 : 0;
  const moonB = b.moon ? 1 : 0;
  if (moonA !== moonB) return moonA - moonB;
  if (a.major !== b.major) return a.major - b.major;
  const ca = a.moon?.charCodeAt(0) ?? 0;
  const cb = b.moon?.charCodeAt(0) ?? 0;
  return ca - cb;
}

function syntheticSemiMajorAxis(d: ParsedDesignation): number {
  if (d.moon) {
    return d.major * 1e15 + d.moon.charCodeAt(0) * 1e6;
  }
  return d.major * 1e15;
}

function parentsForSyntheticPlanet(
  groupKey: string,
  groupRef: Map<string, ExplorationScanRecord>,
  solePrimary: ExplorationScanRecord | null,
  byId: Map<number, ExplorationScanRecord>,
  starSystemName: string,
): unknown {
  const ref = groupRef.get(groupKey);
  if (!ref) {
    return solePrimary ? [{ Star: solePrimary.bodyId }] : undefined;
  }
  const short = shortBodyLabel(ref.bodyName, starSystemName);
  const p = parseShortDesignation(short);
  if (p && !p.moon && ref.parents) return ref.parents;
  if (p?.moon) {
    const pid = directParentPlanetId(ref.parents);
    if (pid != null && byId.has(pid)) {
      const pr = byId.get(pid)!;
      if (pr.parents) return pr.parents;
    }
  }
  if (solePrimary) return [{ Star: solePrimary.bodyId }];
  return ref.parents;
}

function buildShortLabelToBodyId(recs: ExplorationScanRecord[], starSystemName: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of recs) {
    if (recordIsStellarMapHub(r, starSystemName) || isBeltExplorationRecord(r)) continue;
    const short = shortBodyLabel(r.bodyName, starSystemName);
    const p = parseShortDesignation(short);
    if (!p) continue;
    m.set(designationKey(p), r.bodyId);
  }
  return m;
}

/**
 * Stub Scan records for FSS-tagged bodies not yet present in merged exploration (no `Scan` line).
 */
export function stubExplorationRecordsFromFss(
  store: GameStateStore,
  focusSystemAddress: number,
  starSystemName: string,
  existingBodyIds: Set<number>,
): ExplorationScanRecord[] {
  const out: ExplorationScanRecord[] = [];
  const prefix = `${focusSystemAddress}:`;
  for (const k of store.fssBodySignalsBodyKeys) {
    if (!k.startsWith(prefix)) continue;
    const bodyId = Number(k.slice(prefix.length));
    if (!Number.isFinite(bodyId) || existingBodyIds.has(bodyId)) continue;
    const b = store.bodies.get(k);
    const bodyName = b?.bodyName?.trim() ?? `Body ${bodyId}`;
    const star = b?.starSystem?.trim() || starSystemName;
    out.push({
      systemAddress: focusSystemAddress,
      bodyId,
      bodyName,
      starSystem: star,
      updatedAt: "",
    });
  }
  return out;
}

/**
 * Merge FSS stubs and inferred placeholders into exploration records for map layout.
 */
export function mergeExplorationRecordsWithInferredPlaceholders(
  store: GameStateStore,
  focusSystemAddress: number,
  recsInput: ExplorationScanRecord[],
  starSystemName: string,
): ExplorationScanRecord[] {
  const starSystem = starSystemName.trim();
  const recs = [...recsInput];
  const existingIds = new Set(recs.map((r) => r.bodyId));
  recs.push(...stubExplorationRecordsFromFss(store, focusSystemAddress, starSystem, existingIds));

  const byId = new Map<number, ExplorationScanRecord>(recs.map((r) => [r.bodyId, r]));
  const journalPlanetIds = journalPlanetIdByParentDesignation(recs, starSystem);
  const required = collectRequiredPlaceholders(recs, starSystem);

  const groupRef = new Map<string, ExplorationScanRecord>();
  for (const r of recs) {
    if (r.isSynthetic) continue;
    if (recordIsStellarMapHub(r, starSystem) || isBeltExplorationRecord(r)) continue;
    const short = shortBodyLabel(r.bodyName, starSystem);
    const p = parseShortDesignation(short);
    if (!p) continue;
    const gk = inferenceGroupKey(p.starLetters);
    if (!groupRef.has(gk)) groupRef.set(gk, r);
  }

  const stars = recs.filter((r) => recordIsStellarMapHub(r, starSystem)).sort((a, b) => a.bodyId - b.bodyId);
  const solePrimary = stars.length === 1 ? stars[0]! : null;

  let phantomId = PHANTOM_ID_START;
  const nextNegativeId = () => phantomId--;

  const labelToId = buildShortLabelToBodyId(recs, starSystem);
  const sortedReq = [...required].sort(sortPlaceholderOrder);

  for (const d of sortedReq) {
    const dk = designationKey(d);
    if (labelToId.has(dk)) continue;

    const fullName = `${starSystem} ${formatDesignationShort(d)}`.trim();
    let bodyId: number;
    let parents: unknown;

    if (d.moon) {
      const planetKey = designationKey({ starLetters: d.starLetters, major: d.major });
      const planetId = labelToId.get(planetKey);
      if (planetId == null) continue;
      parents = [{ Planet: planetId }];
      bodyId = nextNegativeId();
    } else {
      const gk = inferenceGroupKey(d.starLetters);
      parents = parentsForSyntheticPlanet(gk, groupRef, solePrimary, byId, starSystem);
      const forced = journalPlanetIds.get(dk);
      if (forced != null && byId.has(forced) && !recordIsStellarMapHub(byId.get(forced)!, starSystem)) {
        labelToId.set(dk, forced);
        continue;
      }
      bodyId = forced != null && !byId.has(forced) ? forced : nextNegativeId();
    }

    const syn: ExplorationScanRecord = {
      systemAddress: focusSystemAddress,
      bodyId,
      bodyName: fullName,
      starSystem: starSystem,
      updatedAt: "",
      semiMajorAxis: syntheticSemiMajorAxis(d),
      isSynthetic: true,
    };
    if (parents !== undefined) syn.parents = parents;

    recs.push(syn);
    labelToId.set(dk, bodyId);
    byId.set(bodyId, syn);
  }

  return recs;
}
