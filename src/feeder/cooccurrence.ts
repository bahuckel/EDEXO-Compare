/**
 * Build the genus co-occurrence table the matcher reads.
 *
 * The corpus records one sighting per (planet, species); grouping those by planet gives the genus
 * set of 10,371 bodies, and 8,505 of them carry more than one. That is the dataset A5 asked for, and
 * it was already sitting in the store — this is a GROUP BY, not a derivation.
 *
 * Two things it has to get right:
 *
 *  1. **Key on the app's genus, not on the corpus'.** Spansh landmark subtypes make "Aureum Brain
 *     Tree" a genus called `Aureum`, and there are eleven of those colour words against two real
 *     genera. Every label is resolved through the same `findSpeciesEntryForLabel` the installer
 *     uses, so the table speaks `genusDataDir` and joins to the matcher without a second mapping.
 *  2. **Say what was dropped.** Labels with no species row — the Anemone colour variants, Bark
 *     Mounds — are listed in the file rather than silently discarded, because a body whose only
 *     genus is unmapped still counted as a body until it did not.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database, SqlValue } from "sql.js";
import type { SpeciesDatabase } from "../shared/types.js";
import type { GenusCooccurrenceTable } from "../shared/genusCooccurrence.js";
import type { SpeciesPrevalenceFile } from "../shared/speciesPrior.js";
import { findSpeciesEntryForLabel } from "./install.js";
import { PROJECT_ROOT } from "./paths.js";

/** Where the app loads it from. Ships with `data/`, like the price list. */
export function cooccurrenceTablePath(projectRoot: string = PROJECT_ROOT): string {
  return join(projectRoot, "data", "exomastery", "genus-cooccurrence.json");
}

/** Where the ranking model reads its prior from. Same GROUP BY, one level down from the genus. */
export function speciesPrevalencePath(projectRoot: string = PROJECT_ROOT): string {
  return join(projectRoot, "data", "exomastery", "species-prevalence.json");
}

function queryAll<T extends SqlValue[]>(db: Database, sql: string): T[] {
  const st = db.prepare(sql);
  const out: T[] = [];
  while (st.step()) out.push(st.get() as T);
  st.free();
  return out;
}

export interface CooccurrenceBuildReport {
  table: GenusCooccurrenceTable;
  /** Bodies per species id — the ranking model's prior, counted on the same pass. */
  prevalence: SpeciesPrevalenceFile;
  /** Sightings whose species label resolved to a row in `data/species/**`. */
  mappedSightings: number;
  /** Sightings dropped because no row matched — one entry per distinct label in the table. */
  unmappedSightings: number;
  /** Bodies whose genus set survived mapping. */
  bodies: number;
  /** Bodies carrying two or more mapped genera — the ones that carry the co-occurrence signal. */
  multiGenusBodies: number;
}

