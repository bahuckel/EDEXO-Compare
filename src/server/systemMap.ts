import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BodyExoState,
  ExoPayoutRangeDTO,
  ExplorationScanRecord,
  PlanetScan,
  PrimaryStarHeaderEntryDTO,
  PrimaryStarsHeaderDTO,
  SpeciesDatabase,
  StarRoleDTO,
  SystemMapBodyDetailDTO,
  SystemMapNodeDTO,
  SystemMapSnapshot,
} from "../shared/types.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import { formatFullSpectralNotation, spectralDiscGlyph } from "../shared/spectralNotation.js";
import type { GameStateStore } from "./gameState.js";
import {
  bodyScanValueCredits,
  referenceFssAt1EarthMass,
  starScanValueCredits,
} from "./explorationValue.js";
import { matchDatabaseToScan } from "./matchSpecies.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import { lookupPrice, lookupPriceStrict, type PriceIndex } from "./priceList.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import type { ParsedJournalParent } from "./orbitUtils.js";
import {
  allStarParentIds,
  barycentreSyntheticBodyId,
  directParentBodyId,
  directParentPlanetId,
  isBarycentreSyntheticBodyId,
  parseJournalParentEntry,
} from "./orbitUtils.js";
import {
  estimateExplorationJournalDataCreditsForSystem,
  firstMapperForDssPayout,
} from "./explorationDataEstimate.js";
import { approximateSystemRoughFssDssTotals } from "./systemRoughValueEstimate.js";
import { mergeExplorationRecordsWithInferredPlaceholders } from "./inferredSystemMapPlaceholders.js";
import {
  compareByParsedDesignationOrBodyId,
  parseDesignationTailFromFullBodyName,
  parseShortDesignation,
} from "../shared/eliteDesignation.js";
import { explorationRecordHasPlanetSlotDesignation } from "../shared/planetSlotDesignation.js";
import {
  explorationRecordIsBeltClusterLike,
  explorationRecordIsStellar,
} from "./explorationStellar.js";

const isBeltClusterRecord = explorationRecordIsBeltClusterLike;

/** Bodies that act as sun nodes / primary column in the map: stellar but not planet-designation slots. */
function isStarOnSystemMap(r: ExplorationScanRecord, starSystemName: string): boolean {
  return explorationRecordIsStellar(r) && !explorationRecordHasPlanetSlotDesignation(r, starSystemName);
}

function bodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/**
 * Order siblings like the in-game system map: by designation (major index, then moon a…z), not raw
 * `semiMajorAxis` (journal vs synthetic scales differ, so “planet 7 discovered first” wrongly sat beside the star).
 */
function compareExplorationScanSiblingOrder(
  a: ExplorationScanRecord,
  b: ExplorationScanRecord,
  starSystemName: string,
): number {
  const sa = shortBodyLabel(a.bodyName, starSystemName);
  const sb = shortBodyLabel(b.bodyName, starSystemName);
  const pa = parseShortDesignation(sa) ?? parseDesignationTailFromFullBodyName(a.bodyName);
  const pb = parseShortDesignation(sb) ?? parseDesignationTailFromFullBodyName(b.bodyName);
  if (!pa && !pb) {
    const semiA = a.semiMajorAxis;
    const semiB = b.semiMajorAxis;
    const finiteA = typeof semiA === "number" && Number.isFinite(semiA);
    const finiteB = typeof semiB === "number" && Number.isFinite(semiB);
    if (finiteA && finiteB && semiA !== semiB) return semiA - semiB;
    return a.bodyId - b.bodyId;
  }
  return compareByParsedDesignationOrBodyId(sa, sb, a.bodyId, b.bodyId);
}

const isStarRecord = explorationRecordIsStellar;

/**
 * Journal `BodyName` is `"<StarSystem> <designation>"`. Using `recs[0]` is unsafe: `explorationScans`
 * iteration order is arbitrary, so the first row can be a world with an empty/wrong `StarSystem` while
 * the primary star row has the real name — then prefixes never strip ("System_Name A 1" stays unparsed)
 * and orbit inference can leave worlds disconnected from the star.
 */
