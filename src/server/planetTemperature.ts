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

export function atmosphereBucketForEstimator(scan: PlanetScan): "none" | "thin" | "thick" {
  const t = (scan.AtmosphereType ?? "").trim().toLowerCase();
  if (!t || t === "none" || t.includes("no atmosphere")) return "none";
  if (t.includes("thin")) return "thin";
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
