/**
 * The feeder, as commands instead of a web UI.
 *
 * The feeder used to be a local Express server with a React page: import a CSV, then click "fetch"
 * per species, then "analyse" per species, then download each profile, then drag each file into
 * `data/species/<genus>/exomastery/`. It lives inside the app now, and the click-by-click part is
 * gone — the profiles are written straight where the app reads them.
 *
 *   npm run feeder -- status                  what the corpus holds and what the app is missing
 *   npm run feeder -- import <file.csv>       the one manual step: import, then run what it touched
 *   npm run feeder -- run [species...]        hydrate + analyse + install (default: everything)
 *   npm run feeder -- rebuild [species...]    rebuild from packs already on disk, no EDSM calls
 *
 * Flags: `--allow-downgrade` to overwrite a profile with one built from fewer samples (refused by
 * default), `--dry-run` on `rebuild` to report what would change without writing.
 *
 * The raw corpus is a build input and never ships. See `src/feeder/paths.ts` for where it is found.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import {
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  maxExomasteryProfileSampleCount,
} from "../src/server/exomasteryProfile.js";
import { feederDataDir, feederDataDirExists } from "../src/feeder/paths.js";
import {
  analyseAndInstallSpecies,
  formatRunReport,
  importCsv,
  openFeeder,
  recordStatusSnapshot,
  runPipeline,
  speciesWithSamples,
  type RunReport,
} from "../src/feeder/pipeline.js";
import { describeInstall, findSpeciesEntryForLabel } from "../src/feeder/install.js";
import { speciesFileSlug } from "../src/feeder/profileBuilder.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const command = argv[0] ?? "status";
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const allowDowngrade = flags.has("--allow-downgrade");

const log = (line: string) => console.log(line);

function requireCorpus(): void {
  if (feederDataDirExists()) return;
  console.error(
    `No feeder corpus at ${feederDataDir()}.\n` +
      "Set EDEXO_FEEDER_DATA_DIR, or put the raw sample packs in <repo>/feeder-data.",
  );
  process.exit(1);
}

async function cmdStatus(): Promise<void> {
  const db = loadSpeciesDatabaseFromTree(root);
  console.log(`\ncorpus            ${feederDataDir()}${feederDataDirExists() ? "" : "   (missing)"}`);

  if (!feederDataDirExists()) {
    console.log("\nNothing to report until the corpus is present.");
    return;
  }

  const ctx = await openFeeder();
  const stats = ctx.store.getStats();
  const labels = Object.keys(ctx.speciesIndex);
  console.log(
    `store             ${stats.uniqueSystems} systems · ${stats.uniquePlanets} planets · ${stats.uniqueSightings} sightings`,
  );
  console.log(`index             ${labels.length} species · ${ctx.cumulativeCsvRows} cumulative CSV lines`);

  const withSamples = new Set(await speciesWithSamples());
  const notHydrated = labels.filter((l) => !withSamples.has(speciesFileSlug(l)));
  console.log(`hydrated          ${labels.length - notHydrated.length} of ${labels.length} species`);

  // The number that actually matters: species the app can rank, versus species it only has codex
  // gates for. A species with no profile can be gated but never scored.
  const withProfile = db.species.filter((e) => hasExomasteryProfileFile(root, e));
  console.log(`app profiles      ${withProfile.length} of ${db.species.length} species rows`);

  const unmatched = labels.filter((l) => !findSpeciesEntryForLabel(db, l));
  if (unmatched.length) {
    console.log(`\nin the corpus but not in data/species/** (${unmatched.length}):`);
    for (const l of unmatched.slice(0, 12)) console.log(`  ${l}`);
    if (unmatched.length > 12) console.log(`  … and ${unmatched.length - 12} more`);
  }

  const missing = db.species.filter((e) => !hasExomasteryProfileFile(root, e));
  if (missing.length) {
    console.log(`\nspecies rows with no profile (${missing.length}):`);
    for (const e of missing.slice(0, 12)) console.log(`  ${e.displayName}`);
    if (missing.length > 12) console.log(`  … and ${missing.length - 12} more`);
  }

  // A profile built from fewer bodies than the corpus now holds is one an import left behind.
  const stale: string[] = [];
  for (const e of db.species) {
    const prof = loadExomasteryProfile(root, e);
    if (!prof) continue;
    const entry = Object.entries(ctx.speciesIndex).find(
      ([label]) => findSpeciesEntryForLabel(db, label)?.id === e.id,
    );
    if (!entry) continue;
    const have = prof.sampleCount ?? maxExomasteryProfileSampleCount(prof);
    const could = entry[1].occurrences.length;
    if (could > have) stale.push(`  ${e.displayName.padEnd(26)} profile ${have}, corpus has ${could}`);
  }
  if (stale.length) {
    console.log(
      `\nprofiles behind the corpus (${stale.length}) — \`npm run feeder -- run\` catches these up:`,
    );
    for (const s of stale.slice(0, 12)) console.log(s);
    if (stale.length > 12) console.log(`  … and ${stale.length - 12} more`);
  }
  // Every command leaves the snapshot behind, so the app's Options panel is never older than the
  // last time the feeder was touched.
  recordStatusSnapshot(ctx, "status");
  console.log("");
}

async function cmdImport(): Promise<void> {
  requireCorpus();
  const csv = positional[0];
  if (!csv) {
    console.error("Usage: npm run feeder -- import <file.csv>");
    process.exit(1);
  }
  const csvPath = path.resolve(csv);
  if (!existsSync(csvPath)) {
    console.error(`No such file: ${csvPath}`);
    process.exit(1);
  }

  const db = loadSpeciesDatabaseFromTree(root);
  const ctx = await openFeeder();
  const r = await importCsv(ctx, csvPath);

  console.log(`\nimported ${r.rowsInFile} rows from ${path.basename(csvPath)}`);
  console.log(`  species in corpus   ${r.speciesTotal}`);
  console.log(`  new species         ${r.newSpeciesLabels.length}`);
  console.log(`  new occurrences     ${r.newOccurrences}`);
  console.log(`  species to refresh  ${r.touchedSpecies.length}`);
  if (r.newSpeciesLabels.length) console.log(`  new: ${r.newSpeciesLabels.join(", ")}`);

  recordStatusSnapshot(ctx, "import");

  if (r.touchedSpecies.length === 0) {
    console.log("\nNothing gained occurrences — no rebuild needed.");
    return;
  }

  console.log("");
  const report = await runPipeline(ctx, db, r.touchedSpecies, { allowDowngrade, onProgress: log });
  finish(report);
}

async function cmdRun(): Promise<void> {
  requireCorpus();
  const db = loadSpeciesDatabaseFromTree(root);
  const ctx = await openFeeder();
  const labels = positional.length ? positional : Object.keys(ctx.speciesIndex).sort();
  console.log(`\nrunning ${labels.length} species from ${feederDataDir()}\n`);
  const report = await runPipeline(ctx, db, labels, { allowDowngrade, onProgress: log });
  recordStatusSnapshot(ctx, "run");
  finish(report);
}

/**
 * Rebuild from the packs already on disk. No EDSM traffic, so this is what to run after a change to
 * the profile builder — a full pass over the corpus in minutes rather than hours.
 */
