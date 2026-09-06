/**
 * Read a Spansh JSONL export into the corpus — INCLUDE-BODY-IDS Phase 8's importer half.
 *
 * The producer is `EDSM-targz-to-db/export_jsonl.py`; the format is the contract in
 * `EDEXO-TEXT-OR-BIGINT.md` §C. This side does not trust it. Four gates run before a single row is
 * written, because the failure this whole item exists to prevent is silent:
 *
 * 1. **The probe.** The manifest carries a known id64 as a string. If it does not survive the trip
 *    to here, something between the file and this function created a JavaScript `number`, and every
 *    other id in the file is suspect. Cost: one string comparison. Turns the corruption that ate
 *    38,489 body ids from silent into loud.
 * 2. **The field lists.** Each row's keys must equal the manifest's `fields` for its kind. A renamed
 *    column then fails at the door instead of being quietly ignored for a year.
 * 3. **The identity.** `id64 == systemId64 + (bodyId << 55)` on every body. A rounded id breaks the
 *    equation while a correct one satisfies it, so this catches damage that happened *upstream of
 *    the file* — which the probe alone cannot see.
 * 4. **No oversized identifier.** Every id-class field must be a string, and any *other* integer
 *    beyond 2^53 is reported. That half is a warning rather than a failure, because the contract's
 *    claim that no such integer exists turned out to be false — `belts[].mass` is a mass in
 *    kilograms and reaches 1.26 × 10^18. Losing digits off a belt costs nothing; losing them off an
 *    identifier is the whole defect.
 *
 * The rows are parsed with plain `JSON.parse`, deliberately. Running the quoting pre-pass first
 * would *manufacture* conformance and make gate 4 unfalsifiable — the file has to be validated as
 * it actually is.
 *
 * ## What it writes, and what it does not
 *
 * **Update-only.** The importer never inserts a body or a system. `planets` means "a body with at
 * least one sighting", and profiles are built from that; filling it with 43,325 dump bodies would
 * change what every count in the app means. Growing the register into Store A proper (§2.1) is a
 * separate decision with its own migration.
 *
 * The join is `(systemId64, bodyId)` — **no string comparison anywhere in the path**, which is
 * acceptance rule 2 finally exercised rather than merely designed.
 *
 * ## Mapping comes from `genuses`, not from `mappedBy`
 *
 * The export carries `discoveredBy`, `mappedBy`, `mappedAt` and they are **NULL on every row**,
 * including the bodies that demonstrably were mapped. Reading them would get the answer exactly
 * backwards. A non-empty `signals.genuses` is the real signal: genera only ever appear in
 * `SAASignalsFound`, which only fires after a DSS — verified on the owner's 244 journals, where
 * `FSSBodySignals` carried `Genuses` 0 times in 2,631 events and all 467 genus-bearing
 * `SAASignalsFound` had `SAAScanComplete` on that body first (§8.9).
 *
 * Absence of genera is **no evidence of mapping**, not proof of none — somebody may have mapped and
 * never uploaded — so it writes `false` under the same age-and-provenance rule as footfall, and
 * never overwrites a `true`.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { bodyId64Matches } from "./bigIntJson.js";
import type { FeederStore } from "./feederDb.js";

/** The largest body id64 known in the galaxy dump, and the manifest's canary value. */
export const EXPECTED_PROBE_ID64 = "6160925022241180003";

const MAX_SAFE = 9007199254740991;

export interface SpanshManifest {
  kind: "manifest";
  schemaVersion: number;
  source?: string;
  exported?: string;
  rows?: { system?: number; body?: number };
  idFields?: string[];
  identity?: string;
  probe?: { id64?: string };
  fields?: { system?: string[]; body?: string[] };
}

