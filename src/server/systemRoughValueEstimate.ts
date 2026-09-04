/**
 * Lightweight FSS/DSS heuristic for **planetary bodies** (@see fss-dss-current attachment).
 * Stellar totals use {@link starScanValueCredits}; belt clusters skipped.
 */

import type { ExplorationScanRecord } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { explorationRecordIsBeltClusterLike, explorationRecordIsStellar } from "./explorationStellar.js";
import { starScanValueCredits } from "./explorationValue.js";

const BASE_VALUES: Record<string, number> = {
  "Earthlike body": 1200000,
  "Water world": 300000,
  "Ammonia world": 600000,
  "High metal content world": 80000,
  "Rocky body": 30000,
  "Icy body": 10000,
  "Metal-rich body": 150000,
  Gas_giant_aggregate: 20000,
};

const MULTIPLIERS = {
  terraformable: 3,
  mapping: 3.333,
  efficiencyBonus: 1.25,
};

function terraformableFromExplorationRecord(r: ExplorationScanRecord): boolean {
  return (r.terraformState ?? "").toLowerCase().includes("terraformable");
}

/** Map Elite `PlanetClass` to coarse bucket used by the attachment script. */
function mapRoughPlanetSubtype(planetClass: string | undefined): string {
  const pc = (planetClass ?? "").trim().toLowerCase();
  if (!pc) return "Rocky body";
  if (pc.includes("earth") && pc.includes("like")) return "Earthlike body";
  if (pc.includes("water world")) return "Water world";
  if (pc.includes("ammonia")) return "Ammonia world";
  if (pc.includes("metal rich")) return "Metal-rich body";
  if (pc.includes("high metal content")) return "High metal content world";
  if (pc.includes("icy")) return "Icy body";
  if (pc.includes("rocky")) return "Rocky body";
  if (pc.includes("gas giant")) return "Gas_giant_aggregate";
  if (pc.includes("sudarsky")) return "Gas_giant_aggregate";
  return "Rocky body";
}

function biologicalWeight(bio: number | null | undefined): number {
  if (bio != null && Number.isFinite(bio)) {
    if (bio >= 3) return 1.2;
    if (bio === 1) return 0.9;
  }
  return 1;
}

interface RoughPlanetRow {
  name: string;
  subType: string;
  terraformable?: boolean;
  mapped?: boolean;
  signals?: number;
}

function getProbabilityWeight(body: RoughPlanetRow): number {
  let weight = biologicalWeight(body.signals);
  if (body.terraformable) weight *= 1.4;
  if (
    body.subType === "Earthlike body" ||
    body.subType === "Water world" ||
    body.subType === "Ammonia world"
  ) {
    weight *= 1.5;
  }
  return weight;
}

function getBaseValue(body: RoughPlanetRow): number {
  const key = body.subType;
  const canonical = BASE_VALUES[key] ?? 5000;
  let value = canonical;
  if (body.terraformable) value *= MULTIPLIERS.terraformable;
  value *= getProbabilityWeight(body);
  return value;
}

function getFSSValue(body: RoughPlanetRow): number {
  return getBaseValue(body);
}

function getDSSValue(body: RoughPlanetRow): number {
  return getBaseValue(body) * MULTIPLIERS.mapping * MULTIPLIERS.efficiencyBonus;
}

function getCurrentValue(body: RoughPlanetRow): number {
  let v = getBaseValue(body);
  if (body.mapped) v *= MULTIPLIERS.mapping * MULTIPLIERS.efficiencyBonus;
  return v;
}

export function approximatePlanetaryRoughFromAttachment(recs: RoughPlanetRow[]): {
  fss: number;
  dss: number;
  current: number;
} {
  let fss = 0;
  let dss = 0;
  let cur = 0;
  for (const b of recs) {
    fss += getFSSValue(b);
    dss += getDSSValue(b);
    cur += getCurrentValue(b);
  }
  return {
    fss: Math.round(fss),
    dss: Math.round(dss),
    current: Math.round(cur),
  };
}

function bodyKey(sa: number, id: number): string {
  return `${sa}:${id}`;
}

/** Planetary heuristic (attachment) + MattG-ish stars → headline FSS/DSS approximation. */
export function approximateSystemRoughFssDssTotals(
  store: GameStateStore,
  focusSystemAddress: number,
  recs: ExplorationScanRecord[],
): { roughSystemFss: number; roughSystemDss: number } {
  const roughRows: RoughPlanetRow[] = [];
  let starsFss = 0;
  let starsDss = 0;

  for (const r of recs) {
    if (explorationRecordIsBeltClusterLike(r)) continue;
    if (explorationRecordIsStellar(r)) {
      const sm = r.stellarMass ?? 1;
      const fd = r.wasDiscovered === false;
      const sv = starScanValueCredits(sm, r.starType, fd);
      starsFss += sv.value;
      starsDss += sv.value;
      continue;
    }
    if (!r.planetClass?.trim()) continue;
    const bk = bodyKey(focusSystemAddress, r.bodyId);
    const bio = store.bodies.get(bk)?.biologicalSignals;
    roughRows.push({
      name: r.bodyName,
      subType: mapRoughPlanetSubtype(r.planetClass),
      terraformable: terraformableFromExplorationRecord(r),
      mapped: store.dssMappedBodyKeys.has(bk),
      signals: bio ?? undefined,
    });
  }

  const p = approximatePlanetaryRoughFromAttachment(roughRows);
  return {
    roughSystemFss: starsFss + p.fss,
    roughSystemDss: starsDss + p.dss,
  };
}
