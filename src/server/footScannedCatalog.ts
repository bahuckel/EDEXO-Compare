import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalLine,
  FootCatalogConfirmation,
  FootScannedEntry,
  FootScannedFile,
  FootScanFieldRow,
  FootScanHitDetail,
  FootScanMatchPayload,
  GenusHint,
  JournalHostStarObservation,
  OrganicGenusLock,
  PlanetScan,
  SpeciesCriterion,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
  DssPhysicalSlackRatios,
} from "../shared/types.js";
import type { PriceIndex } from "./priceList.js";
import {
  buildExomasteryDetail,
  buildExomasteryVarietyHints,
  exomasteryHabitatQualityPercent,
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  resolveExomasteryExportBasename,
} from "./exomasteryProfile.js";
import { estimatedTemperatureRangeForScan, normalizeScanAtmosphereForMatch } from "./planetTemperature.js";
import { matchDatabaseToScan, shownSpeciesMatches, speciesMatchesCriteria } from "./matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "./speciesTreeLoader.js";
import { filterByGenusHints } from "./genusMatchUtils.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { lookupPrice } from "./priceList.js";

const REL_PATH = join("data", "foot_scanned.json");
const REL_TOLERANCE = 0.1;

/**
 * True when a journal line (e.g. `ScanOrganic`) carries planetary fields that should fold into
 * `mergeExplorationScan` so ED Exo merges journal + Spansh/EDSM like a full `Scan`.
 */
export function journalLineCarriesPlanetMetrics(line: JournalLine): boolean {
  const o = line as Record<string, unknown>;
  if (typeof o.PlanetClass === "string" && o.PlanetClass.trim()) return true;
  const numericKeys = [
    o.SurfaceTemperature,
    o.SurfaceGravity,
    o.SurfacePressure,
    o.Radius,
    o.MassEM,
    o.SemiMajorAxis,
    o.Eccentricity,
    o.OrbitalInclination,
    o.Periapsis,
    o.OrbitalPeriod,
    o.AscendingNode,
    o.MeanAnomaly,
    o.RotationPeriod,
    o.AxialTilt,
    (line as Record<string, unknown>).DistanceFromArrivalLS,
  ];
  if (numericKeys.some((x) => typeof x === "number" && Number.isFinite(x as number))) return true;
  if (typeof o.Landable === "boolean") return true;
  for (const s of [o.Atmosphere, o.AtmosphereType, o.TerraformState, o.Volcanism]) {
    if (typeof s === "string" && s.trim()) return true;
  }
  if (Array.isArray(o.Materials) && o.Materials.length > 0) return true;
  if (Array.isArray(o.AtmosphereComposition) && o.AtmosphereComposition.length > 0) return true;
  if (o.Composition && typeof o.Composition === "object" && Object.keys(o.Composition as object).length > 0)
    return true;
  return false;
}

/** Build matcher scan fields from merged journal `Scan` data (any system). */
export function planetScanFromExplorationRecord(r: ExplorationScanRecord): PlanetScan | null {
  if (!r.planetClass?.trim() && !r.atmosphereType?.trim() && !r.atmosphere?.trim()) return null;
  const materials =
    Array.isArray(r.materials) && r.materials.length > 0
      ? (r.materials as PlanetScan["materials"])
      : undefined;
  const atmosphereComposition =
    Array.isArray(r.atmosphereComposition) && r.atmosphereComposition.length > 0
      ? (r.atmosphereComposition as PlanetScan["atmosphereComposition"])
      : undefined;
  const composition =
    r.composition && typeof r.composition === "object"
      ? (r.composition as PlanetScan["composition"])
      : undefined;
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
    materials,
    atmosphereComposition,
    composition,
    radius: r.radius,
    MassEM: r.massEM,
    RotationPeriod: r.rotationPeriod,
    AxialTilt: r.axialTilt,
    OrbitalPeriod: r.orbitalPeriod,
    Eccentricity: r.eccentricity,
    OrbitalInclination: r.orbitalInclination,
    Periapsis: r.periapsis,
    AscendingNode: r.ascendingNode,
    MeanAnomaly: r.meanAnomaly,
    distanceFromArrivalLs: r.distanceFromArrivalLs,
  };
}

