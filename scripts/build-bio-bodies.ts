/**
 * The galaxy's *unexplored* biology: every body somebody honked and walked away from.
 *
 *   npx tsx scripts/build-bio-bodies.ts <galaxy_bio.jsonl.gz> [--out <file>] [--limit N]
 *
 * ## The question this exists to answer
 *
 * `bio-index.bin` knows which species have been **recorded** in a system, and that record only ever
 * exists because a commander landed and logged one. Measured on the shipped index: 5,286,282 systems,
 * 1,713,156 carrying a species name — and every single one of those is a system somebody has already
 * walked. The 2,866,079 systems where biology was detected and nobody followed it up name nothing at
 * all, by construction.
 *
 * So "show me untouched systems that might have Fonticulua fluctus" cannot be answered from that
 * index: the two halves select disjoint sets. What *is* known about those systems is the body itself
 * — subtype, atmosphere, temperature, gravity, pressure, volcanism — which is exactly what the
 * matcher gates on when the commander is standing in the system looking at their own FSS. This file
 * carries that, so the same gates can run galaxy-wide over somebody else's honk.
 *
 * ## Why physics and not answers
 *
 * The obvious build stores "species allowed here" per system and is smaller. It also freezes the
 * gates at build time: change a criterion, fix a species table, add a colour rule, and every answer
 * on disk is stale with nothing to say so. Storing what the game measured instead means a rebuild is
 * only needed when the *dump* changes, and the gates stay a runtime decision — which is the same
 * reason `exomasteryProfile` keeps observations rather than verdicts.
 *
 * ## Local, never shipped
 *
 * The output goes **beside the user's settings**, not under `data/`. `dist-win.mjs` copies the whole
 * of `data/` into the installer — which is how `bio-index.bin` came to be 234 MB of the 369 MB exe —
 * so a file dropped there rides along whether or not anybody decided it should. This one is built
 * from a dump only its owner has, and the app treats it missing the way it treats a missing
 * `bio-index.bin`: the feature hides itself.
 *
 * ## One pass, and nothing kept
 *
 * The dump writes a system line and then that system's bodies, so a single stream can carry the
 * system's coordinates forward onto its bodies. Lines are string-tested before `JSON.parse` — roughly
 * 85% of 51.8 M body lines have no biology and parsing them is the whole cost of the job.
 *
 * **Only the system being read is held in memory.** The first cut of this accumulated every system
 * and body in arrays and died at the 4 GB heap limit six minutes in, which is the obvious failure in
 * hindsight and was invisible on the 2,000-system sample it was tested against. Records are written
 * to four temporary streams as each system closes, and the header — which needs totals and the string
 * tables the pass itself discovers — is written last, in front of them.
 *
 * Stars are bodies too and carry `mainStar`, so the system's primary spectral class comes along for
 * one extra string test. That matters: several species gate on the host star, and every colour
 * variant is decided by it.
 *
 * ## Format
 *
 * Fixed-stride tables so a region scan is a bounded walk rather than a parse, with the
 * variable-length names after. Ids are u64; the dump writes them as JSON strings because they do not
 * survive a double, and they are read here with `BigInt`.
 *
 *   magic "EDEXOBOD" | u16 version | u16 reserved | u32 systemCount | u32 bodyCount | u32 jsonLen
 *   string tables (JSON: subTypes, atmospheres, volcanisms, starTypes — index order)
 *   systems, in encounter order:
 *     u64 id64 | f32 x | f32 y | f32 z | u8 regionId | u8 starTypeIdx | u16 bioBodyCount | u32 firstBody
 *   bodies, grouped by system:
 *     u32 systemIndex | u16 bodyId | u8 subTypeIdx | u8 atmoIdx | u8 volcIdx | u8 flags
 *     | f32 temperatureK | f32 gravityG | f32 pressureAtm | u8 bioCount | u8 reserved
 *   system name run: u8 byte-length + UTF-8
 *   body name run:   u8 byte-length + UTF-8, the part after the system name ("A 4 c")
 */
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionIndexForCoords, type RegionMapData } from "../src/shared/regionMap.js";
import { resolveUserSettingsJsonPath } from "../src/server/paths.js";

