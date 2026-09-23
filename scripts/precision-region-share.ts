/**
 * Calibrating a relative region test before it touches the matcher.
 *
 *   npx tsx scripts/precision-region-share.ts
 *
 * ## The gap
 *
 * The region rule asks a yes/no question: is a species under 0.02 % of a region's recorded bio
 * systems? That is an absolute measure, and it misses the case the separator search kept finding —
 * two species of one genus that live in different regions, where the minority is rare but not
 * *that* rare. Tussock divisa in Galactic Centre: 12 of 53,631 systems, 0.022 %, "present" — beside
 * cultro's thousands. Four smaller regions are "unknown" outright, under the 25,000-system floor.
 *
 * ## The relative question
 *
 * Given that this genus is on the body, which of its species is it? In a region, the record says:
 * a species' **share of its own genus' records there**. That needs no galaxy-wide floor — only
 * enough records of the genus in the region to mean something — and it compares like with like.
 *
 * ## What this measures
 *
 * Phase 1's slots (`phase1-slots.jsonl`) already hold, per body and genus, the species the app
 * shows. For a grid of (share cut, minimum genus records) this demotes every shown species whose
 * share falls under the cut, and reports what the truth and the slot sizes do — overall and per
 * source, since the journal and capture rows are the ones the rollup did not see built. A slot the
 * test would empty keeps its whole list, which is what the shipped rule does: it breaks ties between
 * siblings and never demotes the last one standing.
 *
 * Read it against a phase-1 run made **without** the rule (its slots are the input), or the rule is
 * measured on lists it has already trimmed.
 *
 * Output: stdout and `docs/precision/region-share.md` (local only).
 */
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { loadRegionSpecies } from "../src/server/regionSpeciesData.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { precisionDir, root } from "./precisionReplay.js";

interface Slot {
  body: string;
  truth: string;
  source: "journal" | "capture" | "corpus";
  region: string | null;
  post: { shown: string[] };
}
const slots: Slot[] = readFileSync(path.join(precisionDir, "phase1-slots.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Slot);

const data = loadRegionSpecies(root);
const map = loadRegionMap(root);
if (!data?.regions || !map) throw new Error("no region rollup or region map");
const indexOf = new Map(map.regions.map((n, i) => [n, i]));
const vocabulary = new Set(data.speciesIds ?? []);
/** `tussock_tussock_divisa` → `tussock_tussock`: the genus, as the species ids spell it. */
const genusKey = (id: string) => id.slice(0, id.lastIndexOf("_"));

/** Share of its genus' records in the region, and how many records the genus has there. */
function share(regionName: string | null, id: string): { share: number; genusRecords: number } | null {
  if (!regionName || !vocabulary.has(id)) return null;
  const row = data!.regions![String(indexOf.get(regionName))];
  if (!row) return null;
  const g = genusKey(id);
  let total = 0;
  for (const [sid, n] of Object.entries(row.species)) if (genusKey(sid) === g) total += n;
  if (!total) return null;
  return { share: (row.species[id] ?? 0) / total, genusRecords: total };
}

const CUTS = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.05];
const MINS = [50, 200, 1000];

interface Result {
  cut: number;
  min: number;
  shown: number;
  sizes: number[];
  bySource: Map<string, { n: number; shown: number; sizes: number[] }>;
  lost: Map<string, number>;
}
function run(cut: number, min: number): Result {
  const r: Result = { cut, min, shown: 0, sizes: [], bySource: new Map(), lost: new Map() };
  for (const s of slots) {
    // As shipped (`demoteRegionallyRareSiblings`): only between siblings shown together, and never
    // the last one — a slot the test would empty keeps its whole list.
    let kept = s.post.shown.filter((id) => {
      const v = share(s.region, id);
      return !v || v.genusRecords < min || v.share >= cut;
    });
    if (kept.length === 0) kept = s.post.shown;
    const hit = kept.includes(s.truth);
    if (hit) r.shown += 1;
    else if (s.post.shown.includes(s.truth)) r.lost.set(s.truth, (r.lost.get(s.truth) ?? 0) + 1);
    r.sizes.push(kept.length);
    const b = r.bySource.get(s.source) ?? { n: 0, shown: 0, sizes: [] };
    b.n += 1;
    if (hit) b.shown += 1;
    b.sizes.push(kept.length);
    r.bySource.set(s.source, b);
  }
  return r;
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)} %` : "—");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const one = (xs: number[]) => pc(xs.filter((n) => n === 1).length, xs.length);

const baseline = run(0, 0);
const out: string[] = [
  `# Relative region test — calibration`,
  ``,
  `Generated ${new Date().toISOString()} by \`scripts/precision-region-share.ts\`. ${slots.length} slots from phase 1. Local only.`,
  ``,
  `| cut (share of genus) | min genus records | truth shown | lost vs now | mean size | size 1 | journal truth | capture truth |`,
  `|---:|---:|---:|---:|---:|---:|---:|---:|`,
  `| — | — | ${pc(baseline.shown, slots.length)} | — | ${mean(baseline.sizes).toFixed(3)} | ${one(baseline.sizes)} | ${pc(baseline.bySource.get("journal")?.shown ?? 0, baseline.bySource.get("journal")?.n ?? 0)} | ${pc(baseline.bySource.get("capture")?.shown ?? 0, baseline.bySource.get("capture")?.n ?? 0)} |`,
];
const results: Result[] = [];
for (const min of MINS) {
  for (const cut of CUTS) {
    const r = run(cut, min);
    results.push(r);
    const j = r.bySource.get("journal");
    const c = r.bySource.get("capture");
    out.push(
      `| ${(cut * 100).toFixed(2)} % | ${min} | ${pc(r.shown, slots.length)} | ${baseline.shown - r.shown} | ${mean(r.sizes).toFixed(3)} | ${one(r.sizes)} | ${pc(j?.shown ?? 0, j?.n ?? 0)} | ${pc(c?.shown ?? 0, c?.n ?? 0)} |`,
    );
  }
}
out.push(``, `## Who loses their own slots, per setting`, ``);
for (const r of results) {
  const top = [...r.lost].sort((a, b) => b[1] - a[1]).slice(0, 6);
  out.push(`- ${(r.cut * 100).toFixed(2)} % / ${r.min}: ${top.map(([k, n]) => `${k.split("_").pop()} ${n}`).join(", ") || "none"}`);
}
writeFileSync(path.join(precisionDir, "region-share.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
