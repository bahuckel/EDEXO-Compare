/**
 * When does one species of a genus win the body, and why that one?
 *
 * The owner: *"we need to run it against other bacteria and see when Tela won."* Right question, and
 * different from the one the last probe answered. Comparing a species against **all bio bodies** says
 * what kind of world it likes. Comparing it against **its own genus** says what it beat — and since
 * the game places one genus per biological signal, the siblings are not co-tenants but rivals for the
 * same ground.
 *
 * So this partitions every corpus body that carries the genus by which species is recorded there, and
 * reports each axis as: what share of *this* species' bodies look like X, against what share of *the
 * rest of the genus* does. A value both sides share is not a reason; a value only one side has is.
 *
 * The specific suspicion worth testing on Bacterium tela is that it is the **residual** — the species
 * that wins wherever no sibling's atmosphere fits — because its own condition row says "any thin
 * atmosphere" and nothing else. If that is what the data shows, the app can model it as a fallback
 * instead of a candidate, which is a far stronger statement than a weighted likelihood.
 *
 *   npx tsx scripts/genus-rivalry-probe.ts                       # Bacterium, focus on tela
 *   npx tsx scripts/genus-rivalry-probe.ts --genus Osseus --species "Osseus discus"
 */
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { normaliseMaterial } from "../src/shared/speciesColour.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");
const argv = process.argv.slice(2);
const argOf = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};

const genusWanted = argOf("genus", "Bacterium").toLowerCase();
const focusWanted = argOf("species", "Bacterium Tela").toLowerCase();

const db = loadSpeciesDatabaseFromTree(root);
const planets = path.join(feederDir, "data", "raw", "planets");
const systemsDir = path.join(feederDir, "data", "raw", "systems");

interface CacheBody {
  name?: string;
  subType?: string;
  gravity?: number;
  surfaceTemperature?: number;
  surfacePressure?: number;
  volcanismType?: string;
  atmosphereType?: string;
  materials?: Record<string, number>;
}

const sysCache = new Map<string, Map<string, CacheBody>>();
function bodyRecord(file: string, name: string): CacheBody | null {
  let m = sysCache.get(file);
  if (!m) {
    m = new Map();
    const p = path.join(systemsDir, file);
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8")) as { bodies?: CacheBody[] };
        for (const b of j.bodies ?? []) if (b.name) m.set(b.name, b);
      } catch {
        /* unreadable */
      }
    }
    sysCache.set(file, m);
  }
  return m.get(name) ?? null;
}

const slugOf = (displayName: string) => displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** body name -> the species of this genus recorded on it. */
const speciesOnBody = new Map<string, Set<string>>();
const recordOf = new Map<string, CacheBody>();

const genusSpecies = db.species.filter(
  (e) =>
    (e.genus || e.genusDataDir).toLowerCase().replace(/[^a-z]/g, "") === genusWanted.replace(/[^a-z]/g, ""),
);

for (const e of genusSpecies) {
  const dir = path.join(planets, slugOf(e.displayName));
  if (!existsSync(dir)) continue;
  const docs: { bodyName?: string; systemCacheFile?: string }[] = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (f.endsWith(".jsonl.gz")) {
        for (const line of gunzipSync(readFileSync(full)).toString("utf8").split(/\r?\n/)) {
          if (line.trim()) docs.push(JSON.parse(line));
        }
      } else if (f.endsWith(".json")) {
        docs.push(JSON.parse(readFileSync(full, "utf8")));
      }
    } catch {
      /* skip */
    }
  }
  for (const d of docs) {
    const name = d.bodyName;
    if (!name || !d.systemCacheFile) continue;
    const set = speciesOnBody.get(name) ?? new Set<string>();
    set.add(e.displayName);
    speciesOnBody.set(name, set);
    if (!recordOf.has(name)) {
      const rec = bodyRecord(d.systemCacheFile, name);
      if (rec) recordOf.set(name, rec);
    }
  }
}

const bodiesWithRecord = [...speciesOnBody.keys()].filter((n) => recordOf.has(n));
const shared = bodiesWithRecord.filter((n) => (speciesOnBody.get(n)?.size ?? 0) > 1);

console.log(`genus                       ${genusWanted}`);
console.log(`species in the tree         ${genusSpecies.length}`);
console.log(
  `bodies carrying the genus   ${speciesOnBody.size}  (${bodiesWithRecord.length} with a body record)`,
);
console.log(
  `bodies carrying two or more ${shared.length}   <- one genus per signal, so these are rivals meeting`,
);

