/**
 * Give the profiles back the kelvin that EDSM threw away.
 *
 * **The defect.** Every `surfaceTemperature` in the shipped profiles is a whole number — 303 of 303
 * min/max/mode values — while gravity and pressure are full floats. It is not our rounding: 80.2 %
 * of the sample packs (41,159 of 51,340) arrive integer from EDSM's bodies endpoint. Gravity is
 * 0.0 % integer in the same packs and pressure 0.1 %, so this is temperature specifically.
 *
 * **What it costs.** `histogramBin` walks `value > edges[i]`, so a corpus `159` and a live
 * `159.864456` land in different bins. Tussock ventusa's histogram is `[0, 423, 0, …]` — everything
 * in bin 1, nothing in bin 2 — and a live float scored against an empty bin. All **7** ground-truth
 * misses across 439 scans sit above a ceiling by **under 0.9 K**, none below; sampling error misses
 * both ways by varying amounts, truncation misses one way by under a kelvin.
 *
 * **The source.** `galaxy_bio.jsonl.gz` is 88.5 % float and is the only clean one held locally. It
 * covers the corpus almost exactly: of 3,000 sampled corpus systems, 2,992 are in the dump, and of
 * 5,938 bodies, 5,923 — 99.7 % either way.
 *
 * ## The join is `(systemName, bodyId)`, and that is not a shortcut
 *
 * The obvious key is `id64`, which every pack carries and which the dump uses. **It cannot be used**,
 * because EDSM's own `id64` is already destroyed when it reaches us:
 *
 * ```
 *   Swoals CG-F d11-3 1 c     pack 864691242448492200   dump 864691242448492131
 *   Dryaea Bre CL-P d5-5 C 4  pack 1224979284746049000  dump 1224979284746048947
 *   Flimbuae ES-R d5-9 3 c    pack 1080864234109342700  dump 1080864234109342771
 * ```
 *
 * The pack values end in `200`, `000`, `700` — the signature of an integer that has been through a
 * double and printed back. EDSM serialises these ids as JSON numbers above 2^53, so the low bits are
 * gone *in the file*, before anything here reads it. Since `id64 == systemId64 + (bodyId << 55)`,
 * the bits it loses are precisely the system half. This is the same corruption the `import-dump`
 * gates exist to catch; it simply lives upstream of them, in the cached packs, where no gate in this
 * repository was looking.
 *
 * What survives is `bodyId` — small, exact, and identical on both sides — and the system's **name**,
 * which Elite guarantees unique. So the walk resolves a wanted system name to the dump's own
 * `systemId64` from its system row, then matches its bodies by `bodyId`, and checks the body name
 * agrees before believing any of it.
 *
 * ## Two decisions worth keeping
 *
 * **It writes a sidecar, not the packs.** A pack is EDSM's answer to a question, cached; editing
 * 41,159 of them in place would destroy that provenance and leave no way back except re-fetching a
 * corpus over a rate-limited API. The overlay is one file, applied at load, and deleting it undoes
 * everything this module did.
 *
 * **It only repairs what looks repairable.** A dump value is accepted only when the pack's value is
 * an integer, the dump's is not, the body names agree, and `Math.floor(dump) === pack`. That last
 * clause is the safety argument: truncation is the hypothesis, so a reading that does not truncate
 * back to the pack's is not the same measurement — a re-survey, a changed value, a different body —
 * and none of those are this module's business. They are counted and reported rather than dropped
 * quietly, because the count is how anyone would find out the hypothesis was wrong.
 */
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { rawPlanetsDir } from "./paths.js";

/** `raw/numeric-overlay.json` — the numerics this module restored, keyed by body name. */
export function numericOverlayPath(): string {
  return path.join(rawPlanetsDir(), "..", "numeric-overlay.json");
}

export type NumericOverlay = {
  builtAt: string;
  source: string;
  /**
   * Body name → restored values.
   *
   * Keyed by name rather than id because the id the profile builder will be holding is the damaged
   * one — see the note above. Elite's body names are unique galaxy-wide and are the only identifier
   * both sides agree on.
   */
  bodies: Record<string, { surfaceTemperature?: number }>;
};

export function readNumericOverlay(): NumericOverlay | null {
  const f = numericOverlayPath();
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as NumericOverlay;
    return j && typeof j === "object" && j.bodies ? j : null;
  } catch {
    return null;
  }
}

