/**
 * Build the galaxy biology index: which species are known to be in which system.
 *
 * This is the layer that makes a galaxy-wide value filter possible. "Show me systems holding
 * something that pays 19 M or more" is a question about 1.7 million systems, and neither the journal
 * (where this commander has been) nor the corpus (where the feeder has profiles) can answer it.
 *
 * Source is edastro's codex export — species-level sightings with a system id64 and coordinates.
 * The Spansh galaxy export cannot serve here: a DSS genus list proves *genus*, and a value filter is
 * a question about species, since Tussock Propagito pays 1 000 000 and Tussock Pennata 5 853 800.
 *
 *   npx tsx scripts/build-bio-index.ts <codex-data.csv> <bioforge-stats-dir> [--out <file>]
 *
 * Paths are arguments, never constants: the inputs live on whichever drive the owner keeps them on
 * and machine paths must not enter this repo.
 *
 * ## The two joins, both of which fail silently if done naively
 *
 * **Codex id → species.** The file carries species ids (`codex_ent_stratum_07`) *and* material or
 * colour variants of them (`codex_ent_bacterial_04_yttrium`). Matching ids exactly keeps 0.5 % of the
 * biology rows and reports a clean, small, wrong answer. Key on the `codex_ent_<genus>_<nn>` prefix.
 *
 * **Species name → our tree.** Bioforge names structures colour-first (`Gypseeum Brain Tree`), the
 * species tree genus-first (`Brain Tree Gypseeum`). A positional compare resolves 90 of 108 and looks
 * like honest absence; a sorted word bag resolves 102. The remaining six are real: Bioforge splits
 * Anemone into six colour species where this project models one.
 *
 * ## Format
 *
 * Fixed-stride records so a lookup is a binary search rather than a parse, and the species lists in
 * one run afterwards so the stride stays constant. Offsets are not stored — they are a prefix sum
 * over `speciesCount`, which the loader builds once and which saves 6.8 MB on disk.
 *
 *   magic "EDEXOBIO" | u16 version | u16 speciesCount | u32 systemCount | u32 jsonLen
 *   species table (JSON: our species ids, in index order)
 *   systems, ascending by id64:  u64 id64 | f32 x | f32 y | f32 z | u8 regionId | u8 speciesCount
 *   species run: one u8 index per (system, species), in system order
 *   name run:    u8 byte-length + UTF-8 name per system, in system order
 *
 * v2 added the names. Without them the index can locate a system but cannot say what to type into
 * the galaxy map, which is the one thing a commander does with the answer.
 */
import { createReadStream, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRegionName, regionIndexForCoords, type RegionMapData } from "../src/shared/regionMap.js";

const MAGIC = "EDEXOBIO";
const VERSION = 2;

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1]! : "data/galaxy/bio-index.bin";
const [CSV, BIOFORGE] = positional;

if (!CSV || !BIOFORGE) {
  console.error("Usage: npx tsx scripts/build-bio-index.ts <codex-data.csv> <bioforge-stats-dir> [--out <file>]");
  process.exit(1);
}

/** Sorted word bag — see the header. Order-insensitive, so colour-first and genus-first agree. */
const bag = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");

/** Our own species ids, keyed by word bag. */
function loadTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(root, "data", "species");
  for (const genus of readdirSync(dir)) {
    const gd = path.join(dir, genus);
    const files = readdirSync(gd).filter((f) => f.endsWith(".json"));
    const file = files.find((f) => f.endsWith("_new.json")) ?? files[0];
    if (!file) continue;
    const parsed = JSON.parse(readFileSync(path.join(gd, file), "utf8")) as {
      species?: { id: string; displayName: string }[];
    };
    for (const s of parsed.species ?? []) out.set(bag(s.displayName), s.id);
  }
  return out;
}

/** codex species id -> our species id, bridged through Bioforge's fdevname + readable name. */
function loadCodexBridge(bioforgeDir: string, tree: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(bioforgeDir)) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(readFileSync(path.join(bioforgeDir, f), "utf8")) as Record<
      string,
      { id?: string; name?: string }
    >;
    for (const e of Object.values(d)) {
      const m = /^\$(Codex_Ent_[A-Za-z]+_\d+)/.exec(String(e.id ?? ""));
      if (!m) continue;
      // Bioforge entries are per colour variant; strip the trailing " - Colour" to reach the species.
      const species = String(e.name ?? "").replace(/\s*-\s*[^-]+$/, "").trim();
      const ours = tree.get(bag(species));
      if (ours) out.set(m[1]!.toLowerCase(), ours);
    }
  }
  return out;
}

/** One CSV line, honouring quoted fields (`"F (White) Star"`, `"System Address / ID64"`). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// fileURLToPath, not URL.pathname: the latter leaves "%20" in a path with a space in it, and this
// repo lives under "Cursor Projects".
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Region comes from the coordinates, not from the CSV's own Region column.
 *
 * edastro writes the region per *codex report*, and its reports disagree with each other: Colonia's
 * rows carry both "Odin's Hold" and "Inner Scutum-Centaurus Arm", so whichever row is read first
 * decides — a stable-looking column built on row order. The region map is a function of position and
 * gives the same answer every time.
 *
 * The name column is still parsed, but only to count how often it contradicts the map, which is worth
 * knowing and is reported at the end. `normaliseRegionName` handles the "Achilles' Altar" versus
 * "Achilles's Altar" split; reusing it beats a second normaliser that can drift from the first.
 */
const regionMapData = JSON.parse(
  readFileSync(path.join(root, "data", "exomastery", "region-map.json"), "utf8"),
) as RegionMapData;
const regionIndex = new Map<string, number>();
regionMapData.regions.forEach((name, i) => {
  if (name) regionIndex.set(normaliseRegionName(name), i);
});