const MAGIC = "EDEXOBOD";
const VERSION = 1;
const SYS_RECORD = 28;
const BODY_RECORD = 24;

/** Landable, and the dump's own genus list is present (somebody probed it). */
const FLAG_LANDABLE = 1;
const FLAG_DSS = 2;

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const EXPORT = positional[0];
/*
  Beside the user's settings, not under `data/`. See the note at the top: `dist-win.mjs` stages the
  whole of `data/` into the installer, so a hundred-odd megabytes dropped there rides into the exe
  without anybody deciding to put it there.
*/
const OUT =
  flag("out") ?? path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-bio-bodies.bin");
const LIMIT = Number(flag("limit") ?? "0") || 0;

if (!EXPORT) {
  console.error("Usage: npx tsx scripts/build-bio-bodies.ts <galaxy_bio.jsonl.gz> [--out <file>] [--limit N]");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const regionMapData = JSON.parse(
  readFileSync(path.join(root, "data/exomastery/region-map.json"), "utf8"),
) as RegionMapData;

const outPath = path.isAbsolute(OUT) ? OUT : path.resolve(root, OUT);
mkdirSync(path.dirname(outPath), { recursive: true });

/** Interning: the dump repeats a few dozen distinct strings across tens of millions of rows. */
class Table {
  private readonly ix = new Map<string, number>();
  readonly values: string[] = [];
  id(v: string | null | undefined): number {
    const s = (v ?? "").trim();
    if (!s) return 0;
    const hit = this.ix.get(s);
    if (hit !== undefined) return hit;
    if (this.values.length >= 255) return 0; // 0 reads as "not recorded", which is honest
    const at = this.values.length + 1;
    this.ix.set(s, at);
    this.values.push(s);
    return at;
  }
}

const subTypes = new Table();
const atmospheres = new Table();
const volcanisms = new Table();
const starTypes = new Table();

/**
 * A write stream with back-pressure honoured.
 *
 * `write()` returning false and being ignored is how a streaming writer quietly becomes a buffering
 * one — the very failure this rewrite exists to fix, moved from an array into the stream's own queue.
 */
class Sink {
  readonly stream;
  constructor(readonly file: string) {
    this.stream = createWriteStream(file);
  }
  async put(b: Buffer): Promise<void> {
    if (!this.stream.write(b)) await once(this.stream, "drain");
  }
  async close(): Promise<void> {
    await new Promise<void>((res, rej) => this.stream.end((e?: Error) => (e ? rej(e) : res())));
  }
}

const tmp = (n: string) => `${outPath}.${n}.tmp`;
const sysSink = new Sink(tmp("sys"));
const bodySink = new Sink(tmp("body"));
const sysNameSink = new Sink(tmp("sysname"));
const bodyNameSink = new Sink(tmp("bodyname"));

interface PendingBody {
  bodyId: number;
  subTypeIdx: number;
  atmoIdx: number;
  volcIdx: number;
  flags: number;
  temperatureK: number;
  gravityG: number;
  pressureAtm: number;
  bioCount: number;
  nameSuffix: string;
}
interface PendingSystem {
  id64: bigint;
  x: number;
  y: number;
  z: number;
  regionId: number;
  name: string;
  starTypeIdx: number;
}

/** The system being read, and its bio bodies. Flushed when the next system line arrives. */
let cur: PendingSystem | null = null;
let curBodies: PendingBody[] = [];

let systemCount = 0;
let bodyCount = 0;
let landableCount = 0;
let dssCount = 0;
let atmoCount = 0;
let starCount = 0;

function nameBuf(s: string): Buffer {
  const b = Buffer.from(s, "utf8").subarray(0, 255);
  return Buffer.concat([Buffer.from([b.length]), b]);
}

/** Write the system that just finished, and its bodies, then forget both. */
async function flush(): Promise<void> {
  if (!cur || curBodies.length === 0) {
    cur = null;
    curBodies = [];
    return;
  }
  const s = cur;
  const sysIndex = systemCount;
  const firstBody = bodyCount;

  const rec = Buffer.alloc(SYS_RECORD);
  rec.writeBigUInt64LE(s.id64, 0);
  rec.writeFloatLE(s.x, 8);
  rec.writeFloatLE(s.y, 12);
  rec.writeFloatLE(s.z, 16);
  rec.writeUInt8(s.regionId, 20);
  rec.writeUInt8(s.starTypeIdx, 21);
  rec.writeUInt16LE(Math.min(65535, curBodies.length), 22);
  rec.writeUInt32LE(firstBody, 24);
  await sysSink.put(rec);
  await sysNameSink.put(nameBuf(s.name));
  if (s.starTypeIdx) starCount++;
  systemCount++;

  const table = Buffer.alloc(BODY_RECORD * curBodies.length);
  let names = Buffer.alloc(0);
  curBodies.forEach((b, i) => {
    const o = i * BODY_RECORD;
    table.writeUInt32LE(sysIndex, o);
    table.writeUInt16LE(b.bodyId, o + 4);
    table.writeUInt8(b.subTypeIdx, o + 6);
    table.writeUInt8(b.atmoIdx, o + 7);
    table.writeUInt8(b.volcIdx, o + 8);
    table.writeUInt8(b.flags, o + 9);
    table.writeFloatLE(b.temperatureK, o + 10);
    table.writeFloatLE(b.gravityG, o + 14);
    table.writeFloatLE(b.pressureAtm, o + 18);
    table.writeUInt8(b.bioCount, o + 22);
    table.writeUInt8(0, o + 23);
    names = Buffer.concat([names, nameBuf(b.nameSuffix)]);
    if (b.flags & FLAG_LANDABLE) landableCount++;
    if (b.flags & FLAG_DSS) dssCount++;
    if (b.atmoIdx) atmoCount++;
  });
  await bodySink.put(table);
  await bodyNameSink.put(names);
  bodyCount += curBodies.length;

  cur = null;
  curBodies = [];
}

type RawSystem = { id64?: string; name?: string; coords?: { x: number; y: number; z: number } };
type RawBody = {
  bodyId?: number;
  name?: string;
  subType?: string;
  atmosphereType?: string | null;
  surfaceTemperature?: number;
  gravity?: number;
  surfacePressure?: number;
  volcanismType?: string | null;
  isLandable?: boolean;
  spectralClass?: string | null;
  signals?: { signals?: Record<string, number>; genuses?: string[] };
};

const BIO_KEY = "$SAA_SignalType_Biological;";
let linesRead = 0;
let parsed = 0;
const t0 = Date.now();

const rl = createInterface({
  input: createReadStream(EXPORT, { highWaterMark: 1 << 22 }).pipe(createGunzip({ chunkSize: 1 << 22 })),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  linesRead++;
  if (linesRead % 5_000_000 === 0) {
    const mins = (Date.now() - t0) / 60000;
    const mb = process.memoryUsage().heapUsed / 1e6;
    process.stderr.write(
      `  ${(linesRead / 1e6).toFixed(0)}M lines · ${systemCount.toLocaleString()} systems · ` +
        `${bodyCount.toLocaleString()} bio bodies · ${mins.toFixed(1)} min · heap ${mb.toFixed(0)} MB\n`,
    );
  }

  /*
    String tests before the parse. `JSON.parse` on 51.8 M body rows is the entire cost of this job and
    roughly 85% of them carry no biology at all; `includes` on the raw line is a memchr and costs
    nothing next to building an object graph.

    Both spacings, because the dump uses both: system rows are written pretty (`"kind": "system"`) and
    body rows compact (`"mainStar":true`). Assuming one of them cost a whole sample build — the star
    capture silently found nothing and the column was simply empty.
  */
  const isSystem = line.includes('"kind": "system"') || line.includes('"kind":"system"');
  const hasBio = !isSystem && line.includes(BIO_KEY);
  const isMainStar =
    !isSystem && !hasBio && (line.includes('"mainStar":true') || line.includes('"mainStar": true'));
  if (!isSystem && !hasBio && !isMainStar) continue;

  let o: RawSystem & RawBody;
  try {
    o = JSON.parse(line) as RawSystem & RawBody;
  } catch {
    continue;
  }
  parsed++;

  if (isSystem) {
    await flush();
    const co = o.coords;
    if (!o.id64 || !co) {
      cur = null;
      continue;
    }
    cur = {
      id64: BigInt(o.id64),
      x: co.x,
      y: co.y,
      z: co.z,
      regionId: regionIndexForCoords(regionMapData, co.x, co.z),
      name: String(o.name ?? ""),
      starTypeIdx: 0,
    };
    continue;
  }

  if (!cur) continue;

  if (isMainStar) {
    if (o.spectralClass || o.subType) cur.starTypeIdx = starTypes.id(o.spectralClass ?? o.subType);
    continue;
  }

  const count = o.signals?.signals?.[BIO_KEY] ?? 0;
  if (!count) continue;

  const full = String(o.name ?? "");
  const suffix = cur.name && full.startsWith(cur.name) ? full.slice(cur.name.length).trim() : full;

  curBodies.push({
    bodyId: Math.min(65535, Number(o.bodyId ?? 0)),
    subTypeIdx: subTypes.id(o.subType),
    atmoIdx: atmospheres.id(o.atmosphereType),
    volcIdx: volcanisms.id(o.volcanismType),
    flags: (o.isLandable === true ? FLAG_LANDABLE : 0) | (o.signals?.genuses?.length ? FLAG_DSS : 0),
    temperatureK: Number(o.surfaceTemperature ?? 0),
    gravityG: Number(o.gravity ?? 0),
    pressureAtm: Number(o.surfacePressure ?? 0),
    bioCount: Math.min(255, count),
    nameSuffix: suffix,
  });

  if (LIMIT && bodyCount + curBodies.length >= LIMIT) break;
}
await flush();

await sysSink.close();
await bodySink.close();
await sysNameSink.close();
await bodyNameSink.close();

// ---- assemble: header, then the four runs, copied rather than loaded ----
const json = Buffer.from(
  JSON.stringify({
    subTypes: subTypes.values,
    atmospheres: atmospheres.values,
    volcanisms: volcanisms.values,
    starTypes: starTypes.values,
  }),
  "utf8",
);

const header = Buffer.alloc(24);
header.write(MAGIC, 0, "ascii");
header.writeUInt16LE(VERSION, 8);
header.writeUInt16LE(0, 10);
header.writeUInt32LE(systemCount, 12);
header.writeUInt32LE(bodyCount, 16);
header.writeUInt32LE(json.length, 20);

const finalOut = createWriteStream(outPath);
finalOut.write(header);
finalOut.write(json);
for (const part of ["sys", "body", "sysname", "bodyname"]) {
  await pipeline(createReadStream(tmp(part)), finalOut, { end: false });
}
await new Promise<void>((res, rej) => finalOut.end((e?: Error) => (e ? rej(e) : res())));
for (const part of ["sys", "body", "sysname", "bodyname"]) rmSync(tmp(part), { force: true });

const mins = (Date.now() - t0) / 60000;
const size = statSync(outPath).size;
console.log(
  [
    `read ${linesRead.toLocaleString()} lines, parsed ${parsed.toLocaleString()} (${((parsed / linesRead) * 100).toFixed(1)}%)`,
    `systems with biology  ${systemCount.toLocaleString()}`,
    `bio bodies            ${bodyCount.toLocaleString()}`,
    `  landable            ${landableCount.toLocaleString()} (${((landableCount / bodyCount) * 100).toFixed(1)}%)`,
    `  already DSS-d       ${dssCount.toLocaleString()} (${((dssCount / bodyCount) * 100).toFixed(1)}%)`,
    `  with an atmosphere  ${atmoCount.toLocaleString()} (${((atmoCount / bodyCount) * 100).toFixed(1)}%)`,
    `systems with a star   ${starCount.toLocaleString()} (${((starCount / systemCount) * 100).toFixed(1)}%)`,
    `subTypes ${subTypes.values.length}  atmospheres ${atmospheres.values.length}  volcanisms ${volcanisms.values.length}  starTypes ${starTypes.values.length}`,
    `peak heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`,
    `wrote ${outPath} — ${(size / 1e6).toFixed(0)} MB in ${mins.toFixed(1)} min`,
  ].join("\n"),
);