export type RehydrationReport = {
  packsRead: number;
  /** Distinct systems the candidates live in — what the dump walk has to find. */
  candidateSystems: number;
  /** Distinct bodies with an integer temperature: the repair candidates. */
  candidates: number;
  /** Candidate systems located in the dump. The gap is genuine coverage, not a join failure. */
  systemsFoundInDump: number;
  /** Candidate bodies located in the dump, by (systemId64, bodyId). */
  foundInDump: number;
  accepted: number;
  /** Rejected because the dump value was itself an integer — nothing to restore. */
  rejectedIntegerInDump: number;
  /** Rejected because `floor(dump) !== pack`. The count that would falsify the truncation story. */
  rejectedMismatch: number;
  /** Rejected because the dump's body name disagreed — a bodyId collision, and never expected. */
  rejectedNameMismatch: number;
  mismatchExamples: { body: string; pack: number; dump: number }[];
  dumpRows: number;
  elapsedMs: number;
};

type WantedBody = { packTemp: number; bodyName: string };

/**
 * Every pack body with an integer `surfaceTemperature`, grouped by system name then `bodyId`.
 *
 * A pack whose value is already a float is left alone entirely: it came from a source that had the
 * resolution, and replacing one float with another from a different source is not a repair, it is a
 * preference between measurements.
 */
