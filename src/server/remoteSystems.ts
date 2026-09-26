/**
 * Systems the commander looks up but has never been to (owner, 2026-09-25, Discord batch O-E1).
 *
 * Pasting a system name from EDSM or Spansh used to end at "no data": the header search only knew
 * the journals, and the manual "load bodies" buttons filled the map but never the biology. Now a
 * looked-up system is fetched from Spansh and shown like any other — bio counts, the genera somebody
 * mapped, the species somebody logged, and the app's prediction for the rest.
 *
 * Two Spansh records, both public and keyless:
 *   - `GET /api/dump/<id64>` — every body's physics (the EDSM-shaped fields the mapper already reads)
 *     and `signals`: the biological count and, where a surface scan reached EDDN, the genera;
 *   - `GET /api/system/<id64>` — `landmarks`, the species commanders logged on each body, and the
 *     system's coordinates. Optional: without it there are no logged species, only predictions.
 *
 * Kept apart from everything the journals say. Nothing here enters the journal merge cache, the
 * discoveries, the data value or the visited-systems list; it lives in its own file in the user data
 * folder for 30 days, then is fetched again.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BodyExoState, GenusHint, RemoteBioBody, RemoteSystemRecord } from "../shared/types.js";
import { APP_USER_AGENT } from "./appVersion.js";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { spanshDumpToExplorationRecords } from "./spanshSystemHydration.js";
import { planetScanFromExplorationRecord } from "./footScannedCatalog.js";
import { genusNameForCodexToken } from "../shared/codexGenusNames.js";

const DUMP_URL = "https://spansh.co.uk/api/dump";
const SYSTEM_URL = "https://spansh.co.uk/api/system";
export const REMOTE_CACHE_DAYS = 30;
const MAX_CACHED = 400;
const BIO_SIGNAL = "$SAA_SignalType_Biological;";

type FetchLike = typeof fetch;

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Bio counts, genera and signal types per body from a Spansh dump. Exported for tests. */
export function remoteBioFromDump(dump: unknown): Map<number, Omit<RemoteBioBody, "loggedSpecies">> {
  const root = obj(dump);
  const sys = obj(root?.system) ?? root;
  const out = new Map<number, Omit<RemoteBioBody, "loggedSpecies">>();
  const bodies = sys?.bodies;
  if (!Array.isArray(bodies)) return out;
  for (const b of bodies) {
    const body = obj(b);
    if (!body) continue;
    const bodyId = num(body.bodyId);
    const bodyName = str(body.name);
    const sig = obj(body.signals);
    if (bodyId === undefined || !bodyName || !sig) continue;
    const counts = obj(sig.signals) ?? {};
    const bio = num(counts[BIO_SIGNAL]);
    const genuses = Array.isArray(sig.genuses)
      ? sig.genuses.filter((g): g is string => typeof g === "string")
      : [];
    out.set(bodyId, {
      bodyId,
      bodyName,
      biologicalSignals: bio ?? null,
      genuses,
      signalTypes: Object.keys(counts),
    });
  }
  return out;
}

/**
 * Logged species per body name from `/api/system/<id64>`: biology only — geology comes in the same
 * list (fumaroles, vents) with a value of 0. Exported for tests.
 */