function canonicalStarSystemNameForMap(recs: ExplorationScanRecord[]): string {
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

/**
 * Build `child → parent` edges from journal `Scan.Parents` (Stellar Forge: index 0 is immediate parent;
 * each subsequent entry is further out). `{ Null: n }` → synthetic barycentre node id.
 */
function buildOrbitChildMapFromJournalChains(
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
    for (const entry of parents) {
      const parsed = parseJournalParentEntry(entry);
      if (parsed == null) break;
      const parentId = resolveJournalOrbitLinkTarget(parsed, byId, solePrimary);
      if (parentId == null) break;
      orbitChild.set(currentChild, parentId);
      currentChild = parentId;
    }
  }

  for (const r of recs) {
    if (orbitChild.has(r.bodyId)) continue;
    if (isStarOnSystemMap(r, starSystemName)) continue;
    if (solePrimary && !isBeltClusterRecord(r)) orbitChild.set(r.bodyId, solePrimary.bodyId);
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
      if (targetId != null) orbitChild.set(r.bodyId, targetId);
    }
  }

  return orbitChild;
}

function parentToChildrenFromOrbitChild(orbitChild: Map<number, number>): Map<number, number[]> {
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

function allIdsInOrbitGraph(recs: ExplorationScanRecord[], orbitChild: Map<number, number>): Set<number> {
  const s = new Set<number>();
  for (const r of recs) s.add(r.bodyId);
  for (const [c, p] of orbitChild) {
    s.add(c);
    s.add(p);
  }
  return s;
}

function rootBodyIdsFromOrbitGraph(allIds: Set<number>, orbitChild: Map<number, number>): number[] {
  return [...allIds].filter((id) => !orbitChild.has(id)).sort((a, b) => a - b);
}

function sortChildIdsForSystemMap(
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
function attachMoonsByParsedDesignation(
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
      orbitChild.set(r.bodyId, jp);
      continue;
    }
    orbitChild.set(r.bodyId, planetId);
  }
}

/**
 * Stable key for grouping multi-star “belt” bodies on separate map rows: which primaries the body orbits.
 * Prefers journal `Parents` Star ids; otherwise parses `AB 1`-style letters (A → lowest bodyId star, …).
 */
function orbitPrimaryKeyFromRecord(
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
function inferBarycentreDisplayTag(
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

export function bodyHasExoMarkers(b: BodyExoState): boolean {
  const hasBioCount = b.biologicalSignals !== null && b.biologicalSignals > 0;
  const hasHints = !!(b.genusHints && b.genusHints.length);
  const confirmed = b.confirmedVariants.length > 0;
  const organicLocks = b.organicGenusLocks.length > 0;
  return hasBioCount || hasHints || confirmed || organicLocks;
}

export type StarRolesConfig = {
  fuelPrefixes: string[];
  neutronExact: string[];
  blackHoleExact: string[];
  whiteDwarfPrefix: string;
};

export function loadStarRolesConfig(projectRoot: string): StarRolesConfig {
  const p = join(projectRoot, "data", "system-map", "star-roles.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  return {
    fuelPrefixes: (raw.fuelPrefixes as string[]) ?? [],
    neutronExact: (raw.neutronExact as string[]) ?? [],
    blackHoleExact: (raw.blackHoleExact as string[]) ?? [],
    whiteDwarfPrefix: typeof raw.whiteDwarfPrefix === "string" ? raw.whiteDwarfPrefix : "D",
  };
}

export function roleForStarType(starType: string | undefined, cfg: StarRolesConfig): StarRoleDTO {
  const u = (starType ?? "").trim().toUpperCase();
  if (!u) return "useless";
  if (cfg.neutronExact.some((x) => x.toUpperCase() === u)) return "neutron_boost";
  if (cfg.blackHoleExact.some((x) => x.toUpperCase() === u)) return "useless";
  const wd = cfg.whiteDwarfPrefix.trim().toUpperCase().charAt(0);
  if (wd && u.charAt(0) === wd) return "wd_boost";
  const c0 = u.charAt(0);
  if (cfg.fuelPrefixes.some((p) => p.trim().toUpperCase().charAt(0) === c0)) return "fuel";
  return "useless";
}

const ELEMENT_SYMBOL: Record<string, string> = {
  iron: "Fe",
  silicates: "Si",
  silicate: "Si",
  carbon: "C",
  nickel: "Ni",
  chromium: "Cr",
  manganese: "Mn",
  selenium: "Se",
  zinc: "Zn",
  germanium: "Ge",
  cadmium: "Cd",
  tin: "Sn",
  antimony: "Sb",
  tellurium: "Te",
  mercury: "Hg",
  sulphur: "S",
  sulfur: "S",
  rock: "Si",
  ice: "H₂O",
  ammonia: "NH₃",
  water: "H₂O",
  oxygen: "O",
  hydrogen: "H",
  helium: "He",
};

function formatCompositionList(raw: unknown): string {
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const x of raw) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const name = (o.Name ?? o.name) as string | undefined;
      const pct = o.Percent ?? o.percent;
      if (!name?.trim()) continue;
      const sym = ELEMENT_SYMBOL[name.trim().toLowerCase()] ?? name.trim();
      if (typeof pct === "number" && Number.isFinite(pct)) parts.push(`${sym} ${pct.toFixed(1)}%`);
      else parts.push(sym);
    }
    return parts.join(", ");
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const sym = ELEMENT_SYMBOL[k.trim().toLowerCase()] ?? k.trim();
      if (typeof v === "number" && Number.isFinite(v)) parts.push(`${sym} ${v.toFixed(1)}%`);
    }
    return parts.join(", ");
  }
  return "";
}

