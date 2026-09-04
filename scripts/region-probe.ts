/**
 * Does where you are in the galaxy tell you which genera are on the body?
 *
 * A9/A3's region prior, measured before any of it is wired to anything. The corpus now carries
 * galactic coordinates for all 2,993 of its systems (`npm run feeder -- coords`), so each of the
 * 10,299 bodies with a known genus set has a position, and the question can be asked directly:
 *
 *   given the genus set of a body, is it better predicted by the genus mix of its own part of the
 *   galaxy than by the genus mix of the galaxy as a whole?
 *
 * Five folds, split by system so no body is scored by a prior its own system helped build. For each
 * held-out body, both priors rank every genus and the top `m` are compared with the `m` really
 * there. Regions are cubes, swept from 200 ly to 5,000 ly a side, plus two shapes that are not cubes
 * at all: distance from Sol, and height above the galactic plane.
 *
 * **The bias this cannot see.** The corpus is Spansh data, which is where commanders have flown —
 * neutron systems are over-represented because people supercharge there (§14.1a), and the bubble is
 * over-represented because people live there. Cross-validation shares that bias on both sides, so a
 * gain here is a gain at predicting *the corpus*, and only maybe a gain at predicting the galaxy.
 *
 *   npm run region-probe
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSpeciesEntryForLabel } from "../src/feeder/install.js";
import { openFeederStore } from "../src/feeder/feederDb.js";
import { feederDataDirExists, feederDbPath } from "../src/feeder/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

if (!feederDataDirExists()) {
  console.error("No feeder corpus. Nothing to measure.");
  process.exit(1);
}

const store = await openFeederStore(feederDbPath());
const coords = store.systemCoords();

interface Body {
  systemId: number;
  genera: string[];
  x: number;
  y: number;
  z: number;
}

/** `--species` measures the same question one level down: which species, not which genus. */
const BY_SPECIES = process.argv.includes("--species");

const byPlanet = new Map<number, { systemId: number; genera: Set<string> }>();
{
  const st = store.db.prepare(`
    SELECT si.planet_id, p.system_id, si.species_label
    FROM sightings si JOIN planets p ON p.id = si.planet_id`);
  const genusOfLabel = new Map<string, string | null>();
  while (st.step()) {
    const [planetId, systemId, label] = st.get() as [number, number, string];
    if (!genusOfLabel.has(label)) {
      const entry = findSpeciesEntryForLabel(db, label);
      genusOfLabel.set(label, entry ? (BY_SPECIES ? entry.id : entry.genusDataDir) : null);
    }
    const genus = genusOfLabel.get(label);
    if (!genus) continue;
    const row = byPlanet.get(planetId) ?? { systemId, genera: new Set<string>() };
    row.genera.add(genus);
    byPlanet.set(planetId, row);
  }
  st.free();
}
store.close();

const bodies: Body[] = [];
for (const { systemId, genera } of byPlanet.values()) {
  const c = coords.get(systemId);
  if (!c) continue;
  bodies.push({ systemId, genera: [...genera], x: c.x, y: c.y, z: c.z });
}

console.log(
  `\ncorpus: ${byPlanet.size} bodies with a genus set, ${bodies.length} of them in a system with coordinates`,
);
const dists = bodies.map((b) => Math.hypot(b.x, b.y, b.z)).sort((a, b) => a - b);
const pct = (p: number) =>
  Math.round(dists[Math.min(dists.length - 1, Math.floor((p / 100) * dists.length))]!);
console.log(
  `distance from Sol: p10 ${pct(10)} ly · median ${pct(50)} ly · p90 ${pct(90)} ly · max ${Math.round(dists[dists.length - 1]!)} ly`,
);

/** How a region is carved out of the galaxy. Each returns a key, or null for "no region for this body". */
type Regioning = { name: string; key: (b: Body) => string };

const REGIONINGS: Regioning[] = [
  ...[200, 500, 1000, 2000, 5000].map((side) => ({
    name: `${side} ly cube`,
    key: (b: Body) => `${Math.floor(b.x / side)}:${Math.floor(b.y / side)}:${Math.floor(b.z / side)}`,
  })),
  {
    name: "distance shell (1000 ly)",
    key: (b: Body) => String(Math.floor(Math.hypot(b.x, b.y, b.z) / 1000)),
  },
  {
    name: "height above plane (100 ly)",
    key: (b: Body) => String(Math.floor(b.y / 100)),
  },
];

const FOLDS = 5;

/**
 * Smoothing, in bodies.
 *
 * A region with four bodies in it should not overrule the galaxy. The prior is the global mix and
 * the region has to outvote it, which is the same shape as the co-occurrence smoothing in step 7 and
 * for the same reason.
 */
const SMOOTHING = 20;

