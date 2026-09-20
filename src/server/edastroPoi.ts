/**
 * Points of interest, from EDAstro's Galactic Exploration Catalog.
 *
 * Same contract as the carrier list and for the same reasons: the commander presses a button, the
 * file lands on their machine, every question after that is answered locally, and nothing from
 * EDAstro is in this repository or the installer. See `docs/edastro-integration.md`; the rule that
 * must not move is that this fetch never goes through a server of ours.
 *
 * ### Which feed, and why it is the big one
 *
 * `/gec/json/combined` (6.2 MB, 2,766) rather than `/gec/json/all` (2.2 MB, 643), because this panel
 * exists to answer "what is near me" and coverage is the whole job. Measured over 60 random
 * deep-space points, the median nearest POI is **791 ly with the combined feed against 1,084 ly with
 * GEC alone** — a quarter closer for bytes that arrive once a day.
 *
 * What that costs is a second vocabulary: the 2,123 Galactic Mapping Project rows carry camelCase
 * type codes, no rating, no region and no summary. `shared/gecCategories.ts` folds both into one set
 * of groups, and the thinner fields simply read blank.
 *
 * ### Three traps in the feed
 *
 * - **`id` is not unique.** 551 ids appear in both catalogues. The key is `source:id`, which is
 *   unique across all 2,766.
 * - **No `ETag`, no `Last-Modified`, `cf-cache-status: DYNAMIC`.** Unlike `fleetcarriers.csv` there
 *   is no conditional GET here, so every refresh is the full 6.2 MB and the cooldown is the only
 *   thing keeping that honest.
 * - **The descriptions are the licensed part.** CC BY-NC-SA covers this text and these images far
 *   more clearly than it covers a list of coordinates. We keep the 200-character `summary` and link
 *   out for the rest, and **never render `mainImage`** — 200 rows of hotlinked photographs would put
 *   this app's users on someone's hobby image server on every panel open.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { poiGroup, poiIsOrganic, poiTypeLabel, type PoiGroup } from "../shared/gecCategories.js";
import { parseCarrierQuery, textMatchesQuery } from "../shared/carrierSearch.js";
import { EDASTRO_USER_AGENT } from "./edastroCarriers.js";
import { resolveUserSettingsJsonPath } from "./paths.js";
import type { PoiDataStatusDTO, PoiRowDTO } from "../shared/types.js";

const POI_URL = "https://edastro.com/gec/json/combined";

/**
 * Longer than the carrier file's.
 *
 * The catalogue is curated by hand and gains a few entries a week, not a few thousand a day, and
 * there is no conditional GET to make a wasted check cheap. Six hours is still far more often than
 * the data changes.
 */
export const POI_FETCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function resolvePoiCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-poi.json");
}

function resolvePoiMetaPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-poi.meta.json");
}

interface PoiCacheMeta {
  fetchedAtMs: number;
  rowCount?: number;
}

function readMeta(): PoiCacheMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(resolvePoiMetaPath(), "utf8")) as PoiCacheMeta;
    return typeof parsed?.fetchedAtMs === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export interface PoiRecord {
  /** `source:id`. `id` alone collides on 551 rows across the two catalogues. */
  key: string;
  source: string;
  name: string;
  /** The system, as the galaxy map spells it. Blank on 94 rows. */
  system: string;
  region: string;
  type: string;
  typeLabel: string;
  group: PoiGroup;
  organic: boolean;
  x: number;
  y: number;
  z: number;
  summary: string;
  /** 1.07 to 9.3 where present; GMP rows have none. */
  rating: number | null;
  /** The POI's page, or the galaxy-map link GMP rows carry instead. */
  url: string;
}

