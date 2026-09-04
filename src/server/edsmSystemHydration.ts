import type { ExplorationScanRecord } from "../shared/types.js";

const EDSM_BODIES_URL = "https://www.edsm.net/api-system-v1/bodies";
const EDSM_SYSTEMS_URL = "https://www.edsm.net/api-v1/systems";
const AU_TO_M = 149597870700;
const DAY_TO_SEC = 86400;

type EdsmParent = Record<string, number>;

function pickNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** EDSM `gravity` is ~Earth gees; journal `SurfaceGravity` is m/s². */
function edsmGravityToSurfaceMs2(g: number | undefined): number | undefined {
  if (g === undefined || !Number.isFinite(g)) return undefined;
  return g * 9.80665;
}

/** EDSM planet radius often in km; journal uses metres. */
function edsmRadiusToMetres(r: number | undefined): number | undefined {
  if (r === undefined || !Number.isFinite(r) || r <= 0) return undefined;
  if (r > 2_000_000) return r;
  return r * 1000;
}

/** EDSM orbital distances often in AU; journal SemiMajorAxis in metres. */
function edsmSemiMajorAxisToM(au: number | undefined): number | undefined {
  if (au === undefined || !Number.isFinite(au) || au <= 0) return undefined;
  if (au > 5e11) return au;
  return au * AU_TO_M;
}

function edsmPeriodToJournalSeconds(days: number | undefined): number | undefined {
  if (days === undefined || !Number.isFinite(days)) return undefined;
  return days * DAY_TO_SEC;
}

function mapEdsmParents(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: EdsmParent[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      out.push(item as EdsmParent);
    }
  }
  return out.length ? out : undefined;
}

function mapMaterialsToJournal(materials: unknown): ExplorationScanRecord["materials"] {
  if (!materials || typeof materials !== "object") return undefined;
  const rows: { Name: string; Percent: number }[] = [];
  for (const [k, v] of Object.entries(materials as Record<string, unknown>)) {
    const n = typeof v === "number" && Number.isFinite(v) ? v : undefined;
    if (n !== undefined) rows.push({ Name: k, Percent: n });
  }
  return rows.length ? rows : undefined;
}

export function mapEdsmBodyToExplorationRecord(
  body: Record<string, unknown>,
  systemAddress: number,
  starSystem: string,
): ExplorationScanRecord | null {
  const bodyId = pickNum(body.bodyId);
  if (bodyId === undefined || !Number.isInteger(bodyId)) return null;
  const nameRaw = pickStr(body.name);
  if (!nameRaw) return null;
  const type = pickStr(body.type)?.toLowerCase();
  const subType = pickStr(body.subType) ?? "";
  const isStar = type === "star";

  const distLs = pickNum(body.distanceToArrival);

  const rec: ExplorationScanRecord = {
    systemAddress,
    bodyId,
    bodyName: nameRaw,
    starSystem,
    updatedAt: new Date().toISOString(),
    edsmHydrated: true,
    distanceFromArrivalLs: distLs,
    parents: mapEdsmParents(body.parents),
  };

  if (isStar) {
    rec.bodyType = "Star";
    rec.starType = pickStr(body.spectralClass) ?? (subType ? subType.split(/\s+/)[0] : undefined);
    rec.luminosity = pickStr(body.luminosity);
    const sm = pickNum(body.solarMasses);
    if (sm !== undefined) rec.stellarMass = sm;
    const st = pickNum(body.surfaceTemperature);
    if (st !== undefined) rec.surfaceTemperature = st;
    const stSemi = edsmSemiMajorAxisToM(pickNum(body.semiMajorAxis));
    if (stSemi !== undefined) rec.semiMajorAxis = stSemi;
    rec.rotationPeriod = edsmPeriodToJournalSeconds(pickNum(body.rotationalPeriod));
    const tilt = pickNum(body.axialTilt);
    if (tilt !== undefined) rec.axialTilt = tilt;
    return rec;
  }

  rec.bodyType = "Planet";
  if (subType) rec.planetClass = subType;
  const em = pickNum(body.earthMasses);
  if (em !== undefined) rec.massEM = em;
  const rad = edsmRadiusToMetres(pickNum(body.radius));
  if (rad !== undefined) rec.radius = rad;
  const sg = edsmGravityFromBody(body);
  if (sg !== undefined) rec.surfaceGravity = sg;
  const t = pickNum(body.surfaceTemperature);
  if (t !== undefined) rec.surfaceTemperature = t;
  const press = pickNum(body.surfacePressure);
  if (press !== undefined) rec.surfacePressure = press;
  if (typeof body.isLandable === "boolean") rec.landable = body.isLandable;
  const tf = pickStr(body.terraformingState);
  if (tf) rec.terraformState = tf;
  const atm = pickStr(body.atmosphereType);
  if (atm) {
    rec.atmosphereType = atm;
    rec.atmosphere = atm;
  }
  const vol = pickStr(body.volcanismType);
  if (vol && vol.toLowerCase() !== "no volcanism") rec.volcanism = vol;
  if (body.tidalLock === true || body.rotationalPeriodTidallyLocked === true) rec.tidalLock = true;

  rec.semiMajorAxis = edsmSemiMajorAxisToM(pickNum(body.semiMajorAxis));
  rec.eccentricity = pickNum(body.orbitalEccentricity);
  rec.orbitalInclination = pickNum(body.orbitalInclination);
  rec.periapsis = pickNum(body.argOfPeriapsis);
  rec.orbitalPeriod = edsmPeriodToJournalSeconds(pickNum(body.orbitalPeriod));
  rec.rotationPeriod = edsmPeriodToJournalSeconds(pickNum(body.rotationalPeriod));
  const tilt = pickNum(body.axialTilt);
  if (tilt !== undefined) rec.axialTilt = tilt;

  const mat = mapMaterialsToJournal(body.materials);
  if (mat) rec.materials = mat;

  const comp = body.solidComposition;
  if (comp && typeof comp === "object") rec.composition = comp;

  if (body.atmosphereComposition && typeof body.atmosphereComposition === "object") {
    rec.atmosphereComposition = body.atmosphereComposition;
  }

  return rec;
}