const tree = loadTree(root);
const bridge = loadCodexBridge(BIOFORGE, tree);
console.log(`species tree: ${tree.size}   codex ids bridged: ${bridge.size}`);
if (bridge.size < 80) {
  console.error("Bridge resolved too few species — the join is wrong, refusing to write a bad index.");
  process.exit(1);
}

/** Stable index per species so the file can store a byte instead of a name. */
const speciesIds = [...new Set(bridge.values())].sort();
const speciesIndex = new Map(speciesIds.map((id, i) => [id, i]));
if (speciesIds.length > 255) {
  console.error(`${speciesIds.length} species will not fit in a u8 index.`);
  process.exit(1);
}

interface Row {
  name: string;
  x: number;
  y: number;
  z: number;
  region: number;
  species: Set<number>;
}
const systems = new Map<bigint, Row>();

let rows = 0;
let kept = 0;
let unbridged = 0;
let regionAgree = 0;
let regionDisagree = 0;
const rl = createInterface({
  input: createReadStream(CSV, { highWaterMark: 1 << 22 }),
  crlfDelay: Infinity,
});
let header = false;
for await (const line of rl) {
  if (!header) {
    header = true;
    continue;
  }
  if (!line) continue;
  rows++;
  const f = splitCsv(line);
  const pm = /^(codex_ent_[a-z]+_\d+)/.exec((f[1] ?? "").toLowerCase());
  const ours = pm ? bridge.get(pm[1]!) : undefined;
  if (!ours) {
    if (pm) unbridged++;
    continue;
  }
  const id64raw = f[10] ?? "";
  if (!/^\d+$/.test(id64raw)) continue;
  const id = BigInt(id64raw);
  let rec = systems.get(id);
  if (!rec) {
    rec = {
      name: (f[5] ?? "").trim(),
      x: Number(f[6]),
      y: Number(f[7]),
      z: Number(f[8]),
      region: 0,
      species: new Set(),
    };
    rec.region = regionIndexForCoords(regionMapData, rec.x, rec.z);
    systems.set(id, rec);
  }
  rec.species.add(speciesIndex.get(ours)!);
  kept++;
  // How often does edastro's own Region string disagree with the map? Counted, not trusted.
  const claimed = regionIndex.get(normaliseRegionName(f[4] ?? ""));
  if (claimed !== undefined && rec.region !== 0) {
    if (claimed === rec.region) regionAgree++;
    else regionDisagree++;
  }
  if (rows % 1_000_000 === 0) process.stderr.write(`  ${rows / 1e6}M rows…\n`);
}

console.log(`rows ${rows.toLocaleString()}   ours ${kept.toLocaleString()}   systems ${systems.size.toLocaleString()}`);
console.log(`codex biology rows with no shipped species: ${unbridged.toLocaleString()}`);
{
  const n = regionAgree + regionDisagree;
  if (n > 0) {
    console.log(
      `edastro Region column vs the map: ${((100 * regionAgree) / n).toFixed(2)}% agree ` +
        `(${regionDisagree.toLocaleString()} rows differ of ${n.toLocaleString()})`,
    );
  }
}
{
  let placed = 0;
  for (const r of systems.values()) if (r.region > 0) placed++;
  console.log(`systems with a region: ${placed.toLocaleString()} of ${systems.size.toLocaleString()}`);
}

// Ascending id64, so the loader can binary search without an index.
const ids = [...systems.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const totalSpecies = ids.reduce((n, id) => n + systems.get(id)!.species.size, 0);

const json = Buffer.from(JSON.stringify({ species: speciesIds }), "utf8");
const RECORD = 22;
const head = Buffer.alloc(20);
head.write(MAGIC, 0, "ascii");
head.writeUInt16LE(VERSION, 8);
head.writeUInt16LE(speciesIds.length, 10);
head.writeUInt32LE(ids.length, 12);
head.writeUInt32LE(json.length, 16);

const table = Buffer.alloc(ids.length * RECORD);
const runs = Buffer.alloc(totalSpecies);
const nameParts: Buffer[] = [];
let off = 0;
let runAt = 0;
let longNames = 0;
for (const id of ids) {
  const r = systems.get(id)!;
  table.writeBigUInt64LE(id, off);
  table.writeFloatLE(Number.isFinite(r.x) ? r.x : 0, off + 8);
  table.writeFloatLE(Number.isFinite(r.y) ? r.y : 0, off + 12);
  table.writeFloatLE(Number.isFinite(r.z) ? r.z : 0, off + 16);
  table.writeUInt8(r.region, off + 20);
  table.writeUInt8(Math.min(255, r.species.size), off + 21);
  off += RECORD;
  for (const s of r.species) runs.writeUInt8(s, runAt++);
  // u8 length: the longest real system name is well under 255 bytes, but truncate rather than
  // corrupt the run if the source ever surprises us.
  let nb = Buffer.from(r.name, "utf8");
  if (nb.length > 255) {
    nb = nb.subarray(0, 255);
    longNames++;
  }
  const len = Buffer.alloc(1);
  len.writeUInt8(nb.length, 0);
  nameParts.push(len, nb);
}
const names = Buffer.concat(nameParts);
if (longNames) console.log(`names truncated to 255 bytes: ${longNames}`);

const outPath = path.isAbsolute(OUT) ? OUT : path.join(root, OUT);
writeFileSync(outPath, Buffer.concat([head, json, table, runs, names]));
const bytes = head.length + json.length + table.length + runs.length + names.length;
console.log(
  `\nwrote ${outPath}\n  ${ids.length.toLocaleString()} systems, ${totalSpecies.toLocaleString()} species hits, ` +
    `${speciesIds.length} species\n  ${(bytes / 1048576).toFixed(1)} MB`,
);
