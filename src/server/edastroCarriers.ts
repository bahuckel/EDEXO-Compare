/**
 * Fleet carriers, from EDAstro's public `fleetcarriers.csv`.
 *
 * **Nothing about this runs on its own.** The commander presses a button, the file downloads to
 * their machine, and every question after that is answered locally. There is no background poll, no
 * per-jump call and no second source: the file is rebuilt about once a day, so anything faster
 * spends someone else's bandwidth to learn nothing. See `docs/edastro-integration.md`.
 *
 * The app ships the endpoint, never the data — nothing from EDAstro is in this repository, in the
 * installer or in a fixture, and the cache lives beside the user's settings. That is what keeps this
 * clear of CC BY-NC-SA: the user's machine fetches, exactly as it already does from EDSM, and we are
 * not in the distribution chain. The corollary is the rule that must not move: **never proxy this
 * through a server of ours**, or we become the client and we *are* redistributing.
 *
 * ### The measurement that shapes the output
 *
 * Carriers move far more than the word "parked" suggests, and the ones worth flying to barely move
 * at all. Measured on the 2026-09-19 file:
 *
 * ```
 * observed in last 7d: 7,070   of those, moved in last 7d: 4,477 (63.3%)
 * days sat still at the moment of sighting:  median 1   p75 13   p90 180
 * ```
 *
 * Bimodal: a carrier is either working and hops every day or two, or it has been parked for half a
 * year. Deep space is worse — Vista Genomics carriers beyond 5,000 ly are a **median 35 days** since
 * anyone saw them.
 *
 * So every row carries **two** ages and neither is a position:
 *
 * - `lastSeenDays` — how old the sighting is. Honesty about the record.
 * - `dwellDays` — `LastUpdated - LastMoved`, how long it had sat still when last seen. **This is the
 *   prediction.** A carrier parked 180 days will still be there; one that moved yesterday is a coin
 *   flip, however fresh the record. That is backwards from instinct and is what the numbers say.
 *
 * Both come free in the file, so this costs no extra request.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { carrierHasServices, parseCarrierServices } from "../shared/carrierServices.js";
import { carrierMatchesQuery, parseCarrierQuery } from "../shared/carrierSearch.js";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { fetchDssaData, readDssaByCallsign } from "./edastroDssa.js";
import { networkForCallsign } from "../shared/carrierNetworks.js";
import type { CarrierDataStatusDTO, CarrierRowDTO } from "../shared/types.js";

const CARRIERS_URL = "https://edastro.com/mapcharts/files/fleetcarriers.csv";

/**
 * Identifies the app to EDAstro.
 *
 * This is not protection against a hostile fork — a fork keeps the string, and no mechanism exists
 * to stop that without per-app keys EDAstro does not issue. What it buys is *contact before block*:
 * a maintainer who can see who we are will send an email rather than firewall a subnet. Same shape
 * as `EDSM_USER_AGENT`, deliberately.
 */
export const EDASTRO_USER_AGENT = "ED-Exo-Compare/1.1.0 (+https://github.com/bahuckel/EDEXO-Compare)";

/**
 * How long before the button will fetch again.
 *
 * The source rebuilds roughly daily and Cloudflare fronts it with `max-age=7200`, so a shorter
 * cooldown cannot return anything new. Thirty minutes is well inside that and still feels like a
 * button rather than a lockout.
 */
export const CARRIER_FETCH_COOLDOWN_MS = 30 * 60 * 1000;

/** Rows without coordinates are unplaceable — 49 of 90,293 in the 2026-09-19 file. */
const MS_PER_DAY = 86_400_000;

export function resolveCarrierCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-carriers.csv");
}

function resolveCarrierMetaPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-carriers.meta.json");
}

