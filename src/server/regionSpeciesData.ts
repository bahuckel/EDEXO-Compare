/**
 * The region × species rollup, loaded once.
 *
 * `data/exomastery/region-species.json` is 132 kB: for each of the galaxy's 42 regions, how many
 * systems there record each species, and how many record any species at all. Built by
 * `scripts/build-region-species.ts` from the galaxy bio index — counts only, no system rows, which
 * is the shape this project ships everything in.
 *
 * A missing file is not an error. Every verdict is then `unknown`, the matcher makes no region claim
 * and behaves exactly as it did before this existed. That is the same failure mode the region map
 * and the spatial catalogue chose, and the only safe one for optional data.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  judgeRegionalGenusShare,
  judgeRegionalPresence,
  REGION_GENUS_MIN_RECORDS,
  type RegionGenusShareVerdict,
  type RegionPresenceVerdict,
} from "../shared/regionAbsence.js";

interface RegionRow {
  name: string;
  systems: number;
  bioSystems: number;
  species: Record<string, number>;
}

interface RegionSpeciesFile {
  formatVersion?: number;
  builtAt?: string;
  speciesIds?: string[];
  regions?: Record<string, RegionRow>;
}

let cached: RegionSpeciesFile | null | undefined;
/**
 * The vocabulary as a set.
 *
 * `speciesIds.includes()` is a 102-entry linear scan, and this is asked once per species per body
 * per match run — the shape of question that turned into 82 % of a CPU profile last week. Built once
 * beside the file it describes.
 */
let cachedVocabulary: Set<string> | null = null;

export function regionSpeciesPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "exomastery", "region-species.json");
}

export function loadRegionSpecies(projectRoot: string): RegionSpeciesFile | null {
  if (cached !== undefined) return cached;
  const file = regionSpeciesPath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RegionSpeciesFile;
    cached = parsed?.regions && Object.keys(parsed.regions).length > 0 ? parsed : null;
    cachedVocabulary = cached?.speciesIds ? new Set(cached.speciesIds) : null;
  } catch {
    cached = null;
    cachedVocabulary = null;
  }
  return cached;
}

/**
 * How this species stands in this region.
 *
 * `regionIndex` is the klightspeed index the region map returns, so a caller that has already
 * resolved the commander's position passes it straight through.
 *
 * A species the rollup has never heard of returns `unknown` rather than `absent`: the index's
 * vocabulary is 102 species and the app knows 108, and the six it does not cover — Brain Trees and
 * the like — would otherwise be judged missing from every region in the galaxy.
 */
export function regionalPresence(
  projectRoot: string,
  regionIndex: number | null | undefined,
  speciesId: string,
): (RegionPresenceVerdict & { regionName: string }) | null {
  if (regionIndex == null || regionIndex <= 0) return null;
  const data = loadRegionSpecies(projectRoot);
  const row = data?.regions?.[String(regionIndex)];
  if (!row) return null;
  if (cachedVocabulary && !cachedVocabulary.has(speciesId)) {
    return { presence: "unknown", count: 0, bioSystems: row.bioSystems, share: 0, regionName: row.name };
  }
  const verdict = judgeRegionalPresence(row.species[speciesId] ?? 0, row.bioSystems);
  return { ...verdict, regionName: row.name };
}

/**
 * Drop the cached file so the next read comes off disk.
 *
 * Wired into the launcher's **Refresh exomastery**, which is the one control that promises a
 * commander their edits to `data/` have been picked up. Every module-level cache under `data/` has
 * to be listed there or that promise is quietly false for the file it holds — which is exactly what
 * happened to this one until the owner asked whether the button still worked.
 */
export function clearRegionSpeciesCache(): void {
  cached = undefined;
  // The vocabulary is derived from the file, so it must go with it or the next read keeps the old
  // species list and silently answers "unknown" for anything newly added.
  cachedVocabulary = null;
  // Derived from the same file, so it goes with it for the same reason.
  medianByRegion.clear();
  genusTotals.clear();
  galaxyTotals = null;
}

/** Test seam — the file is process-wide, so a test that swaps it must be able to put it back. */
export function setRegionSpeciesForTests(v: RegionSpeciesFile | null | undefined): void {
  cached = v;
  cachedVocabulary = v?.speciesIds ? new Set(v.speciesIds) : null;
  medianByRegion.clear();
  genusTotals.clear();
  galaxyTotals = null;
}