function terraformableFromRecord(r: ExplorationScanRecord): boolean {
  return (r.terraformState ?? "").toLowerCase().includes("terraformable");
}

function acronymFromWords(text: string, maxLen: number): string {
  return text
    .replace(/\s+body$/i, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .join("")
    .slice(0, maxLen);
}

function shortLabel(r: ExplorationScanRecord, starSystemName: string): string {
  if (r.isSynthetic) return "?";
  if (isStarOnSystemMap(r, starSystemName)) {
    const st = (r.starType ?? "").trim();
    if (st) {
      const sub = r.subclass != null ? `${st}${r.subclass}` : st;
      return sub;
    }
    const pc = (r.planetClass ?? "").trim();
    if (pc) return acronymFromWords(pc, 5);
    return "?";
  }
  const pc = r.planetClass ?? "?";
  if (pc === "High metal content body") return "HMC";
  if (pc === "Earthlike body") return "ELW";
  if (pc === "Water world") return "WW";
  if (pc === "Ammonia world") return "AW";
  if (pc === "Metal rich body") return "MR";
  if (pc === "Rocky body") return "R";
  if (pc === "Rocky ice body") return "RI";
  if (pc === "Icy body") return "I";
  if (/Sudarsky class I gas giant/i.test(pc)) return "GG1";
  if (/Sudarsky class II gas giant/i.test(pc)) return "GG2";
  if (/Sudarsky class III gas giant/i.test(pc)) return "GG3";
  if (/Sudarsky class IV gas giant/i.test(pc)) return "GG4";
  if (/Sudarsky class V gas giant/i.test(pc)) return "GG5";
  if (/gas giant/i.test(pc)) return "GG";
  return acronymFromWords(pc, 5);
}

function exoValueTierFromHeuristic(credits: number, plusMin: number, plusPlusMin: number): 0 | 1 | 2 {
  if (credits >= plusPlusMin) return 2;
  if (credits >= plusMin) return 1;
  return 0;
}

/**
 * `displayMax`: best single-species payout heuristic for map tiers (list × 5 only when this commander has
 * first-footfall on the body, else × 1 — same rule as pending organic valuation).
 * `tierValue`: conservative basis for `+` / `++` when matching is approximate-only (minimum among tied ×vals).
 */
function maxExoHeuristicPair(
  store: GameStateStore,
  db: SpeciesDatabase,
  prices: PriceIndex,
  r: ExplorationScanRecord,
): { displayMax: number; tierValue: number } {
  const bk = bodyKey(r.systemAddress, r.bodyId);
  const exo = store.bodies.get(bk);
  if (!exo || !bodyHasExoMarkers(exo)) return { displayMax: 0, tierValue: 0 };
  const scan = scanForMatch(store, r, exo);
  if (!scan?.PlanetClass) return { displayMax: 0, tierValue: 0 };
  const run = matchDatabaseToScan(db, scan, exo.genusHints, exo.organicGenusLocks, {
    includeBacterium: store.includeBacteriumInSearch,
    matchContext: buildSpeciesMatchContext(exo, store),
    dssPhysicalSlack: store.getDssPhysicalSlackRatios(),
  });
  const mult: 1 | 5 = store.firstFootfallBodies.has(bk) ? 5 : 1;
  const vals: number[] = [];
  for (const m of run.matches) {
    const p = lookupPriceStrict(prices, m.entry.displayName, m.entry.id);
    if (p != null) vals.push(p * mult);
  }
  if (vals.length === 0) return { displayMax: 0, tierValue: 0 };
  const displayMax = Math.max(...vals);
  const tierValue = run.approximateMatchingUsed ? Math.min(...vals) : displayMax;
  return { displayMax, tierValue };
}

function buildExoPayoutRangeForRecord(
  store: GameStateStore,
  db: SpeciesDatabase,
  prices: PriceIndex,
  r: ExplorationScanRecord,
): ExoPayoutRangeDTO | null {
  const bk = bodyKey(r.systemAddress, r.bodyId);
  const exo = store.bodies.get(bk);
  if (!exo || !bodyHasExoMarkers(exo)) return null;
  const scan = scanForMatch(store, r, exo);
  if (!scan?.PlanetClass) return null;
  const { matches } = matchDatabaseToScan(db, scan, exo.genusHints, exo.organicGenusLocks, {
    includeBacterium: store.includeBacteriumInSearch,
    matchContext: buildSpeciesMatchContext(exo, store),
    dssPhysicalSlack: store.getDssPhysicalSlackRatios(),
  });
  const { count: slots, source: slotSource } = resolveOrganicSlotCount(exo);
  if (slots <= 0 || slotSource === "none") return null;
  const mult: 1 | 5 = store.firstFootfallBodies.has(bk) ? 5 : 1;
  const wf = store.bodyDetailedFootfallState.get(bk);
  const journalWasFootfalled = wf === undefined ? null : wf === true;
  return computeExoPayoutRangeFromMatches(
    matches,
    prices,
    slots,
    slotSource,
    mult,
    journalWasFootfalled,
    mult === 5,
  );
}

function scanForMatch(store: GameStateStore, r: ExplorationScanRecord, exo: BodyExoState | undefined): PlanetScan | null {
  if (exo?.scan) return exo.scan;
  if (!r.planetClass && !r.atmosphereType && !r.atmosphere) return null;
  return {
    BodyName: r.bodyName,
    BodyID: r.bodyId,
    StarSystem: r.starSystem,
    SystemAddress: r.systemAddress,
    PlanetClass: r.planetClass,
    Atmosphere: r.atmosphere,
    AtmosphereType: r.atmosphereType,
    SurfaceGravity: r.surfaceGravity,
    SurfaceTemperature: r.surfaceTemperature,
    SurfacePressure: r.surfacePressure,
    SemiMajorAxis: r.semiMajorAxis,
    TidalLock: r.tidalLock,
    Volcanism: r.volcanism,
    Landable: r.landable,
    TerraformState: r.terraformState,
  };
}

function exoMatchSummaries(
  store: GameStateStore,
  db: SpeciesDatabase,
  r: ExplorationScanRecord,
): { displayName: string; id: string }[] {
  const exo = store.bodies.get(bodyKey(r.systemAddress, r.bodyId));
  if (!exo || !bodyHasExoMarkers(exo)) return [];
  const scan = scanForMatch(store, r, exo);
  if (!scan?.PlanetClass) return [];
  const { matches } = matchDatabaseToScan(db, scan, exo.genusHints, exo.organicGenusLocks, {
    includeBacterium: store.includeBacteriumInSearch,
    matchContext: buildSpeciesMatchContext(exo, store),
    dssPhysicalSlack: store.getDssPhysicalSlackRatios(),
  });
  return matches.slice(0, 48).map((m) => ({ displayName: m.entry.displayName, id: m.entry.id }));
}

export function buildPrimaryStarsHeader(
  recs: ExplorationScanRecord[],
  cfg: StarRolesConfig,
): PrimaryStarsHeaderDTO | null {
  const starSystemName = canonicalStarSystemNameForMap(recs);
  const stars = recs.filter((r) => isStarOnSystemMap(r, starSystemName)).sort((a, b) => a.bodyId - b.bodyId);
  if (!stars.length) return null;
  const multi = stars.length > 1;
  const out: PrimaryStarHeaderEntryDTO[] = stars.map((s, idx) => {
    const starRole = roleForStarType(s.starType, cfg);
    const letter: string | null = multi ? String.fromCharCode(65 + idx) : null;
    let shortLabel =
      shortBodyLabel(s.bodyName, starSystemName).trim() ||
      (s.bodyName || "").replace(/\s+/g, " ").trim() ||
      "Star";
    const glyph = letter ?? "★";
    if (shortLabel === glyph) shortLabel = "";
    else if (letter && shortLabel.length <= 2 && shortLabel.toUpperCase() === letter.toUpperCase()) shortLabel = "";
    else if (!letter && (shortLabel === "★" || shortLabel === "Star")) shortLabel = "";
    return {
      letter,
      shortLabel,
      starRole,
      fullSpectralNotation: formatFullSpectralNotation(s.starType, s.subclass, s.luminosity),
    };
  });
  const systemName = starSystemName.trim() || stars[0]?.starSystem?.trim() || "—";
  return { systemName, stars: out };
}

/**
 * Count bodies the system map actually draws for D-scan parity: stars / planets / moons with merged journal data,
 * excluding mutual barycentre nodes and naming placeholders. Belt clusters are already omitted from the map tree.
 */
export function countPhysicalBodiesInSystemMapTree(nodes: SystemMapNodeDTO[]): number {
  const seen = new Set<number>();
  let n = 0;
  function walk(arr: SystemMapNodeDTO[]) {
    for (const node of arr) {
      if (node.isBarycentre === true) {
        walk(node.children);
        continue;
      }
      if (node.isInferredPlaceholder === true) {
        walk(node.children);
        continue;
      }
      if (!seen.has(node.bodyId)) {
        seen.add(node.bodyId);
        n += 1;
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return n;
}

export function buildSystemMapSnapshot(
  store: GameStateStore,
  focusSystemAddress: number | null,
  db: SpeciesDatabase,
  cfg: StarRolesConfig,
  prices: PriceIndex,
): SystemMapSnapshot | null {
  if (focusSystemAddress == null) return null;
  /** Narrowed copy: the closures below lose the null-check on the captured parameter. */
  const focusAddr: number = focusSystemAddress;
  const prefix = `${focusSystemAddress}:`;
  const journalRecs: ExplorationScanRecord[] = [];
  for (const [key, r] of store.explorationScans) {
    if (key.startsWith(prefix)) journalRecs.push(r);
  }
  let recs = journalRecs.filter((r) => !isBeltClusterRecord(r));
  if (recs.length === 0) {
    const edsmRecs: ExplorationScanRecord[] = [];
    for (const [key, r] of store.edsmExplorationByKey) {
      if (key.startsWith(prefix)) edsmRecs.push(r);
    }
    recs = edsmRecs.filter((r) => !isBeltClusterRecord(r));
  }
  if (recs.length === 0) return null;

  const starSystemName = canonicalStarSystemNameForMap(recs);
  recs = mergeExplorationRecordsWithInferredPlaceholders(store, focusSystemAddress, recs, starSystemName);

  const byId = new Map<number, ExplorationScanRecord>();
  for (const r of recs) byId.set(r.bodyId, r);

  const orbitChild = buildOrbitChildMapFromJournalChains(recs, byId, starSystemName);
  attachMoonsByParsedDesignation(recs, orbitChild, starSystemName, byId);

  const detailsByBodyId: Record<string, SystemMapBodyDetailDTO> = {};
  let totalFss = 0;
  let totalDss = 0;
  let totalFssFd = 0;
  let totalDssFd = 0;
  let totalDssVersusFssUplift = 0;

  for (const r of recs) {
    if (r.isBarycentreJournal) {
      const bk = bodyKey(r.systemAddress, r.bodyId);
      detailsByBodyId[String(r.bodyId)] = {
        bodyId: r.bodyId,
        bodyName: "Mutual barycentre",
        bodyKey: bk,
        isStar: false,
        journalStellar: false,
        fssCredits: null,
        fssFirstDiscoverCredits: null,
        fssFirstDiscoverBonus: null,
        dssCredits: null,
        dssFirstDiscoverCredits: null,
        dssFirstDiscoverBonus: null,
        dssVersusFssUpliftCredits: null,
        dssProjectedCredits: null,
        dssProbeEfficientApplied: null,
        valuePlus: false,
        hasExobiology: false,
        bioBodyKey: null,
        estimatedSurfaceTempK: null,
        exoMatchSummaries: [],
        maxExoHeuristicCredits: 0,
        exoValueTier: 0,
        exoPayoutRange: null,
        parentBodyId: null,
        parentStarIds: [],
        isMutualBarycentre: true,
        semiMajorAxis: r.semiMajorAxis,
        baryEccentricity: r.eccentricity,
        baryOrbitalInclination: r.orbitalInclination,
        baryPeriapsis: r.periapsis,
        baryOrbitalPeriod: r.orbitalPeriod,
        baryAscendingNode: r.ascendingNode,
        baryMeanAnomaly: r.meanAnomaly,
        baryJournalNullId: r.journalBarycentreNullId,
      };
      continue;
    }

    const bk = bodyKey(r.systemAddress, r.bodyId);
    const exo = store.bodies.get(bk);
    const hasExo = exo ? bodyHasExoMarkers(exo) : false;
    const tf = terraformableFromRecord(r);
    const mass = r.massEM ?? 1;
    const isStar = isStarOnSystemMap(r, starSystemName);
    const journalStellar = explorationRecordIsStellar(r);

    const fd = r.wasDiscovered === false;

    let dssVersusFssUplift: number | null = null;
    let dssProjected: number | null = null;
    let dssProbeEfficientApplied: boolean | null = null;

    let fss: number | null = null;
    let fssFd: number | null = null;
    let dss: number | null = null;
    let dssFd: number | null = null;
    let valuePlus = false;

    if (journalStellar) {
      const sm = r.stellarMass ?? 1;
      const sv = starScanValueCredits(sm, r.starType, fd);
      const svFd = starScanValueCredits(sm, r.starType, true);
      fss = sv.value;
      fssFd = svFd.value;
      dss = fss;
      dssFd = fssFd;
      totalFss += fss;
      totalDss += dss;
      totalFssFd += fssFd;
      totalDssFd += dssFd;
    } else if (r.planetClass) {
      const mapped = store.dssMappedBodyKeys.has(bk);
      const fm = firstMapperForDssPayout(store, bk, r, mapped);
      const eff = mapped && store.dssMappingEfficientByBodyKey.get(bk) === true;
      const base = bodyScanValueCredits(r.planetClass, tf, mass, fd, false, false, false);
      const mappedVal = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, eff);
      const baseFd = bodyScanValueCredits(r.planetClass, tf, mass, true, false, false, false);
      const mapFd = bodyScanValueCredits(r.planetClass, tf, mass, true, true, false, false);
      const projectedMapped = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, false).dssMapped;
      fss = base.fss;
      dss = mapped ? mappedVal.dssMapped : base.fss;
      fssFd = baseFd.fss;
      dssFd = mapped ? mapFd.dssMapped : baseFd.fss;
      dssVersusFssUplift = mapped && fss != null && dss != null ? dss - fss : null;
      dssProjected = mapped ? null : projectedMapped;
      dssProbeEfficientApplied = mapped ? eff : null;
      totalFss += fss;
      totalDss += dss;
      totalFssFd += fssFd;
      totalDssFd += dssFd;
      if (mapped) totalDssVersusFssUplift += dss - fss;

      const ref = referenceFssAt1EarthMass(r.planetClass, tf);
      valuePlus = ref > 0 && fss > ref * 1.12;
    }

    const scan = scanForMatch(store, r, exo);
    const est = scan ? estimatedTemperatureRangeForScan(scan) : null;

    const maxExo = maxExoHeuristicPair(store, db, prices, r);
    const exoTier = exoValueTierFromHeuristic(
      maxExo.tierValue,
      store.exoMapTierPlusMinCr,
      store.exoMapTierPlusPlusMinCr,
    );
    const parentResolved = orbitChild.get(r.bodyId);
    const parentBodyId = parentResolved ?? directParentBodyId(r.parents);
    const parentStarIds = allStarParentIds(r.parents);

    const role = journalStellar ? roleForStarType(r.starType, cfg) : undefined;

    detailsByBodyId[String(r.bodyId)] = {
      bodyId: r.bodyId,
      bodyName: shortBodyLabel(r.bodyName, starSystemName),
      bodyKey: bk,
      isStar,
      journalStellar,
      starType: r.starType,
      fullSpectralNotation: journalStellar
        ? formatFullSpectralNotation(r.starType, r.subclass, r.luminosity)
        : null,
      starRole: role,
      planetClass: r.planetClass,
      terraformState: r.terraformState,
      landable: r.landable,
      massEM: r.massEM,
      stellarMass: r.stellarMass,
      semiMajorAxis: r.semiMajorAxis,
      surfaceTemperature: r.surfaceTemperature,
      surfaceGravity: r.surfaceGravity,
      surfacePressure: r.surfacePressure,
      atmosphereType: r.atmosphereType,
      atmosphere: r.atmosphere,
      volcanism: r.volcanism,
      tidalLock: r.tidalLock,
      compositionSummary: formatCompositionList(r.composition) || formatCompositionList(r.materials),
      atmosphereCompositionSummary: formatCompositionList(r.atmosphereComposition),
      fssCredits: fss,
      fssFirstDiscoverCredits: fssFd,
      fssFirstDiscoverBonus: fss != null && fssFd != null ? fssFd - fss : null,
      dssCredits: dss,
      dssFirstDiscoverCredits: dssFd,
      dssFirstDiscoverBonus: dss != null && dssFd != null ? dssFd - dss : null,
      dssVersusFssUpliftCredits: dssVersusFssUplift,
      dssProjectedCredits: dssProjected,
      dssProbeEfficientApplied: dssProbeEfficientApplied,
      valuePlus,
      hasExobiology: hasExo,
      bioBodyKey: hasExo ? bk : null,
      estimatedSurfaceTempK:
        est != null ? { minK: est.tMin, maxK: est.tMax, midK: est.tMid } : null,
      exoMatchSummaries: exoMatchSummaries(store, db, r),
      maxExoHeuristicCredits: maxExo.displayMax,
      exoValueTier: exoTier,
      exoPayoutRange: buildExoPayoutRangeForRecord(store, db, prices, r),
      parentBodyId,
      parentStarIds,
      isInferredPlaceholder: !!r.isSynthetic,
    };
  }

  const starsOrderedByBodyId = recs
    .filter((r) => isStarOnSystemMap(r, starSystemName))
    .sort((a, b) => a.bodyId - b.bodyId);
  const starLetterMap = new Map(
    starsOrderedByBodyId.map((s, i) => [s.bodyId, String.fromCharCode(65 + i)]),
  );
  const parentToChildren = parentToChildrenFromOrbitChild(orbitChild);
  const graphIds = allIdsInOrbitGraph(recs, orbitChild);
  const rootIds = rootBodyIdsFromOrbitGraph(graphIds, orbitChild);
  const arrivalBodyId =
    recs.find((r) => typeof r.distanceFromArrivalLs === "number" && r.distanceFromArrivalLs === 0)?.bodyId ??
    null;

  function mapSubTree(bodyId: number, visiting: Set<number>): SystemMapNodeDTO | null {
    if (visiting.has(bodyId)) return null;
    visiting.add(bodyId);
    try {
      const childIds = sortChildIdsForSystemMap(parentToChildren.get(bodyId) ?? [], byId, starSystemName);
      const children: SystemMapNodeDTO[] = [];
      for (const cid of childIds) {
        const sub = mapSubTree(cid, visiting);
        if (sub) children.push(sub);
      }

      if (isBarycentreSyntheticBodyId(bodyId)) {
        const tag = inferBarycentreDisplayTag(children, starLetterMap, starSystemName);
        const pretty = tag ? `Bary ${tag}` : "Barycentre";
        const bk = bodyKey(focusAddr, bodyId);
        const existing = detailsByBodyId[String(bodyId)];
        if (!existing) {
          detailsByBodyId[String(bodyId)] = {
            bodyId,
            bodyName: pretty,
            bodyKey: bk,
            isStar: false,
            journalStellar: false,
            fssCredits: null,
            fssFirstDiscoverCredits: null,
            fssFirstDiscoverBonus: null,
            dssCredits: null,
            dssFirstDiscoverCredits: null,
            dssFirstDiscoverBonus: null,
            dssVersusFssUpliftCredits: null,
            dssProjectedCredits: null,
            dssProbeEfficientApplied: null,
            valuePlus: false,
            hasExobiology: false,
            bioBodyKey: null,
            estimatedSurfaceTempK: null,
            exoMatchSummaries: [],
            maxExoHeuristicCredits: 0,
            exoValueTier: 0,
            exoPayoutRange: null,
            parentBodyId: null,
            parentStarIds: [],
            isMutualBarycentre: true,
            baryAffectsBodyIds: children.map((c) => c.bodyId),
            baryJournalNullId: byId.get(bodyId)?.journalBarycentreNullId,
          };
        } else {
          existing.bodyName = pretty;
          existing.baryAffectsBodyIds = children.map((c) => c.bodyId);
          existing.isMutualBarycentre = true;
          const jr = byId.get(bodyId);
          if (jr?.journalBarycentreNullId != null) existing.baryJournalNullId = jr.journalBarycentreNullId;
        }
        return {
          bodyId,
          bodyName: tag,
          label: "×",
          mapLabel: "×",
          isStar: false,
          journalStellar: false,
          hasExobiology: false,
          valuePlus: false,
          maxExoHeuristicCredits: 0,
          exoValueTier: 0,
          namePlus: false,
          starVisual: "default",
          orbitPrimaryKey: "",
          children,
          isBarycentre: true,
          semiMajorAxis: null,
        };
      }

      const r = byId.get(bodyId);
      if (!r) {
        const placeholderKey = bodyKey(focusAddr, bodyId);
        const phName = `Body ${bodyId}`;
        detailsByBodyId[String(bodyId)] = {
          bodyId,
          bodyName: phName,
          bodyKey: placeholderKey,
          isStar: false,
          journalStellar: false,
          fssCredits: null,
          fssFirstDiscoverCredits: null,
          fssFirstDiscoverBonus: null,
          dssCredits: null,
          dssFirstDiscoverCredits: null,
          dssFirstDiscoverBonus: null,
          dssVersusFssUpliftCredits: null,
          dssProjectedCredits: null,
          dssProbeEfficientApplied: null,
          valuePlus: false,
          hasExobiology: false,
          bioBodyKey: null,
          estimatedSurfaceTempK: null,
          exoMatchSummaries: [],
          maxExoHeuristicCredits: 0,
          exoValueTier: 0,
          exoPayoutRange: null,
          parentBodyId: null,
          parentStarIds: [],
          isInferredPlaceholder: true,
        };
        return {
          bodyId,
          bodyName: phName,
          label: "?",
          mapLabel: "?",
          isStar: false,
          journalStellar: false,
          hasExobiology: false,
          valuePlus: false,
          maxExoHeuristicCredits: 0,
          exoValueTier: 0,
          namePlus: false,
          starVisual: "default",
          orbitPrimaryKey: "",
          children,
          isInferredPlaceholder: true,
          semiMajorAxis: null,
        };
      }

      const d = detailsByBodyId[String(r.bodyId)];
      const orbitPrimaryKey = orbitPrimaryKeyFromRecord(r, starsOrderedByBodyId, starSystemName);
      const journalStellarNode = explorationRecordIsStellar(r);
      const isHubStar = isStarOnSystemMap(r, starSystemName);
      const baseLabel = shortLabel(r, starSystemName);
      let mapLabel = baseLabel;
      let namePlus = false;
      let starVisual: "default" | "neutron" = "default";
      if (isHubStar || journalStellarNode) {
        mapLabel = spectralDiscGlyph(r.starType, r.subclass, r.planetClass);
        if (d?.starRole === "neutron_boost") {
          mapLabel = `${mapLabel}++`;
          starVisual = "neutron";
        }
        namePlus = d?.starRole === "fuel";
      } else {
        if (!r.isSynthetic) {
          if (terraformableFromRecord(r)) mapLabel = `${mapLabel}*`;
          const tier = d?.exoValueTier ?? 0;
          if (tier === 2) mapLabel = `${mapLabel}++`;
          else if (tier === 1) mapLabel = `${mapLabel}+`;
        } else {
          mapLabel = "?";
        }
      }

      const isUnexplored = r.wasDiscovered === false;

      return {
        bodyId: r.bodyId,
        bodyName: shortBodyLabel(r.bodyName, starSystemName),
        label: baseLabel,
        mapLabel,
        isStar: isHubStar,
        journalStellar: journalStellarNode,
        hasExobiology: d?.hasExobiology ?? false,
        valuePlus: d?.valuePlus ?? false,
        maxExoHeuristicCredits: d?.maxExoHeuristicCredits ?? 0,
        exoValueTier: d?.exoValueTier ?? 0,
        namePlus,
        starVisual,
        orbitPrimaryKey,
        children,
        isInferredPlaceholder: !!r.isSynthetic,
        semiMajorAxis:
          typeof r.semiMajorAxis === "number" && Number.isFinite(r.semiMajorAxis) ? r.semiMajorAxis : null,
        isArrivalBody: arrivalBodyId != null && r.bodyId === arrivalBodyId,
        isUnexplored,
      };
    } finally {
      visiting.delete(bodyId);
    }
  }

  const tree = rootIds
    .map((id) => mapSubTree(id, new Set<number>()))
    .filter((n): n is SystemMapNodeDTO => n != null);

  const roughTotals = approximateSystemRoughFssDssTotals(store, focusSystemAddress, recs);
  const journalSaleFocused = estimateExplorationJournalDataCreditsForSystem(store, focusSystemAddress);

  return {
    systemAddress: focusSystemAddress,
    starSystem: starSystemName,
    tree,
    detailsByBodyId,
    totalFss,
    totalDss,
    totalFssFirstDiscover: totalFssFd,
    totalDssFirstDiscover: totalDssFd,
    totalDssVersusFssUplift: totalDssVersusFssUplift,
    formulaAttribution: "",
    approxSystemFssValue: roughTotals.roughSystemFss,
    approxSystemDssValue: roughTotals.roughSystemDss,
    journalExplorationSaleCreditsFocused: journalSaleFocused,
  };
}