/** Parse the combined feed. Tolerates either catalogue's shape, and drops nothing silently. */
export function parsePoiJson(text: string): PoiRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: PoiRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const coords = p.coordinates;
    if (!Array.isArray(coords) || coords.length < 3) continue;
    const [x, y, z] = coords.map((n) => Number(n));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const source = String(p.source ?? "GEC");
    const key = `${source}:${String(p.id ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const type = String(p.type ?? "");
    const type2 = typeof p.type2 === "string" ? p.type2 : null;
    const ratingRaw = Number(p.rating);
    out.push({
      key,
      source,
      name: String(p.name ?? "").trim(),
      system: String(p.galMapSearch ?? "").trim(),
      region: String(p.region ?? "").trim(),
      type,
      typeLabel: poiTypeLabel(type),
      group: poiGroup(type, type2),
      organic: poiIsOrganic(type, type2),
      x: x!,
      y: y!,
      z: z!,
      summary: String(p.summary ?? "").trim(),
      rating: Number.isFinite(ratingRaw) && ratingRaw > 0 ? ratingRaw : null,
      url: String(p.poiUrl ?? p.galMapUrl ?? "").trim(),
    });
  }
  return out;
}

let memo: { mtimeMs: number; rows: PoiRecord[] } | null = null;

function loadRows(): PoiRecord[] {
  const path = resolvePoiCachePath();
  let stat;
  try {
    stat = statSync(path);
  } catch {
    memo = null;
    return [];
  }
  if (memo && memo.mtimeMs === stat.mtimeMs) return memo.rows;
  try {
    const rows = parsePoiJson(readFileSync(path, "utf8"));
    memo = { mtimeMs: stat.mtimeMs, rows };
    return rows;
  } catch {
    memo = null;
    return [];
  }
}

export function resetPoiMemo(): void {
  memo = null;
}

export function readPoiStatus(nowMs: number = Date.now()): PoiDataStatusDTO {
  const meta = readMeta();
  const have = existsSync(resolvePoiCachePath());
  const since = meta ? nowMs - meta.fetchedAtMs : Number.POSITIVE_INFINITY;
  const cooldownMsRemaining = Math.max(0, POI_FETCH_COOLDOWN_MS - since);
  return {
    haveData: have,
    rowCount: have ? loadRows().length : 0,
    fetchedAtMs: meta?.fetchedAtMs ?? null,
    cooldownMsRemaining: Number.isFinite(cooldownMsRemaining) ? cooldownMsRemaining : 0,
    sourceUrl: POI_URL,
  };
}

export async function fetchPoiData(opts?: {
  force?: boolean;
  nowMs?: number;
}): Promise<{ ok: boolean; status: PoiDataStatusDTO; error?: string }> {
  const nowMs = opts?.nowMs ?? Date.now();
  const before = readPoiStatus(nowMs);
  if (!opts?.force && before.cooldownMsRemaining > 0 && before.haveData) {
    return { ok: false, status: before, error: "Fetched recently. Try again later." };
  }

  let res: Response;
  try {
    res = await fetch(POI_URL, {
      headers: { Accept: "application/json", "User-Agent": EDASTRO_USER_AGENT },
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return {
      ok: false,
      status: before,
      error: e instanceof Error ? e.message : "EDAstro request failed (network or timeout).",
    };
  }
  if (!res.ok) return { ok: false, status: before, error: `EDAstro replied ${res.status}.` };

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, status: before, error: e instanceof Error ? e.message : "Download failed." };
  }

  const rows = parsePoiJson(text);
  // An error page or a truncated body parses to nothing; keeping the previous catalogue beats
  // replacing it with something unreadable.
  if (rows.length === 0) {
    return { ok: false, status: before, error: "EDAstro returned no usable catalogue entries." };
  }

  const path = resolvePoiCachePath();
  try {
    const tmp = `${path}.part`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (e) {
    return { ok: false, status: before, error: e instanceof Error ? e.message : "Could not save the file." };
  }
  resetPoiMemo();
  try {
    writeFileSync(
      resolvePoiMetaPath(),
      JSON.stringify({ fetchedAtMs: nowMs, rowCount: rows.length }, null, 2),
      "utf8",
    );
  } catch {
    /* best effort */
  }
  return { ok: true, status: readPoiStatus(nowMs) };
}

export interface PoiQuery {
  origin: { x: number; y: number; z: number } | null;
  groups?: readonly string[];
  organicOnly?: boolean;
  /** Hide anything the catalogue rates below this. Rows with no rating are kept — see below. */
  minRating?: number;
  search?: string;
  limit?: number;
}

export function queryPoi(q: PoiQuery, nowMs: number = Date.now()): PoiRowDTO[] {
  void nowMs;
  const rows = loadRows();
  const terms = parseCarrierQuery(q.search);
  const limit = Math.max(1, Math.min(500, q.limit ?? 100));
  const out: PoiRowDTO[] = [];

  for (const r of rows) {
    if (!poiPasses(r, q, terms)) continue;

    const distanceLy = q.origin
      ? Math.sqrt((r.x - q.origin.x) ** 2 + (r.y - q.origin.y) ** 2 + (r.z - q.origin.z) ** 2)
      : null;
    out.push({
      key: r.key,
      name: r.name,
      system: r.system,
      region: r.region,
      typeLabel: r.typeLabel,
      group: r.group,
      organic: r.organic,
      distanceLy,
      summary: r.summary,
      rating: r.rating,
      url: r.url,
      source: r.source,
    });
  }

  out.sort((a, b) => {
    if (a.distanceLy == null && b.distanceLy == null) return a.name.localeCompare(b.name);
    if (a.distanceLy == null) return 1;
    if (b.distanceLy == null) return -1;
    return a.distanceLy - b.distanceLy;
  });
  return out.slice(0, limit);
}

/** Matches before the limit, so the panel can say "100 of 2,766". One pass, same predicate. */
export function countPoi(q: PoiQuery): number {
  const terms = parseCarrierQuery(q.search);
  let n = 0;
  for (const r of loadRows()) {
    if (!poiPasses(r, q, terms)) continue;
    n += 1;
  }
  return n;
}

/**
 * The filter, in one place.
 *
 * The list and the count must apply exactly the same predicate or "N of M" is a lie, and it is the
 * kind of lie nothing notices: both numbers stay small and plausible while disagreeing.
 */
function poiPasses(r: PoiRecord, q: PoiQuery, terms: readonly string[]): boolean {
  if (q.organicOnly && !r.organic) return false;
  if (q.groups && q.groups.length > 0 && !q.groups.includes(r.group)) return false;
  /*
    An unrated POI passes a rating floor.

    Only the 643 GEC rows carry a rating; the 2,123 GMP ones have none. Treating absent as zero would
    make any rating filter quietly delete three quarters of the catalogue, and that reads as "nothing
    out here" rather than "this filter cannot see them".
  */
  if (q.minRating && q.minRating > 0 && r.rating != null && r.rating < q.minRating) return false;
  return textMatchesQuery([r.name, r.system, r.region, r.typeLabel, r.summary], terms);
}
