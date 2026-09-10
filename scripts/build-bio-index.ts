/**
 * Build the galaxy biology index: what is known to live where, across 5.2 million systems.
 *
 * This is the layer that makes a galaxy-wide question answerable. "Where is something worth 19 M",
 * "where has somebody mapped a genus but never landed" — neither the journal (where this commander
 * has been) nor the feeder corpus (where the feeder has profiles) is a galaxy.
 *
 *   npx tsx scripts/build-bio-index.ts <codex-data.csv> <bioforge-stats-dir> [galaxy_bio.jsonl.gz] [--out <file>]
 *
 * Paths are arguments, never constants: the inputs live on whichever drive the owner keeps them on,
 * and machine paths must not enter this repo.
 *
 * ## Two sources, because neither is enough
 *
 * **edastro's codex** knows which *species* was recorded in a system — the only species-level source,
 * and a value filter is a species question, since Tussock Propagito pays 1 000 000 and Tussock
 * Pennata 5 853 800. It covers 1.7 M systems.
 *
 * **Spansh's export** knows the 5.2 M systems where somebody mapped a genus or merely honked and saw
 * a signal count. That is most of what a commander is actually choosing between, and the codex cannot
 * see any of it.
 *
 * Not in either: systems with no biology at all. The export is `bioOnly`, so "known barren" has to
 * come from EDDN's FSSDiscoveryScan over time, or from a separate all-systems roster.
 *
 * ## Three joins, each of which fails silently if done naively
 *
 * **Codex id → species.** The file carries species ids (`codex_ent_stratum_07`) *and* material or
 * colour variants of them (`codex_ent_bacterial_04_yttrium`). Matching ids exactly keeps 0.5 % of the
 * biology rows and reports a clean, small, wrong answer. Key on the `codex_ent_<genus>_<nn>` prefix.
 *
 * **Species name → our tree.** Bioforge names structures colour-first (`Gypseeum Brain Tree`), the
 * tree genus-first (`Brain Tree Gypseeum`). A positional compare resolves 90 of 108 and looks like
 * honest absence; a sorted word bag resolves 102. The remaining six are real — Bioforge splits
 * Anemone into six colour species where this project models one.
 *
 * **Region.** Not from the CSV's Region column: edastro writes it per *codex report* and its reports
 * disagree with each other, so whichever row loads first would decide. The export's `regionId` is the
 * boxel corner — what the game itself writes into Codex events — and the pixel lookup is the fallback.
 *
 * ## Why typed arrays rather than a Map of objects
 *
 * The obvious shape — `Map<bigint, {name, coords, species: Set}>` — died at 12 GB on 5.2 M systems.
 * Per system that is a Map entry, an object, a Set and a string, and the overhead is an order of
 * magnitude larger than the twenty-odd bytes of actual data. Parallel typed arrays indexed by
 * position cost what the data costs, and the id array doubles as the sorted lookup key.
 *
 * ## Format
 *
 * Fixed-stride records so a lookup is a binary search rather than a parse, with the variable-length
 * runs after. Offsets are not stored — they are prefix sums the loader builds once.
 *
 *   magic "EDEXOBIO" | u16 version | u16 speciesCount | u32 systemCount | u32 jsonLen
 *   species table (JSON: our species ids, in index order)
 *   systems, ascending by id64:
 *     u64 id64 | f32 x | f32 y | f32 z | u8 regionId | u8 speciesCount | u8 tiers | u16 bodyCount
 *   species run: one u8 index per (system, species), in system order
 *   name run:    u8 byte-length + UTF-8 name per system, in system order
 */
import { createReadStream, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRegionName, regionIndexForCoords, type RegionMapData } from "../src/shared/regionMap.js";

const MAGIC = "EDEXOBIO";
const VERSION = 3;
const RECORD = 25;

/**
 * Evidence tiers as bit flags. A system can carry several at once — a confirmed species on one body
 * and only a signal count on another — so this is a set, not a ladder position. Collapsing to "the
 * strongest" here would discard the system a commander most wants: a known plant beside unexplored
 * signals.
 */
const TIER_FSS = 1;
const TIER_DSS = 2;
const TIER_CODEX = 4;
const TIER_BODIES_KNOWN = 8;

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1]! : "data/galaxy/bio-index.bin";
const [CSV, BIOFORGE, EXPORT] = positional;

if (!CSV || !BIOFORGE) {
  console.error(
    "Usage: npx tsx scripts/build-bio-index.ts <codex-data.csv> <bioforge-stats-dir> [galaxy_bio.jsonl.gz] [--out <file>]",
  );
  process.exit(1);
}

