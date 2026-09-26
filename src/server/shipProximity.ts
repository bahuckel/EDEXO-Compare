/**
 * How far each biological body is from where the ship is — the "Closest" body sort (owner,
 * 2026-09-26, Discord batch O-F).
 *
 * His flow: jump in, work the bodies nearest the arrival star first; land; then see which body is
 * next from the one he is on. So there are two bases:
 *
 * - **arrival** — the ship is at the arrival star (just jumped in, or at a body the journal cannot
 *   place). Each body's own `DistanceFromArrivalLS` is the answer: the game measured it.
 * - **orbits** — the ship is at another body (`GameStateStore.currentBodyKey`: approached, dropped
 *   out at, or landed on). The journal has no position for either end, so the distance is estimated
 *   from the orbit tree: climb both bodies to the object they share, and take their orbit radii
 *   around it.
 *
 * **Why not real positions.** Every Scan carries a full set of Keplerian elements and the mean
 * anomaly does advance exactly with the period (checked on 105 re-scanned bodies, to 1e-5°). But
 * the positions they give do not match the game's own distances: over 5,295 moons of planets round
 * an arrival star in his journals, the predicted "moon nearer or further than its planet" had zero
 * correlation (|r| < 0.03) with the measured `DistanceFromArrivalLS`, under every sign and angle
 * convention tried. Phases of two different orbits cannot be combined, so the unknown angle between
 * them is averaged instead: the mean distance between two points on circles of radius a and b round
 * the same centre. Two stars of one pair share a period and sit opposite each other, so theirs is
 * a + b exactly.
 */
import type { BodyComputed, ExplorationScanRecord, ShipProximityDTO } from "../shared/types.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import {
  barycentreSyntheticBodyId,
  isBarycentreSyntheticBodyId,
  parseJournalParentEntry,
} from "./orbitUtils.js";

const LIGHT_SECOND_M = 299_792_458;

/** Parent of every orbit in the system, from the `Parents` chains (a barycentre has no scan of its own that names one). */
function parentMap(recs: ExplorationScanRecord[]): Map<number, number> {
  const parent = new Map<number, number>();
  for (const r of recs) {
    if (!Array.isArray(r.parents)) continue;
    const chain = [r.bodyId];
    for (const entry of r.parents) {
      const p = parseJournalParentEntry(entry);
      if (!p) break;
      chain.push(p.kind === "Null" ? barycentreSyntheticBodyId(p.id) : p.id);
    }
    for (let i = 0; i + 1 < chain.length; i++) {
      if (!parent.has(chain[i]!)) parent.set(chain[i]!, chain[i + 1]!);
    }
  }
  return parent;
}

function ancestry(id: number, parent: Map<number, number>): number[] {
  const out = [id];
  for (let i = 0; i < 64; i++) {
    const p = parent.get(out[out.length - 1]!);
    if (p === undefined) break;
    out.push(p);
  }
  return out;
}

/**
 * Mean distance between a point on a circle of radius `a` and one on a circle of radius `b`, same
 * centre, same plane, the angle between them unknown. 0 when both are 0; the other radius when one is.
 */
export function meanSeparation(a: number, b: number): number {
  if (a <= 0) return Math.max(0, b);
  if (b <= 0) return a;
  const N = 64;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * Math.PI;
    sum += Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(t));
  }
  return sum / N;
}

/**
 * Estimated distance in light seconds between two bodies of one system, from their orbits. Null when
 * the tree does not reach far enough (no shared ancestor, or an orbit on the way with no radius).
 */
export function orbitDistanceLs(
  fromId: number,
  toId: number,
  byId: Map<number, ExplorationScanRecord>,
  parent: Map<number, number>,
): number | null {
  if (fromId === toId) return 0;
  const a = ancestry(fromId, parent);
  const b = ancestry(toId, parent);
  const inA = new Set(a);
  const lcaAt = b.findIndex((id) => inA.has(id));
  if (lcaAt < 0) return null;
  const lca = b[lcaAt]!;
  const branchA = a.indexOf(lca) > 0 ? a[a.indexOf(lca) - 1]! : null;
  const branchB = lcaAt > 0 ? b[lcaAt - 1]! : null;
  const radius = (id: number | null): number | null => {
    if (id === null) return 0;
    const sma = byId.get(id)?.semiMajorAxis;
    return typeof sma === "number" && Number.isFinite(sma) && sma > 0 ? sma / LIGHT_SECOND_M : null;
  };
  const ra = radius(branchA);
  const rb = radius(branchB);
  if (ra === null || rb === null) return null;
  if (branchA !== null && branchB !== null && isBarycentreSyntheticBodyId(lca)) {
    const pa = byId.get(branchA)?.orbitalPeriod;
    const pb = byId.get(branchB)?.orbitalPeriod;
    // One pair round a barycentre: the very same period, always on opposite sides.
    if (typeof pa === "number" && typeof pb === "number" && pa > 0 && Math.abs(pa - pb) / pa < 1e-6) {
      return ra + rb;
    }
  }
  return meanSeparation(ra, rb);
}

export function buildShipProximity(
  currentBodyKey: string | null,
  focusAddr: number | null,
  recs: ExplorationScanRecord[],
  bodies: BodyComputed[],
): ShipProximityDTO | null {
  if (focusAddr == null || bodies.length === 0) return null;
  const byId = new Map(recs.map((r) => [r.bodyId, r]));
  const arrival = recs.find((r) => r.distanceFromArrivalLs === 0 && !r.isBarycentreJournal) ?? null;
  const sysName = arrival?.starSystem || bodies[0]!.state.starSystem || "";
  const label = (r: ExplorationScanRecord | null) =>
    r ? shortBodyLabel(r.bodyName, sysName) || r.bodyName : null;

  const prefix = `${focusAddr}:`;
  const atId =
    currentBodyKey && currentBodyKey.startsWith(prefix) ? Number(currentBodyKey.slice(prefix.length)) : NaN;
  const at = Number.isFinite(atId) ? (byId.get(atId) ?? null) : null;

  const arrivalLs = (b: BodyComputed): number | null => {
    const d = b.mergedScan?.distanceFromArrivalLs ?? byId.get(b.state.bodyId)?.distanceFromArrivalLs;
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  };

  const distanceLsByBodyKey: Record<string, number> = {};
  if (!at || at.distanceFromArrivalLs === 0) {
    for (const b of bodies) {
      const d = arrivalLs(b);
      if (d !== null) distanceLsByBodyKey[b.state.key] = d;
    }
    return {
      originBodyKey: arrival ? `${focusAddr}:${arrival.bodyId}` : null,
      originLabel: label(arrival),
      basis: "arrival",
      distanceLsByBodyKey,
    };
  }

  const parent = parentMap(recs);
  const atArrival = at.distanceFromArrivalLs;
  for (const b of bodies) {
    let d = orbitDistanceLs(at.bodyId, b.state.bodyId, byId, parent);
    if (d === null) {
      // Not enough orbit data on the way: the two arrival distances still bound it from below.
      const da = arrivalLs(b);
      if (da !== null && typeof atArrival === "number") d = Math.abs(da - atArrival);
    }
    if (d !== null) distanceLsByBodyKey[b.state.key] = d;
  }
  return {
    originBodyKey: `${focusAddr}:${at.bodyId}`,
    originLabel: label(at),
    basis: "orbits",
    distanceLsByBodyKey,
  };
}