export function buildCooccurrenceTable(db: Database, speciesDb: SpeciesDatabase): CooccurrenceBuildReport {
  const rows = queryAll<[number, string]>(db, "SELECT planet_id, species_label FROM sightings");

  const genusOfLabel = new Map<string, string | null>();
  const speciesIdOfLabel = new Map<string, string | null>();
  const labelOfGenus = new Map<string, string>();
  const bodiesPerSpecies = new Map<string, Set<number>>();
  const unmapped = new Set<string>();
  let mappedSightings = 0;
  let unmappedSightings = 0;

  const byPlanet = new Map<number, Set<string>>();
  for (const [planetId, label] of rows) {
    if (!genusOfLabel.has(label)) {
      const entry = findSpeciesEntryForLabel(speciesDb, label);
      genusOfLabel.set(label, entry?.genusDataDir ?? null);
      speciesIdOfLabel.set(label, entry?.id ?? null);
      if (entry?.genusDataDir)
        labelOfGenus.set(entry.genusDataDir, entry.genus?.trim() || entry.genusDataDir);
    }
    const genus = genusOfLabel.get(label) ?? null;
    if (!genus) {
      unmappedSightings++;
      unmapped.add(label);
      continue;
    }
    mappedSightings++;
    const speciesId = speciesIdOfLabel.get(label);
    if (speciesId) {
      const bodies = bodiesPerSpecies.get(speciesId) ?? new Set<number>();
      bodies.add(planetId);
      bodiesPerSpecies.set(speciesId, bodies);
    }
    const set = byPlanet.get(planetId) ?? new Set<string>();
    set.add(genus);
    byPlanet.set(planetId, set);
  }

  const table = tableFromGenusSets([...byPlanet.values()], labelOfGenus);
  table.unmappedLabels = [...unmapped].sort();

  return {
    table,
    prevalence: {
      formatVersion: 1,
      builtAt: table.builtAt,
      bodies: byPlanet.size,
      species: Object.fromEntries(
        [...bodiesPerSpecies.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, bodies]) => [id, bodies.size] as const),
      ),
    },
    mappedSightings,
    unmappedSightings,
    bodies: byPlanet.size,
    multiGenusBodies: [...byPlanet.values()].filter((s) => s.size > 1).length,
  };
}

/**
 * The counting itself, over genus sets rather than over the store.
 *
 * Separate from the query because the probe cross-validates by rebuilding the table from a subset of
 * the bodies — a table built over the same bodies it is then tested on would confirm itself.
 */
export function tableFromGenusSets(
  sets: Iterable<Iterable<string>>,
  labels: Map<string, string> = new Map(),
): GenusCooccurrenceTable {
  const genera: GenusCooccurrenceTable["genera"] = {};
  const pairs: Record<string, number> = {};
  const setSizes: Record<string, number> = {};
  let bodies = 0;

  for (const set of sets) {
    const list = [...new Set(set)].sort();
    if (list.length === 0) continue;
    bodies++;
    setSizes[String(list.length)] = (setSizes[String(list.length)] ?? 0) + 1;
    for (const g of list) {
      const row = genera[g] ?? { label: labels.get(g) ?? g, bodies: 0 };
      row.bodies++;
      genera[g] = row;
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = `${list[i]}|${list[j]}`;
        pairs[k] = (pairs[k] ?? 0) + 1;
      }
    }
  }

  return {
    formatVersion: 1,
    builtAt: new Date().toISOString(),
    bodies,
    genera: Object.fromEntries(Object.entries(genera).sort(([a], [b]) => a.localeCompare(b))),
    pairs: Object.fromEntries(Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b))),
    setSizes,
    unmappedLabels: [],
  };
}

export function writeCooccurrenceTable(table: GenusCooccurrenceTable, projectRoot?: string): string {
  const path = cooccurrenceTablePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`, "utf8");
  return path;
}

export function writeSpeciesPrevalence(prevalence: SpeciesPrevalenceFile, projectRoot?: string): string {
  const path = speciesPrevalencePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(prevalence, null, 2)}\n`, "utf8");
  return path;
}

export function formatCooccurrenceReport(r: CooccurrenceBuildReport, path: string): string {
  const t = r.table;
  const generaCount = Object.keys(t.genera).length;
  const possible = (generaCount * (generaCount - 1)) / 2;
  const lines = [
    "",
    `genus co-occurrence → ${path}`,
    `  bodies           ${r.bodies}   (${r.multiGenusBodies} carry more than one genus)`,
    `  sightings        ${r.mappedSightings} mapped, ${r.unmappedSightings} dropped with no species row`,
    `  genera           ${generaCount}`,
    `  species prior    ${Object.keys(r.prevalence.species).length} species over ${r.prevalence.bodies} bodies`,
    `  pairs observed   ${Object.keys(t.pairs).length} of ${possible} possible`,
  ];
  if (t.unmappedLabels.length) {
    lines.push(`  unmapped labels  ${t.unmappedLabels.join(", ")}`);
  }
  return lines.join("\n");
}
