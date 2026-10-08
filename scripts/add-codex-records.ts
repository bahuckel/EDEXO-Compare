/**
 * Where a species grows in clusters, as points for a spatial gate (owner, 2026-10-08: Electricae
 * radialem clusters mark nebulae the catalogue lacks; a lone find is a planetary nebula, in-system, and
 * does not count). Reads EDAstro's codex-data.csv, keeps the systems whose Codex ID starts with the
 * given prefix, one per system, and of those only the ones with at least `--min` other such systems
 * within `--radius` ly; writes them into `data/exomastery/spatial-catalogue.json` under `records.<key>`.
 *
 *   npx tsx scripts/add-codex-records.ts <codex-data.csv> <codex-id-prefix> <key> [--radius 100] [--min 2]
 *   npx tsx scripts/add-codex-records.ts codex-data.csv codex_ent_electricae_02 radialem
 */
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpatialCatalogue, SpatialPoint } from "../src/shared/spatialGates.js";

const args = process.argv.slice(2);
const opt = (name: string, dflt: number) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : dflt;
};
const RADIUS = opt("--radius", 100);
const MIN = opt("--min", 2);
const [CSV, PREFIX, KEY] = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
if (!CSV || !PREFIX || !KEY || !(RADIUS > 0) || !(MIN >= 0)) {
  console.error("usage: npx tsx scripts/add-codex-records.ts <codex-data.csv> <codex-id-prefix> <key> [--radius 100] [--min 2]");
  process.exit(1);
}

/** One CSV line, honouring quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const prefix = PREFIX.toLowerCase();
const systems = new Map<string, { n: string; x: number; y: number; z: number }>();
const rl = createInterface({ input: createReadStream(CSV), crlfDelay: Infinity });
let first = true;
for await (const line of rl) {
  if (first) {
    first = false;
    continue;
  }
  if (!line.toLowerCase().includes(prefix)) continue;
  const f = splitCsv(line);
  if (!(f[1] ?? "").toLowerCase().startsWith(prefix)) continue;
  const [x, y, z] = [Number(f[6]), Number(f[7]), Number(f[8])];
  if (![x, y, z].every(Number.isFinite)) continue;
  const key = f[10] || f[5] || `${x}:${y}:${z}`;
  if (!systems.has(key)) systems.set(key, { n: f[5] ?? "", x, y, z });
}

// Neighbours within RADIUS, through a grid of RADIUS-sized cubes.
const list = [...systems.values()];
const cubeOf = (s: { x: number; y: number; z: number }) =>
  [Math.floor(s.x / RADIUS), Math.floor(s.y / RADIUS), Math.floor(s.z / RADIUS)] as const;
const grid = new Map<string, number[]>();
list.forEach((s, i) => {
  const k = cubeOf(s).join(":");
  grid.set(k, [...(grid.get(k) ?? []), i]);
});
const clustered = list.filter((s, i) => {
  const [cx, cy, cz] = cubeOf(s);
  let n = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of grid.get(`${cx + dx}:${cy + dy}:${cz + dz}`) ?? []) {
          if (j === i) continue;
          const o = list[j]!;
          if (Math.hypot(s.x - o.x, s.y - o.y, s.z - o.z) <= RADIUS) n++;
        }
  return n >= MIN;
});
const round = (v: number) => Math.round(v * 10) / 10;
const points: SpatialPoint[] = clustered
  .map((s) => ({ n: s.n, x: round(s.x), y: round(s.y), z: round(s.z) }))
  .sort((a, b) => a.x - b.x || a.z - b.z);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "exomastery", "spatial-catalogue.json");
const cat = JSON.parse(readFileSync(file, "utf8")) as SpatialCatalogue;
cat.records = { ...(cat.records ?? {}), [KEY]: points };
cat.sources = {
  ...cat.sources,
  [`records.${KEY}`]: `edastro codex-data.csv, Codex ID ${prefix}*: ${points.length} of ${systems.size} systems, those with ${MIN}+ others within ${RADIUS} ly`,
};
writeFileSync(file, JSON.stringify(cat) + "\n", "utf8");
console.log(`${KEY}: ${systems.size} systems -> ${points.length} in clusters (${MIN}+ others within ${RADIUS} ly) in ${file}`);
