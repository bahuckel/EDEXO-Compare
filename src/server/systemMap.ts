import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExplorationScanRecord,
  PrimaryStarHeaderEntryDTO,
  PrimaryStarsHeaderDTO,
  SpeciesDatabase,
  StarRoleDTO,
  SystemMapBodyDetailDTO,
  SystemMapNodeDTO,
  SystemMapSnapshot,
} from "../shared/types.js";
import { estimateSurfaceTemperatureRange } from "./surfaceTemperatureRange.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import { formatFullSpectralNotation, spectralDiscGlyph } from "../shared/spectralNotation.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, referenceFssAt1EarthMass, starScanValueCredits } from "./explorationValue.js";
import type { SpatialCatalogue } from "../shared/spatialGates.js";
import { estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import { type PriceIndex } from "./priceList.js";
import { allStarParentIds, directParentBodyId, isBarycentreSyntheticBodyId } from "./orbitUtils.js";
import {
  estimateExplorationJournalDataCreditsForSystem,
  firstMapperForDssPayout,
} from "./explorationDataEstimate.js";
import { approximateSystemRoughFssDssTotals } from "./systemRoughValueEstimate.js";
import { mergeExplorationRecordsWithInferredPlaceholders } from "./inferredSystemMapPlaceholders.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { commanderFirstDiscoveredBody } from "./developerPopulatedSystems.js";
import { footfallCertainty } from "../shared/footfallValue.js";
import { isTerraformableState } from "../shared/terraformState.js";
import {
  isBeltClusterRecord,
  isStarOnSystemMap,
  bodyKey,
  canonicalStarSystemNameForMap,
  buildOrbitChildMapFromJournalChains,
  parentToChildrenFromOrbitChild,
  allIdsInOrbitGraph,
  rootBodyIdsFromOrbitGraph,
  sortChildIdsForSystemMap,
  attachMoonsByParsedDesignation,
  orbitPrimaryKeyFromRecord,
  inferBarycentreDisplayTag,
} from "./systemMapOrbitGraph.js";
import {
  bodyHasJournalExoEvidence,
  exoMatchRun,
  maxExoHeuristicPair,
  buildExoPayoutRangeForRecord,
  scanForMatch,
  exoMatchSummaries,
} from "./systemMapExo.js";
export { exoMarkerBasis, bodyHasJournalExoEvidence, bodyHasExoMarkers } from "./systemMapExo.js";
export type { ExoMarkerBasis } from "./systemMapExo.js";

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
  return isTerraformableState(r.terraformState);
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
    else if (letter && shortLabel.length <= 2 && shortLabel.toUpperCase() === letter.toUpperCase())
      shortLabel = "";
    else if (!letter && (shortLabel === "★" || shortLabel === "Star")) shortLabel = "";
    return {
      letter,
      shortLabel,
      starRole,
      fullSpectralNotation: formatFullSpectralNotation(s.starType, s.subclass, s.luminosity),
      // `H`, and Sagittarius A*'s `SupermassiveBlackHole`, which no list entry names.
      ...(cfg.blackHoleExact.some((x) => x.toUpperCase() === (s.starType ?? "").trim().toUpperCase()) ||
      /blackhole/i.test(s.starType ?? "")
        ? { blackHole: true as const }
        : {}),
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

/**
 * Every exploration record we hold for a system — **including the ones already sold**.
 *
 * Selling exploration data pays the commander and moves nothing in space, but the store files those
 * rows under `soldExplorationScans`, and the system map and the star header read only
 * `explorationScans`. So a commander who cashed in their data lost the orbital view of their own
 * home system: the map button disappears with the star header it hangs off, and nothing says why.
 *
 * Measured on the owner's logs: replaying up to 2026-05-15 leaves 42 Swoilz KI-E b4-9 records and a
 * working map. Adding the next file — which carries a `MultiSellExplorationData` for 38 of its
 * bodies — leaves **zero**, and `buildSystemMapSnapshot` returns null from then on.
 *
 * `systemExplorationScanIndex` already made this call for host-star resolution, in those words:
 * *"selling the data does not move the star"*. It is just as true of the map.
 *
 * Live rows win over sold ones where both exist, and EDSM fills in only when we hold nothing of our
 * own — the same order the map used before, with the sold archive added to the "our own" side.
 */
export function explorationRecordsForSystem(
  store: GameStateStore,
  systemAddress: number,
): ExplorationScanRecord[] {
  const prefix = `${systemAddress}:`;
  const byBodyId = new Map<number, ExplorationScanRecord>();
  for (const [key, r] of store.soldExplorationScans) if (key.startsWith(prefix)) byBodyId.set(r.bodyId, r);
  for (const [key, r] of store.explorationScans) if (key.startsWith(prefix)) byBodyId.set(r.bodyId, r);
  if (byBodyId.size > 0) return [...byBodyId.values()];
  for (const [key, r] of store.edsmExplorationByKey) if (key.startsWith(prefix)) byBodyId.set(r.bodyId, r);
  if (byBodyId.size > 0) return [...byBodyId.values()];
  // A system looked up from Spansh and never flown to (remoteSystems.ts).
  return [...(store.remoteSystems.get(systemAddress)?.records ?? [])];
}

export function buildSystemMapSnapshot(
  store: GameStateStore,
  focusSystemAddress: number | null,
  db: SpeciesDatabase,
  cfg: StarRolesConfig,
  prices: PriceIndex,
  /**
   * Phase 7 point catalogues, threaded from the caller rather than loaded here.
   *
   * The map's value tiers and its per-body species lists come from the same matcher as the detail
   * panel. Leaving the catalogue out here did not make the map neutral — it made it *disagree*: a
   * body could be coloured rich, and listed as holding Electricae radialem, by a candidate the
   * panel beside it had already demoted for sitting 175 ly from the nearest nebula.
   */
  spatialCatalogue: SpatialCatalogue | null,
): SystemMapSnapshot | null {
  if (focusSystemAddress == null) return null;
  /** Narrowed copy: the closures below lose the null-check on the captured parameter. */
  const focusAddr: number = focusSystemAddress;
  const allRecs = explorationRecordsForSystem(store, focusSystemAddress);
  /*
    Belt clusters are not bodies on the map, but the belt is: the game draws it between the star and
    its first planet. Counted per star from each cluster's `Parents` ({Ring} then {Star}).
  */
  const beltClustersByStar = new Map<number, number>();
  for (const r of allRecs) {
    if (!isBeltClusterRecord(r) || !Array.isArray(r.parents)) continue;
    for (const p of r.parents as Record<string, unknown>[]) {
      const star = p && typeof p === "object" ? p.Star : undefined;
      if (typeof star === "number") {
        beltClustersByStar.set(star, (beltClustersByStar.get(star) ?? 0) + 1);
        break;
      }
    }
  }
  let recs = allRecs.filter((r) => !isBeltClusterRecord(r));
  if (recs.length === 0) return null;

  const starSystemName = canonicalStarSystemNameForMap(recs);
  recs = mergeExplorationRecordsWithInferredPlaceholders(store, focusSystemAddress, recs, starSystemName);

  /** The star a body falls back to when its own orbit cannot be resolved: the one you arrive at. */
  const arrivalStarRecord = recs.find((r) => r.starType && !((r.distanceFromArrivalLs ?? 0) > 0)) ?? null;
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
        surfaceTemperatureRangeK: null,
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
    const exo = store.bioBodyState(bk);
    const hasExo = exo ? bodyHasJournalExoEvidence(exo) : false;
    const tf = terraformableFromRecord(r);
    const mass = r.massEM ?? 1;
    const isStar = isStarOnSystemMap(r, starSystemName);
    const journalStellar = explorationRecordIsStellar(r);

    const fd = commanderFirstDiscoveredBody(r.systemAddress, r.wasDiscovered);

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

    /*
     * One matcher run for the three things the map asks about this body.
     *
     * The value tier, the payout range and the candidate list want the same answer, and they used to
     * fetch it separately — 81 runs of the matcher on a 27-body system to produce 27 results, each
     * rebuilding the same context and walking the same 108 species.
     */
    const matchRun = exoMatchRun(store, db, r, spatialCatalogue);
    const maxExo = maxExoHeuristicPair(store, prices, r, matchRun);
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
      estimatedSurfaceTempK: est != null ? { minK: est.tMin, maxK: est.tMax, midK: est.tMid } : null,
      surfaceTemperatureRangeK: estimateSurfaceTemperatureRange(r, byId, arrivalStarRecord),
      exoMatchSummaries: exoMatchSummaries(matchRun),
      maxExoHeuristicCredits: maxExo.displayMax,
      exoValueTier: exoTier,
      exoPayoutRange: buildExoPayoutRangeForRecord(store, prices, r, matchRun),
      parentBodyId,
      parentStarIds,
      isInferredPlaceholder: !!r.isSynthetic,
    };
  }

  const starsOrderedByBodyId = recs
    .filter((r) => isStarOnSystemMap(r, starSystemName))
    .sort((a, b) => a.bodyId - b.bodyId);
  const starLetterMap = new Map(starsOrderedByBodyId.map((s, i) => [s.bodyId, String.fromCharCode(65 + i)]));
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
            surfaceTemperatureRangeK: null,
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
          surfaceTemperatureRangeK: null,
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

      const isUnexplored = commanderFirstDiscoveredBody(r.systemAddress, r.wasDiscovered);

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
        ...(isHubStar && beltClustersByStar.get(r.bodyId)
          ? { beltClusters: beltClustersByStar.get(r.bodyId) }
          : {}),
        ...(() => {
          const bk = bodyKey(r.systemAddress, r.bodyId);
          const bio = store.bioBodyState(bk)?.biologicalSignals ?? null;
          const pr = d?.exoPayoutRange ?? null;
          const x5 =
            pr != null &&
            footfallCertainty({
              journalWasFootfalled: pr.journalWasFootfalled,
              commanderFirstFootfall: pr.commanderFirstFootfall,
            }) === "unwalked";
          const ringed = !isHubStar && !journalStellarNode && (r.ringCount ?? 0) > 0;
          return {
            ...(bio != null && bio > 0 ? { bioSignals: bio } : {}),
            ...(ringed ? { rings: r.ringCount } : {}),
            ...(x5 ? { firstFootfallX5: true } : {}),
            ...(store.currentBodyKey === bk ? { youAreHere: true } : {}),
          };
        })(),
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
