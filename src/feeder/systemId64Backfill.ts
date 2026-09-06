/**
 * Phase 2 of INCLUDE-BODY-IDS: give every system its `id64`.
 *
 * The plan filed this as a network job — "2,993 systems ÷ 50 ≈ 60 requests" — on the strength of
 * §1.3, which sampled 300 cached files, found 94.8 % of `id64` values beyond 2^53, and concluded
 * that every id64 on disk was damaged.
 *
 * **That conclusion does not hold for systems, and the reason is worth writing down.** Those 8,595
 * sampled values were nearly all *body* id64s — a cache file carries one system id64 and dozens of
 * body ones, so the sample was dominated by bodies. Measured separately across all 2,884 cache
 * files, **every system id64 is intact**: the largest in the corpus is 493,353,632,091,969, which is
 * eighteen times below 2^53. System addresses pack a mass code and sector coordinates and simply do
 * not reach the magnitudes a body address does.
 *
 * So the systems half of Phase 2 costs **no network at all** — it is already on disk. This is §45's
 * lesson arriving a second time: the expensive job was expensive because nobody checked what was
 * already there. The network path below exists only for the handful of systems with no cache file.
 *
 * Body id64 is still not recovered, and still deliberately. It is damaged, the cache cannot heal it,
 * and `(systemId64, bodyId)` is already a complete identity without it — see §2.1.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { rawSystemsDir } from "./paths.js";
import { isTrustworthyId64, parseJsonPreservingIds, toId64String } from "./bigIntJson.js";
import type { FeederStore } from "./feederDb.js";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The header of a cached bodies response.
 *
 * Only the first few hundred bytes are needed — `id`, `id64` and `name` are the first three keys
 * EDSM writes, ahead of the `bodies` array that makes these files 40 kB each. Reading 119 MB in
 * full to take 60 bytes from each file would be the same mistake in a smaller costume, so the read
 * is capped and falls back to a full parse only if the cap was not enough.
 */
const HEADER_BYTES = 4096;

export interface SystemCacheIds {
  name: string;
  edsmId: number | null;
  id64: string;
}

/** `id`, `id64` and `name` out of one cache file's header, without parsing its body list. */
export function parseSystemCacheHeader(head: string): SystemCacheIds | null {
  // The header is not valid JSON on its own — it is the opening of a much larger object — so it is
  // closed off before parsing rather than regex-scraped field by field. `parseJsonPreservingIds`
  // then applies the same digit-preserving rule the network path uses.
  const cut = head.indexOf('"bodies"');
  const trimmed = cut > 0 ? head.slice(0, head.lastIndexOf(",", cut)) + "}" : null;
  if (!trimmed) return null;
  let parsed: { name?: unknown; id?: unknown; id64?: unknown };
  try {
    parsed = parseJsonPreservingIds(trimmed);
  } catch {
    return null;
  }
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const id64 = toId64String(parsed.id64);
  if (!name || !id64) return null;
  // A system id64 that arrived as a big number would already be rounded, and storing it would put a
  // wrong identity in the column that is supposed to end wrong identities.
  if (!isTrustworthyId64(parsed.id64)) return null;
  return {
    name,
    edsmId: typeof parsed.id === "number" && Number.isSafeInteger(parsed.id) ? parsed.id : null,
    id64,
  };
}

export interface SystemCacheScan {
  filesRead: number;
  filesUnparsed: number;
  /** Keyed by normalised system name, the same key the store uses. */
  byName: Map<string, SystemCacheIds>;
  /** id64 values that arrived too large to trust and were therefore refused. */
  untrusted: number;
}

/** Every system id64 the on-disk cache can supply. No network. */
export async function readSystemIdsFromCache(): Promise<SystemCacheScan> {
  const byName = new Map<string, SystemCacheIds>();
  let filesRead = 0;
  let filesUnparsed = 0;
  let untrusted = 0;

  let files: string[];
  try {
    files = (await readdir(rawSystemsDir())).filter((f) => f.endsWith(".json"));
  } catch {
    return { filesRead, filesUnparsed, byName, untrusted };
  }

  for (const f of files) {
    let head: string;
    try {
      const buf = await readFile(join(rawSystemsDir(), f));
      head = buf.subarray(0, HEADER_BYTES).toString("utf8");
      filesRead += 1;
      let ids = parseSystemCacheHeader(head);
      if (!ids && buf.length > HEADER_BYTES) ids = parseSystemCacheHeader(buf.toString("utf8"));
      if (!ids) {
        filesUnparsed += 1;
        continue;
      }
      byName.set(norm(ids.name), ids);
    } catch {
      filesUnparsed += 1;
    }
  }
  return { filesRead, filesUnparsed, byName, untrusted };
}

