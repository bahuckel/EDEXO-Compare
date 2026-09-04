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
import type { SpeciesDatabase } from "../shared/types.js";
import { loadExomasteryProfile, resolveExomasteryProfileJsonPath } from "../server/exomasteryProfile.js";
import {
  buildParameterImportance,
  poolBackground,
  type CategoricalTable,
  type ParameterImportance,
} from "./parameterImportance.js";
import { PROJECT_ROOT } from "./paths.js";

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

export function applyParameterImportance(db: SpeciesDatabase): ImportanceReport {
  const loaded: { path: string; categorical: CategoricalTable | undefined }[] = [];
  for (const entry of db.species) {
    const file = resolveExomasteryProfileJsonPath(PROJECT_ROOT, entry);
    if (!file) continue;
    const prof = loadExomasteryProfile(PROJECT_ROOT, entry);
    if (!prof) continue;
    const categorical = prof.categorical
      ? Object.fromEntries(Object.entries(prof.categorical).filter(([p]) => !PROVENANCE_PATHS.has(p)))
      : undefined;
    loaded.push({ path: file, categorical });
  }

  const background = poolBackground(loaded.map((l) => l.categorical));
  const byPath = new Map<string, number[]>();
  let scored = 0;

  for (const { path, categorical } of loaded) {
    const importance: ParameterImportance | undefined = buildParameterImportance(categorical, background);
    // Read and rewrite the file directly: the app's loader normalises the profile on the way in
    // (hoisting composition rollups), and writing that back would rewrite observations as a side
    // effect of storing a weight.
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (importance) {
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
