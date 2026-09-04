/**
 * Elite Dangerous `Status.json` (same folder as journal): lat/lon on body + planet radius for surface odometer.
 */
import { readFileSync } from "node:fs";
import type { JournalLine } from "../shared/types.js";

export type FootTravelFix = {
  latDeg: number;
  lonDeg: number;
  /** Metres — journal `PlanetRadius`. */
  planetRadiusM: number;
  /** `Status.json` BodyName when on/near a surface — used to gate odometer to the session body. */
  bodyName: string | null;
};

function pickFinite(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Haversine great-circle distance on a sphere of radius R (metres). Inputs in degrees. */
export function greatCircleDistanceMeters(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  radiusM: number,
): number {
  if (!(radiusM > 0 && Number.isFinite(radiusM))) return 0;
  const torad = Math.PI / 180;
  const φ1 = lat1Deg * torad;
  const φ2 = lat2Deg * torad;
  const Δφ = (lat2Deg - lat1Deg) * torad;
  const Δλ = (lon2Deg - lon1Deg) * torad;
  const sΔφ = Math.sin(Δφ / 2);
  const sΔλ = Math.sin(Δλ / 2);
  const a = sΔφ * sΔφ + Math.cos(φ1) * Math.cos(φ2) * sΔλ * sΔλ;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return radiusM * c;
}

/**
 * Some `ScanOrganic` lines include the same lat/lon/radius as `Status.json` when the fix was not readable at ingest.
 */
export function parseScanOrganicLineFootFix(line: JournalLine): FootTravelFix | null {
  const o = line as Record<string, unknown>;
  const lat = pickFinite(o, ["Latitude", "latitude"]);
  const lon = pickFinite(o, ["Longitude", "longitude"]);
  const radius = pickFinite(o, ["PlanetRadius", "planetRadius"]);
  if (lat == null || lon == null || radius == null) return null;
  if (!(radius > 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const bnRaw = o.BodyName;
  const bodyName = typeof bnRaw === "string" && bnRaw.trim() ? bnRaw.trim() : null;
  return { latDeg: lat, lonDeg: lon, planetRadiusM: radius, bodyName };
}

/** Prefer live `Status.json` parse; fall back to coordinates on the journal line. */
export function resolveFootFixForOrganicLine(
  statusFix: FootTravelFix | null,
  line: JournalLine,
): FootTravelFix | null {
  if (
    statusFix &&
    statusFix.planetRadiusM > 0 &&
    Number.isFinite(statusFix.latDeg) &&
    Number.isFinite(statusFix.lonDeg)
  ) {
    return statusFix;
  }
  return parseScanOrganicLineFootFix(line);
}

export function parseStatusJsonFootFix(rawText: string): FootTravelFix | null {
  let j: unknown;
  try {
    j = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const lat = pickFinite(o, ["Latitude", "latitude"]);
  const lon = pickFinite(o, ["Longitude", "longitude"]);
  const radius = pickFinite(o, ["PlanetRadius", "planetRadius"]);
  if (lat == null || lon == null || radius == null) return null;
  if (!(radius > 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const bnRaw = o.BodyName;
  const bodyName = typeof bnRaw === "string" && bnRaw.trim() ? bnRaw.trim() : null;
  return { latDeg: lat, lonDeg: lon, planetRadiusM: radius, bodyName };
}

export type StatusJsonFuelTons = { fuelMain: number; fuelReserve: number };

/** `Status.json` `Fuel.FuelMain` / `Fuel.FuelReservoir` (tonnes). */
export function parseStatusJsonFuel(rawText: string): StatusJsonFuelTons | null {
  let j: unknown;
  try {
    j = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const fuelRaw = o.Fuel ?? o.fuel;
  if (!fuelRaw || typeof fuelRaw !== "object") return null;
  const fuel = fuelRaw as Record<string, unknown>;
  const main = fuel.FuelMain ?? fuel.fuelMain;
  const res = fuel.FuelReservoir ?? fuel.fuelReservoir;
  if (typeof main !== "number" || typeof res !== "number") return null;
  if (!Number.isFinite(main) || !Number.isFinite(res)) return null;
  if (main < 0 || res < 0) return null;
  return { fuelMain: main, fuelReserve: res };
}

export function readStatusJsonFootFix(statusJsonPath: string): FootTravelFix | null {
  let raw: string;
  try {
    raw = readFileSync(statusJsonPath, "utf8");
  } catch {
    return null;
  }
  return parseStatusJsonFootFix(raw);
}