const bag = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");

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
      const species = String(e.name ?? "").replace(/\s*-\s*[^-]+$/, "").trim();
      const ours = tree.get(bag(species));
      if (ours) out.set(m[1]!.toLowerCase(), ours);
    }
  }
  return out;
}

/** One CSV line, honouring quoted fields (`"F (White) Star"`). */
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const regionMapData = JSON.parse(
  readFileSync(path.join(root, "data", "exomastery", "region-map.json"), "utf8"),
) as RegionMapData;
const regionIndex = new Map<string, number>();
regionMapData.regions.forEach((name, i) => {
  if (name) regionIndex.set(normaliseRegionName(name), i);
});

const tree = loadTree(root);
const bridge = loadCodexBridge(BIOFORGE, tree);
console.log(`species tree ${tree.size}   codex ids bridged ${bridge.size}`);
if (bridge.size < 80) {
  console.error("Bridge resolved too few species — the join is wrong, refusing to write a bad index.");
  process.exit(1);
}

const speciesIds = [...new Set(bridge.values())].sort();
const speciesSlot = new Map(speciesIds.map((id, i) => [id, i]));
if (speciesIds.length > 255) {
  console.error(`${speciesIds.length} species will not fit in a u8 index.`);
  process.exit(1);
}
/** Bytes of bitmask per system — one bit per species. */
const MASK = Math.ceil(speciesIds.length / 8);

const SYS_ID = /"id64":"(\d+)"/;
const NAME = /"name":"((?:[^"\\]|\\.)*)"/;
const COORDS = /"coords":\{"x":(-?[\d.eE+]+),"y":(-?[\d.eE+]+),"z":(-?[\d.eE+]+)\}/;
const REGION_ID = /"regionId":(\d+)/;
const BODY_COUNT = /"bodyCount":(\d+)/;
const BIO = /"\$SAA_SignalType_Biological;":(\d+)/;
const GENUSES = /"genuses":\[([^\]]*)\]/;
const CODEX_SPECIES = /^(codex_ent_[a-z]+_\d+)/;

/** Growable id list. A plain array of bigints is heavy; this stays at eight bytes each. */
let ids = new BigUint64Array(1 << 20);
let idCount = 0;
const pushId = (v: bigint) => {
  if (idCount === ids.length) {
    const next = new BigUint64Array(ids.length * 2);
    next.set(ids);
    ids = next;
  }
  ids[idCount++] = v;
};

// ---- pass 1: every system id, from both sources ----
if (EXPORT) {
  process.stderr.write("pass 1 — system ids from the export…\n");
  const rl = createInterface({
    input: createReadStream(EXPORT, { highWaterMark: 1 << 22 }).pipe(createGunzip({ chunkSize: 1 << 22 })),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.charCodeAt(9) !== 115 || !line.startsWith('{"kind":"system"')) continue;
    const m = SYS_ID.exec(line);
    if (m) pushId(BigInt(m[1]!));
  }
  console.log(`export systems ${idCount.toLocaleString()}`);
}