export interface ImportReport {
  manifest: SpanshManifest | null;
  linesRead: number;
  systemRows: number;
  bodyRows: number;
  /** Bodies whose `(systemId64, bodyId)` matched a corpus row. */
  matched: number;
  /** Of those, how many carried something the corpus did not already have. */
  changed: number;
  /** Of those, how many the dump says are DSS-mapped. */
  mappedTrue: number;
  mappedFalse: number;
  planetsWritten: number;
  systemsWithCoords: number;
  /** Gate failures. Any non-empty list aborts before writing. */
  failures: string[];
  /**
   * Oversized integers in fields that are plainly quantities rather than identities — currently
   * only `belts[].mass`. Reported because §C.3 claims they cannot exist; not a reason to refuse.
   */
  warnings: string[];
  coverage: ReturnType<FeederStore["mappedCoverage"]>;
  elapsedMs: number;
}

/** Whether a body row's genus list proves a DSS map. */
export function bodyIsMapped(row: Record<string, unknown>): boolean {
  const signals = row.signals as { genuses?: unknown } | null | undefined;
  return Array.isArray(signals?.genuses) && signals.genuses.length > 0;
}

/** The moment the signal block describes — the age that gives a mapped flag its meaning. */
export function bodySignalsSeenAt(row: Record<string, unknown>): string | null {
  const signals = row.signals as { updateTime?: unknown } | null | undefined;
  const t = signals?.updateTime;
  if (typeof t !== "string" || !t.trim()) return null;
  // Spansh writes `2026-09-04 22:55:03+00`; normalise to ISO so it compares with journal timestamps.
  return t.trim().replace(" ", "T").replace(/\+00$/, "Z");
}

/**
 * Gate 4, recursive — and it distinguishes two things the contract conflates.
 *
 * §C.3 promised "every other integer is a plain JSON number, all of them below 2^53 by
 * construction". That is **not true**: `belts[].mass` is a mass in kilograms and reaches 1.26 × 10^18
 * in the sample. Measured, 133 values across 45,326 lines, and it is the only such field.
 *
 * Losing digits off a belt's mass costs nothing — it is a physical quantity with a handful of
 * significant figures, not an identity. Losing them off an identifier is the defect this whole item
 * exists to prevent. So an oversized integer in an **id-shaped** field is a hard failure, and one in
 * any other field is a warning: reported so the contract can be corrected, but not a reason to
 * reject a file that is otherwise sound.
 */
function looksLikeIdentity(key: string): boolean {
  return /(^|[a-z])id(64)?$/i.test(key) || key.toLowerCase().endsWith("address");
}

function findUnsafeIntegers(value: unknown, path: string, out: string[], warn: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findUnsafeIntegers(v, `${path}[${i}]`, out, warn));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = `${path}.${k}`;
    if (k === "id64" || k.endsWith("Id64")) {
      if (v !== null && typeof v !== "string") out.push(`${p} is ${typeof v}, expected a decimal string`);
      continue;
    }
    if (typeof v === "number" && Number.isInteger(v) && Math.abs(v) > MAX_SAFE) {
      const msg = `${p} = ${v} is a bare integer beyond 2^53`;
      if (looksLikeIdentity(k)) out.push(`${msg} — and its name says it is an identifier`);
      else warn.push(msg);
    }
    findUnsafeIntegers(v, p, out, warn);
  }
}

function checkFields(row: Record<string, unknown>, expected: string[] | undefined, kind: string): string | null {
  if (!expected) return null;
  const got = Object.keys(row);
  if (got.length === expected.length && got.every((k, i) => k === expected[i])) return null;
  const missing = expected.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !expected.includes(k));
  return `${kind} row key list deviates from the manifest${missing.length ? `; missing ${missing.join(",")}` : ""}${
    extra.length ? `; unexpected ${extra.join(",")}` : ""
  }`;
}

export interface ImportOptions {
  apply: boolean;
  /** Stop after this many gate failures. The first few say what is wrong; a thousand do not. */
  maxFailures?: number;
  /** Override the expected probe, for tests. */
  expectedProbe?: string;
}

