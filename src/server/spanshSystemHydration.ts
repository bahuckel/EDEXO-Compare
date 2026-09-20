/**
 * Spansh as a second galaxy source beside EDSM (owner, 2026-09-13: "Search: [EDSM] [Spansh]").
 *
 * Two public endpoints, no key:
 * - `GET /api/systems/field_values/system_names?q=…` — name completion, each hit carrying the id64,
 *   which is the journal's `SystemAddress`, so a hit can be viewed straight away;
 * - `GET /api/dump/{id64}` — the system as Spansh holds it, bodies in the same shape EDSM uses
 *   (`subType`, `atmosphereType`, `gravity` in g, `surfaceTemperature`, `surfacePressure`,
 *   `isLandable`, `distanceToArrival`, `parents`, …), so the EDSM body mapper serves both. Bodies of
 *   type `Barycentre` are Spansh's own and are skipped: the map draws barycentres from `parents`.
 */
import type { ExplorationScanRecord } from "../shared/types.js";
import { mapEdsmBodyToExplorationRecord } from "./edsmSystemHydration.js";

const SPANSH_NAMES_URL = "https://spansh.co.uk/api/systems/field_values/system_names";
const SPANSH_DUMP_URL = "https://spansh.co.uk/api/dump";
const USER_AGENT = "EDExoCompare (+https://github.com/bahuckel/EDEXO-Compare)";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function pickNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type SpanshSearchResult =
  { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string };

export async function searchSpanshSystemsByName(query: string, maxResults = 25): Promise<SpanshSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, error: "Enter at least 2 characters." };
  let res: Response;
  try {
    res = await fetch(`${SPANSH_NAMES_URL}?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Spansh request failed (network or timeout).",
    };
  }
  if (!res.ok) return { ok: false, error: `Spansh HTTP ${res.status}` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "Spansh returned invalid JSON." };
  }
  return { ok: true, systems: parseSpanshNameHits(data, maxResults) };
}

/** Exported for tests: the completion payload is `{ min_max: [{ id64, name, x, y, z }] }`. */
export function parseSpanshNameHits(
  data: unknown,
  maxResults = 25,
): { systemAddress: number; starSystem: string }[] {
  const rows = data && typeof data === "object" ? (data as Record<string, unknown>).min_max : null;
  if (!Array.isArray(rows)) return [];
  const out: { systemAddress: number; starSystem: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id64 = pickNum(rec.id64);
    const name = pickStr(rec.name);
    if (id64 === undefined || !name) continue;
    out.push({ systemAddress: Math.trunc(id64), starSystem: name });
    if (out.length >= maxResults) break;
  }
  return out;
}

export type FetchSpanshBodiesResult =
  { ok: true; records: ExplorationScanRecord[]; starSystem: string } | { ok: false; error: string };

export async function fetchSpanshBodiesAsExplorationRecords(
  systemAddress: number,
  systemNameHint: string,
): Promise<FetchSpanshBodiesResult> {
  if (!Number.isFinite(systemAddress) || systemAddress <= 0)
    return { ok: false, error: "System address is required." };
  let res: Response;
  try {
    res = await fetch(`${SPANSH_DUMP_URL}/${Math.trunc(systemAddress)}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(22_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Spansh request failed (network or timeout).",
    };
  }
  if (res.status === 404) return { ok: false, error: "Spansh has no record of this system." };
  if (!res.ok) return { ok: false, error: `Spansh HTTP ${res.status}` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "Spansh returned invalid JSON." };
  }
  return spanshDumpToExplorationRecords(data, systemAddress, systemNameHint);
}

/** Exported for tests: `{ system: { name, id64, bodies: [...] } }` (or the system object itself). */
export function spanshDumpToExplorationRecords(
  data: unknown,
  systemAddress: number,
  systemNameHint: string,
): FetchSpanshBodiesResult {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const sys =
    root && root.system && typeof root.system === "object" ? (root.system as Record<string, unknown>) : root;
  if (!sys) return { ok: false, error: "Spansh returned an empty response." };
  const bodies = sys.bodies;
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return { ok: false, error: "Spansh has no bodies for this system yet." };
  }
  const starSystem = pickStr(sys.name)?.trim() || systemNameHint.trim();
  const out: ExplorationScanRecord[] = [];
  for (const b of bodies) {
    if (!b || typeof b !== "object") continue;
    const body = b as Record<string, unknown>;
    const type = pickStr(body.type)?.toLowerCase();
    if (type === "barycentre") continue;
    const rec = mapEdsmBodyToExplorationRecord(body, systemAddress, starSystem);
    if (rec) out.push(rec);
  }
  if (out.length === 0) return { ok: false, error: "Spansh bodies could not be read for this system." };
  return { ok: true, records: out, starSystem };
}