function edsmGravityFromBody(body: Record<string, unknown>): number | undefined {
  const g = pickNum(body.gravity);
  return edsmGravityToSurfaceMs2(g);
}

export type FetchEdsmBodiesResult =
  { ok: true; records: ExplorationScanRecord[] } | { ok: false; error: string };

export async function fetchEdsmBodiesAsExplorationRecords(
  systemName: string,
  systemAddress: number,
): Promise<FetchEdsmBodiesResult> {
  const q = systemName.trim();
  if (!q) return { ok: false, error: "System name is required." };
  const url = `${EDSM_BODIES_URL}?systemName=${encodeURIComponent(q)}&showId=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "edexo-compare/journal-fallback" },
      signal: AbortSignal.timeout(22_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "EDSM request failed (network or timeout).",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `EDSM HTTP ${res.status}` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "EDSM returned invalid JSON." };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "EDSM returned empty response." };
  }
  const root = data as Record<string, unknown>;
  const bodyList = root.bodies;
  if (!Array.isArray(bodyList) || bodyList.length === 0) {
    const msg = pickStr(root.msg) ?? "No bodies in EDSM for this system.";
    return { ok: false, error: msg };
  }
  const starSystem = pickStr(root.name)?.trim() || q;
  const out: ExplorationScanRecord[] = [];
  for (const b of bodyList) {
    if (!b || typeof b !== "object") continue;
    const rec = mapEdsmBodyToExplorationRecord(b as Record<string, unknown>, systemAddress, starSystem);
    if (rec) out.push(rec);
  }
  if (out.length === 0) {
    return { ok: false, error: "Could not parse EDSM body list." };
  }
  return { ok: true, records: out };
}

export type SearchEdsmSystemsResult =
  { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string };

/**
 * Prefix search against EDSM’s public systems API (`id64` matches in-game `SystemAddress`).
 */
export async function searchEdsmSystemsByName(
  query: string,
  maxResults = 30,
): Promise<SearchEdsmSystemsResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, error: "Enter at least 2 characters." };
  const url = `${EDSM_SYSTEMS_URL}?systemName=${encodeURIComponent(q)}&showId=1&showCoordinates=0`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "edexo-compare/edsm-search" },
      signal: AbortSignal.timeout(22_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "EDSM system search failed (network or timeout).",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `EDSM HTTP ${res.status}` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "EDSM returned invalid JSON." };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: "Unexpected EDSM system search shape." };
  }
  const out: { systemAddress: number; starSystem: string }[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id64 = pickNum(rec.id64);
    const name = pickStr(rec.name);
    if (id64 === undefined || !Number.isFinite(id64) || !name) continue;
    out.push({ systemAddress: Math.trunc(id64), starSystem: name });
    if (out.length >= maxResults) break;
  }
  return { ok: true, systems: out };
}