interface CarrierCacheMeta {
  /** Validators from the last 200, replayed so a refetch of an unchanged file costs a few hundred bytes. */
  etag?: string;
  lastModified?: string;
  /** When we last *asked*, which is what the cooldown counts — not when the file last changed. */
  fetchedAtMs: number;
  /** `Last-Modified` as EDAstro reported it, which is how old the data actually is. */
  sourceLastModified?: string;
  rowCount?: number;
}

function readMeta(): CarrierCacheMeta | null {
  try {
    const raw = readFileSync(resolveCarrierMetaPath(), "utf8");
    const parsed = JSON.parse(raw) as CarrierCacheMeta;
    return typeof parsed?.fetchedAtMs === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeMeta(meta: CarrierCacheMeta): void {
  try {
    writeFileSync(resolveCarrierMetaPath(), JSON.stringify(meta, null, 2), "utf8");
  } catch {
    /* best effort; a lost meta file costs one full download, not correctness */
  }
}

/**
 * Split one CSV line, honouring quoted fields.
 *
 * Hand-rolled because the runtime dependencies are `express` and `ws` and adding a third for one
 * column-split is not worth it. The file needs exactly this much: quoted fields containing commas
 * (`"2026-09-11 23:17:58"`, and the semicolon-joined `Services`), and doubled quotes inside them.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/**
 * EDAstro writes `"2026-09-11 23:17:58"` — a space, not a `T`, and no zone.
 *
 * Read as UTC. The alternative is the machine's local zone, which would shift every age in this
 * panel by up to a day depending on where the commander lives, and a day matters when the median
 * sighting out in the black is already 35 days old.
 */
export function parseEdastroDate(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  return Number.isFinite(ms) ? ms : null;
}

/** One parsed row, before it is scored against the commander's position. */
export interface CarrierRecord {
  callsign: string;
  name: string;
  system: string;
  systemAddress: number | null;
  x: number;
  y: number;
  z: number;
  region: string;
  services: string[];
  lastUpdatedMs: number | null;
  lastMovedMs: number | null;
}

/**
 * Parse the whole file.
 *
 * Column *names* are read from the header rather than fixed positions: this is somebody else's file
 * and a column inserted upstream would otherwise silently shift every field by one, which would
 * read as plausible garbage rather than as an error.
 */
export function parseCarrierCsv(text: string): CarrierRecord[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0];
  if (!header) return [];
  const cols = splitCsvLine(header).map((c) => c.trim());
  const at = (name: string) => cols.indexOf(name);
  const iCall = at("Callsign");
  const iName = at("Name");
  const iUpdated = at("LastUpdated");
  const iMoved = at("LastMoved");
  const iSystem = at("LastSystem");
  const iAddress = at("SystemAddress");
  const iX = at("Coord_X");
  const iY = at("Coord_Y");
  const iZ = at("Coord_Z");
  const iRegion = at("EstimatedRegion");
  const iServices = at("Services");
  if (iCall < 0 || iX < 0 || iY < 0 || iZ < 0 || iServices < 0) return [];

  /*
    Keyed by callsign because the file repeats carriers.

    152 callsigns appear more than once in the 2026-09-19 file, up to three times. The rows are
    byte-identical apart from `Name` -- "CRV Haruspex" against "haruspex" for T9J-L2N, same
    coordinates, same system, same timestamps -- so this is the same carrier recorded twice rather
    than two carriers. A callsign is unique in the game, so collapsing them is the correct reading
    and not merely a tidy-up: left alone the panel lists one carrier twice and React warns about the
    duplicate key.

    The keeper is the newest sighting, and on a tie the one that actually carries a name.
  */
  const byCallsign = new Map<string, CarrierRecord>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const f = splitCsvLine(line);
    const x = Number(f[iX]);
    const y = Number(f[iY]);
    const z = Number(f[iZ]);
    // No coordinates means the carrier cannot be placed. 49 of 90,293 on the 2026-09-19 file.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (!f[iX]?.trim()) continue;
    const address = Number(f[iAddress]);
    const record: CarrierRecord = {
      callsign: (f[iCall] ?? "").trim(),
      name: (f[iName] ?? "").trim(),
      system: (f[iSystem] ?? "").trim(),
      systemAddress: Number.isFinite(address) && f[iAddress]?.trim() ? address : null,
      x,
      y,
      z,
      region: (f[iRegion] ?? "").trim(),
      services: parseCarrierServices(f[iServices]),
      lastUpdatedMs: parseEdastroDate(f[iUpdated]),
      lastMovedMs: parseEdastroDate(f[iMoved]),
    };
    const existing = byCallsign.get(record.callsign);
    if (existing && !supersedes(record, existing)) continue;
    byCallsign.set(record.callsign, record);
  }
  return [...byCallsign.values()];
}

