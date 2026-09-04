/**
 * A8 — what changes when the background includes bodies with nothing on them.
 *
 * Every profile the feeder builds is positive-only: it records where a species *was* seen, and the
 * background it is measured against is the pool of other species' bodies. So "Stratum tectonicas
 * lives on high-metal-content bodies" and "the bodies people scan for exobiology are mostly
 * high-metal-content" are the same shape of evidence, and §11.2 flagged that we could not tell a
 * wide wall from an unconstrained parameter without a background of *available* bodies.
 *
 * The commander's own journal is that background, free and local: every body FSS-resolved in a
 * system where the FSS ran, with its physics, split by whether the game reported biological signals
 * on it. Bodies in systems the commander never honked are excluded — an absent signal there means
 * nobody looked, not that nothing grows.
 *
 * Four measurements:
 *
 *  1. **P(biology | class · atmosphere)** over the available bodies. Descriptive, and it is a number
 *     nobody in this project has ever had.
 *  2. **How much biology itself narrows each parameter**, against availability rather than against
 *     other species. §11.2's question, asked directly.
 *  3. **P(biology | volcanism) on airless bodies** — the one population the matcher has to judge
 *     without an atmosphere to go on.
 *  4. **What the matcher offers on a body the game says is empty** — the false-positive rate against
 *     real negatives, which no probe has ever measured because every probe corpus has biology on it.
 *
 * The app itself never shows a candidate on a body whose FSS biological count is zero
 * (`gameState.listBioBodies` drops it), so (4) is the model's own answer with the count taken away —
 * a measure of the gates rather than of the panel.
 *
 *   npm run negatives-probe
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { resolveJournalMergeCacheRoot } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import {
  binIndex,
  bucketCategoricalValue,
  determinismVsBackground,
  quantileBins,
  type CategoricalCounts,
} from "../src/feeder/parameterImportance.js";
import type { BodyExoState, PlanetScan } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const payloadPath = path.join(resolveJournalMergeCacheRoot(), "journal-merge.payload.v8gz");
if (!existsSync(payloadPath)) {
  console.error(`No journal merge cache at ${payloadPath}. Run the app once to build it.`);
  process.exit(1);
}
const rawCache = readFileSync(payloadPath);
const doc =
  rawCache[0] === 0x1f && rawCache[1] === 0x8b
    ? v8.deserialize(gunzipSync(rawCache))
    : JSON.parse(rawCache.toString("utf8"));
const payload = decodeJournalMergeCache(doc);
if (!payload) {
  console.error("Cache is not in the current encoding; delete it and let the app rebuild.");
  process.exit(1);
}
const allBodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

/**
 * Systems where the FSS demonstrably ran.
 *
 * `FSSAllBodiesFound` is the clean signal and the store holds it for 29 systems — too few. A system
 * that produced any `FSSBodySignals` line, or a `FSSDiscoveryScan`, was honked too, and in a honked
 * system a body with no signal record has no biology rather than no observer.
 */
const fssRan = new Set<number>([
  ...(payload.fssAllBodiesCompleteSystems ?? []),
  ...(payload.fssDiscoveryScanBySystem ?? []).map(([addr]) => addr),
]);
for (const b of allBodies) if ((b.biologicalSignals ?? 0) > 0) fssRan.add(b.systemAddress);

interface Sample {
  body: BodyExoState;
  scan: PlanetScan;
  bio: boolean;
}

const samples: Sample[] = [];
for (const b of allBodies) {
  const scan = b.scan;
  if (!scan?.PlanetClass?.trim() || !scan.Landable) continue;
  if (!fssRan.has(b.systemAddress)) continue;
  // A body with no biology has no `FSSBodySignals` line at all, so its count is null rather than 0.
  // In a system the FSS ran, that silence is the negative — which is the whole point of this probe,
  // and reading it as "unknown" is what made the first run report 1,096 bodies and no background.
  samples.push({ body: b, scan, bio: (b.biologicalSignals ?? 0) > 0 });
}

const withBio = samples.filter((s) => s.bio);
const noBio = samples.filter((s) => !s.bio);
console.log(
  `\navailable bodies: ${samples.length} landable and FSS-resolved in ${fssRan.size} systems` +
    `   —   ${withBio.length} carry biology, ${noBio.length} carry none`,
);

/* ── 1. What physics carries biology ─────────────────────────────────── */

function classKey(s: PlanetScan): string {
  const atmo = bucketCategoricalValue("body.atmosphereType", s.AtmosphereType?.trim() || "None");
  return `${s.PlanetClass} · ${atmo}`;
}

const byClass = new Map<string, { bio: number; n: number }>();
for (const s of samples) {
  const k = classKey(s.scan);
  const row = byClass.get(k) ?? { bio: 0, n: 0 };
  row.n++;
  if (s.bio) row.bio++;
  byClass.set(k, row);
}

console.log("\n── P(biology | class · atmosphere), n >= 40 ────────────");
const rows = [...byClass.entries()]
  .map(([k, v]) => ({ k, ...v, rate: v.bio / v.n }))
  .filter((r) => r.n >= 40)
  .sort((a, b) => b.rate - a.rate);
for (const r of rows) {
  console.log(`  ${(r.rate * 100).toFixed(1).padStart(5)} %   ${String(r.n).padStart(5)} bodies   ${r.k}`);
}

/* ── 2. Does the background change the answer? ────────────────────────── */

/**
 * Determinism for one species' parameter, measured twice inside the same sample.
 *
 * The species distribution comes from the bodies where the commander actually found it, so it is
 * thin — but both backgrounds are measured over the same bodies, so the comparison is fair even
 * where the absolute numbers are not worth much.
 */