{
  process.stderr.write("pass 1b — system ids from the codex…\n");
  const rl = createInterface({ input: createReadStream(CSV, { highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  let header = false;
  for await (const line of rl) {
    if (!header) {
      header = true;
      continue;
    }
    if (!line) continue;
    const f = splitCsv(line);
    const pm = CODEX_SPECIES.exec((f[1] ?? "").toLowerCase());
    if (!pm || !bridge.has(pm[1]!)) continue;
    const raw = f[10] ?? "";
    if (/^\d+$/.test(raw)) pushId(BigInt(raw));
  }
}

// Sort and de-duplicate: the id array is both the record order and the lookup key.
const sorted = ids.subarray(0, idCount).slice().sort();
let n = 0;
for (let i = 0; i < sorted.length; i++) {
  if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[n++] = sorted[i]!;
}
const sysIds = sorted.subarray(0, n);
console.log(`distinct systems ${n.toLocaleString()}`);

/** Position of an id, or -1. The whole reason the array is sorted. */
function indexOfId(id: bigint): number {
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const at = sysIds[mid]!;
    if (at === id) return mid;
    if (at < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const xs = new Float32Array(n);
const ys = new Float32Array(n);
const zs = new Float32Array(n);
const regions = new Uint8Array(n);
const tiers = new Uint8Array(n);
const bodyCounts = new Uint16Array(n);
const speciesMask = new Uint8Array(n * MASK);

/**
 * Names as bytes in one blob, not as 5.3 M JavaScript strings.
 *
 * A regex capture in V8 is a *sliced* string: it keeps a pointer into the line it came from. Holding
 * 5.3 M of them therefore holds 5.3 M export lines alive at about 2 kB each, which is 8 GB spent to
 * store roughly 110 MB of names — this is exactly how the previous build died. Copying the bytes out
 * breaks the link to the parent, and the bytes are what gets written anyway.
 *
 * Offsets are recorded per system, so passes may fill them in any order.
 */
let nameBlob = Buffer.alloc(1 << 24);
let nameUsed = 0;
const nameOff = new Uint32Array(n);
const nameLen = new Uint8Array(n);
function setName(at: number, value: string): void {
  if (nameLen[at]) return; // first writer wins; the export runs before the codex
  let bytes = Buffer.from(value, "utf8");
  if (bytes.length > 255) bytes = bytes.subarray(0, 255);
  if (bytes.length === 0) return;
  while (nameUsed + bytes.length > nameBlob.length) {
    const next = Buffer.alloc(nameBlob.length * 2);
    nameBlob.copy(next, 0, 0, nameUsed);
    nameBlob = next;
  }
  bytes.copy(nameBlob, nameUsed);
  nameOff[at] = nameUsed;
  nameLen[at] = bytes.length;
  nameUsed += bytes.length;
}
const nameAt = (at: number): Buffer =>
  nameLen[at] ? nameBlob.subarray(nameOff[at]!, nameOff[at]! + nameLen[at]!) : Buffer.alloc(0);

// ---- pass 2: the export's own fields ----
if (EXPORT) {
  process.stderr.write("pass 2 — export fields…\n");
  const rl = createInterface({
    input: createReadStream(EXPORT, { highWaterMark: 1 << 22 }).pipe(createGunzip({ chunkSize: 1 << 22 })),
    crlfDelay: Infinity,
  });
  let at = -1;
  let seen = 0;
  for await (const line of rl) {
    if (line.charCodeAt(9) === 115 && line.startsWith('{"kind":"system"')) {
      at = -1;
      const m = SYS_ID.exec(line);
      if (!m) continue;
      at = indexOfId(BigInt(m[1]!));
      if (at < 0) continue;
      const nm = NAME.exec(line);
      // JSON escapes survive the regex read; undo them so the name is what a commander types.
      if (nm) setName(at, nm[1]!.replace(/\\(.)/g, "$1"));
      const co = COORDS.exec(line);
      if (co) {
        xs[at] = Number(co[1]);
        ys[at] = Number(co[2]);
        zs[at] = Number(co[3]);
      }
      const rid = REGION_ID.exec(line);
      regions[at] = rid
        ? Number(rid[1])
        : co
          ? regionIndexForCoords(regionMapData, Number(co[1]), Number(co[3]))
          : 0;
      const bc = BODY_COUNT.exec(line);
      if (bc) {
        bodyCounts[at] = Math.min(65535, Number(bc[1]));
        tiers[at]! |= TIER_BODIES_KNOWN;
      }
      if (++seen % 1_000_000 === 0) process.stderr.write(`  ${seen / 1e6}M systems…\n`);
      continue;
    }
    if (at < 0) continue;
    const g = GENUSES.exec(line);
    if (g && g[1]) tiers[at]! |= TIER_DSS;
    const b = BIO.exec(line);
    if (b && Number(b[1]) > 0) tiers[at]! |= TIER_FSS;
  }
}

// ---- pass 3: codex species, and coordinates for anything the export missed ----
process.stderr.write("pass 3 — codex species…\n");
let codexRows = 0;
let codexKept = 0;
let regionAgree = 0;
let regionDisagree = 0;
{
  const rl = createInterface({ input: createReadStream(CSV, { highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  let header = false;
  for await (const line of rl) {
    if (!header) {
      header = true;
      continue;
    }
    if (!line) continue;
    codexRows++;
    const f = splitCsv(line);
    const pm = CODEX_SPECIES.exec((f[1] ?? "").toLowerCase());
    const ours = pm ? bridge.get(pm[1]!) : undefined;
    if (!ours) continue;
    const raw = f[10] ?? "";
    if (!/^\d+$/.test(raw)) continue;
    const at = indexOfId(BigInt(raw));
    if (at < 0) continue;
    codexKept++;

    const slot = speciesSlot.get(ours)!;
    speciesMask[at * MASK + (slot >> 3)]! |= 1 << (slot & 7);
    tiers[at]! |= TIER_CODEX;

    // Systems the export never carried — fill what the codex knows.
    if (!nameLen[at]) {
      setName(at, (f[5] ?? "").trim());
      xs[at] = Number(f[6]);
      ys[at] = Number(f[7]);
      zs[at] = Number(f[8]);
      regions[at] = regionIndexForCoords(regionMapData, xs[at]!, zs[at]!);
    }
    // How often does edastro's own Region string disagree with the map? Counted, not trusted.
    const claimed = regionIndex.get(normaliseRegionName(f[4] ?? ""));
    if (claimed !== undefined && regions[at] !== 0) {
      if (claimed === regions[at]) regionAgree++;
      else regionDisagree++;
    }
  }
}
console.log(`codex rows ${codexRows.toLocaleString()}   ours ${codexKept.toLocaleString()}`);
{
  const t = regionAgree + regionDisagree;
  if (t) {
    console.log(
      `edastro Region column vs the map: ${((100 * regionAgree) / t).toFixed(2)}% agree ` +
        `(${regionDisagree.toLocaleString()} of ${t.toLocaleString()} differ)`,
    );
  }
}

// ---- write ----
const counts = { fss: 0, dss: 0, codex: 0, bodies: 0, named: 0 };
let totalSpecies = 0;
for (let i = 0; i < n; i++) {
  const t = tiers[i]!;
  if (t & TIER_FSS) counts.fss++;
  if (t & TIER_DSS) counts.dss++;
  if (t & TIER_CODEX) counts.codex++;
  if (t & TIER_BODIES_KNOWN) counts.bodies++;
  if (nameLen[i]) counts.named++;
  for (let b = 0; b < MASK; b++) {
    let v = speciesMask[i * MASK + b]!;
    while (v) {
      v &= v - 1;
      totalSpecies++;
    }
  }
}
console.log(
  `tiers — FSS ${counts.fss.toLocaleString()}  DSS ${counts.dss.toLocaleString()}  ` +
    `codex ${counts.codex.toLocaleString()}  bodyCount ${counts.bodies.toLocaleString()}`,
);
console.log(`named ${counts.named.toLocaleString()} of ${n.toLocaleString()}`);

const json = Buffer.from(JSON.stringify({ species: speciesIds }), "utf8");
const head = Buffer.alloc(20);
head.write(MAGIC, 0, "ascii");
head.writeUInt16LE(VERSION, 8);
head.writeUInt16LE(speciesIds.length, 10);
head.writeUInt32LE(n, 12);
head.writeUInt32LE(json.length, 16);

const table = Buffer.alloc(n * RECORD);
const runs = Buffer.alloc(totalSpecies);
const nameParts: Buffer[] = [];
let runAt = 0;
for (let i = 0; i < n; i++) {
  const o = i * RECORD;
  table.writeBigUInt64LE(sysIds[i]!, o);
  table.writeFloatLE(Number.isFinite(xs[i]) ? xs[i]! : 0, o + 8);
  table.writeFloatLE(Number.isFinite(ys[i]) ? ys[i]! : 0, o + 12);
  table.writeFloatLE(Number.isFinite(zs[i]) ? zs[i]! : 0, o + 16);
  table.writeUInt8(regions[i]!, o + 20);
  let count = 0;
  for (let slot = 0; slot < speciesIds.length; slot++) {
    if (speciesMask[i * MASK + (slot >> 3)]! & (1 << (slot & 7))) {
      runs.writeUInt8(slot, runAt++);
      count++;
    }
  }
  table.writeUInt8(Math.min(255, count), o + 21);
  table.writeUInt8(tiers[i]!, o + 22);
  table.writeUInt16LE(bodyCounts[i]!, o + 23);

  const nb = nameAt(i);
  const len = Buffer.alloc(1);
  len.writeUInt8(nb.length, 0);
  nameParts.push(len, nb);
}

const nameRun = Buffer.concat(nameParts);
const outPath = path.isAbsolute(OUT) ? OUT : path.join(root, OUT);
writeFileSync(outPath, Buffer.concat([head, json, table, runs, nameRun]));
const bytes = head.length + json.length + table.length + runs.length + nameRun.length;
console.log(
  `\nwrote ${outPath}\n  ${n.toLocaleString()} systems, ${totalSpecies.toLocaleString()} species hits, ` +
    `${speciesIds.length} species\n  ${(bytes / 1048576).toFixed(1)} MB`,
);