export interface SystemId64Report {
  filesRead: number;
  filesUnparsed: number;
  /** Systems in the store that the cache could name. */
  fromCache: number;
  /** Systems in the store the cache had nothing for — the only ones a network pass would touch. */
  stillMissing: number;
  /** Names still missing, so the caller can fetch exactly those and nothing more. */
  missingNames: string[];
  written: number;
  /** Cache entries for systems the store does not hold. Harmless, but worth seeing. */
  cacheOnly: number;
  largestId64: string | null;
  beyondSafeInteger: number;
  coverage: { systems: number; systemsWithId64: number };
  elapsedMs: number;
}

/** Fill `systems.id64` from the cache. `apply: false` measures without writing. */
export async function backfillSystemId64(
  store: FeederStore,
  opts: { apply: boolean },
): Promise<SystemId64Report> {
  const started = Date.now();
  const scan = await readSystemIdsFromCache();
  const rows = store.systemIdentityRows();

  const updates: { normSystem: string; id64: string; edsmId: number | null }[] = [];
  const missingNames: string[] = [];
  const matched = new Set<string>();
  let largest: bigint | null = null;
  let beyond = 0;

  for (const row of rows) {
    const found = scan.byName.get(row.normSystem);
    if (!found) {
      if (row.id64 === null) missingNames.push(row.displayName);
      continue;
    }
    matched.add(row.normSystem);
    const v = BigInt(found.id64);
    if (largest === null || v > largest) largest = v;
    if (v > 9007199254740991n) beyond += 1;
    if (row.id64 === null) updates.push({ normSystem: row.normSystem, id64: found.id64, edsmId: found.edsmId });
  }

  let written = 0;
  if (opts.apply) {
    written = store.setSystemId64(updates);
    store.persist();
  }

  return {
    filesRead: scan.filesRead,
    filesUnparsed: scan.filesUnparsed,
    fromCache: matched.size,
    stillMissing: missingNames.length,
    missingNames,
    written,
    cacheOnly: scan.byName.size - matched.size,
    largestId64: largest === null ? null : largest.toString(),
    beyondSafeInteger: beyond,
    coverage: store.systemId64Coverage(),
    elapsedMs: Date.now() - started,
  };
}

const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));

export function formatSystemId64Report(r: SystemId64Report, applied: boolean): string {
  const out: string[] = [];
  out.push(`Cache files        ${r.filesRead.toLocaleString()} read, ${r.filesUnparsed} unreadable (${r.elapsedMs} ms)`);
  out.push(
    `From cache         ${r.fromCache.toLocaleString()} of ${r.coverage.systems.toLocaleString()} systems ` +
      `(${pct(r.fromCache, r.coverage.systems)} %) — no network`,
  );
  out.push(`Cache-only         ${r.cacheOnly.toLocaleString()} cached systems the store does not hold`);
  out.push(
    `Coverage now       ${r.coverage.systemsWithId64.toLocaleString()}/${r.coverage.systems.toLocaleString()} systems have id64`,
  );
  out.push(
    applied
      ? `Written            ${r.written.toLocaleString()} system rows`
      : `Written            nothing — dry run. Re-run with --apply to write.`,
  );
  out.push("");
  out.push(
    `Largest id64       ${r.largestId64 ?? "none"} — ${r.beyondSafeInteger} of them beyond 2^53 ` +
      `(2^53 = 9,007,199,254,740,991)`,
  );
  out.push(
    `Still missing      ${r.stillMissing.toLocaleString()} systems have no cache file — ` +
      `${Math.ceil(r.stillMissing / 50)} batched request${Math.ceil(r.stillMissing / 50) === 1 ? "" : "s"} with --fetch-missing`,
  );
  for (const n of r.missingNames.slice(0, 15)) out.push(`   ${n}`);
  if (r.missingNames.length > 15) out.push(`   … and ${r.missingNames.length - 15} more`);
  return out.join("\n");
}
