import type { PlanetScan } from "../shared/types.js";
import {
  estimateTemperatureRange,
  type BodyClass,
  type PlanetInput,
  type TemperatureRange,
} from "../shared/temperatureRangeEstimator.js";

const AU_M = 149_597_870_700;

export function journalSemiMajorAxisToAU(meters: number | undefined): number | undefined {
  if (meters == null || meters <= 0) return undefined;
  return meters / AU_M;
}

function hasMeaningfulVolcanism(scan: PlanetScan): boolean {
  const v = (scan.Volcanism ?? "").trim().toLowerCase();
  if (!v) return false;
  return !v.includes("no volcanism") && v !== "none";
}

export { normalizeScanAtmosphereForMatch, atmosphereCompositionKey } from "../shared/scanAtmosphereMatch.js";

/**
 * Thickness comes from `Atmosphere`, not `AtmosphereType`.
 *
 * `AtmosphereType` is the *composition* — `Ammonia`, `SulphurDioxide`, `NeonRich` — and the journal
 * puts the thickness in `Atmosphere`: "thin ammonia atmosphere", "hot thick carbon dioxide
 * atmosphere". Reading only the former meant this returned `thin` **never**: across 6,750 scans in
 * the owner's journals, `AtmosphereType` contains "thin" zero times while `Atmosphere` contains it
 * 2,023 times. Every thin-atmosphere body in the game was being classified as thick.
 *
 * That fed two things. `inferBodyClass` could never select `rocky_thin_atmo`, so the temperature
 * estimator used the wrong class for exactly the bodies exobiology cares about; and the "any thin
 * atmosphere" gate fell back on it whenever no measured surface pressure was available.
 *
 * `AtmosphereType` is still checked first: EDSM-hydrated records spell it `Thin Argon`, and a
 * caller may hand us either vocabulary.
 */
export function atmosphereBucketForEstimator(scan: PlanetScan): "none" | "thin" | "thick" {
  const t = (scan.AtmosphereType ?? "").trim().toLowerCase();
  const a = (scan.Atmosphere ?? "").trim().toLowerCase();
  const noType = !t || t === "none" || t.includes("no atmosphere");
  const noText = !a || a === "none" || a.includes("no atmosphere");
  if (noType && noText) return "none";
  if (t.includes("thin") || a.includes("thin")) return "thin";
  return "thick";
}

export function inferBodyClass(scan: PlanetScan): BodyClass | null {
  const pc = (scan.PlanetClass ?? "").trim().toLowerCase();
  const surf = scan.SurfaceTemperature;
  const atmo = atmosphereBucketForEstimator(scan);

  if (pc.includes("icy")) return "icy";
  if (pc.includes("high metal content") || pc.includes("metal rich")) {
    if (surf != null && surf > 600) return "high_metal_hot";
    return "rocky_standard";
  }
  if (pc.includes("rocky")) {
    if (atmo === "thin") return "rocky_thin_atmo";
    if (surf != null && surf < 220) return "rocky_cold";
    return "rocky_standard";
  }
  if (surf != null && surf < 200) return "icy";
  if (surf != null && surf > 500) return "high_metal_hot";
  if (pc.includes("metal")) return "rocky_standard";
  return null;
}

export function planetInputFromScan(scan: PlanetScan): PlanetInput | null {
  const bodyClass = inferBodyClass(scan);
  if (!bodyClass) return null;
  return {
    surfaceTemperature: scan.SurfaceTemperature,
    semiMajorAxisAU: journalSemiMajorAxisToAU(scan.SemiMajorAxis),
    tidalLock: scan.TidalLock === true,
    volcanism: hasMeaningfulVolcanism(scan),
    atmosphere: atmosphereBucketForEstimator(scan),
    bodyClass,
  };
}

export function estimatedTemperatureRangeForScan(scan: PlanetScan): TemperatureRange | null {
  const input = planetInputFromScan(scan);
  if (!input) return null;
  return estimateTemperatureRange(input);
}
