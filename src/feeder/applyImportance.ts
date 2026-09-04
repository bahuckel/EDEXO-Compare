/**
 * Write measured parameter importance into the installed profiles.
 *
 * This has to be a pass *over all of them*, not part of building one, because the measure is
 * relative: a species' concentration only means something against the pooled distribution of every
 * body carrying biology. So profiles are installed first, then read back together, pooled, scored,
 * and rewritten with a `parameterImportance` block.
 *
 * Idempotent, and it never changes an observation — only the derived weights.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpeciesDatabase } from "../shared/types.js";
import { loadExomasteryProfile, resolveExomasteryProfileJsonPath } from "../server/exomasteryProfile.js";
import {
  buildParameterImportance,
  numericDeterminism,
  poolBackground,
  quantileBins,
  type CategoricalTable,
  type NumericBins,
  type ParameterImportance,
} from "./parameterImportance.js";
import { PROJECT_ROOT, rawPlanetsDir } from "./paths.js";
import { loadPlanetContextsFromDir } from "./planetContexts.js";
import { flattenForStats, speciesFileSlug } from "./flatten.js";
import { shouldOmitExomasterySciencePath } from "../server/exomasteryPathHygiene.js";

/**
 * Paths that describe our own pipeline rather than the body.
 *
 * `exo.host_star_source` records whether the host star came from the parent chain or from a
 * designation guess. It is provenance, and scoring a species for being consistently resolvable would
 * be measuring the feeder rather than the galaxy.
 */
const PROVENANCE_PATHS = new Set(["exo.host_star_source"]);

export interface ImportanceReport {
  profiles: number;
  scored: number;
  /** Mean determinism per parameter across every species that had enough samples to score. */
  meanByPath: { path: string; mean: number; species: number }[];
}

/**
 * Every numeric reading the corpus holds for one species, by path.
 *
 * Read from the sample packs rather than from the profile, because the profile stores rollups and a
 * rollup cannot be re-binned. This is the same source the profile itself was built from.
 */
async function numericSamplesForSpecies(slug: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  let contexts;
  try {
    contexts = await loadPlanetContextsFromDir(join(rawPlanetsDir(), slug));
  } catch {
    return out;
  }
  for (const ctx of contexts) {
    const body = ctx.targetBody as unknown as Record<string, unknown> | null;
    if (!body) continue;
    for (const [path, val] of flattenForStats(body, "body", 0, new Map())) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      if (shouldOmitExomasterySciencePath(path)) continue;
      const list = out.get(path) ?? [];
      list.push(val);
      out.set(path, list);
    }
  }
  return out;
}

export async function applyParameterImportance(db: SpeciesDatabase): Promise<ImportanceReport> {
  const loaded: { path: string; slug: string; categorical: CategoricalTable | undefined }[] = [];
  for (const entry of db.species) {
    const file = resolveExomasteryProfileJsonPath(PROJECT_ROOT, entry);
    if (!file) continue;
    const prof = loadExomasteryProfile(PROJECT_ROOT, entry);
    if (!prof) continue;
    const categorical = prof.categorical
      ? Object.fromEntries(Object.entries(prof.categorical).filter(([p]) => !PROVENANCE_PATHS.has(p)))
      : undefined;
    // The pack directory is named after the corpus label, which the installer records when it
    // rewrites the profile with the app's own species name.
    const source = (prof as { sourceSpeciesLabel?: string }).sourceSpeciesLabel;
    loaded.push({
      path: file,
      slug: speciesFileSlug(source ?? prof.speciesLabel ?? entry.displayName),
      categorical,
    });
  }

  const background = poolBackground(loaded.map((l) => l.categorical));

  /**
   * The numeric half, on the same scale.
   *
   * Categorical determinism alone reweights six terms among fifty-three, which shrinks them against
   * the numerics rather than reordering anything — measured, it made ranking slightly worse. Both
   * halves have to speak the same units before either is usable.
   */
  const numericSamples = new Map<string, Map<string, number[]>>();
  const pooledNumerics = new Map<string, number[]>();
  for (const l of loaded) {
    const samples = await numericSamplesForSpecies(l.slug);
    numericSamples.set(l.path, samples);
    for (const [p, vals] of samples) {
      const acc = pooledNumerics.get(p) ?? [];
      acc.push(...vals);
      pooledNumerics.set(p, acc);
    }
  }
  const numericBins = new Map<string, NumericBins>();
  for (const [p, vals] of pooledNumerics) numericBins.set(p, quantileBins(vals));
  const byPath = new Map<string, number[]>();
  let scored = 0;

  for (const { path, categorical } of loaded) {
    const importance: ParameterImportance = buildParameterImportance(categorical, background) ?? {};
    for (const [p, vals] of numericSamples.get(path) ?? []) {
      const edges = numericBins.get(p);
      if (!edges) continue;
      const d = numericDeterminism(vals, edges);
      if (d != null) importance[p] = Math.round(d * 1000) / 1000;
    }
    const hasImportance = Object.keys(importance).length > 0;
    // Read and rewrite the file directly: the app's loader normalises the profile on the way in
    // (hoisting composition rollups), and writing that back would rewrite observations as a side
    // effect of storing a weight.
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (hasImportance) {
      raw.parameterImportance = importance;
      scored++;
      for (const [p, d] of Object.entries(importance)) byPath.set(p, [...(byPath.get(p) ?? []), d]);
    } else {
      delete raw.parameterImportance;
    }
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }

  const meanByPath = [...byPath.entries()]
    .map(([path, ds]) => ({ path, mean: ds.reduce((s, x) => s + x, 0) / ds.length, species: ds.length }))
    .sort((a, b) => b.mean - a.mean);

  return { profiles: loaded.length, scored, meanByPath };
}

export function formatImportanceReport(r: ImportanceReport): string {
  const lines = [
    "",
    `measured parameter importance on ${r.scored} of ${r.profiles} profiles`,
    "  determinism vs the pooled background — 1 = decides everything, 0 = spread like the galaxy,",
    "  negative = spread wider than the galaxy, so this parameter does not constrain the species",
    "",
  ];
  for (const m of r.meanByPath) {
    lines.push(`  ${m.path.padEnd(38)} ${m.mean.toFixed(3)}   (${m.species} species)`);
  }
  return lines.join("\n");
}
