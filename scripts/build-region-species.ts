/**
 * Build the region × species table: which of the galaxy's 42 regions each species has been seen in.
 *
 *   npx tsx scripts/build-region-species.ts
 *
 * ## Why this exists
 *
 * Region is one of the strongest signals in exobiology and the app has never used it. On Blu Thua
 * EM-D d12-25 A 1 a the conditions admitted 20 species for 9 signals, and the owner's read of the
 * losers was the same word four times over: *region check*. Conditions say what could grow; region
 * says what grows **here**, and no amount of temperature and gravity will separate two species that
 * share a codex row but live half a galaxy apart.
 *
 * ## What is shipped, and what is not
 *
 * Input is `data/galaxy/bio-index.bin`, whose species layer comes from edastro's codex. Output is a
 * **rollup** — counts per region, nothing per system — which is the shape the owner set for this
 * project: ship the statistic, never the corpus. It is about 90 kB against the index's 234 MB, and
 * it carries no system, no body and no commander.
 *
 * ## Reading the numbers
 *
 * Two denominators, because the interesting question needs both:
 *
 *   `systems`        systems the index holds in that region at all
 *   `bioSystems`     systems there with at least one recorded species
 *   `species[id]`    systems there recording that species
 *
 * A species with zero in a region that has thousands of recorded bio systems is a real absence. A
 * species with zero in a region holding forty is nothing at all, and the consumer has to be able to
 * tell those apart — so the denominator ships with the numerator rather than being folded into a
 * share.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadBioIndex } from "../src/server/bioIndex.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { getProjectRoot } from "../src/server/paths.js";

const root = getProjectRoot();

function main(): void {
  const idx = loadBioIndex();
  if (!idx) {
    console.error("No bio index at data/galaxy/bio-index.bin — build it first.");
    process.exitCode = 1;
    return;
  }
  const regionMap = loadRegionMap(root);
  const regionNames = regionMap?.regions ?? [];

  const speciesCount = idx.species.length;
  // One flat Int32Array rather than a Map per region: 43 x 102 is 4,386 counters, and a typed array
  // keeps the inner loop free of hashing on a pass that runs five million times.
  const REGIONS = 64;
  const counts = new Int32Array(REGIONS * speciesCount);
  const systems = new Int32Array(REGIONS);
  const bioSystems = new Int32Array(REGIONS);

  /*
   * One pass. The callback carries the system ordinal precisely so this loop can tell where one
   * system's species run ends: a change of ordinal is a new system, and the first entry of a run is
   * where the system itself gets counted.
   */
  let currentSystem = -1;
  idx.forEachRegionSpecies((systemIndex, regionId, speciesIndex) => {
    const r = regionId < REGIONS ? regionId : 0;
    if (systemIndex !== currentSystem) {
      currentSystem = systemIndex;
      systems[r]!++;
      if (speciesIndex >= 0) bioSystems[r]!++;
    }
    if (speciesIndex >= 0) counts[r * speciesCount + speciesIndex]!++;
  });

  const out: {
    formatVersion: number;
    builtAt: string;
    source: Record<string, string>;
    speciesIds: string[];
    regions: Record<string, { name: string; systems: number; bioSystems: number; species: Record<string, number> }>;
  } = {
    formatVersion: 1,
    builtAt: new Date().toISOString(),
    source: {
      index: "data/galaxy/bio-index.bin",
      note: "Counts only. Rolled up from the galaxy bio index, whose species layer comes from edastro's codex; no per-system row is reproduced here.",
      regionMap: "data/exomastery/region-map.json (klightspeed region indices 1-42)",
    },
    speciesIds: idx.species,
    regions: {},
  };

  for (let r = 0; r < REGIONS; r++) {
    if (systems[r] === 0) continue;
    const species: Record<string, number> = {};
    for (let s = 0; s < speciesCount; s++) {
      const n = counts[r * speciesCount + s]!;
      if (n > 0) species[idx.species[s]!] = n;
    }
    out.regions[String(r)] = {
      name: regionNames[r] ?? (r === 0 ? "Unknown" : `Region ${r}`),
      systems: systems[r]!,
      bioSystems: bioSystems[r]!,
      species,
    };
  }

  const file = path.join(root, "data", "exomastery", "region-species.json");
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`, "utf8");

  const rows = Object.entries(out.regions).sort((a, b) => b[1].bioSystems - a[1].bioSystems);
  console.log(`wrote ${file}`);
  console.log(`${rows.length} regions, ${speciesCount} species`);
  for (const [id, r] of rows.slice(0, 8)) {
    const named = Object.keys(r.species).length;
    console.log(
      `  ${id.padStart(2)} ${r.name.padEnd(28)} ${String(r.bioSystems).padStart(8)} bio systems · ${named} species seen`,
    );
  }
}

main();