/** Which of two records for the same callsign to keep: newer sighting, then the one with a name. */
function supersedes(next: CarrierRecord, current: CarrierRecord): boolean {
  const a = next.lastUpdatedMs ?? -1;
  const b = current.lastUpdatedMs ?? -1;
  if (a !== b) return a > b;
  return next.name.length > 0 && current.name.length === 0;
}

/** Parsed file, kept in memory and invalidated by the cache file's mtime. */
let memo: { mtimeMs: number; rows: CarrierRecord[] } | null = null;

function loadRows(): CarrierRecord[] {
  const path = resolveCarrierCachePath();
  let stat;
  try {
    stat = statSync(path);
  } catch {
    memo = null;
    return [];
  }
  if (memo && memo.mtimeMs === stat.mtimeMs) return memo.rows;
  try {
    const rows = parseCarrierCsv(readFileSync(path, "utf8"));
    memo = { mtimeMs: stat.mtimeMs, rows };
    return rows;
  } catch {
    memo = null;
    return [];
  }
}

/** Drop the in-memory copy. Tests use it; nothing in the app needs to. */
export function resetCarrierMemo(): void {
  memo = null;
}

export function readCarrierStatus(nowMs: number = Date.now()): CarrierDataStatusDTO {
  const meta = readMeta();
  const path = resolveCarrierCachePath();
  const have = existsSync(path);
  const sinceFetch = meta ? nowMs - meta.fetchedAtMs : Number.POSITIVE_INFINITY;
  const cooldownMsRemaining = Math.max(0, CARRIER_FETCH_COOLDOWN_MS - sinceFetch);
  return {
    haveData: have,
    // The parsed count, not the stored one. `rowCount` in the meta file was written by whichever
    // build fetched it, and a parser change -- the callsign de-duplication, for instance -- leaves it
    // describing a file that is no longer read that way. Parsing is memoised on mtime, so this is a
    // map lookup after the first call.
    rowCount: have ? loadRows().length : 0,
    fetchedAtMs: meta?.fetchedAtMs ?? null,
    sourceLastModified: meta?.sourceLastModified ?? null,
    cooldownMsRemaining: Number.isFinite(cooldownMsRemaining) ? cooldownMsRemaining : 0,
    sourceUrl: CARRIERS_URL,
    dssaCount: readDssaByCallsign().size,
  };
}

export interface CarrierFetchResult {
  ok: boolean;
  status: CarrierDataStatusDTO;
  /** True when EDAstro answered 304 — the file we hold is already the current one. */
  unchanged?: boolean;
  error?: string;
}

/**
 * Download the file, or confirm the one on disk is current.
 *
 * Conditional GET is not a courtesy here, it is most of the point: the source rebuilds daily, so
 * every refresh but the first costs a few hundred bytes instead of 21 MB. EDAstro serves both
 * validators and answers 304 correctly — checked 2026-09-20.
 */