/**
 * How often a species is recorded in one region, as a count, with a floor that is not zero.
 *
 * The absence gate asks a yes/no question at 0.02 %, which throws the magnitude away. In The Veils
 * Tubus cavas is recorded 2,115 times and compagibus 11 — a ratio of 192 to 1 — and **both clear the
 * gate**, so the ranking sees them as equally plausible while no habitat term in the model comes
 * close to that much evidence.
 *
 * Returned as a raw count rather than a share because every candidate on a body sits in the same
 * region: `bioSystems` is identical for all of them and cancels in the softmax.
 *
 * A species the galaxy index has never heard of gets the region's **median** count rather than zero.
 * Six of the 108 shipped species are outside that index, and scoring them as absent everywhere would
 * bury them on evidence nobody ever gathered.
 */
export function regionalSpeciesCount(
  projectRoot: string,
  regionIndex: number | null | undefined,
  speciesId: string,
): number | null {
  if (regionIndex == null || regionIndex <= 0) return null;
  const data = loadRegionSpecies(projectRoot);
  const row = data?.regions?.[String(regionIndex)];
  if (!row) return null;
  if (cachedVocabulary && !cachedVocabulary.has(speciesId)) return medianCountFor(regionIndex, row);
  return row.species[speciesId] ?? 0;
}

const medianByRegion = new Map<number, number>();
function medianCountFor(regionIndex: number, row: RegionRow): number {
  const hit = medianByRegion.get(regionIndex);
  if (hit != null) return hit;
  const counts = Object.values(row.species)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const med = counts.length ? counts[Math.floor(counts.length / 2)]! : 0;
  medianByRegion.set(regionIndex, med);
  return med;
}

/** `tussock_tussock_divisa` → `tussock_tussock`: the genus, as every rollup species id spells it. */
const genusKeyOf = (speciesId: string) => speciesId.slice(0, speciesId.lastIndexOf("_"));

/** region index → genus key → records of that genus there, summed over its species. */
const genusTotals = new Map<number, Map<string, number>>();

/**
 * This species' share of its own genus' records in one region — see `REGION_GENUS_SHARE_MIN`.
 *
 * Null when there is nothing to judge: no region, a region the rollup does not hold, or a species
 * outside its vocabulary (the Brain Trees and their kind), which abstain rather than read as zero.
 */
export function regionalGenusShare(
  projectRoot: string,
  regionIndex: number | null | undefined,
  speciesId: string,
): (RegionGenusShareVerdict & { regionName: string }) | null {
  if (regionIndex == null || regionIndex <= 0) return null;
  const data = loadRegionSpecies(projectRoot);
  const row = data?.regions?.[String(regionIndex)];
  if (!row) return null;
  if (!cachedVocabulary?.has(speciesId)) return null;
  let totals = genusTotals.get(regionIndex);
  if (!totals) {
    totals = new Map();
    for (const [id, n] of Object.entries(row.species)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      const g = genusKeyOf(id);
      totals.set(g, (totals.get(g) ?? 0) + n);
    }
    genusTotals.set(regionIndex, totals);
  }
  const genusRecords = totals.get(genusKeyOf(speciesId)) ?? 0;
  if (!genusRecords) return null;
  return { ...judgeRegionalGenusShare(row.species[speciesId] ?? 0, genusRecords), regionName: row.name };
}

/** Galaxy-wide: species id → records, genus key → records. Summed once over every region. */
let galaxyTotals: { species: Map<string, number>; genus: Map<string, number> } | null = null;

/**
 * This species' share of its genus in the region, divided by its share of the genus galaxy-wide.
 *
 * 1 is its usual place in the genus; 0.004 is Tubus compagibus in the Trojan Belt (0.3 % of Tubus
 * records there, against a third of them across the galaxy). The share alone cannot tell that apart
 * from a species that is a small minority everywhere because its conditions are rare — Bacterium
 * scopulum is under 0.5 % of Bacterium in most regions and exactly as common as it always is.
 */
export function regionalGenusEnrichment(
  projectRoot: string,
  regionIndex: number | null | undefined,
  speciesId: string,
): number | null {
  const v = regionalGenusShare(projectRoot, regionIndex, speciesId);
  if (!v || v.genusRecords < REGION_GENUS_MIN_RECORDS) return null;
  if (!galaxyTotals) {
    const species = new Map<string, number>();
    const genus = new Map<string, number>();
    for (const row of Object.values(loadRegionSpecies(projectRoot)?.regions ?? {})) {
      for (const [id, n] of Object.entries(row.species)) {
        if (!Number.isFinite(n) || n <= 0) continue;
        species.set(id, (species.get(id) ?? 0) + n);
        genus.set(genusKeyOf(id), (genus.get(genusKeyOf(id)) ?? 0) + n);
      }
    }
    galaxyTotals = { species, genus };
  }
  const g = galaxyTotals.genus.get(genusKeyOf(speciesId)) ?? 0;
  const s = galaxyTotals.species.get(speciesId) ?? 0;
  if (!g || !s) return null;
  return v.share / (s / g);
}