function nonemptyMaterials(a: PlanetScan["materials"] | undefined): boolean {
  return Array.isArray(a) && a.length > 0;
}

function nonemptyAtmo(a: PlanetScan["atmosphereComposition"] | undefined): boolean {
  return Array.isArray(a) && a.length > 0;
}

/**
 * Merge {@link BodyExoState.scan} with merged journal exploration data so exomastery sees detailed
 * `Materials` / `AtmosphereComposition` from `Scan` lines even when the body's `PlanetScan` object omits them.
 */
export function mergeScanForExomastery(
  scan: PlanetScan | null | undefined,
  rec: ExplorationScanRecord | null | undefined,
): PlanetScan | null {
  const fromRec = rec ? planetScanFromExplorationRecord(rec) : null;
  const base = scan?.PlanetClass?.trim() ? scan : fromRec;
  if (!base?.PlanetClass?.trim()) return null;
  if (!rec) return base;
  return {
    ...base,
    materials: nonemptyMaterials(base.materials)
      ? base.materials
      : nonemptyMaterials(rec.materials as PlanetScan["materials"])
        ? (rec.materials as PlanetScan["materials"])
        : base.materials,
    atmosphereComposition: nonemptyAtmo(base.atmosphereComposition)
      ? base.atmosphereComposition
      : nonemptyAtmo(rec.atmosphereComposition as PlanetScan["atmosphereComposition"])
        ? (rec.atmosphereComposition as PlanetScan["atmosphereComposition"])
        : base.atmosphereComposition,
    composition: base.composition ?? (rec.composition as PlanetScan["composition"]),
    radius: base.radius ?? rec.radius,
    SemiMajorAxis: base.SemiMajorAxis ?? rec.semiMajorAxis,
    SurfacePressure: base.SurfacePressure ?? rec.surfacePressure,
    SurfaceGravity: base.SurfaceGravity ?? rec.surfaceGravity,
    SurfaceTemperature: base.SurfaceTemperature ?? rec.surfaceTemperature,
    Atmosphere: base.Atmosphere ?? rec.atmosphere,
    AtmosphereType: base.AtmosphereType ?? rec.atmosphereType,
    Volcanism: base.Volcanism ?? rec.volcanism,
    TerraformState: base.TerraformState ?? rec.terraformState,
    Landable: base.Landable ?? rec.landable,
    TidalLock: base.TidalLock ?? rec.tidalLock,
    MassEM: base.MassEM ?? rec.massEM,
    RotationPeriod: base.RotationPeriod ?? rec.rotationPeriod,
    AxialTilt: base.AxialTilt ?? rec.axialTilt,
    OrbitalPeriod: base.OrbitalPeriod ?? rec.orbitalPeriod,
    Eccentricity: base.Eccentricity ?? rec.eccentricity,
    OrbitalInclination: base.OrbitalInclination ?? rec.orbitalInclination,
    Periapsis: base.Periapsis ?? rec.periapsis,
    AscendingNode: base.AscendingNode ?? rec.ascendingNode,
    MeanAnomaly: base.MeanAnomaly ?? rec.meanAnomaly,
    distanceFromArrivalLs: base.distanceFromArrivalLs ?? rec.distanceFromArrivalLs,
  };
}

function genusFold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normOrganicLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function speciesMatchesOrganicLabels(entry: SpeciesEntry, lock: OrganicGenusLock): boolean {
  const nd = normOrganicLabel(entry.displayName);
  const labels = [lock.variantLocalised, lock.speciesLocalised].filter((x): x is string => !!x?.trim());
  for (const lab of labels) {
    const nl = normOrganicLabel(lab);
    if (!nl) continue;
    if (nd === nl) return true;
    if (nd.includes(nl) || nl.includes(nd)) return true;
  }
  return false;
}