async function cmdRebuild(): Promise<void> {
  requireCorpus();
  const dryRun = flags.has("--dry-run");
  const db = loadSpeciesDatabaseFromTree(root);
  const ctx = await openFeeder();

  const slugs = new Set(await speciesWithSamples());
  const labels = (positional.length ? positional : Object.keys(ctx.speciesIndex))
    .filter((l) => slugs.has(speciesFileSlug(l)))
    .sort();

  console.log(`\n${dryRun ? "[dry run] " : ""}rebuilding ${labels.length} species from saved packs\n`);
  const report: RunReport = { hydrated: [], installs: [], errors: [], halted: false };
  for (const label of labels) {
    try {
      if (dryRun) {
        // Building without installing still exercises the loader and the builder, which is where a
        // regression would show; it just does not touch data/species.
        const before = findSpeciesEntryForLabel(db, label);
        console.log(`  would rebuild ${label}${before ? "" : "   (no species row — would not install)"}`);
        continue;
      }
      const install = await analyseAndInstallSpecies(ctx, db, label, { allowDowngrade });
      report.installs.push(install);
      console.log(describeInstall(install));
    } catch (e) {
      report.errors.push({ speciesLabel: label, error: String(e instanceof Error ? e.message : e) });
      console.log(`  error      ${label.padEnd(26)} ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  if (!dryRun) {
    recordStatusSnapshot(ctx, "rebuild");
    finish(report);
  }
}

function finish(report: RunReport): void {
  console.log(formatRunReport(report));
  const bad =
    report.installs.some((r) => r.outcome.kind === "unreadable-after-write") || report.errors.length > 0;
  if (bad) process.exitCode = 1;
}

switch (command) {
  case "status":
    await cmdStatus();
    break;
  case "import":
    await cmdImport();
    break;
  case "run":
    await cmdRun();
    break;
  case "rebuild":
    await cmdRebuild();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error("  npm run feeder -- status | import <file.csv> | run [species...] | rebuild [species...]");
    process.exit(1);
}
