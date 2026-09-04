/**
 * Put a freshly built profile where the app reads it.
 *
 * This is the step that used to be a browser download followed by a drag into
 * `data/species/<genus>/exomastery/`, and the cost of that is on the record: two Electricae profiles
 * shipped stale and three Tubus were never copied at all. Nobody did anything wrong — the pipeline
 * simply had a person in the middle of it.
 *
 * Two rules make automating it safe rather than merely fast:
 *
 *  1. **Ask the consumer where the file goes.** The target path is resolved through the app's own
 *     `resolveExomasteryExportBasename` / `resolveExomasteryProfileJsonPath`, and the write is
 *     verified by asking the loader to find it again afterwards. An installer that computes its own
 *     filename can write a file the app never opens, which looks exactly like a build that worked.
 *  2. **Never quietly lose evidence.** A profile built from fewer samples than the one already in
 *     place is refused unless the caller says otherwise, because that is what an interrupted
 *     hydration produces and it is indistinguishable from a good run at the file level.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import {
  maxExomasteryProfileSampleCount,
  resolveExomasteryExportBasename,
  resolveExomasteryProfileJsonPath,
  speciesSlug,
  type ExomasteryProfileV1 as AppProfile,
} from "../server/exomasteryProfile.js";
import type { ExomasteryProfileV1 } from "./profileBuilder.js";
import { PROJECT_ROOT, speciesDataDir } from "./paths.js";

export type InstallOutcome =
  /** Written. `previousSamples` is null when this is the first profile for the species. */
  | { kind: "installed"; path: string; samples: number; previousSamples: number | null }
  /** Built from fewer samples than the profile in place; nothing written. */
  | { kind: "refused-downgrade"; path: string; samples: number; previousSamples: number }
  /** No species row in `data/species/**` matches this feeder label. */
  | { kind: "no-species-row" }
  /** Written, but the app's loader does not resolve it — a silent-failure guard. */
  | { kind: "unreadable-after-write"; path: string };

export interface InstallResult {
  speciesLabel: string;
  outcome: InstallOutcome;
}

/** Word multiset of a label, order removed — `brain tree aureum` and `aureum brain tree` collide. */
function wordBag(label: string): string {
  return speciesSlug(label).split("_").filter(Boolean).sort().join("_");
}

/**
 * Match a feeder species label to a row in the app's species tree.
 *
 * The feeder labels come from Spansh landmark subtypes ("Stratum Tectonicas"); the app's display
 * names come from the genus JSON ("Stratum tectonicas"). Slug comparison is what makes those the
 * same key, and it is the same slug the app's own filename candidates use.
 *
 * The colour-variant genera do not agree on word order at all: Spansh writes "Aureum Brain Tree"
 * and "Prasinum Sinuous Tubers" where the app has "Brain Tree Aureum" and "Sinuous Tubers Prasinum".
 * That mismatch alone left 8 Brain Tree and 8 Sinuous Tubers rows with no profile while their
 * samples sat in the corpus. Word-order-insensitive matching is only accepted when exactly one row
 * matches — an ambiguous bag is a naming problem to look at, not one to guess at.
 *
 * Deliberately *not* matched: "Croceum Anemone", "Roseum Bioluminescent Anemone" and their
 * siblings, because the app carries a single `Anemone` row and folding six observed variants into
 * it would invent a habitat none of them has. Same for "Bark Mounds", which has no species row at
 * all. Both are reported by `feeder status` rather than papered over.
 */
export function findSpeciesEntryForLabel(db: SpeciesDatabase, speciesLabel: string): SpeciesEntry | null {
  const want = speciesSlug(speciesLabel);
  if (!want) return null;
  for (const e of db.species) {
    if (speciesSlug(e.displayName) === want) return e;
    if (speciesSlug(`${e.genus} ${e.displayName}`) === want) return e;
  }

  const bag = wordBag(speciesLabel);
  const byBag = db.species.filter(
    (e) => wordBag(e.displayName) === bag || wordBag(`${e.genus} ${e.displayName}`) === bag,
  );
  return byBag.length === 1 ? byBag[0]! : null;
}

