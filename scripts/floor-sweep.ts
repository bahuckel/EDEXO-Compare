/**
 * Re-sweep the observation floors — how much corpus evidence overrules the codex.
 *
 * Each floor in `src/server/species*Observations.ts` was chosen by measuring, and each was measured
 * against a smaller corpus than the one on disk now. This runs that measurement again, one floor at
 * a time, so a decision to move one is a reading rather than a preference.
 *
 * It drives `accuracy-probe.ts` in a child process with `EDEXO_FLOOR_<NAME>` set, because the floors
 * are read once at module load and a single process cannot try two of them. Each run costs about two
 * and a half minutes, so a full grid is hours — pass only the values worth asking about.
 *
 *   npx tsx scripts/floor-sweep.ts                       # the default plan, ~25 min
 *   npx tsx scripts/floor-sweep.ts VOLCANISM 1 3 5 10    # one dimension, chosen values
 *
 * What to read. **Recall** is the cost side: a floor that hides corpus evidence loses species the
 * commander actually found, and a species missed is a body flown to for nothing. **Decidability** is
 * the benefit side — the share of bodies where the candidate genera exactly equal the signal count,
 * so the app can say "these are here" instead of "one of these twelve". Ambiguity is the mean
 * candidate count and moves with decidability, so it is reported but rarely decides anything.
 *
 * A floor should only move if it buys decidability without costing recall. Raising one always
 * *looks* better on precision — fewer candidates is trivially more precise — which is why precision
 * is not the number to steer by.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The values worth asking about, either side of each shipped floor. */
const PLAN: Record<string, number[]> = {
  VOLCANISM: [3, 5, 10],
  ATMOSPHERE: [5, 10, 20],
  CLASS: [10, 20, 30],
  TEMPERATURE: [10, 20, 30],
  GRAVITY: [5, 10, 20],
};

interface Result {
  dimension: string;
  floor: number | "shipped";
  speciesRecall: number | null;
  genusRecall: number | null;
  ambiguity: number | null;
  decidablePct: number | null;
  decidedRight: string | null;
  missed: number | null;
}

/**
 * Pull the SHOWN-tier FSS-only block, which is the panel the commander actually sees.
 *
 * Deliberately anchored to the "SHOWN" heading rather than matching the first occurrence of each
 * label: the probe prints the same labels again for the unlikely tier and for the post-DSS scenario,
 * and reading those instead would answer a question nobody asked.
 */
function parse(out: string): Omit<Result, "dimension" | "floor"> {
  const shown = out.slice(out.indexOf("SHOWN — the default panel"));
  const block = shown.slice(0, shown.indexOf("unlikely tier"));
  const num = (re: RegExp, src = block) => {
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };
  const dec = out.slice(out.indexOf("decidability (FSS-only, SHOWN tier"));
  const decBlock = dec.slice(0, dec.indexOf("──", 10) === -1 ? undefined : dec.indexOf("──", 10));
  return {
    speciesRecall: num(/species recall\s+([\d.]+)%/),
    genusRecall: num(/genus recall\s+([\d.]+)%/),
    ambiguity: num(/ambiguity\s+mean\s+([\d.]+)/),
    missed: num(/species recall\s+[\d.]+%\s+\(\d+ found, (\d+) missed\)/),
    decidablePct: num(/DECIDABLE\s+\d+\s+\(([\d.]+)%\)/, decBlock),
    decidedRight: decBlock.match(/decided & right\s+(\S+)/)?.[1] ?? null,
  };
}

function run(env: Record<string, string>): string {
  // Relative, not absolute: `shell: true` is needed on Windows to find npx, and the shell splits an
  // unquoted absolute path at the space in "Cursor Projects". `cwd` already points at the repo.
  const r = spawnSync("npx", ["tsx", "scripts/accuracy-probe.ts"], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`probe failed (${r.status})\n${r.stderr?.slice(0, 2000)}`);
  return r.stdout;
}

const args = process.argv.slice(2);
const plan: Record<string, number[]> =
  args.length >= 2 ? { [args[0]!.toUpperCase()]: args.slice(1).map(Number) } : PLAN;

const runs = Object.values(plan).reduce((a, v) => a + v.length, 0) + 1;
console.log(`${runs} probe runs at ~2.5 min each — roughly ${Math.round((runs * 2.5) / 5) * 5} min.\n`);

const results: Result[] = [];
console.log("baseline (shipped floors)…");
results.push({ dimension: "—", floor: "shipped", ...parse(run({})) });

for (const [dim, values] of Object.entries(plan)) {
  for (const v of values) {
    console.log(`${dim} = ${v}…`);
    results.push({ dimension: dim, floor: v, ...parse(run({ [`EDEXO_FLOOR_${dim}`]: String(v) })) });
  }
}

const base = results[0]!;
const d = (a: number | null, b: number | null) =>
  a == null || b == null ? "" : `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)}`;

console.log("\n" + "dimension".padEnd(13) + "floor".padStart(6) + "recall".padStart(9) + "Δ".padStart(7) +
  "genus".padStart(8) + "decidable".padStart(11) + "Δ".padStart(7) + "ambig".padStart(8) + "missed".padStart(8));
for (const r of results) {
  console.log(
    r.dimension.padEnd(13) +
      String(r.floor).padStart(6) +
      `${r.speciesRecall?.toFixed(1) ?? "?"}%`.padStart(9) +
      d(r.speciesRecall, base.speciesRecall).padStart(7) +
      `${r.genusRecall?.toFixed(1) ?? "?"}%`.padStart(8) +
      `${r.decidablePct?.toFixed(1) ?? "?"}%`.padStart(11) +
      d(r.decidablePct, base.decidablePct).padStart(7) +
      `${r.ambiguity?.toFixed(2) ?? "?"}`.padStart(8) +
      `${r.missed ?? "?"}`.padStart(8),
  );
}
console.log(`\ndecided & right stayed ${base.decidedRight} at the shipped floors.`);
console.log("Move a floor only where decidability rises and recall does not fall.");