const NUMERIC_PATHS: { path: string; get: (s: PlanetScan) => number | null }[] = [
  { path: "body.gravity", get: (s) => (s.SurfaceGravity != null ? s.SurfaceGravity / 9.80665 : null) },
  { path: "body.surfaceTemperature", get: (s) => s.SurfaceTemperature ?? null },
  { path: "body.surfacePressure", get: (s) => s.SurfacePressure ?? null },
];

const CATEGORICAL_PATHS: { path: string; get: (s: PlanetScan) => string }[] = [
  { path: "body.subType", get: (s) => s.PlanetClass ?? "" },
  { path: "body.atmosphereType", get: (s) => s.AtmosphereType?.trim() || "None" },
];

function countsFor(list: Sample[], get: (s: PlanetScan) => string, path: string): CategoricalCounts {
  const out: CategoricalCounts = {};
  for (const s of list) {
    const v = bucketCategoricalValue(path, get(s.scan));
    if (!v) continue;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function numericCounts(
  list: Sample[],
  get: (s: PlanetScan) => number | null,
  edges: number[],
): CategoricalCounts {
  const out: CategoricalCounts = {};
  for (const s of list) {
    const v = get(s.scan);
    if (v == null || !Number.isFinite(v)) continue;
    const k = String(binIndex(edges, v));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * How much biology itself narrows each parameter, against what is available.
 *
 * This is section 11.2's question at population level: if the bodies carrying biology are already a
 * narrow slice of the landable bodies, then a species measured only against other species' bodies is
 * being scored inside that slice, and its apparent indifference to a parameter may be the slice's
 * concentration rather than the species' own.
 */
console.log("");
console.log("how much biology narrows each parameter");
console.log("   determinism of the biology-bearing population against every landable body");

for (const { path: p, get } of CATEGORICAL_PATHS) {
  const d = determinismVsBackground(countsFor(withBio, get, p), countsFor(samples, get, p));
  if (d == null) continue;
  console.log(`  ${p.padEnd(28)} ${d.toFixed(3).padStart(6)}`);
}

for (const { path: p, get } of NUMERIC_PATHS) {
  const values = samples.map((s) => get(s.scan)).filter((v): v is number => v != null && Number.isFinite(v));
  const edges = quantileBins(values);
  if (edges.length === 0) continue;
  const d = determinismVsBackground(numericCounts(withBio, get, edges), numericCounts(samples, get, edges));
  if (d == null) continue;
  console.log(`  ${p.padEnd(28)} ${d.toFixed(3).padStart(6)}`);
}

/* Airless bodies: the one place the matcher has to guess without an atmosphere to go on. */

const airless = samples.filter((s) => !(s.scan.AtmosphereType?.trim() && s.scan.AtmosphereType !== "None"));
const byVolc = new Map<string, { bio: number; n: number }>();
for (const s of airless) {
  const v = bucketCategoricalValue("body.volcanismType", s.scan.Volcanism?.trim() || "none");
  const row = byVolc.get(v) ?? { bio: 0, n: 0 };
  row.n++;
  if (s.bio) row.bio++;
  byVolc.set(v, row);
}
console.log("");
console.log(`P(biology | volcanism) on the ${airless.length} airless bodies`);
for (const [v, r] of [...byVolc.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10)) {
  console.log(`  ${((r.bio / r.n) * 100).toFixed(1).padStart(5)} %   ${String(r.n).padStart(5)}   ${v}`);
}

/* ── 3. What the matcher says about an empty body ─────────────────────── */

console.log("\n── the matcher on bodies the game says are empty ───────");
let shownSum = 0;
let unlikelySum = 0;
let anyShown = 0;
const worst: { name: string; n: number; klass: string }[] = [];
/** Which species keep turning up where the game says nothing grows, and on what kind of body. */
const offenders = new Map<string, number>();
const offenderClass = new Map<string, number>();
for (const s of noBio) {
  const matches = matchDatabaseToScan(db, s.scan, null, null, { includeBacterium: true }).matches;
  const shown = matches.filter((m) => !m.unlikely && !m.entry.predictionUnsupported);
  shownSum += shown.length;
  unlikelySum += matches.length - shown.length;
  if (shown.length > 0) anyShown++;
  if (shown.length >= 6)
    worst.push({ name: s.body.bodyName ?? "?", n: shown.length, klass: classKey(s.scan) });
  for (const m of shown) offenders.set(m.entry.id, (offenders.get(m.entry.id) ?? 0) + 1);
  for (const m of shown) offenderClass.set(classKey(s.scan), (offenderClass.get(classKey(s.scan)) ?? 0) + 1);
}
console.log(
  `  ${noBio.length} bodies with zero biological signals: ${anyShown} would list at least one candidate` +
    ` (${((anyShown / noBio.length) * 100).toFixed(1)} %)`,
);
console.log(
  `  mean candidates shown ${(shownSum / noBio.length).toFixed(2)}, mean demoted ${(unlikelySum / noBio.length).toFixed(2)}`,
);
console.log("  most often offered on an empty body:");
for (const [id, n] of [...offenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${String(n).padStart(4)}  ${id}`);
}
console.log("  the bodies they are offered on:");
for (const [k, n] of [...offenderClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`    ${String(n).padStart(4)}  ${k}`);
}
worst.sort((a, b) => b.n - a.n);
for (const w of worst.slice(0, 5)) console.log(`    ${String(w.n).padStart(3)} on ${w.name}   ${w.klass}`);
console.log(
  "\n  The app never shows these: a body whose FSS count is 0 is dropped from the bio list outright\n" +
    "  (gameState.listBioBodies). This is the model's own answer with the count taken away.",
);
console.log("");
