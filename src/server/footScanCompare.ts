/**
 * A body compared field by field with a species' foot-catalog finds (the 'Found in your catalog' rows). Split out of footScannedCatalog.ts (code review D, 2026-09-27).
 */
import { journalPressureToAtm } from "../shared/journalPhysics.js";
import type {
  FootScanFieldRow,
  FootScanHitDetail,
  FootScanMatchPayload,
  FootScannedEntry,
  PlanetScan,
  SpeciesCriterion,
  SpeciesEntry,
} from "../shared/types.js";
import { estimatedTemperatureRangeForScan, normalizeScanAtmosphereForMatch } from "./planetTemperature.js";

export const REL_TOLERANCE = 0.1;

export function withinRelative(a: number, b: number, frac: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const denom = Math.max(Math.abs(b), 1e-6);
  return Math.abs(a - b) / denom <= frac;
}

type FootScanAspect = "planetClass" | "atmosphere" | "temperature" | "pressure" | "gravity";

function criterionSpecifiesAspect(c: SpeciesCriterion, aspect: FootScanAspect): boolean {
  switch (aspect) {
    case "planetClass":
      return !!c.planetClassAnyOf?.length;
    case "atmosphere":
      return !!c.atmosphereTypeAnyOf?.length;
    case "temperature":
      return !!(
        c.surfaceTemperatureK &&
        (c.surfaceTemperatureK.min != null || c.surfaceTemperatureK.max != null)
      );
    case "pressure":
      return !!(c.surfacePressure && (c.surfacePressure.min != null || c.surfacePressure.max != null));
    case "gravity":
      return !!(c.surfaceGravity && (c.surfaceGravity.min != null || c.surfaceGravity.max != null));
    default:
      return false;
  }
}

function formatTemperatureScanDisplay(scan: PlanetScan): string {
  const est = estimatedTemperatureRangeForScan(scan);
  if (est) {
    return `${Math.round(est.tMin)} · ${Math.round(est.tMax)} K (mid ${Math.round(est.tMid)})`;
  }
  if (scan.SurfaceTemperature != null && Number.isFinite(scan.SurfaceTemperature)) {
    return `${Math.round(scan.SurfaceTemperature)} K`;
  }
  return "—";
}

function formatTemperatureRowDisplay(row: FootScannedEntry): string {
  return `${Math.round(row.tempBandMinK)} · ${Math.round(row.tempBandMaxK)} K (mid ${Math.round(row.tempMidK)})`;
}

function atmosphereScanDisplay(scan: PlanetScan): string {
  const raw = (scan.AtmosphereType || scan.Atmosphere || "").trim();
  return raw || "—";
}

function atmosphereNormDisplay(norm: string): string {
  const t = norm.trim();
  return t === "" ? "None / vacuum" : t;
}

function footComparePlanetClass(scan: PlanetScan, row: FootScannedEntry): boolean {
  return (scan.PlanetClass ?? "").trim() === row.planetClass.trim();
}

function footCompareAtmosphere(scan: PlanetScan, row: FootScannedEntry): boolean {
  return normalizeScanAtmosphereForMatch(scan) === row.atmosphereNorm;
}

function footCompareTempMid(scan: PlanetScan, row: FootScannedEntry): boolean {
  const est = estimatedTemperatureRangeForScan(scan);
  let curMid: number | null = null;
  if (est) curMid = est.tMid;
  else if (scan.SurfaceTemperature != null && Number.isFinite(scan.SurfaceTemperature))
    curMid = scan.SurfaceTemperature;
  if (curMid == null) return false;
  return withinRelative(curMid, row.tempMidK, REL_TOLERANCE);
}

function footComparePressure(scan: PlanetScan, row: FootScannedEntry): boolean {
  const pScan = scan.SurfacePressure;
  const pEntry = row.surfacePressure;
  if (pScan == null || !Number.isFinite(pScan) || pEntry == null || !Number.isFinite(pEntry)) return true;
  return withinRelative(pScan, pEntry, REL_TOLERANCE);
}

function footCompareGravity(scan: PlanetScan, row: FootScannedEntry): boolean {
  const gScan = scan.SurfaceGravity;
  const gRow = row.surfaceGravityMs2;
  if (gScan == null || !Number.isFinite(gScan) || gRow == null || !Number.isFinite(gRow)) return true;
  return withinRelative(gScan, gRow, REL_TOLERANCE);
}

function buildFootScanFieldRows(
  scan: PlanetScan,
  row: FootScannedEntry,
  criteria: SpeciesCriterion,
): FootScanFieldRow[] {
  return [
    {
      key: "planetClass",
      label: "Planet class",
      currentDisplay: (scan.PlanetClass ?? "").trim() || "—",
      catalogDisplay: row.planetClass.trim() || "—",
      matches: footComparePlanetClass(scan, row),
      speciesCriteriaIncludes: criterionSpecifiesAspect(criteria, "planetClass"),
    },
    {
      key: "atmosphere",
      label: "Atmosphere type",
      currentDisplay: atmosphereScanDisplay(scan),
      catalogDisplay: atmosphereNormDisplay(row.atmosphereNorm),
      matches: footCompareAtmosphere(scan, row),
      speciesCriteriaIncludes: criterionSpecifiesAspect(criteria, "atmosphere"),
    },
    {
      key: "temperature",
      label: "Surface temperature",
      currentDisplay: formatTemperatureScanDisplay(scan),
      catalogDisplay: formatTemperatureRowDisplay(row),
      matches: footCompareTempMid(scan, row),
      speciesCriteriaIncludes: criterionSpecifiesAspect(criteria, "temperature"),
    },
    {
      key: "pressure",
      label: "Surface pressure",
      currentDisplay:
        scan.SurfacePressure != null && Number.isFinite(scan.SurfacePressure)
          ? `${journalPressureToAtm(scan.SurfacePressure).toPrecision(4)} atm`
          : "—",
      catalogDisplay:
        // Both the scan and the catalog row hold the journal's pascals.
        row.surfacePressure != null && Number.isFinite(row.surfacePressure)
          ? `${journalPressureToAtm(row.surfacePressure).toPrecision(4)} atm`
          : "—",
      matches: footComparePressure(scan, row),
      speciesCriteriaIncludes: criterionSpecifiesAspect(criteria, "pressure"),
    },
    {
      key: "gravity",
      label: "Surface gravity",
      currentDisplay:
        scan.SurfaceGravity != null && Number.isFinite(scan.SurfaceGravity)
          ? `${scan.SurfaceGravity.toFixed(3)} m/s²`
          : "—",
      catalogDisplay:
        row.surfaceGravityMs2 != null && Number.isFinite(row.surfaceGravityMs2)
          ? `${row.surfaceGravityMs2.toFixed(3)} m/s²`
          : "—",
      matches: footCompareGravity(scan, row),
      speciesCriteriaIncludes: criterionSpecifiesAspect(criteria, "gravity"),
    },
  ];
}

/** Build structured comparison rows for the UI (this body's scan vs each matching catalog snapshot). */
export function buildFootScanMatchPayload(
  scan: PlanetScan,
  catalogRows: FootScannedEntry[],
  entry: SpeciesEntry,
): FootScanMatchPayload {
  const sorted = [...catalogRows].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const criteria = entry.criteria;
  const hits: FootScanHitDetail[] = sorted.map((row) => ({
    bodyName: row.bodyName,
    starSystem: row.starSystem,
    recordedAt: row.recordedAt,
    confirmationSource: row.confirmationSource ?? "analyse",
    fieldRows: buildFootScanFieldRows(scan, row, criteria),
  }));
  return { hits };
}