function resolveLockToSpeciesId(
  lock: OrganicGenusLock,
  genusDataDir: string,
  db: SpeciesDatabase,
): string | null {
  const cands = db.species.filter((s) => s.genusDataDir === genusDataDir);
  const hits = cands.filter((e) => speciesMatchesOrganicLabels(e, lock));
  if (hits.length === 1) return hits[0]!.id;
  return null;
}

function resolveSpeciesIdFromLock(lock: OrganicGenusLock, db: SpeciesDatabase): string | null {
  const loc = lock.genusLocalised?.trim() || "";
  const sym = lock.genusSymbol?.trim() || "";
  const hint: GenusHint = { Genus_Localised: loc || sym, Genus: sym || loc };
  if (!hint.Genus_Localised?.trim()) return null;
  const narrowed = filterByGenusHints(db.species, [hint]);
  const dirs = new Set(narrowed.map((s) => s.genusDataDir));
  if (dirs.size !== 1) return null;
  const dir = [...dirs][0]!;
  return resolveLockToSpeciesId(lock, dir, db);
}

export function resolveSpeciesEntryFromOrganicLock(
  lock: OrganicGenusLock,
  db: SpeciesDatabase,
): SpeciesEntry | null {
  const id = resolveSpeciesIdFromLock(lock, db);
  if (!id) return null;
  return db.species.find((s) => s.id === id) ?? null;
}

function entryIdFor(systemAddress: number, bodyId: number, lock: OrganicGenusLock): string {
  const g = normOrganicLabel(lock.genusSymbol || lock.genusLocalised);
  const s = normOrganicLabel(lock.speciesSymbol || lock.speciesLocalised);
  const v = normOrganicLabel(lock.variantLocalised);
  return `${systemAddress}:${bodyId}:${g}|${s}|${v}`;
}

function withinRelative(a: number, b: number, frac: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const denom = Math.max(Math.abs(b), 1e-6);
  return Math.abs(a - b) / denom <= frac;
}

function bandMid(minK: number, maxK: number): number {
  return (minK + maxK) / 2;
}

export function isCloseFootScanProfile(scan: PlanetScan, entry: FootScannedEntry): boolean {
  const pc = (scan.PlanetClass ?? "").trim();
  if (!pc || pc !== entry.planetClass.trim()) return false;

  const at = normalizeScanAtmosphereForMatch(scan);
  if (at !== entry.atmosphereNorm) return false;

  const est = estimatedTemperatureRangeForScan(scan);
  let curMin: number;
  let curMax: number;
  if (est) {
    curMin = est.tMin;
    curMax = est.tMax;
  } else if (scan.SurfaceTemperature != null && Number.isFinite(scan.SurfaceTemperature)) {
    const t = scan.SurfaceTemperature;
    curMin = t;
    curMax = t;
  } else {
    return false;
  }
  const curMid = bandMid(curMin, curMax);
  if (!withinRelative(curMid, entry.tempMidK, REL_TOLERANCE)) return false;

  const pScan = scan.SurfacePressure;
  const pEntry = entry.surfacePressure;
  if (pScan != null && Number.isFinite(pScan) && pEntry != null && Number.isFinite(pEntry)) {
    if (!withinRelative(pScan, pEntry, REL_TOLERANCE)) return false;
  }

  return true;
}

/**
 * Parsed catalog, keyed by file path and validated against the file's mtime + size. The file is
 * ~230 KB and was re-read and re-parsed on every snapshot build; the stat that replaces it costs
 * microseconds and still picks up edits made outside the app.
 */
const footCatalogCache = new Map<string, { mtimeMs: number; size: number; file: FootScannedFile }>();

const EMPTY_FOOT_CATALOG: FootScannedFile = { formatVersion: 1, entries: [] };

/** Cheap identity of the catalog file (mtime + size) for cache keys; "0:0" when absent. */
export function footScannedCatalogSignature(projectRoot: string): string {
  try {
    const st = statSync(join(projectRoot, REL_PATH));
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "0:0";
  }
}

export function clearFootScannedCatalogCache(): void {
  footCatalogCache.clear();
}

