/**
 * `presence_any_of` — the one "or" in the condition format, evaluated in one place.
 *
 * Every other key on a conditions object is ANDed. This one takes a list of branches and asks the
 * body to satisfy at least one; Bacterium tela is why it exists (volcanism, or 300 K, and on neither
 * alone — see `docs/tela-decision-20092026.md`).
 *
 * It lives in `shared/` rather than in the matcher because **two surfaces have to agree about it**:
 * the matcher, which excludes on it, and the encyclopedia's spawn-condition cards, which explain it.
 * The cards are otherwise a second implementation of the matcher's logic, and when this rule shipped
 * only in the matcher the encyclopedia went on drawing a single blue "Match" on bodies the species
 * had just been excluded from. One module, both callers, no drift.
 */
import type { PlanetScan, SpeciesCriterion } from "./types.js";
import { journalSurfaceGravityToG } from "./journalPhysics.js";

export interface PresenceTemperatureBand {
  minK: number;
  maxK: number;
}

/**
 * The fields a presence branch may carry.
 *
 * Anything outside this list is **ignored** by {@link evaluatePresenceBranch}, and a branch whose
 * only requirement is ignored passes on every body — the rule would disappear without a test
 * failing. `tests/presenceAnyOf.test.ts` walks every shipped branch against this list so that cannot
 * happen quietly; extend both together.
 *
 * Atmosphere is deliberately **not** here. The main path's atmosphere verdict is not a comparison —
 * it folds `…Rich` suffixes, reads composition rather than the type label, consults the thin-pressure
 * category and lets observation argue — and a plain-comparison copy of it inside a branch would
 * agree with it on most bodies and disagree on exactly the awkward ones. A branch that needs an
 * atmosphere should wait until that logic can be shared rather than approximated.
 */
export const PRESENCE_BRANCH_FIELDS = [
  "volcanismActiveRequired",
  "surfaceTemperatureK",
  "planetClassAnyOf",
  "surfaceGravity",
  "surfacePressure",
  "landable",
] as const satisfies readonly (keyof SpeciesCriterion)[];

function inRange(v: number, min?: number, max?: number): boolean {
  if (min !== undefined && v < min) return false;
  if (max !== undefined && v > max) return false;
  return true;
}

/** `Volcanism` absent, empty, or saying "no volcanism" all read false. Matches the matcher's rule. */
export function presenceReportsAnyVolcanism(scan: PlanetScan): boolean {
  const raw = scan.Volcanism;
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (!v) return false;
  return !v.toLowerCase().includes("no volcanism");
}

function bandsOverlap(planet: PresenceTemperatureBand, lo: number, hi: number): boolean {
  return planet.minK <= hi && lo <= planet.maxK;
}

/**
 * One branch against one body: every field it carries has to pass, in plain comparisons.
 *
 * Returns the reason it passed, or null. No tolerance and no observation rescue anywhere in here —
 * see {@link SpeciesCriterion.presenceAnyOf} for why both would defeat the purpose.
 */
export function evaluatePresenceBranch(
  b: SpeciesCriterion,
  scan: PlanetScan,
  planetTempBand: PresenceTemperatureBand | null,
): string | null {
  const parts: string[] = [];

  if (b.volcanismActiveRequired === true) {
    if (!presenceReportsAnyVolcanism(scan)) return null;
    parts.push(`volcanism present (${scan.Volcanism})`);
  }

  if (b.surfaceTemperatureK) {
    const { min, max } = b.surfaceTemperatureK;
    const measured = scan.SurfaceTemperature;
    if (typeof measured === "number" && Number.isFinite(measured)) {
      if (!inRange(measured, min, max)) return null;
      parts.push(`${measured.toFixed(1)} K`);
    } else if (planetTempBand) {
      /*
        No thermometer. The estimated band is allowed to answer, because refusing every unscanned
        body would hide the species from the FSS list where it is most useful — but it answers on
        overlap, which is the weakest reading that is still honest.
      */
      if (!bandsOverlap(planetTempBand, min ?? -Infinity, max ?? Infinity)) return null;
      parts.push(`estimated ${planetTempBand.minK.toFixed(0)}–${planetTempBand.maxK.toFixed(0)} K`);
    } else {
      return null;
    }
  }

  if (b.planetClassAnyOf?.length) {
    if (!scan.PlanetClass || !b.planetClassAnyOf.includes(scan.PlanetClass)) return null;
    parts.push(scan.PlanetClass);
  }

  if (b.surfaceGravity && (b.surfaceGravity.min !== undefined || b.surfaceGravity.max !== undefined)) {
    const gRaw = scan.SurfaceGravity;
    if (gRaw === undefined || gRaw === null) return null;
    const g = journalSurfaceGravityToG(gRaw);
    if (!inRange(g, b.surfaceGravity.min, b.surfaceGravity.max)) return null;
    parts.push(`${g.toFixed(3)} g`);
  }

  if (b.surfacePressure && (b.surfacePressure.min !== undefined || b.surfacePressure.max !== undefined)) {
    const p = scan.SurfacePressure;
    if (
      typeof p !== "number" ||
      !Number.isFinite(p) ||
      !inRange(p, b.surfacePressure.min, b.surfacePressure.max)
    )
      return null;
    parts.push(`${p.toFixed(3)} atm`);
  }

  if (b.landable !== undefined) {
    if (scan.Landable !== b.landable) return null;
    parts.push(b.landable ? "landable" : "not landable");
  }

  return parts.length ? parts.join(", ") : null;
}

/** How a branch reads on its own, before any body is compared to it. */
export function describePresenceBranch(b: SpeciesCriterion): string {
  const parts: string[] = [];
  if (b.volcanismActiveRequired === true) parts.push("volcanism present");
  if (b.surfaceTemperatureK) {
    const { min, max } = b.surfaceTemperatureK;
    if (min !== undefined && max !== undefined) parts.push(`surface temperature ${min}–${max} K`);
    else if (min !== undefined) parts.push(`surface temperature ≥ ${min} K`);
    else if (max !== undefined) parts.push(`surface temperature ≤ ${max} K`);
  }
  if (b.planetClassAnyOf?.length) parts.push(b.planetClassAnyOf.join(" / "));
  if (b.surfaceGravity) parts.push(`${b.surfaceGravity.min ?? "−∞"}…${b.surfaceGravity.max ?? "∞"} g`);
  if (b.surfacePressure) parts.push(`${b.surfacePressure.min ?? "−∞"}…${b.surfacePressure.max ?? "∞"} atm`);
  if (b.landable !== undefined) parts.push(b.landable ? "landable" : "not landable");
  return parts.join(" and ") || "no requirement";
}

/** Every branch, joined the way the failure message and the card both want to read it. */
export function describePresenceBranches(branches: readonly SpeciesCriterion[]): string {
  return branches.map(describePresenceBranch).join(", or ");
}

/** What the body actually has, for the other half of the failure sentence. */
export function describeBodyForPresence(scan: PlanetScan): string {
  const volc = presenceReportsAnyVolcanism(scan) ? scan.Volcanism : "No volcanism";
  const t = scan.SurfaceTemperature;
  const temp = typeof t === "number" && Number.isFinite(t) ? `${t.toFixed(1)} K` : "no temperature reading";
  return `${volc}, ${temp}`;
}
