/**
 * The galaxy map's star and body filters (owner, 2026-10-04): what every system of `bio-index.bin`
 * holds besides biology, from the Spansh dump.
 *
 *   npx tsx scripts/build-system-traits.ts <galaxy_bio.jsonl.gz> [--out data/galaxy/system-traits.bin.gz]
 *
 * One stream over the dump (a system line, then its bodies), one record per **bio-index ordinal**,
 * so the map can test a system by the same number its points already carry. Systems the dump lacks
 * keep zeros and 255 (not recorded). Layout (little-endian, gzipped):
 *
 *   0   "EDXTRT01"
 *   8   u32 count (= bio-index systemCount)
 *   12  u8  main star class × count   (src/shared/galaxyTraits.ts STAR_CLASSES index, 255 = none)
 *   ..  u32 star classes present × count   (bit per STAR_CLASSES)
 *   ..  u32 body traits present × count    (bit per BODY_TRAITS)
 *
 * Two u32 arrays start at a multiple of 4 (padding after the u8 array).
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createGunzip, gzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { loadBioIndex } from "../src/server/bioIndex.js";
import { TRAITS_MAGIC } from "../src/server/galaxyTraits.js";
import {
  BODY_TRAITS,
  STAR_CLASSES,
  STAR_NONE,
  isGiantStar,
  planetClassIndex,
  starClassIndex,
} from "../src/shared/galaxyTraits.js";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--"));
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1]! : path.join("data", "galaxy", "system-traits.bin.gz");
if (!src) {
  console.error("usage: npx tsx scripts/build-system-traits.ts <galaxy_bio.jsonl.gz> [--out file]");
  process.exit(1);
}
const index = loadBioIndex();
if (!index) throw new Error("no data/galaxy/bio-index.bin");
const n = index.systemCount;
const main = new Uint8Array(n).fill(STAR_NONE);
const stars = new Uint32Array(n);
const bodies = new Uint32Array(n);
const bit = (list: readonly { key: string }[], key: string) => 1 << list.findIndex((t) => t.key === key);
const SG = bit(STAR_CLASSES, "SG");
const TERRA = bit(BODY_TRAITS, "terraformable");
const LAND_ATMO = bit(BODY_TRAITS, "landable_atmo");
const LAND = bit(BODY_TRAITS, "landable");
const RINGED = bit(BODY_TRAITS, "ringed_planet");

let ord = -1;
let lines = 0;
let systems = 0;
let matched = 0;
const started = Date.now();
const rl = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  lines++;
  if (lines % 5_000_000 === 0) console.log(`${(lines / 1e6).toFixed(0)} M lines, ${matched.toLocaleString()} systems matched, ${Math.round((Date.now() - started) / 1000)} s`);
  if (line.startsWith('{"kind":"system"')) {
    systems++;
    const m = /"id64":"(\d+)"/.exec(line);
    ord = m ? index.ordinalOf(BigInt(m[1]!)) : -1;
    if (ord >= 0) matched++;
    continue;
  }
  if (ord < 0 || !line.startsWith('{"kind":"body"')) continue;
  // Barycentres and belts carry nothing to filter by; skip them before parsing.
  if (line.includes('"type":"Barycentre"')) continue;
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(line) as Record<string, unknown>;
  } catch {
    continue;
  }
  const sub = typeof b.subType === "string" ? b.subType : "";
  if (b.type === "Star") {
    const c = starClassIndex(sub);
    if (c >= 0) stars[ord]! |= 1 << c;
    if (isGiantStar(sub)) stars[ord]! |= SG;
    if (b.mainStar === true && c >= 0) main[ord] = c;
  } else if (b.type === "Planet") {
    const p = planetClassIndex(sub);
    let t = p >= 0 ? 1 << p : 0;
    if (b.terraformingState === "Terraformable" || b.terraformingState === "Terraforming") t |= TERRA;
    if (b.isLandable === true) {
      t |= LAND;
      const atm = typeof b.atmosphereType === "string" ? b.atmosphereType : "";
      if (atm && atm !== "No atmosphere") t |= LAND_ATMO;
    }
    if (Array.isArray(b.rings) && b.rings.length) t |= RINGED;
    bodies[ord]! |= t;
  }
}
const pad = (12 + n) % 4 ? 4 - ((12 + n) % 4) : 0;
const buf = Buffer.alloc(12 + n + pad + n * 8);
buf.write(TRAITS_MAGIC, 0, "ascii");
buf.writeUInt32LE(n, 8);
buf.set(main, 12);
Buffer.from(stars.buffer).copy(buf, 12 + n + pad);
Buffer.from(bodies.buffer).copy(buf, 12 + n + pad + n * 4);
const gz = gzipSync(buf, { level: 9 });
writeFileSync(out, gz);
console.log(
  `${lines.toLocaleString()} lines, ${systems.toLocaleString()} systems, ${matched.toLocaleString()} of ${n.toLocaleString()} index systems found; ` +
    `${out}: ${(gz.length / 1e6).toFixed(1)} MB (${(buf.length / 1e6).toFixed(1)} MB raw), ${Math.round((Date.now() - started) / 1000)} s`,
);