/**
 * Sample count a profile claims, preferring its own field and falling back to the rollups.
 *
 * The rollup fallback reads four maps and an older or partial profile may be missing some of them,
 * so they are filled in here. This runs against whatever is already on disk, which is exactly the
 * place a shape assumption does not hold.
 */
export function profileSampleCount(profile: {
  sampleCount?: number;
  numerics?: Record<string, { count?: number }>;
  materials?: Record<string, { count?: number }>;
  atmosphereComposition?: Record<string, { count?: number }>;
  solidComposition?: Record<string, { count?: number }>;
}): number {
  if (typeof profile.sampleCount === "number" && profile.sampleCount > 0) return profile.sampleCount;
  const whole = {
    numerics: profile.numerics ?? {},
    materials: profile.materials ?? {},
    atmosphereComposition: profile.atmosphereComposition ?? {},
    solidComposition: profile.solidComposition ?? {},
  };
  return maxExomasteryProfileSampleCount(whole as unknown as AppProfile);
}

/**
 * The file to write for this species.
 *
 * An existing profile is overwritten in place, whatever it happens to be called. Writing to a
 * freshly computed name instead would leave two files the loader could choose between, and it picks
 * by sorted filename — so the stale one could win.
 */
export function resolveInstallPath(entry: SpeciesEntry): string {
  const dir = join(speciesDataDir(), entry.genusDataDir, "exomastery");
  const existing = resolveExomasteryExportBasename(PROJECT_ROOT, entry);
  if (existing) return join(dir, existing);
  return join(dir, `${speciesSlug(entry.displayName)}_exomastery.json`);
}

export function installProfile(
  db: SpeciesDatabase,
  profile: ExomasteryProfileV1,
  opts?: { allowDowngrade?: boolean },
): InstallResult {
  const speciesLabel = profile.speciesLabel;
  const entry = findSpeciesEntryForLabel(db, speciesLabel);
  if (!entry) return { speciesLabel, outcome: { kind: "no-species-row" } };

  const path = resolveInstallPath(entry);
  const samples = profileSampleCount(profile);

  let previousSamples: number | null = null;
  if (existsSync(path)) {
    try {
      previousSamples = profileSampleCount(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // Unparseable file in place: treat as no evidence rather than as a reason to refuse.
      previousSamples = null;
    }
  }

  if (previousSamples != null && samples < previousSamples && opts?.allowDowngrade !== true) {
    return { speciesLabel, outcome: { kind: "refused-downgrade", path, samples, previousSamples } };
  }

  mkdirSync(join(speciesDataDir(), entry.genusDataDir, "exomastery"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

  // The loader has its own rules about which file in the folder belongs to which species. If it
  // cannot find what we just wrote, the build "succeeded" and changed nothing the app will read.
  const found = resolveExomasteryProfileJsonPath(PROJECT_ROOT, entry);
  if (!found || basename(found).toLowerCase() !== basename(path).toLowerCase()) {
    return { speciesLabel, outcome: { kind: "unreadable-after-write", path } };
  }

  return { speciesLabel, outcome: { kind: "installed", path, samples, previousSamples } };
}

/** One line per species, for the run report. */
export function describeInstall(r: InstallResult): string {
  const o = r.outcome;
  switch (o.kind) {
    case "installed": {
      const delta =
        o.previousSamples == null
          ? "new"
          : o.samples === o.previousSamples
            ? `${o.samples} samples, unchanged`
            : `${o.previousSamples} → ${o.samples} samples`;
      return `  installed  ${r.speciesLabel.padEnd(26)} ${delta}`;
    }
    case "refused-downgrade":
      return `  REFUSED    ${r.speciesLabel.padEnd(26)} would drop ${o.previousSamples} → ${o.samples} samples (pass --allow-downgrade to force)`;
    case "no-species-row":
      return `  no row     ${r.speciesLabel.padEnd(26)} nothing in data/species/** matches this label`;
    case "unreadable-after-write":
      return `  BROKEN     ${r.speciesLabel.padEnd(26)} written to ${o.path} but the app's loader does not resolve it`;
  }
}