export function loadFootScannedCatalog(projectRoot: string): FootScannedFile {
  const path = join(projectRoot, REL_PATH);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    footCatalogCache.delete(path);
    return EMPTY_FOOT_CATALOG;
  }

  const cached = footCatalogCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.file;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as FootScannedFile;
    if (!raw || raw.formatVersion !== 1 || !Array.isArray(raw.entries)) {
      footCatalogCache.delete(path);
      return EMPTY_FOOT_CATALOG;
    }
    footCatalogCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, file: raw });
    return raw;
  } catch {
    footCatalogCache.delete(path);
    return EMPTY_FOOT_CATALOG;
  }
}

function persistFootScanned(projectRoot: string, file: FootScannedFile): void {
  const path = join(projectRoot, REL_PATH);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  footCatalogCache.delete(join(projectRoot, REL_PATH));
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
          ? `${scan.SurfacePressure.toPrecision(4)} atm`
          : "—",
      catalogDisplay:
        row.surfacePressure != null && Number.isFinite(row.surfacePressure)
          ? `${row.surfacePressure.toPrecision(4)} atm`
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

function dedupeFootRowsById(rows: FootScannedEntry[]): FootScannedEntry[] {
  const seen = new Set<string>();
  const out: FootScannedEntry[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Deduped foot-catalog rows attributed to this species id (journal-resolved at record time). */
export function footCatalogEntriesForSpecies(
  catalog: FootScannedFile,
  speciesEntryId: string,
): FootScannedEntry[] {
  return dedupeFootRowsById(catalog.entries.filter((e) => e.speciesEntryId === speciesEntryId));
}

function orderedConfirmations(rows: FootScannedEntry[]): FootCatalogConfirmation[] {
  const hasA = rows.some((r) => (r.confirmationSource ?? "analyse") === "analyse");
  const hasS = rows.some((r) => r.confirmationSource === "sample");
  const out: FootCatalogConfirmation[] = [];
  if (hasA) out.push("analyse");
  if (hasS) out.push("sample");
  return out;
}

/**
 * Persist one confirmed exobiology species from `ScanOrganic` (`Analyse` and/or `Sample`) plus planet stats.
 * Runs for **all** merged journal systems when a detailed `Scan` row exists for that body key.
 */
export function recordFootScanned(
  projectRoot: string,
  meta: {
    systemAddress: number;
    bodyId: number;
    bodyName: string;
    starSystem: string;
    scan: PlanetScan;
    lock: OrganicGenusLock;
    ts: string;
    includeBacterium: boolean;
    /** When set, foot-catalog probable species uses same DSS slack as live matching. */
    dssPhysicalSlack?: DssPhysicalSlackRatios;
    confirmationSource: FootCatalogConfirmation;
  },
): void {
  const lock = meta.lock;
  const scan: PlanetScan = {
    ...meta.scan,
    BodyName: meta.bodyName,
    BodyID: meta.bodyId,
    StarSystem: meta.starSystem,
    SystemAddress: meta.systemAddress,
  };

  if (!scan.PlanetClass?.trim()) return;
  if (!lock.genusLocalised?.trim() && !lock.genusSymbol?.trim()) return;
  if (!lock.speciesLocalised?.trim() && !lock.variantLocalised?.trim() && !lock.speciesSymbol?.trim()) return;

  const est = estimatedTemperatureRangeForScan(scan);
  let tempBandMinK: number;
  let tempBandMaxK: number;
  let tempMidK: number;
  if (est) {
    tempBandMinK = est.tMin;
    tempBandMaxK = est.tMax;
    tempMidK = est.tMid;
  } else if (scan.SurfaceTemperature != null && Number.isFinite(scan.SurfaceTemperature)) {
    const t = scan.SurfaceTemperature;
    tempBandMinK = t;
    tempBandMaxK = t;
    tempMidK = t;
  } else {
    return;
  }

  const db = loadSpeciesDatabaseFromTree(projectRoot);
  const speciesEntryId = resolveSpeciesIdFromLock(lock, db);

  const genusHint: GenusHint = {
    Genus_Localised: lock.genusLocalised?.trim() || lock.genusSymbol || "",
    Genus: lock.genusSymbol?.trim() || lock.genusLocalised || "",
  };
  if (!genusHint.Genus_Localised.trim()) return;

  const probableRun = matchDatabaseToScan(db, scan, [genusHint], null, {
    includeBacterium: meta.includeBacterium,
    dssPhysicalSlack: meta.dssPhysicalSlack ?? { temperature: 0, pressure: 0, gravity: 0 },
  });
  const probable = shownSpeciesMatches(probableRun.matches);
  const topProb = probable.find((m) => !m.approximateMatch) ?? probable[0] ?? probableRun.matches[0] ?? null;
  const dbProbableSpeciesId = topProb ? topProb.entry.id : null;
  const dbProbableDisagreed =
    !!speciesEntryId && !!dbProbableSpeciesId && speciesEntryId !== dbProbableSpeciesId;

  const id = entryIdFor(meta.systemAddress, meta.bodyId, lock);
  const row: FootScannedEntry = {
    id,
    recordedAt: meta.ts,
    confirmationSource: meta.confirmationSource,
    planetClass: scan.PlanetClass.trim(),
    atmosphereNorm: normalizeScanAtmosphereForMatch(scan),
    surfacePressure:
      scan.SurfacePressure != null && Number.isFinite(scan.SurfacePressure) ? scan.SurfacePressure : null,
    surfaceTemperatureK:
      scan.SurfaceTemperature != null && Number.isFinite(scan.SurfaceTemperature)
        ? scan.SurfaceTemperature
        : null,
    tempBandMinK,
    tempBandMaxK,
    tempMidK,
    surfaceGravityMs2:
      scan.SurfaceGravity != null && Number.isFinite(scan.SurfaceGravity) ? scan.SurfaceGravity : undefined,
    starSystem: meta.starSystem ?? scan.StarSystem ?? "",
    systemAddress: meta.systemAddress,
    bodyId: meta.bodyId,
    bodyName: meta.bodyName,
    genusLocalised: lock.genusLocalised,
    genusSymbol: lock.genusSymbol,
    speciesLocalised: lock.speciesLocalised,
    speciesSymbol: lock.speciesSymbol,
    variantLocalised: lock.variantLocalised,
    speciesEntryId,
    dbProbableSpeciesId,
    dbProbableDisagreed,
  };

  const file = loadFootScannedCatalog(projectRoot);
  const idx = file.entries.findIndex((e) => e.id === id);
  if (idx >= 0) {
    const prev = file.entries[idx]!;
    const prevSrc: FootCatalogConfirmation = prev.confirmationSource ?? "analyse";
    const mergedSrc: FootCatalogConfirmation =
      prevSrc === "analyse" || meta.confirmationSource === "analyse" ? "analyse" : "sample";
    row.confirmationSource = mergedSrc;
    file.entries[idx] = row;
  } else {
    file.entries.push(row);
  }
  persistFootScanned(projectRoot, file);
}

/** @deprecated Use `recordFootScanned` with `confirmationSource: "analyse"`. */
export function recordFootScannedOnAnalyse(
  projectRoot: string,
  meta: {
    systemAddress: number;
    bodyId: number;
    bodyName: string;
    starSystem: string;
    scan: PlanetScan;
    lock: OrganicGenusLock;
    ts: string;
    includeBacterium: boolean;
  },
): void {
  recordFootScanned(projectRoot, { ...meta, confirmationSource: "analyse" });
}

function hintedGeneraMissingFromMatches(hints: GenusHint[], matches: SpeciesMatch[]): GenusHint[] {
  const matched = new Set(matches.map((m) => genusFold(m.entry.genus)));
  return hints.filter((h) => {
    const a = genusFold(h.Genus_Localised || "");
    const b = genusFold(h.Genus || "");
    const k = a || b;
    if (!k) return false;
    return !matched.has(k);
  });
}

/** DSS genus hints with no candidate row in that genus (for UI markers). */
export function dssHintsMissingCandidateGenera(
  hints: GenusHint[] | null | undefined,
  matches: SpeciesMatch[],
): GenusHint[] {
  if (!hints?.length) return [];
  return hintedGeneraMissingFromMatches(hints, matches);
}

type FootGenusMode = { kind: "none" } | { kind: "hints"; genera: Set<string> } | { kind: "signal_surplus" };

function footGenusMode(body: BodyExoState, allMatches: SpeciesMatch[]): FootGenusMode {
  if (!body.genusHints?.length || !body.scan?.PlanetClass) return { kind: "none" };
  // A genus that only appears in the demoted tier is still missing from what the commander is shown,
  // so the foot catalog should still be asked to cover it.
  const matches = shownSpeciesMatches(allMatches);
  const missing = hintedGeneraMissingFromMatches(body.genusHints, matches);
  const missingSet = new Set<string>();
  for (const h of missing) {
    const a = genusFold(h.Genus_Localised || "");
    const b = genusFold(h.Genus || "");
    if (a) missingSet.add(a);
    if (b) missingSet.add(b);
  }
  if (missingSet.size > 0) return { kind: "hints", genera: missingSet };
  const sig = body.biologicalSignals;
  const matchedN = new Set(matches.map((m) => genusFold(m.entry.genus))).size;
  if (sig != null && sig > matchedN) return { kind: "signal_surplus" };
  return { kind: "none" };
}

export function needsFootCatalogAugment(body: BodyExoState, matches: SpeciesMatch[]): boolean {
  return footGenusMode(body, matches).kind !== "none";
}

function resolveEntryForCatalogRow(e: FootScannedEntry, db: SpeciesDatabase): SpeciesEntry | null {
  if (e.speciesEntryId) {
    const hit = db.species.find((s) => s.id === e.speciesEntryId);
    if (hit) return hit;
  }
  const lock: OrganicGenusLock = {
    genusLocalised: e.genusLocalised,
    genusSymbol: e.genusSymbol,
    speciesLocalised: e.speciesLocalised,
    speciesSymbol: e.speciesSymbol,
    variantLocalised: e.variantLocalised,
  };
  const sid = resolveSpeciesIdFromLock(lock, db);
  if (sid) {
    const hit = db.species.find((s) => s.id === sid);
    if (hit) return hit;
  }
  const hint: GenusHint = {
    Genus_Localised: e.genusLocalised || e.genusSymbol || "",
    Genus: e.genusSymbol || e.genusLocalised || "",
  };
  const narrowed = filterByGenusHints(db.species, [hint]);
  if (!narrowed.length) return null;
  const hits = narrowed.filter((x) => speciesMatchesOrganicLabels(x, lock));
  return hits[0] ?? narrowed[0] ?? null;
}

/**
 * Adds learned `SpeciesMatch` rows from `foot_scanned.json` when DSS/signals are under-satisfied vs the DB,
 * and a prior on-foot record is a **close** profile match (same `PlanetClass` + atmosphere; T/P within ±10%).
 */
export function augmentMatchesWithFootCatalog(
  matches: SpeciesMatch[],
  body: BodyExoState,
  db: SpeciesDatabase,
  prices: PriceIndex,
  projectRoot: string,
  isOrganicComplete: (entry: SpeciesEntry) => boolean,
  explorationRec: ExplorationScanRecord | null,
  journalHost?: JournalHostStarObservation | null,
  matchContext?: SpeciesMatchContext | null,
): SpeciesMatch[] {
  const mode = footGenusMode(body, matches);
  if (mode.kind === "none") return matches;

  const scan = body.scan;
  const mergedScan = mergeScanForExomastery(scan, explorationRec);
  if (!mergedScan?.PlanetClass?.trim()) return matches;

  const est = estimatedTemperatureRangeForScan(mergedScan);
  const estimatedSurfaceRange =
    est != null
      ? { tMin: est.tMin, tMax: est.tMax, tMid: est.tMid }
      : mergedScan.SurfaceTemperature != null && Number.isFinite(mergedScan.SurfaceTemperature)
        ? (() => {
            const t = Math.round(mergedScan.SurfaceTemperature!);
            return { tMin: t, tMax: t, tMid: t };
          })()
        : null;
  const planetTempBand =
    est != null
      ? { minK: est.tMin, maxK: est.tMax }
      : mergedScan.SurfaceTemperature != null && Number.isFinite(mergedScan.SurfaceTemperature)
        ? { minK: mergedScan.SurfaceTemperature, maxK: mergedScan.SurfaceTemperature }
        : null;

  const catalog = loadFootScannedCatalog(projectRoot);
  const matchedGenera = new Set(matches.map((m) => genusFold(m.entry.genus)));
  const haveIds = new Set(matches.map((m) => m.entry.id));
  const out: SpeciesMatch[] = [...matches];

  const rowsBySpeciesId = new Map<string, FootScannedEntry[]>();

  for (const row of catalog.entries) {
    if (!isCloseFootScanProfile(mergedScan, row)) continue;

    const g = genusFold(row.genusLocalised || row.genusSymbol);
    if (!g) continue;
    if (mode.kind === "hints" && !mode.genera.has(g)) continue;
    if (mode.kind === "signal_surplus" && matchedGenera.has(g)) continue;

    const entry = resolveEntryForCatalogRow(row, db);
    if (!entry || haveIds.has(entry.id)) continue;

    const strictOk = speciesMatchesCriteria(
      entry,
      mergedScan,
      planetTempBand,
      estimatedSurfaceRange,
      matchContext ?? null,
    );
    if (!strictOk.ok) continue;

    const list = rowsBySpeciesId.get(entry.id);
    if (list) list.push(row);
    else rowsBySpeciesId.set(entry.id, [row]);
  }

  for (const [speciesId, rawRows] of rowsBySpeciesId) {
    const entry = db.species.find((s) => s.id === speciesId);
    if (!entry) continue;

    const rows = dedupeFootRowsById(rawRows).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const gFold = genusFold(entry.genus);

    haveIds.add(speciesId);
    matchedGenera.add(gFold);

    const { photoUrl, photoNote } = resolveSpeciesPhoto(entry, projectRoot);
    const priceCredits = lookupPrice(prices, entry.displayName, entry.id);

    const primary = rows[0]!;
    const disagreeRow = rows.find((r) => r.dbProbableDisagreed && r.dbProbableSpeciesId);

    const footScanMatch = buildFootScanMatchPayload(mergedScan, rows, entry);

    const hasFile = hasExomasteryProfileFile(projectRoot, entry);
    const profile = loadExomasteryProfile(projectRoot, entry);
    const hq =
      profile && mergedScan
        ? exomasteryHabitatQualityPercent(
            profile,
            mergedScan,
            explorationRec ?? undefined,
            journalHost ?? null,
          )
        : null;

    out.push({
      entry,
      reasons: [
        {
          field: "Foot scan match",
          detail: `Prior on-foot confirmation(s) on ${rows.length} body record(s) match this profile (planet class + atmosphere exact; temperature midpoint and pressure within ±${Math.round(REL_TOLERANCE * 100)}% when known). Latest: ${primary.bodyName} (${primary.recordedAt.slice(0, 19)}).`,
        },
        ...(disagreeRow?.dbProbableSpeciesId
          ? [
              {
                field: "DB disagreement",
                detail: `When that foot scan was recorded, the top strict database candidate for this genus was \`${disagreeRow.dbProbableSpeciesId}\`, not the journal-resolved row.`,
              },
            ]
          : []),
      ],
      photoUrl,
      photoNote,
      priceCredits,
      organicAnalysisComplete: isOrganicComplete(entry),
      learnedFromFootScan: true,
      footCatalogConfirmations: orderedConfirmations(rows),
      footScanMatch,
      ...(hasFile
        ? {
            exomasteryProfilePresent: true,
            exomasteryHabitatQuality: hq ?? null,
            exomasterySimilarityPercent: null,
            exomasteryGenusRelativePercent: null,
            exomasteryVarietyHints: profile ? buildExomasteryVarietyHints(profile) : null,
            exomasteryExportBasename: resolveExomasteryExportBasename(projectRoot, entry),
            exomasteryDetail:
              profile && mergedScan
                ? buildExomasteryDetail(profile, mergedScan, explorationRec, journalHost ?? null)
                : null,
          }
        : {}),
    });
  }

  return out;
}