const focus = genusSpecies.find((e) => e.displayName.toLowerCase() === focusWanted);
if (!focus) {
  console.error(`\n${focusWanted} is not in that genus`);
  process.exit(1);
}

const mine = bodiesWithRecord.filter((n) => speciesOnBody.get(n)!.has(focus.displayName));
const theirs = bodiesWithRecord.filter((n) => !speciesOnBody.get(n)!.has(focus.displayName));
console.log("");
console.log(`${focus.displayName} bodies      ${mine.length}`);
console.log(`the rest of the genus       ${theirs.length}`);

/* ------------------------------------------------------------------ the axes */

const GRADE3 = new Set(["cadmium", "mercury", "molybdenum", "niobium", "tin", "tungsten"]);
const GRADE4 = new Set(["antimony", "polonium", "ruthenium", "technetium", "tellurium", "yttrium"]);

const axes: { label: string; of: (b: CacheBody) => string }[] = [
  { label: "atmosphere", of: (b) => (b.atmosphereType ?? "(none)").replace(/^(hot\s+)?thin\s+/i, "") },
  { label: "body class", of: (b) => b.subType ?? "(unknown)" },
  {
    label: "volcanism",
    of: (b) =>
      b.volcanismType ? (b.volcanismType === "No volcanism" ? "none" : "volcanic") : "(not recorded)",
  },
  {
    label: "grade-4 materials present",
    of: (b) => {
      if (!b.materials) return "(no crust list)";
      const n = Object.keys(b.materials).filter((k) => GRADE4.has(normaliseMaterial(k))).length;
      return n === 0 ? "none" : String(n);
    },
  },
  {
    label: "grade-3 materials present",
    of: (b) => {
      if (!b.materials) return "(no crust list)";
      const n = Object.keys(b.materials).filter((k) => GRADE3.has(normaliseMaterial(k))).length;
      return n === 0 ? "none" : String(n);
    },
  },
];

function tally(names: string[], of: (b: CacheBody) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of names) {
    const k = of(recordOf.get(n)!);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

for (const axis of axes) {
  const a = tally(mine, axis.of);
  const b = tally(theirs, axis.of);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort(
    (x, y) => (b.get(y) ?? 0) + (a.get(y) ?? 0) - ((b.get(x) ?? 0) + (a.get(x) ?? 0)),
  );
  console.log(`\n${axis.label}`);
  console.log(
    `  ${"value".padEnd(26)} ${focus.displayName.slice(0, 14).padStart(15)} ${"rest of genus".padStart(15)} ${"lift".padStart(7)}`,
  );
  for (const k of keys.slice(0, 12)) {
    const pa = ((a.get(k) ?? 0) / Math.max(1, mine.length)) * 100;
    const pb = ((b.get(k) ?? 0) / Math.max(1, theirs.length)) * 100;
    const lift = pb > 0 ? `${(pa / pb).toFixed(2)}x` : pa > 0 ? "only" : "-";
    console.log(
      `  ${k.padEnd(26)} ${`${pa.toFixed(1)} %`.padStart(15)} ${`${pb.toFixed(1)} %`.padStart(15)} ${lift.padStart(7)}`,
    );
  }
}

/* ------------------------------------------------------------------ the residual test */

/*
  Is the focus species simply what grows where no sibling's atmosphere fits?

  For every atmosphere, compare how much of the genus's ground the focus holds. If it is a residual,
  it should own ~everything in atmospheres its siblings never appear in and little elsewhere.
*/
console.log("\nshare of the genus this species holds, by atmosphere:");
console.log(
  `  ${"atmosphere".padEnd(26)} ${"its bodies".padStart(11)} ${"genus total".padStart(12)} ${"share".padStart(8)}`,
);
const atmOf = axes[0]!.of;
const byAtm = new Map<string, { mine: number; total: number }>();
for (const n of bodiesWithRecord) {
  const k = atmOf(recordOf.get(n)!);
  const e = byAtm.get(k) ?? { mine: 0, total: 0 };
  e.total += 1;
  if (speciesOnBody.get(n)!.has(focus.displayName)) e.mine += 1;
  byAtm.set(k, e);
}
for (const [k, v] of [...byAtm].sort((x, y) => y[1].total - x[1].total)) {
  if (v.total < 5) continue;
  console.log(
    `  ${k.padEnd(26)} ${String(v.mine).padStart(11)} ${String(v.total).padStart(12)} ${`${((v.mine / v.total) * 100).toFixed(1)} %`.padStart(8)}`,
  );
}
