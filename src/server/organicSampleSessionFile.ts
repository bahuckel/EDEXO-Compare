import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SpeciesDatabase } from "../shared/types.js";
import { normOrganicToken } from "./organicTracking.js";
import { readGenusMinSampleDistanceM } from "./speciesTreeLoader.js";
import type { ExoOrganicTrackerInternal } from "./exoOrganicTracker.js";
import { getSpeciesDataDir } from "./paths.js";

export const ORGANIC_SAMPLE_SESSION_FORMAT = 1;

export type OrganicSampleSessionPersistedV1 = {
  formatVersion: number;
  bodyKey: string;
  bodyNameNorm: string;
  bundleKey: string;
  speciesDisplay: string;
  genusLocalised: string;
  minSampleDistanceM: number;
  anchors: { latDeg: number; lonDeg: number; planetRadiusM: number }[];
  phase: "tracking" | "celebrate";
  celebrationUntil: number;
  analyseWasLogged?: boolean;
  footTravelOdometerTracking: boolean;
  footTravelDistanceMeters: number;
  footTravelPrevLat: number | null;
  footTravelPrevLon: number | null;
  footTravelLastPlanetRadiusM: number | null;
  footSessionBodyKey: string;
  footSessionBodyNameNorm: string | null;
};

/** Mutable slice of {@link GameStateStore} persisted to `data/organic_sample_session.json`. */
export type OrganicSampleSessionHost = {
  exoOrganicTracker: ExoOrganicTrackerInternal | null;
  footTravelOdometerTracking: boolean;
  footTravelDistanceMeters: number;
  footTravelPrevLat: number | null;
  footTravelPrevLon: number | null;
  footTravelLastPlanetRadiusM: number | null;
  footSessionBodyKey: string | null;
  footSessionBodyNameNorm: string | null;
};

export function organicSampleSessionPath(projectRoot: string): string {
  return join(projectRoot, "data", "organic_sample_session.json");
}

function resolveMinSampleDistanceMForGenus(
  projectRoot: string,
  db: SpeciesDatabase,
  genusLocalised: string,
): number {
  const g = genusLocalised.trim().toLowerCase();
  if (!g) return 0;
  for (const e of db.species) {
    if (e.genus.trim().toLowerCase() !== g) continue;
    const rel = e.dataSourceRelPath;
    if (!rel) return 0;
    const m = readGenusMinSampleDistanceM(join(getSpeciesDataDir(projectRoot), rel));
    return m != null && m > 0 ? m : 0;
  }
  return 0;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending: { host: OrganicSampleSessionHost; projectRoot: string } | null = null;

export function schedulePersistOrganicSampleSession(
  host: OrganicSampleSessionHost,
  projectRoot: string,
): void {
  persistPending = { host, projectRoot };
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const p = persistPending;
    persistPending = null;
    if (p) flushPersistOrganicSampleSession(p.host, p.projectRoot);
  }, 400);
}