interface Result {
  hit: number;
  total: number;
  bodies: number;
  /** Hits and appearances per truth key, so a gain can be attributed rather than admired. */
  perKey: Map<string, { hit: number; total: number }>;
  /** Test bodies whose region was seen in training at all. */
  covered: number;
  /** Mean training bodies behind the regions actually used. */
  regionSize: number;
}

function measure(regioning: Regioning | null): Result {
  const r: Result = { hit: 0, total: 0, bodies: 0, covered: 0, regionSize: 0, perKey: new Map() };
  let regionSizeSum = 0;

  for (let f = 0; f < FOLDS; f++) {
    const train = bodies.filter((b) => b.systemId % FOLDS !== f);
    const test = bodies.filter((b) => b.systemId % FOLDS === f);

    const global = new Map<string, number>();
    let globalBodies = 0;
    const regional = new Map<string, Map<string, number>>();
    const regionBodies = new Map<string, number>();

    for (const b of train) {
      globalBodies++;
      for (const g of b.genera) global.set(g, (global.get(g) ?? 0) + 1);
      if (!regioning) continue;
      const k = regioning.key(b);
      regionBodies.set(k, (regionBodies.get(k) ?? 0) + 1);
      const m = regional.get(k) ?? new Map<string, number>();
      for (const g of b.genera) m.set(g, (m.get(g) ?? 0) + 1);
      regional.set(k, m);
    }

    const allGenera = [...global.keys()];

    for (const b of test) {
      const k = regioning ? regioning.key(b) : null;
      const localCounts = k != null ? regional.get(k) : undefined;
      const localBodies = k != null ? (regionBodies.get(k) ?? 0) : 0;
      if (localBodies > 0) {
        r.covered++;
        regionSizeSum += localBodies;
      }

      const score = (g: string): number => {
        const globalP = (global.get(g) ?? 0) / Math.max(1, globalBodies);
        if (!localCounts || localBodies === 0) return globalP;
        return ((localCounts.get(g) ?? 0) + SMOOTHING * globalP) / (localBodies + SMOOTHING);
      };

      const ranked = [...allGenera].sort((a, c) => score(c) - score(a) || a.localeCompare(c));
      const truth = new Set(b.genera.filter((g) => global.has(g)));
      if (truth.size === 0) continue;
      const top = ranked.slice(0, truth.size);
      r.hit += top.filter((g) => truth.has(g)).length;
      r.total += truth.size;
      r.bodies++;
      for (const g of truth) {
        const row = r.perKey.get(g) ?? { hit: 0, total: 0 };
        row.total++;
        if (top.includes(g)) row.hit++;
        r.perKey.set(g, row);
      }
    }
  }
  r.regionSize = r.covered ? regionSizeSum / r.covered : 0;
  return r;
}

function report(name: string, r: Result, baseline?: Result): void {
  const acc = (r.hit / r.total) * 100;
  const delta = baseline ? acc - (baseline.hit / baseline.total) * 100 : 0;
  console.log(
    `  ${name.padEnd(26)} top-m ${acc.toFixed(2)}%${baseline ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})` : ""}` +
      `   covered ${((r.covered / r.bodies) * 100).toFixed(1)}%   mean region ${Math.round(r.regionSize)} bodies`,
  );
}

console.log(`
── naming the ${BY_SPECIES ? "species" : "genera"} on a held-out body ──────`);
const base = measure(null);
const attribute: { name: string; result: Result }[] = [];
report("galaxy-wide prevalence", base);
for (const reg of REGIONINGS) {
  const r = measure(reg);
  attribute.push({ name: reg.name, result: r });
  report(reg.name, r, base);
}

/**
 * Where a gain comes from, if there is one.
 *
 * A blanket prior that moves the average by a point could be a real regional effect on two species
 * or noise spread thinly over eighty. Attribution is the difference between "build a region term"
 * and "note that the corpus is lumpy".
 */
const best = attribute.reduce((a, b) =>
  b.result.hit / b.result.total > a.result.hit / a.result.total ? b : a,
);
const deltas = [...best.result.perKey.entries()]
  .map(([k, r]) => {
    const b = base.perKey.get(k);
    if (!b || b.total < 20) return null;
    return { k, n: r.total, delta: (r.hit / r.total - b.hit / b.total) * 100 };
  })
  .filter((x): x is { k: string; n: number; delta: number } => x !== null)
  .sort((a, b) => b.delta - a.delta);

console.log(`
── where ${best.name} gains and loses (n >= 20) ─────────`);
for (const d of [...deltas.slice(0, 6), ...deltas.slice(-4)]) {
  console.log(`  ${d.k.padEnd(34)} ${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(1)} pts   over ${d.n} bodies`);
}
console.log("");