export function loggedSpeciesFromSystem(system: unknown): {
  byBodyName: Map<string, { genus: string; species: string }[]>;
  coords: { x: number; y: number; z: number } | null;
  updatedAt: string | null;
} {
  const root = obj(system);
  const rec = obj(root?.record) ?? root;
  const byBodyName = new Map<string, { genus: string; species: string }[]>();
  const bodies = rec?.bodies;
  if (Array.isArray(bodies)) {
    for (const b of bodies) {
      const body = obj(b);
      const name = str(body?.name);
      if (!body || !name || !Array.isArray(body.landmarks)) continue;
      const species: { genus: string; species: string }[] = [];
      for (const l of body.landmarks) {
        const lm = obj(l);
        const sub = str(lm?.subtype);
        if (!sub || (num(lm?.value) ?? 0) <= 0 || species.some((x) => x.species === sub)) continue;
        species.push({ genus: str(lm?.type) ?? sub.split(" ")[0]!, species: sub });
      }
      if (species.length) byBodyName.set(name, species);
    }
  }
  const x = num(rec?.x);
  const y = num(rec?.y);
  const z = num(rec?.z);
  return {
    byBodyName,
    coords: x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : null,
    updatedAt: str(rec?.updated_at) ?? null,
  };
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  ms: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status?: number; error: string }> {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": APP_USER_AGENT },
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `Spansh answered HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch one system from Spansh and shape it. */
export async function fetchRemoteSystem(
  systemAddress: number,
  nameHint: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<{ ok: true; system: RemoteSystemRecord } | { ok: false; error: string }> {
  const id = Math.trunc(systemAddress);
  const [dump, sys] = await Promise.all([
    getJson(fetchImpl, `${DUMP_URL}/${id}`, 25_000),
    getJson(fetchImpl, `${SYSTEM_URL}/${id}`, 25_000),
  ]);
  if (!dump.ok) {
    return {
      ok: false,
      error:
        dump.status === 404
          ? "Spansh has no record of this system."
          : `Could not fetch from Spansh: ${dump.error}`,
    };
  }
  const shaped = spanshDumpToExplorationRecords(dump.data, id, nameHint);
  if (!shaped.ok) return { ok: false, error: shaped.error };
  const bio = remoteBioFromDump(dump.data);
  const logged = sys.ok
    ? loggedSpeciesFromSystem(sys.data)
    : {
        byBodyName: new Map<string, { genus: string; species: string }[]>(),
        coords: null,
        updatedAt: null,
      };
  const dumpSys = obj(obj(dump.data)?.system) ?? obj(dump.data);
  const dc = obj(dumpSys?.coords);
  const coords =
    logged.coords ??
    (dc && num(dc.x) !== undefined && num(dc.y) !== undefined && num(dc.z) !== undefined
      ? { x: num(dc.x)!, y: num(dc.y)!, z: num(dc.z)! }
      : null);

  // Every body with biology: a signal count, a genus, or a species somebody logged.
  const nameToId = new Map(shaped.records.map((r) => [r.bodyName, r.bodyId]));
  const ids = new Set<number>([...bio.keys()]);
  for (const name of logged.byBodyName.keys()) {
    const bid = nameToId.get(name);
    if (bid !== undefined) ids.add(bid);
  }
  const out: RemoteBioBody[] = [];
  for (const bodyId of ids) {
    const b = bio.get(bodyId);
    const bodyName = b?.bodyName ?? shaped.records.find((r) => r.bodyId === bodyId)?.bodyName;
    if (!bodyName) continue;
    const entry: RemoteBioBody = {
      bodyId,
      bodyName,
      biologicalSignals: b?.biologicalSignals ?? null,
      genuses: b?.genuses ?? [],
      signalTypes: b?.signalTypes ?? [],
      loggedSpecies: logged.byBodyName.get(bodyName) ?? [],
    };
    if ((entry.biologicalSignals ?? 0) > 0 || entry.genuses.length || entry.loggedSpecies.length) {
      out.push(entry);
    }
  }
  out.sort((a, b) => a.bodyId - b.bodyId);
  return {
    ok: true,
    system: {
      systemAddress: id,
      starSystem: shaped.starSystem,
      coords,
      fetchedAt: now().toISOString(),
      sourceUpdatedAt: logged.updatedAt ?? str(dumpSys?.date) ?? null,
      records: shaped.records,
      bio: out,
      signalBodyCount: bio.size,
    },
  };
}

/* ----------------------------------------------------------------------------- the 30-day cache */

export function remoteSystemsCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-remote-systems.json");
}

type CacheFile = { format: 1; systems: RemoteSystemRecord[] };

function fresh(r: RemoteSystemRecord, nowMs: number): boolean {
  const t = Date.parse(r.fetchedAt);
  return Number.isFinite(t) && nowMs - t < REMOTE_CACHE_DAYS * 86_400_000;
}

/** Cached systems younger than 30 days. A missing or unreadable file is an empty cache. */
export function readRemoteSystemsCache(nowMs = Date.now()): RemoteSystemRecord[] {
  const p = remoteSystemsCachePath();
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")) as CacheFile;
    if (j?.format !== 1 || !Array.isArray(j.systems)) return [];
    return j.systems.filter((r) => r && typeof r.systemAddress === "number" && fresh(r, nowMs));
  } catch {
    return [];
  }
}

/** Add or replace one system; drops anything older than 30 days and keeps the newest {@link MAX_CACHED}. */
export function writeRemoteSystemToCache(system: RemoteSystemRecord, nowMs = Date.now()): void {
  const keep = readRemoteSystemsCache(nowMs).filter((r) => r.systemAddress !== system.systemAddress);
  const systems = [system, ...keep]
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))
    .slice(0, MAX_CACHED);
  const p = remoteSystemsCachePath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify({ format: 1, systems } satisfies CacheFile), "utf8");
    renameSync(tmp, p);
  } catch {
    /* a cache that cannot be written only costs a fetch next time */
  }
}

/* ------------------------------------------------------------------------ as bodies the app reads */

/** Spansh's signal keys to the words the fumarole gate looks for ("geological", "$saa_signaltype_…"). */
function signalHintsFor(types: string[]): string[] {
  const out: string[] = [];
  for (const t of types) {
    out.push(t);
    const m = /^\$SAA_SignalType_(\w+);$/.exec(t);
    if (m) out.push(m[1]!);
  }
  return out;
}

/**
 * The fetched bodies with biology, shaped like journal bodies so the whole prediction path runs on
 * them unchanged. Logged species become locks marked `spansh`: they narrow the prediction the way a
 * foot scan would, and they are never this commander's progress.
 */
export function remoteBodyStates(sys: RemoteSystemRecord): BodyExoState[] {
  const out: BodyExoState[] = [];
  for (const b of sys.bio) {
    const rec = sys.records.find((r) => r.bodyId === b.bodyId);
    const genusHints: GenusHint[] = [];
    for (const g of b.genuses) {
      const name = genusNameForCodexToken(g);
      if (name) genusHints.push({ Genus: g, Genus_Localised: name });
    }
    out.push({
      key: `${sys.systemAddress}:${b.bodyId}`,
      bodyName: b.bodyName,
      bodyId: b.bodyId,
      systemAddress: sys.systemAddress,
      starSystem: sys.starSystem,
      biologicalSignals: b.biologicalSignals,
      genusHints: genusHints.length ? genusHints : null,
      dssComplete: genusHints.length > 0,
      scan: rec ? planetScanFromExplorationRecord(rec) : null,
      signalHints: b.signalTypes.length ? signalHintsFor(b.signalTypes) : null,
      organicGenusLocks: b.loggedSpecies.map((l) => ({
        genusLocalised: l.genus,
        genusSymbol: "",
        speciesLocalised: l.species,
        speciesSymbol: "",
        variantLocalised: "",
        source: "spansh" as const,
      })),
      confirmedVariants: [],
      updatedAt: sys.fetchedAt,
      remote: { source: "spansh", fetchedAt: sys.fetchedAt },
    });
  }
  return out;
}
