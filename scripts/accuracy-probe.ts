/**
 * Predictor accuracy harness.
 *
 * Ground truth comes from the journal itself: every body where a `ScanOrganic` resolved to a
 * species is a body where we know what actually grew there. For each one this re-runs the matcher
 * on the merged scan **without** the organic locks, so it cannot see the answer, and reports:
 *
 *   - **recall** — was the species the commander actually found in the candidate list at all;
 *   - **ambiguity** — how many candidates the user was left to choose between.
 *
 * Both numbers matter. Widening a gate always buys recall and always costs ambiguity, so a change
 * is only an improvement if it moves one without wrecking the other.
 *
 *   npx tsx scripts/accuracy-probe.ts
 *   USE_FEEDER_TEMP=1 npx tsx scripts/accuracy-probe.ts     # observed ranges instead of codex gates
 *   NO_HINTS=1 npx tsx scripts/accuracy-probe.ts            # post-FSS: the scenario the app is for
 *   USE_MEASURED_TEMP=1 npx tsx scripts/accuracy-probe.ts   # note: needs the matchSpecies edit too
 *
 * It reads the local journal merge cache, so the numbers are specific to this commander's history.
 * Run the app once first if the cache does not exist yet.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import v8 from "node:v8";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { resolveJournalMergeCacheRoot } from "../src/server/paths.js";
import type { BodyExoState } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

/**
 * Swap each species' codex temperature gate for the range actually observed in its exomastery
 * feeder profile. Profiles with fewer than 20 samples are left alone — one or two observations say
 * nothing about a range.
 */
if (process.env.USE_FEEDER_TEMP === "1") {
  let patched = 0;
  for (const e of db.species) {
    const dir = path.join(root, "data", "species", e.genusDataDir, "exomastery");
    if (!existsSync(dir)) continue;
    const slug = e.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const file = readdirSync(dir).find((f) => f.toLowerCase() === `${slug}_exomastery.json`);
    if (!file) continue;
    try {
      const prof = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
        numerics?: Record<string, { min: number; max: number; count: number }>;
      };
      const t = prof.numerics?.["body.surfaceTemperature"];
      if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max) || (t.count ?? 0) < 20) continue;
      (e.criteria as Record<string, unknown>).surfaceTemperatureK = { min: t.min, max: t.max };
      patched++;
    } catch {
      /* keep the codex gate */
    }
  }
  console.log(`temperature gates replaced from feeder profiles: ${patched}`);
}

const payloadPath = path.join(resolveJournalMergeCacheRoot(), "journal-merge.payload.v8gz");
if (!existsSync(payloadPath)) {
  console.error(`No journal merge cache at ${payloadPath}. Run the app once to build it.`);
  process.exit(1);
}
const raw = readFileSync(payloadPath);
const doc =
  raw[0] === 0x1f && raw[1] === 0x8b ? v8.deserialize(gunzipSync(raw)) : JSON.parse(raw.toString("utf8"));
const payload = decodeJournalMergeCache(doc);
if (!payload) {
  console.error("Cache is not in the current encoding; delete it and let the app rebuild.");
  process.exit(1);
}

const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

/**
 * The DSS genus list never arrives before travelling — measured over 244 journals,
 * `FSSBodySignals` carries `Genuses` zero times and `SAASignalsFound` carries it every time.
 * Every truth body here has been landed on, so it always has hints; withholding them is the
 * only way to measure the post-FSS case, which is the one the app exists for. Report both.
 */
const fssOnly = process.env.NO_HINTS === "1";

let truthBodies = 0;
let hit = 0;
let miss = 0;
const candCounts: number[] = [];
const genusMiss = new Map<string, number>();
const missExamples: string[] = [];

for (const b of bodies) {
  const truth = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
  if (!truth.length || !b.scan?.PlanetClass?.trim()) continue;
  truthBodies++;

  const hints = fssOnly ? null : (b.genusHints ?? null);
  const r = matchDatabaseToScan(db, b.scan, hints, null, { includeBacterium: true });
  const ids = new Set(r.matches.map((m) => m.entry.id));
  candCounts.push(ids.size);

  for (const t of truth) {
    if (ids.has(t)) {
      hit++;
      continue;
    }
    miss++;
    const g = t.split("_")[0]!;
    genusMiss.set(g, (genusMiss.get(g) ?? 0) + 1);
    if (missExamples.length < 15) {
      missExamples.push(
        `${t} on ${b.bodyName} (${b.scan.PlanetClass}, ${Math.round(b.scan.SurfaceTemperature ?? 0)} K, ` +
          `${(b.scan.SurfaceGravity ?? 0).toFixed(2)} m/s², ${b.scan.AtmosphereType ?? "-"}) — ${ids.size} candidates`,
      );
    }
  }
}

const sorted = [...candCounts].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const mean = candCounts.reduce((s, x) => s + x, 0) / candCounts.length;

console.log(
  `\nscenario:     ${fssOnly ? "FSS-only (DSS genus hints withheld)" : "post-DSS (genus hints supplied)"}`,
);
console.log(`\nground truth: ${truthBodies} bodies, ${hit + miss} confirmed species`);
console.log(`recall:       ${((hit / (hit + miss)) * 100).toFixed(1)}%  (${hit} found, ${miss} missed)`);
console.log(
  `ambiguity:    mean ${mean.toFixed(2)}  p50 ${pct(50)}  p90 ${pct(90)}  max ${sorted[sorted.length - 1]}`,
);

if (miss) {
  console.log(
    `\nmisses by genus: ${[...genusMiss.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g} ${n}`)
      .join(", ")}`,
  );
  for (const e of missExamples) console.log(`  ${e}`);
}