export async function fetchCarrierData(opts?: {
  force?: boolean;
  nowMs?: number;
}): Promise<CarrierFetchResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const before = readCarrierStatus(nowMs);
  if (!opts?.force && before.cooldownMsRemaining > 0 && before.haveData) {
    /*
      The cooldown guards the 21 MB file, not the 12 KB one.

      Returning here unconditionally strands anyone whose carrier data predates the DSSA list, or
      whose DSSA fetch failed once: the deployment list is empty, the filter is disabled, and the
      only way out is to wait half an hour for a download they do not need. So if the carrier file is
      present and the network list is not, fetch just that.
    */
    if (before.dssaCount === 0) {
      const network = await fetchDssaData();
      if (network.ok) return { ok: true, unchanged: true, status: readCarrierStatus(nowMs) };
    }
    return { ok: false, status: before, error: "Fetched recently. Try again shortly." };
  }

  const meta = readMeta();
  const headers: Record<string, string> = {
    Accept: "text/csv,*/*",
    "User-Agent": EDASTRO_USER_AGENT,
  };
  // Only replay validators when the file they describe is still on disk — a 304 against a cache we
  // deleted would leave us claiming data we do not have.
  if (before.haveData) {
    if (meta?.etag) headers["If-None-Match"] = meta.etag;
    if (meta?.lastModified) headers["If-Modified-Since"] = meta.lastModified;
  }

  let res: Response;
  try {
    res = await fetch(CARRIERS_URL, { headers, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    return {
      ok: false,
      status: before,
      error: e instanceof Error ? e.message : "EDAstro request failed (network or timeout).",
    };
  }

  if (res.status === 304 && before.haveData) {
    const next: CarrierCacheMeta = { ...(meta ?? { fetchedAtMs: nowMs }), fetchedAtMs: nowMs };
    writeMeta(next);
    // The DSSA list is 12 KB with its own rebuild cadence, so it is worth refreshing even when the
    // big file has not changed. A failure here is not fatal to the fetch.
    await fetchDssaData();
    return { ok: true, unchanged: true, status: readCarrierStatus(nowMs) };
  }
  if (!res.ok) {
    return { ok: false, status: before, error: `EDAstro replied ${res.status}.` };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, status: before, error: e instanceof Error ? e.message : "Download failed." };
  }

  const rows = parseCarrierCsv(text);
  // A file that parses to nothing is a redirect, an error page or an upstream format change. Keeping
  // the previous file is strictly better than replacing it with something unreadable.
  if (rows.length === 0) {
    return { ok: false, status: before, error: "EDAstro returned no usable carrier rows." };
  }

  const path = resolveCarrierCachePath();
  try {
    // Write beside the target and rename, so an interrupted download cannot leave a half file that
    // parses to a plausible subset of the galaxy.
    const tmp = `${path}.part`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (e) {
    return { ok: false, status: before, error: e instanceof Error ? e.message : "Could not save the file." };
  }
  resetCarrierMemo();
  /*
    The deployment list rides along with the big download rather than having a button of its own:
    12 KB on the back of 21 MB is not worth a second press, and DSSA rows are useless without the
    coordinates that download carries. Failure is tolerated — the carrier list still works and the
    DSSA filter simply has nothing to show.
  */
  await fetchDssaData();
  writeMeta({
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ?? undefined,
    sourceLastModified: res.headers.get("last-modified") ?? undefined,
    fetchedAtMs: nowMs,
    rowCount: rows.length,
  });
  return { ok: true, status: readCarrierStatus(nowMs) };
}

export interface CarrierQuery {
  /** Commander position. Without one there is no "nearest", and the panel says so rather than guessing. */
  origin: { x: number; y: number; z: number } | null;
  services?: readonly string[];
  /** Hide sightings older than this. 0 or undefined keeps everything. */
  maxLastSeenDays?: number;
  /** Only the Deep Space Support Array — 101 curated, deliberately parked service carriers. */
  dssaOnly?: boolean;
  /** Only carriers in a network this app carries a roster for, e.g. "oasis". */
  networkKey?: string;
  /** Free text over callsign, name, system, region and the DSSA commander. See `carrierSearch.ts`. */
  search?: string;
  limit?: number;
}

function days(fromMs: number | null, toMs: number): number | null {
  if (fromMs == null) return null;
  return Math.max(0, Math.floor((toMs - fromMs) / MS_PER_DAY));
}

/**
 * Nearest first, with both ages attached.
 *
 * Sorted by distance and *not* by dwell, deliberately. Dwell is the better predictor of whether the
 * carrier is still there, but the commander's question is "what is near me" — reordering the list by
 * a confidence score would hide the nearest answer behind a more reliable but distant one. The two
 * ages go on the row so the choice is visible; the sort stays the one that was asked for.
 */
/**
 * Turn the panel's query string into a {@link CarrierQuery}.
 *
 * Lives here rather than inline in the route because the route is the one layer nothing tested. The
 * OASIS filter shipped broken for exactly that reason: the client sent `?network=oasis`, the route
 * never read it, and every test passed because they all called {@link queryCarriers} directly — a
 * suite asserting something production never does.
 *
 * So the rule this encodes: **every filter the panel can send is parsed in one place, and that place
 * has a test.** Adding a filter to the client and forgetting the server is now a failing test rather
 * than a chip that does nothing.
 */
export function parseCarrierQueryParams(
  query: Record<string, unknown> | undefined,
  origin: { x: number; y: number; z: number } | null,
): CarrierQuery {
  const servicesRaw = query?.services;
  const services =
    typeof servicesRaw === "string" && servicesRaw.trim()
      ? servicesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  /*
    `Number("")` is 0 and `Number.isFinite(0)` is true, so an absent-but-present parameter reads as a
    deliberate zero. On `limit` that clamps to one row; on `maxLastSeenDays` it happens to mean "any"
    and is harmless, which is exactly how the bug hides. Third time this project has met it — see the
    poll rates, the radar radius and the collection focus floor.
  */
  const num = (v: unknown): number | null => {
    if (typeof v !== "string" || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    origin,
    services,
    maxLastSeenDays: num(query?.maxLastSeenDays) ?? 0,
    dssaOnly: query?.dssaOnly === "1",
    networkKey: typeof query?.network === "string" ? query.network : "",
    search: typeof query?.q === "string" ? query.q : "",
    limit: num(query?.limit) ?? 100,
  };
}

export function queryCarriers(q: CarrierQuery, nowMs: number = Date.now()): CarrierRowDTO[] {
  const rows = loadRows();
  const dssa = readDssaByCallsign();
  const wanted = q.services ?? [];
  const limit = Math.max(1, Math.min(500, q.limit ?? 100));
  const out: CarrierRowDTO[] = [];
  const seen = new Set<string>();

  const terms = parseCarrierQuery(q.search);
  for (const r of rows) {
    const network = dssa.get(r.callsign);
    if (q.dssaOnly && !network) continue;
    const member = networkForCallsign(r.callsign);
    if (q.networkKey && member?.network.key !== q.networkKey) continue;
    if (!carrierHasServices(r.services, wanted)) continue;
    // Searched against the joined values rather than the raw row: the roster name, the DSSA name and
    // the commander are all on screen, so all of them must be findable.
    if (
      !carrierMatchesQuery(
        { ...r, name: member?.name || network?.name || r.name, dssa: network ?? null },
        terms,
      )
    )
      continue;
    const lastSeenDays = days(r.lastUpdatedMs, nowMs);
    if (q.maxLastSeenDays && q.maxLastSeenDays > 0) {
      if (lastSeenDays == null || lastSeenDays > q.maxLastSeenDays) continue;
    }
    const distanceLy = q.origin
      ? Math.sqrt((r.x - q.origin.x) ** 2 + (r.y - q.origin.y) ** 2 + (r.z - q.origin.z) ** 2)
      : null;
    seen.add(r.callsign);
    out.push({
      callsign: r.callsign,
      // The roster name wins, then DSSA's, then the file's. EDAstro holds the OASIS carriers under
      // four capitalisations and one with no prefix at all, so its spelling is not a reliable label.
      name: member?.name || network?.name || r.name,
      system: r.system,
      systemAddress: r.systemAddress,
      region: r.region,
      distanceLy,
      lastSeenDays,
      // Dwell is measured at the moment of the sighting, not against now: "it had sat still for 180
      // days when someone last looked" is a fact, where "it has sat still for 215 days" would be a
      // guess about the 35 days nobody watched.
      dwellDays:
        r.lastUpdatedMs != null && r.lastMovedMs != null
          ? Math.max(0, Math.floor((r.lastUpdatedMs - r.lastMovedMs) / MS_PER_DAY))
          : null,
      services: r.services,
      dssa: network
        ? { commander: network.commander, status: network.status, deploymentSystem: network.deploymentSystem }
        : null,
      network: member
        ? { key: member.network.key, label: member.network.label, name: member.name }
        : null,
    });
  }

  /*
    A DSSA carrier the big file does not carry.

    None today — 101 of 101 join — but the two files are built from different pipelines and this is
    the failure that would be invisible: the carrier would simply not be in the list, and a list of
    deep-space service carriers silently missing one is worse than a row that cannot say how far away
    it is. These are listed without a distance and sort last.
  */
  if (q.dssaOnly) {
    for (const network of dssa.values()) {
      if (seen.has(network.callsign)) continue;
      // Nothing is known about its services, so a service filter cannot be honoured — and claiming a
      // match would be guessing. It drops out of a filtered view rather than pretending.
      if (wanted.length > 0) continue;
      if (
        !carrierMatchesQuery(
          {
            callsign: network.callsign,
            name: network.name,
            system: network.lastSeenSystem,
            region: "",
            dssa: network,
          },
          terms,
        )
      )
        continue;
      const lastSeenDays = days(network.lastSeenMs, nowMs);
      if (q.maxLastSeenDays && q.maxLastSeenDays > 0) {
        if (lastSeenDays == null || lastSeenDays > q.maxLastSeenDays) continue;
      }
      out.push({
        callsign: network.callsign,
        name: network.name,
        system: network.lastSeenSystem,
        systemAddress: null,
        region: "",
        distanceLy: null,
        lastSeenDays,
        dwellDays: null,
        services: [],
        network: null,
        dssa: {
          commander: network.commander,
          status: network.status,
          deploymentSystem: network.deploymentSystem,
        },
      });
    }
  }

  out.sort((a, b) => {
    // Rows without a distance cannot be ranked against ones that have it, and must not sort to the
    // top by comparing as zero. They go last, in callsign order.
    if (a.distanceLy == null && b.distanceLy == null) return a.callsign.localeCompare(b.callsign);
    if (a.distanceLy == null) return 1;
    if (b.distanceLy == null) return -1;
    return a.distanceLy - b.distanceLy;
  });
  return out.slice(0, limit);
}

/** How many rows match the filters, before the limit. Shown as "N of 19,541". */
export function countCarriers(q: CarrierQuery, nowMs: number = Date.now()): number {
  const rows = loadRows();
  const wanted = q.services ?? [];
  let n = 0;
  const dssa = readDssaByCallsign();
  const terms = parseCarrierQuery(q.search);
  for (const r of rows) {
    const network = dssa.get(r.callsign);
    if (q.dssaOnly && !network) continue;
    const member = networkForCallsign(r.callsign);
    if (q.networkKey && member?.network.key !== q.networkKey) continue;
    if (!carrierHasServices(r.services, wanted)) continue;
    if (
      !carrierMatchesQuery(
        { ...r, name: member?.name || network?.name || r.name, dssa: network ?? null },
        terms,
      )
    )
      continue;
    if (q.maxLastSeenDays && q.maxLastSeenDays > 0) {
      const seen = days(r.lastUpdatedMs, nowMs);
      if (seen == null || seen > q.maxLastSeenDays) continue;
    }
    n += 1;
  }
  return n;
}