/**
 * Validate and import one `*.jsonl.gz` export.
 *
 * Streams — the sample is 9 MB but the same command must survive a galaxy-scale file, and one
 * system per line is what makes that free.
 */
export async function importSpanshExport(
  store: FeederStore,
  path: string,
  opts: ImportOptions,
): Promise<ImportReport> {
  const started = Date.now();
  const maxFailures = opts.maxFailures ?? 20;
  const expectedProbe = opts.expectedProbe ?? EXPECTED_PROBE_ID64;
  const failures: string[] = [];
  const warnings: string[] = [];

  let manifest: SpanshManifest | null = null;
  let linesRead = 0;
  let systemRows = 0;
  let bodyRows = 0;
  let mappedTrue = 0;
  let mappedFalse = 0;
  let matched = 0;

  const identity = store.planetsByIdentity();
  const bodyUpdates: Parameters<FeederStore["setBodyMapped"]>[0] = [];
  const coordUpdates: Parameters<FeederStore["setSystemCoordsById64"]>[0] = [];

  const rl = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    linesRead += 1;

    let row: Record<string, unknown>;
    try {
      // Plain parse, on purpose — see the header. Quoting first would hide gate 4.
      row = JSON.parse(line) as Record<string, unknown>;
    } catch (e) {
      failures.push(`line ${linesRead}: unparseable (${e instanceof Error ? e.message : String(e)})`);
      if (failures.length >= maxFailures) break;
      continue;
    }

    if (row.kind === "manifest") {
      manifest = row as unknown as SpanshManifest;
      // Gate 1 — the canary at the door.
      const probe = manifest.probe?.id64;
      if (probe !== undefined && probe !== expectedProbe) {
        failures.push(
          `manifest probe id64 is ${JSON.stringify(probe)}, expected the string "${expectedProbe}" — ` +
            "something between the file and here created a number; every id in this file is suspect",
        );
      }
      continue;
    }

    if (manifest === null) {
      failures.push("first line is not a manifest; refusing to import a file that cannot describe itself");
      break;
    }

    const kind = String(row.kind);
    const fieldIssue = checkFields(row, manifest.fields?.[kind as "system" | "body"], kind); // gate 2
    if (fieldIssue) failures.push(`line ${linesRead}: ${fieldIssue}`);
    findUnsafeIntegers(row, kind, failures, warnings); // gate 4

    if (kind === "system") {
      systemRows += 1;
      const id64 = row.id64;
      const coords = row.coords as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
      if (
        typeof id64 === "string" &&
        typeof coords?.x === "number" &&
        typeof coords?.y === "number" &&
        typeof coords?.z === "number"
      ) {
        coordUpdates.push({ id64, x: coords.x, y: coords.y, z: coords.z });
      }
    } else if (kind === "body") {
      bodyRows += 1;
      const id64 = row.id64;
      const systemId64 = row.systemId64;
      const bodyId = row.bodyId;
      if (typeof id64 !== "string" || typeof systemId64 !== "string" || typeof bodyId !== "number") {
        failures.push(`line ${linesRead}: body is missing a usable id64/systemId64/bodyId`);
      } else if (!bodyId64Matches(systemId64, bodyId, id64)) {
        // Gate 3 — catches damage that happened before the file was written.
        failures.push(`line ${linesRead}: id64 ${id64} fails systemId64 + (bodyId << 55)`);
      } else {
        const known = identity.get(`${systemId64}:${bodyId}`);
        if (known !== undefined) {
          matched += 1;
          const isMapped = bodyIsMapped(row);
          if (isMapped) mappedTrue += 1;
          else mappedFalse += 1;
          const seenAt = bodySignalsSeenAt(row);
          // Queue only what would actually change. SQLite counts a no-op UPDATE as a modified row,
          // so without this the report claims work it did not do — the same misleading count Phase 1
          // had to correct. A `false` against an existing `true` is dropped here as well as in SQL,
          // so the sticky rule shows up in the numbers rather than only in the result.
          const wouldChange =
            known.isMapped === null ||
            (isMapped && !known.isMapped) ||
            (isMapped === known.isMapped && seenAt !== null && seenAt !== known.mappedSeenAt);
          if (wouldChange) {
            bodyUpdates.push({
              planetId: known.planetId,
              isMapped,
              seenAt,
              source: "spansh",
              bodyId64: id64,
            });
          }
        }
      }
    }

    if (failures.length >= maxFailures) break;
  }
  rl.close();

  let planetsWritten = 0;
  let systemsWithCoords = 0;
  // Nothing is written when a gate failed. A partially-imported corpus is worse than none, because
  // it looks finished.
  if (opts.apply && failures.length === 0) {
    planetsWritten = store.setBodyMapped(bodyUpdates);
    systemsWithCoords = store.setSystemCoordsById64(coordUpdates);
    store.persist();
  }

  return {
    manifest,
    linesRead,
    systemRows,
    bodyRows,
    matched,
    changed: bodyUpdates.length,
    mappedTrue,
    mappedFalse,
    planetsWritten,
    systemsWithCoords,
    failures,
    warnings,
    coverage: store.mappedCoverage(),
    elapsedMs: Date.now() - started,
  };
}