function flushPersistOrganicSampleSession(host: OrganicSampleSessionHost, projectRoot: string): void {
  const t = host.exoOrganicTracker;
  if (!t) {
    clearPersistedOrganicSampleSession(projectRoot);
    return;
  }
  if (t.phase === "celebrate" && Date.now() >= t.celebrationUntil) {
    clearPersistedOrganicSampleSession(projectRoot);
    return;
  }

  const payload: OrganicSampleSessionPersistedV1 = {
    formatVersion: ORGANIC_SAMPLE_SESSION_FORMAT,
    bodyKey: t.bodyKey,
    bodyNameNorm: t.bodyNameNorm,
    bundleKey: t.bundleKey,
    speciesDisplay: t.speciesDisplay,
    genusLocalised: t.genusLocalised,
    minSampleDistanceM: t.minSampleDistanceM,
    anchors: t.anchors,
    phase: t.phase,
    celebrationUntil: t.celebrationUntil,
    analyseWasLogged: t.analyseWasLogged,
    footTravelOdometerTracking: host.footTravelOdometerTracking,
    footTravelDistanceMeters: host.footTravelDistanceMeters,
    footTravelPrevLat: host.footTravelPrevLat,
    footTravelPrevLon: host.footTravelPrevLon,
    footTravelLastPlanetRadiusM: host.footTravelLastPlanetRadiusM,
    footSessionBodyKey: host.footSessionBodyKey ?? t.bodyKey,
    footSessionBodyNameNorm: host.footSessionBodyNameNorm,
  };

  const abs = organicSampleSessionPath(projectRoot);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

export function clearPersistedOrganicSampleSession(projectRoot: string): void {
  try {
    unlinkSync(organicSampleSessionPath(projectRoot));
  } catch {
    /* missing file ok */
  }
}

export function wipeOrganicSampleSession(host: OrganicSampleSessionHost, projectRoot: string): void {
  host.exoOrganicTracker = null;
  host.footTravelOdometerTracking = false;
  host.footTravelDistanceMeters = 0;
  host.footTravelPrevLat = null;
  host.footTravelPrevLon = null;
  host.footTravelLastPlanetRadiusM = null;
  host.footSessionBodyKey = null;
  host.footSessionBodyNameNorm = null;
  clearPersistedOrganicSampleSession(projectRoot);
}

export function loadOrganicSampleSessionFromDisk(
  projectRoot: string,
  host: OrganicSampleSessionHost,
  db: SpeciesDatabase,
): void {
  const abs = organicSampleSessionPath(projectRoot);
  if (!existsSync(abs)) return;
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return;
  }
  if (!j || typeof j !== "object") return;
  const p = j as Partial<OrganicSampleSessionPersistedV1>;
  if (p.formatVersion !== ORGANIC_SAMPLE_SESSION_FORMAT) return;
  if (typeof p.bodyKey !== "string" || !p.bodyKey) return;
  if (typeof p.bundleKey !== "string" || !p.bundleKey) return;
  if (typeof p.bodyNameNorm !== "string") return;
  if (!Array.isArray(p.anchors)) return;
  if (p.phase !== "tracking" && p.phase !== "celebrate") return;
  if (typeof p.celebrationUntil !== "number" || !Number.isFinite(p.celebrationUntil)) return;

  if (p.phase === "celebrate" && Date.now() >= p.celebrationUntil) {
    clearPersistedOrganicSampleSession(projectRoot);
    return;
  }

  const speciesDisplay = typeof p.speciesDisplay === "string" ? p.speciesDisplay : "—";
  const genusLocalised = typeof p.genusLocalised === "string" ? p.genusLocalised : "";
  const minDb = resolveMinSampleDistanceMForGenus(projectRoot, db, genusLocalised);
  const minSampleDistanceM =
    typeof p.minSampleDistanceM === "number" && Number.isFinite(p.minSampleDistanceM)
      ? p.minSampleDistanceM
      : 0;
  const minSampleDistanceMResolved = minDb > 0 ? minDb : minSampleDistanceM;

  const anchors: ExoOrganicTrackerInternal["anchors"] = [];
  for (const a of p.anchors) {
    if (!a || typeof a !== "object") continue;
    const lat = (a as { latDeg?: number }).latDeg;
    const lon = (a as { lonDeg?: number }).lonDeg;
    const r = (a as { planetRadiusM?: number }).planetRadiusM;
    if (typeof lat === "number" && typeof r === "number" && r > 0 && typeof lon === "number") {
      anchors.push({ latDeg: lat, lonDeg: lon, planetRadiusM: r });
    }
  }

  const sep = p.bundleKey.indexOf("::");
  const speciesKeyFromBundle = sep >= 0 ? p.bundleKey.slice(sep + 2) : p.bundleKey;
  if (!p.bundleKey.startsWith(`${p.bodyKey}::`)) return;

  const parts = p.bodyKey.split(":");
  const addr = parts.length ? Number(parts[0]) : NaN;
  const bid = parts.length > 1 ? Number(parts[1]) : NaN;
  if (!Number.isFinite(addr) || !Number.isFinite(bid)) return;

  host.exoOrganicTracker = {
    bundleKey: p.bundleKey,
    bodyKey: p.bodyKey,
    speciesKey: speciesKeyFromBundle,
    speciesDisplay,
    genusLocalised,
    bodyNameNorm: p.bodyNameNorm,
    minSampleDistanceM: minSampleDistanceMResolved,
    anchors,
    phase: p.phase,
    celebrationUntil: p.celebrationUntil,
    analyseWasLogged: typeof p.analyseWasLogged === "boolean" ? p.analyseWasLogged : undefined,
  };

  host.footSessionBodyKey =
    typeof p.footSessionBodyKey === "string" && p.footSessionBodyKey ? p.footSessionBodyKey : p.bodyKey;
  host.footSessionBodyNameNorm =
    typeof p.footSessionBodyNameNorm === "string" && footSessionBodyNormValid(p.footSessionBodyNameNorm)
      ? p.footSessionBodyNameNorm
      : p.bodyNameNorm || null;

  host.footTravelOdometerTracking = p.footTravelOdometerTracking === true;
  host.footTravelDistanceMeters =
    typeof p.footTravelDistanceMeters === "number" && Number.isFinite(p.footTravelDistanceMeters)
      ? Math.max(0, p.footTravelDistanceMeters)
      : 0;
  host.footTravelPrevLat =
    typeof p.footTravelPrevLat === "number" && Number.isFinite(p.footTravelPrevLat)
      ? p.footTravelPrevLat
      : null;
  host.footTravelPrevLon =
    typeof p.footTravelPrevLon === "number" && Number.isFinite(p.footTravelPrevLon)
      ? p.footTravelPrevLon
      : null;
  host.footTravelLastPlanetRadiusM =
    typeof p.footTravelLastPlanetRadiusM === "number" && Number.isFinite(p.footTravelLastPlanetRadiusM)
      ? p.footTravelLastPlanetRadiusM
      : null;
}

function footSessionBodyNormValid(s: string): boolean {
  return s.trim().length > 0;
}

/** Normalize `Status.json` / journal body name to compare with saved session. */
export function normStatusBodyName(name: string | null | undefined): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  return normOrganicToken(name);
}
