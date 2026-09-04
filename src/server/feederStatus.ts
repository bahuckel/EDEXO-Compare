/**
 * Feeder state for the Options panel.
 *
 * Deliberately does **not** open the feeder's SQLite store. That would pull `sql.js` and its WASM
 * blob into the shipped server for a maintainer tool whose corpus never ships and which a normal
 * install has nothing to open. The counts that genuinely need the store come from the snapshot the
 * CLI leaves behind; everything else is computed live from the same files the app already reads, so
 * the parts that change when you run the feeder are never stale.
 *
 * The panel exists to answer one question: **is the data the app is ranking with the data the
 * corpus actually holds?** Before the merge the answer was no on 72 of 79 profiles, and nothing in
 * the app said so.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FeederStatusDTO, SpeciesDatabase } from "../shared/types.js";
import { feederDataDir, feederDataDirExists, rawPlanetsDir } from "../feeder/paths.js";
import { readFeederStatusSnapshot } from "../feeder/statusSnapshot.js";
import { findSpeciesEntryForLabel } from "../feeder/install.js";
import {
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  maxExomasteryProfileSampleCount,
  resolveExomasteryProfileJsonPath,
} from "./exomasteryProfile.js";

/** Sample packs on disk for one species slug — what a `rebuild` would actually read. */
function packCount(slug: string): number {
  try {
    return readdirSync(join(rawPlanetsDir(), slug)).filter(
      (f) => f.startsWith("sample_") && f.endsWith(".json"),
    ).length;
  } catch {
    return 0;
  }
}

function hydratedSlugs(): string[] {
  try {
    return readdirSync(rawPlanetsDir());
  } catch {
    return [];
  }
}

export function buildFeederStatus(projectRoot: string, db: SpeciesDatabase): FeederStatusDTO {
  if (!feederDataDirExists()) {
    return {
      available: false,
      corpusDir: feederDataDir(),
      snapshot: null,
      hydratedSpecies: 0,
      speciesRows: db.species.length,
      speciesRowsWithProfile: 0,
      profileBytes: 0,
      behind: [],
      behindCount: 0,
      behindOccurrences: 0,
      unmatchedCorpusLabels: [],
    };
  }

  const snapshot = readFeederStatusSnapshot();
  const slugs = hydratedSlugs();

  /**
   * Corpus occurrence counts keyed by species row, not by label.
   *
   * Matching on the label string is what a first version does, and it fails silently in the one
   * direction that matters: a profile whose name no longer equals the corpus spelling looks
   * up-to-date. Resolving each corpus label through the same matcher the installer uses means the
   * panel and the installer can never disagree about which species a label names.
   */
  const occurrencesByEntryId = new Map<string, number>();
  const unmatchedCorpusLabels: string[] = [];
  for (const [label, n] of Object.entries(snapshot?.occurrencesBySpecies ?? {})) {
    const entry = findSpeciesEntryForLabel(db, label);
    if (!entry) {
      unmatchedCorpusLabels.push(label);
      continue;
    }
    occurrencesByEntryId.set(entry.id, Math.max(occurrencesByEntryId.get(entry.id) ?? 0, n));
  }
  unmatchedCorpusLabels.sort();

  let speciesRowsWithProfile = 0;
  let profileBytes = 0;
  const behind: FeederStatusDTO["behind"] = [];

  for (const entry of db.species) {
    if (!hasExomasteryProfileFile(projectRoot, entry)) continue;
    speciesRowsWithProfile++;
    const path = resolveExomasteryProfileJsonPath(projectRoot, entry);
    if (path) {
      try {
        profileBytes += statSync(path).size;
      } catch {
        /* counted as zero rather than failing the whole panel */
      }
    }
    const prof = loadExomasteryProfile(projectRoot, entry);
    if (!prof) continue;
    const have = prof.sampleCount ?? maxExomasteryProfileSampleCount(prof);

    const corpusOccurrences = occurrencesByEntryId.get(entry.id) ?? 0;
    if (corpusOccurrences > have) {
      behind.push({ species: entry.displayName, profileSamples: have, corpusOccurrences });
    }
  }
  behind.sort((a, b) => b.corpusOccurrences - b.profileSamples - (a.corpusOccurrences - a.profileSamples));

  return {
    available: true,
    corpusDir: feederDataDir(),
    snapshot: snapshot
      ? {
          writtenAtIso: snapshot.writtenAtIso,
          lastCommand: snapshot.lastCommand,
          uniqueSystems: snapshot.uniqueSystems,
          uniquePlanets: snapshot.uniquePlanets,
          uniqueSightings: snapshot.uniqueSightings,
          corpusSpecies: snapshot.corpusSpecies,
          cumulativeCsvRows: snapshot.cumulativeCsvRows,
        }
      : null,
    hydratedSpecies: slugs.filter((s) => packCount(s) > 0).length,
    speciesRows: db.species.length,
    speciesRowsWithProfile,
    profileBytes,
    behind: behind.slice(0, 40),
    behindCount: behind.length,
    behindOccurrences: behind.reduce((s, b) => s + (b.corpusOccurrences - b.profileSamples), 0),
    unmatchedCorpusLabels,
  };
}