export function formatImportReport(r: ImportReport, applied: boolean): string {
  const out: string[] = [];
  const m = r.manifest;
  out.push(
    `Manifest           schema ${m?.schemaVersion ?? "?"}, source ${m?.source ?? "?"}, exported ${m?.exported ?? "?"}`,
  );
  out.push(`Read               ${r.linesRead.toLocaleString()} lines — ${r.systemRows.toLocaleString()} systems, ${r.bodyRows.toLocaleString()} bodies (${r.elapsedMs} ms)`);

  if (r.failures.length > 0) {
    out.push("");
    out.push(`GATE FAILURES      ${r.failures.length} — nothing was written`);
    for (const f of r.failures.slice(0, 10)) out.push(`   ${f}`);
    if (r.failures.length > 10) out.push(`   … and ${r.failures.length - 10} more`);
    return out.join("\n");
  }

  out.push(`Gates              probe, field lists, id64 identity, no oversized identifier — all passed`);
  if (r.warnings.length > 0) {
    const fields = [...new Set(r.warnings.map((w) => w.split(" = ")[0]))];
    out.push(
      `Warnings           ${r.warnings.length} oversized integers in quantity fields (${fields.join(", ")}) — ` +
        "harmless here, but §C.3 says they cannot exist",
    );
  }
  out.push("");
  out.push(
    `Joined by identity ${r.matched.toLocaleString()} of ${r.bodyRows.toLocaleString()} dump bodies matched a corpus row ` +
      `(no string comparison in the path)`,
  );
  out.push(`   new information ${r.changed.toLocaleString()}   (the rest the corpus already had)`);
  out.push(`   mapped          ${r.mappedTrue.toLocaleString()}   (a genus list proves a DSS)`);
  out.push(`   no evidence     ${r.mappedFalse.toLocaleString()}   (signal count only — not proof of unmapped)`);
  out.push(
    applied
      ? `Written            ${r.planetsWritten.toLocaleString()} planet rows, ${r.systemsWithCoords.toLocaleString()} system coordinate rows`
      : `Written            nothing — dry run. Re-run with --apply.`,
  );
  out.push("");
  out.push(
    `Corpus coverage    ${r.coverage.mapped.toLocaleString()} mapped, ${r.coverage.unmapped.toLocaleString()} unmapped, ` +
      `${(r.coverage.planets - r.coverage.mapped - r.coverage.unmapped).toLocaleString()} unknown of ${r.coverage.planets.toLocaleString()} bodies`,
  );
  return out.join("\n");
}
