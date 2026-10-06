/**
 * Where a species has been recorded, as points for a spatial gate (owner, 2026-10-06: Electricae
 * radialem predicted 5,000 ly from any nebula). Reads EDAstro's codex-data.csv, keeps the systems whose
 * Codex ID starts with the given prefix, merges them into cubes of `--cell` ly (each cube's centroid,
 * named after one of its systems) and writes them into `data/exomastery/spatial-catalogue.json` under
 * `records.<key>`.
 *
 *   npx tsx scripts/add-codex-records.ts <codex-data.csv> <codex-id-prefix> <key> [--cell 100]
 *   npx tsx scripts/add-codex-records.ts codex-data.csv codex_ent_electricae_02 radialem
 */
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpatialCatalogue, SpatialPoint } from "../src/shared/spatialGates.js";

const args = process.argv.slice(2);
const cellAt = args.indexOf("--cell");
const CELL = cellAt >= 0 ? Number(args[cellAt + 1]) : 100;
const [CSV, PREFIX, KEY] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--cell");
if (!CSV || !PREFIX || !KEY || !(CELL > 0)) {
  console.error("usage: npx tsx scripts/add-codex-records.ts <codex-data.csv> <codex-id-prefix> <key> [--cell 100]");
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

const cells = new Map<string, { n: string; sx: number; sy: number; sz: number; k: number }>();
for (const s of systems.values()) {
  const id = `${Math.floor(s.x / CELL)}:${Math.floor(s.y / CELL)}:${Math.floor(s.z / CELL)}`;
  const c = cells.get(id) ?? { n: s.n, sx: 0, sy: 0, sz: 0, k: 0 };
  c.sx += s.x;
  c.sy += s.y;
  c.sz += s.z;
  c.k++;
  if (!c.n && s.n) c.n = s.n;
  cells.set(id, c);
}
const round = (v: number) => Math.round(v * 10) / 10;
const points: SpatialPoint[] = [...cells.values()]
  .map((c) => ({ n: c.n, x: round(c.sx / c.k), y: round(c.sy / c.k), z: round(c.sz / c.k) }))
  .sort((a, b) => a.x - b.x || a.z - b.z);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "exomastery", "spatial-catalogue.json");
const cat = JSON.parse(readFileSync(file, "utf8")) as SpatialCatalogue;
cat.records = { ...(cat.records ?? {}), [KEY]: points };
cat.sources = {
  ...cat.sources,
  [`records.${KEY}`]: `edastro codex-data.csv, Codex ID ${prefix}*: ${systems.size} systems in ${points.length} cubes of ${CELL} ly`,
};
writeFileSync(file, JSON.stringify(cat) + "\n", "utf8");
console.log(`${KEY}: ${systems.size} systems -> ${points.length} points (${CELL} ly cubes) in ${file}`);