export function collectIntegerTemperatureBodies(planetsDir = rawPlanetsDir()): {
  wanted: Map<string, Map<number, WantedBody>>;
  packsRead: number;
  bodyCount: number;
  /** Packs that carried an integer temperature but no usable system name or bodyId. */
  packsUnjoinable: number;
} {
  const wanted = new Map<string, Map<number, WantedBody>>();
  let packsRead = 0;
  let packsUnjoinable = 0;
  let bodyCount = 0;
  if (!existsSync(planetsDir)) return { wanted, packsRead, bodyCount, packsUnjoinable };

  for (const slug of readdirSync(planetsDir, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const dir = path.join(planetsDir, slug.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      packsRead += 1;
      let j: { systemName?: unknown; context?: { targetBody?: Record<string, unknown> } };
      try {
        j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      } catch {
        continue;
      }
      const body = j.context?.targetBody;
      if (!body) continue;
      const t = body.surfaceTemperature;
      if (typeof t !== "number" || !Number.isInteger(t)) continue;

      const systemName = typeof j.systemName === "string" ? j.systemName.trim() : "";
      const bodyId = body.bodyId;
      const bodyName = typeof body.name === "string" ? body.name : "";
      if (!systemName || typeof bodyId !== "number" || !bodyName) {
        packsUnjoinable += 1;
        continue;
      }
      let bySystem = wanted.get(systemName);
      if (!bySystem) {
        bySystem = new Map();
        wanted.set(systemName, bySystem);
      }
      if (!bySystem.has(bodyId)) {
        bySystem.set(bodyId, { packTemp: t, bodyName });
        bodyCount += 1;
      }
    }
  }
  return { wanted, packsRead, bodyCount, packsUnjoinable };
}

/** Read a string field off a raw line without parsing it. The dump writes no spaces after colons. */
function rawField(line: string, key: string): string | null {
  const at = line.indexOf(`"${key}":`);
  if (at < 0) return null;
  let i = at + key.length + 3;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
  if (line[i] !== '"') return null;
  const end = line.indexOf('"', i + 1);
  return end < 0 ? null : line.slice(i + 1, end);
}

/**
 * Stream the dump once and build the overlay.
 *
 * 57 million rows, of which about eleven thousand matter, so the cheap text reads above decide
 * whether a line is worth `JSON.parse` at all — the difference between four minutes and an
 * afternoon. Nothing is written unless `apply` is set, the same shape as `import-dump` and for the
 * same reason: a half-applied repair looks finished.
 */
export async function rehydrateNumericsFromDump(
  dumpFile: string,
  opts: { apply: boolean; planetsDir?: string; outFile?: string },
): Promise<RehydrationReport> {
  const startedAt = Date.now();
  const { wanted, packsRead, bodyCount, packsUnjoinable } = collectIntegerTemperatureBodies(opts.planetsDir);

  /** systemId64 of a wanted system → its bodies. Filled as the walk meets each system row. */
  const activeSystems = new Map<string, Map<number, WantedBody>>();
  const restored: Record<string, { surfaceTemperature?: number }> = {};
  const mismatchExamples: RehydrationReport["mismatchExamples"] = [];
  let systemsFoundInDump = 0;
  let foundInDump = 0;
  let accepted = 0;
  let rejectedIntegerInDump = 0;
  let rejectedMismatch = 0;
  let rejectedNameMismatch = 0;
  let dumpRows = 0;

  const rl = createInterface({
    input: createReadStream(dumpFile).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.length < 2) continue;
    dumpRows += 1;
    const isBody = line.startsWith('{"kind":"body"');

    if (!isBody) {
      // A system row. Remember its id64 only when we are actually looking for it.
      const name = rawField(line, "name");
      if (name === null) continue;
      const bodies = wanted.get(name);
      if (!bodies) continue;
      const id64 = rawField(line, "id64");
      if (id64 === null) continue;
      activeSystems.set(id64, bodies);
      systemsFoundInDump += 1;
      continue;
    }

    const systemId64 = rawField(line, "systemId64");
    if (systemId64 === null) continue;
    const bodies = activeSystems.get(systemId64);
    if (!bodies) continue;

    const parsed = JSON.parse(line) as {
      bodyId?: unknown;
      name?: unknown;
      surfaceTemperature?: unknown;
    };
    if (typeof parsed.bodyId !== "number") continue;
    const want = bodies.get(parsed.bodyId);
    if (!want) continue;
    foundInDump += 1;

    if (parsed.name !== want.bodyName) {
      rejectedNameMismatch += 1;
      continue;
    }
    const dumpT = parsed.surfaceTemperature;
    if (typeof dumpT !== "number" || !Number.isFinite(dumpT)) continue;
    if (Number.isInteger(dumpT)) {
      rejectedIntegerInDump += 1;
      continue;
    }
    if (Math.floor(dumpT) !== want.packTemp) {
      rejectedMismatch += 1;
      if (mismatchExamples.length < 12) {
        mismatchExamples.push({ body: want.bodyName, pack: want.packTemp, dump: dumpT });
      }
      continue;
    }
    restored[want.bodyName] = { surfaceTemperature: dumpT };
    accepted += 1;
  }
  rl.close();

  if (opts.apply) {
    const overlay: NumericOverlay = {
      builtAt: new Date().toISOString(),
      source: path.basename(dumpFile),
      bodies: restored,
    };
    writeFileSync(opts.outFile ?? numericOverlayPath(), `${JSON.stringify(overlay)}\n`, "utf8");
  }

  return {
    packsRead,
    candidateSystems: wanted.size,
    candidates: bodyCount,
    systemsFoundInDump,
    foundInDump,
    accepted,
    rejectedIntegerInDump,
    rejectedMismatch,
    rejectedNameMismatch,
    mismatchExamples,
    dumpRows,
    elapsedMs: Date.now() - startedAt,
  };
}

export function formatRehydrationReport(r: RehydrationReport, apply: boolean): string {
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
  const lines = [
    `  packs read                 ${r.packsRead}`,
    `  candidate bodies           ${r.candidates}  (integer temperature, distinct)`,
    `  in systems                 ${r.candidateSystems}`,
    `  dump rows                  ${r.dumpRows}`,
    `  systems found in dump      ${r.systemsFoundInDump}  (${pct(r.systemsFoundInDump, r.candidateSystems)} %)`,
    `  bodies found in dump       ${r.foundInDump}  (${pct(r.foundInDump, r.candidates)} %)`,
    `  restored to a float        ${r.accepted}  (${pct(r.accepted, r.candidates)} % of candidates)`,
    `  dump was integer too       ${r.rejectedIntegerInDump}  (nothing to restore)`,
    `  floor(dump) != pack        ${r.rejectedMismatch}  (left alone — not the same measurement)`,
    `  body name disagreed        ${r.rejectedNameMismatch}  (never expected)`,
    `  elapsed                    ${(r.elapsedMs / 1000).toFixed(1)} s`,
  ];
  if (r.mismatchExamples.length) {
    lines.push("", "  mismatches, first few:");
    for (const m of r.mismatchExamples) lines.push(`    ${m.body}  pack ${m.pack}  dump ${m.dump}`);
  }
  lines.push("", apply ? `  written: ${numericOverlayPath()}` : "  Nothing was written. Re-run with --apply.");
  return lines.join("\n");
}
