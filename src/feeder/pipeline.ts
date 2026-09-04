/**
 * The feeder as one run instead of a page of buttons.
 *
 * What this replaces: import a CSV in a browser, then click "fetch" once per species, then click
 * "analyse" once per species, then download each profile, then drag each file into
 * `data/species/<genus>/exomastery/`. Every one of those steps was a place to stop halfway, and the
 * shipped data shows where it stopped.
 *
 * The target the owner set is one human action — drop a Spansh CSV in — and everything after it
 * derived from data points rather than from judgement. So: import records what changed, hydration
 * runs for exactly the species the import touched, analysis runs when a species finishes hydrating,
 * installation writes where the app reads, and the run ends with a report of what moved.
 *
 * Hydration is checkpointed per species, because EDSM rate-limits and a corpus this size does not
 * fit in one uninterrupted run. A resumed run keeps the samples already on disk and continues from
 * the occurrence index it stopped at.
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SpeciesDatabase } from "../shared/types.js";
import { countIndexGrowth, parseSpanshExobiologyCsv, type SpeciesIndexEntry } from "./csvImport.js";
import { openFeederStore, type FeederStore } from "./feederDb.js";
import {
  extractPlanetContext,
  fetchEdsmSystemBodies,
  isEdsmRateLimitExhausted,
  withEdsmGate,
} from "./edsm.js";
import { loadPlanetContextsFromDir } from "./planetContexts.js";
import { buildProfileFromPlanetContexts, speciesFileSlug } from "./profileBuilder.js";
import { sanitizeExomasteryProfileForEdexo } from "./profileExportSanitize.js";
import { describeInstall, installProfile, type InstallResult } from "./install.js";
import {
  feederDataDir,
  feederDbPath,
  fetchCheckpointsDir,
  indexPath,
  rawPlanetsDir,
  rawSystemsDir,
} from "./paths.js";

export interface FeederContext {
  store: FeederStore;
  speciesIndex: Record<string, SpeciesIndexEntry>;
  cumulativeCsvRows: number;
}

/** Progress callback, so the CLI and any later UI report the same thing. */
export type ProgressFn = (line: string) => void;

async function ensureDirs(): Promise<void> {
  await mkdir(feederDataDir(), { recursive: true });
  await mkdir(rawSystemsDir(), { recursive: true });
  await mkdir(rawPlanetsDir(), { recursive: true });
  await mkdir(fetchCheckpointsDir(), { recursive: true });
}

/** Open the store and read the species index out of it. The SQLite file is the source of truth. */
export async function openFeeder(): Promise<FeederContext> {
  await ensureDirs();
  const store = await openFeederStore(feederDbPath());
  store.tryMigrateFromIndexJsonFile(indexPath());
  return {
    store,
    speciesIndex: store.rebuildSpeciesIndex(),
    cumulativeCsvRows: store.getCumulativeCsvRows(),
  };
}

/** JSON mirror of the index, kept only because the old feeder UI and its migration path read it. */
async function saveIndexMirror(ctx: FeederContext): Promise<void> {
  await writeFile(
    indexPath(),
    JSON.stringify(
      {
        formatVersion: 2,
        lastSavedAt: new Date().toISOString(),
        cumulativeCsvRowsImported: ctx.cumulativeCsvRows,
        species: ctx.speciesIndex,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export interface ImportResult {
  rowsInFile: number;
  speciesTotal: number;
  cumulativeCsvRows: number;
  /** Species the corpus had never seen before this file. */
  newSpeciesLabels: string[];
  newOccurrences: number;
  /** Species labels whose occurrence list grew — exactly what needs re-hydrating. */
  touchedSpecies: string[];
}

/** The one manual step: a Spansh exobiology CSV. Everything else follows from what it changed. */
export async function importCsv(ctx: FeederContext, csvPath: string): Promise<ImportResult> {
  const text = await readFile(csvPath, "utf8");
  const rows = parseSpanshExobiologyCsv(text);
  if (rows.length === 0) {
    throw new Error(
      "No usable rows — the CSV needs System Name, Body Name and Landmark Subtype columns with values.",
    );
  }

  const before = structuredClone(ctx.speciesIndex);
  ctx.store.applyCsvRows(rows);
  ctx.speciesIndex = ctx.store.rebuildSpeciesIndex();
  ctx.cumulativeCsvRows = ctx.store.getCumulativeCsvRows();
  await saveIndexMirror(ctx);

  const growth = countIndexGrowth(before, ctx.speciesIndex);
  // A species is worth re-hydrating when it gained occurrences; one whose count is unchanged would
  // rebuild to the same profile from the same packs.
  const touched: string[] = [];
  const newLabels: string[] = [];
  for (const [label, entry] of Object.entries(ctx.speciesIndex)) {
    const prev = before[label];
    if (!prev) newLabels.push(label);
    if (!prev || entry.occurrences.length > prev.occurrences.length) touched.push(label);
  }

  return {
    rowsInFile: rows.length,
    speciesTotal: Object.keys(ctx.speciesIndex).length,
    cumulativeCsvRows: ctx.cumulativeCsvRows,
    newSpeciesLabels: newLabels.sort(),
    newOccurrences: growth.newOccurrences,
    touchedSpecies: touched.sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------------------------

interface SpeciesCheckpoint {
  version: 1;
  speciesLabel: string;
  nextOccurrenceIndex: number;
}

function checkpointPath(speciesLabel: string): string {
  return join(fetchCheckpointsDir(), `${speciesFileSlug(speciesLabel)}__species_fetch.json`);
}

async function readCheckpoint(speciesLabel: string): Promise<number> {
  try {
    const j = JSON.parse(await readFile(checkpointPath(speciesLabel), "utf8")) as SpeciesCheckpoint;
    if (j?.version !== 1 || j.speciesLabel !== speciesLabel) return 0;
    return typeof j.nextOccurrenceIndex === "number" && j.nextOccurrenceIndex >= 0
      ? j.nextOccurrenceIndex
      : 0;
  } catch {
    return 0;
  }
}

async function writeCheckpoint(speciesLabel: string, nextOccurrenceIndex: number): Promise<void> {
  await mkdir(fetchCheckpointsDir(), { recursive: true });
  await writeFile(
    checkpointPath(speciesLabel),
    JSON.stringify({ version: 1, speciesLabel, nextOccurrenceIndex } satisfies SpeciesCheckpoint, null, 2),
    "utf8",
  );
}

async function clearCheckpoint(speciesLabel: string): Promise<void> {
  try {
    await unlink(checkpointPath(speciesLabel));
  } catch {
    /* nothing to clear */
  }
}

/** Stable per-system cache filename: readable prefix plus a hash, so odd system names stay safe. */
function systemFileSlug(name: string): string {
  const h = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 20);
  const safe = name.replace(/[^\w-]+/g, "_").slice(0, 60);
  return `${safe}__${h}`;
}

/** Reload the system→cache-file map from packs already on disk, so a resume re-fetches nothing. */
async function seenSystemsFromSamples(outDir: string, upTo: number): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  for (let i = 0; i < upTo; i++) {
    try {
      const pack = JSON.parse(await readFile(join(outDir, `sample_${i}.json`), "utf8")) as {
        systemName?: string;
        systemCacheFile?: string;
      };
      if (pack.systemName && pack.systemCacheFile) seen.set(pack.systemName, pack.systemCacheFile);
    } catch {
      /* missing pack: the fetch loop will handle it */
    }
  }
  return seen;
}

export interface HydrateResult {
  speciesLabel: string;
  occurrences: number;
  fetched: number;
  /** Occurrences whose body could not be found in the EDSM response. */
  unmatched: number;
  /** True when EDSM rate limiting stopped the run — the checkpoint holds the resume point. */
  halted: boolean;
}

/**
 * Fetch every occurrence of one species from EDSM into `raw/planets/<slug>/sample_N.json`.
 *
 * Resumable: a run that stopped at occurrence 900 of 3,000 restarts there rather than re-fetching
 * 900 systems, which matters because EDSM's rate limit makes a full pass take hours.
 */
export async function hydrateSpecies(
  ctx: FeederContext,
  speciesLabel: string,
  onProgress?: ProgressFn,
): Promise<HydrateResult> {
  const entry = ctx.speciesIndex[speciesLabel];
  if (!entry) throw new Error(`Unknown species: ${speciesLabel}`);
  const occ = entry.occurrences;
  const outDir = join(rawPlanetsDir(), speciesFileSlug(speciesLabel));
  await mkdir(outDir, { recursive: true });
  await mkdir(rawSystemsDir(), { recursive: true });

  const start = Math.min(await readCheckpoint(speciesLabel), occ.length);
  const seen = await seenSystemsFromSamples(outDir, start);
  const result: HydrateResult = {
    speciesLabel,
    occurrences: occ.length,
    fetched: 0,
    unmatched: 0,
    halted: false,
  };

  for (let i = start; i < occ.length; i++) {
    const o = occ[i]!;
    try {
      let cacheFile = seen.get(o.systemName);
      let sysJson: unknown;
      if (cacheFile) {
        sysJson = JSON.parse(await readFile(join(rawSystemsDir(), cacheFile), "utf8"));
      } else {
        sysJson = await withEdsmGate(() =>
          fetchEdsmSystemBodies(o.systemName, {
            onBackoff: (waitSec, attempt) =>
              onProgress?.(`    EDSM 429 — waiting ${waitSec}s (backoff ${attempt}/2) · ${o.systemName}`),
          }),
        );
        cacheFile = `${systemFileSlug(o.systemName)}.json`;
        seen.set(o.systemName, cacheFile);
        await writeFile(join(rawSystemsDir(), cacheFile), JSON.stringify(sysJson, null, 2), "utf8");
      }

      const context = extractPlanetContext(sysJson, o.bodyName);
      await writeFile(
        join(outDir, `sample_${i}.json`),
        JSON.stringify(
          {
            systemName: o.systemName,
            bodyName: o.bodyName,
            speciesLabel,
            systemCacheFile: cacheFile,
            context,
          },
          null,
          2,
        ),
        "utf8",
      );
      if (context.targetBody) result.fetched++;
      else result.unmatched++;
      await writeCheckpoint(speciesLabel, i + 1);
    } catch (e) {
      if (isEdsmRateLimitExhausted(e)) {
        // The checkpoint already points at this occurrence; stop rather than burn the rest of the
        // run on requests EDSM is going to refuse.
        result.halted = true;
        onProgress?.(`    halted at occurrence ${i} of ${occ.length}: ${String(e)}`);
        return result;
      }
      onProgress?.(`    skipped ${o.systemName} — ${o.bodyName}: ${String(e)}`);
      result.unmatched++;
      await writeCheckpoint(speciesLabel, i + 1);
    }
  }

  await clearCheckpoint(speciesLabel);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Analysis + installation
// ---------------------------------------------------------------------------------------------

/**
 * Build the profile for one species from its sample packs and install it where the app reads.
 *
 * There is no export step and no intermediate copy in the feeder's own data directory: the built
 * profile goes straight to its destination, which is the only way the two can never disagree.
 */
export async function analyseAndInstallSpecies(
  ctx: FeederContext,
  db: SpeciesDatabase,
  speciesLabel: string,
  opts?: { allowDowngrade?: boolean },
): Promise<InstallResult> {
  const entry = ctx.speciesIndex[speciesLabel];
  if (!entry) throw new Error(`Unknown species: ${speciesLabel}`);
  const dir = join(rawPlanetsDir(), speciesFileSlug(speciesLabel));
  const contexts = await loadPlanetContextsFromDir(dir);
  const built = buildProfileFromPlanetContexts(speciesLabel, entry.genus, contexts);
  const profile = sanitizeExomasteryProfileForEdexo(built);
  return installProfile(db, profile, opts);
}

/** Species that have sample packs on disk, whether or not the current index still lists them. */
export async function speciesWithSamples(): Promise<string[]> {
  try {
    return (await readdir(rawPlanetsDir())).sort();
  } catch {
    return [];
  }
}

export interface RunReport {
  hydrated: HydrateResult[];
  installs: InstallResult[];
  errors: { speciesLabel: string; error: string }[];
  halted: boolean;
}

/**
 * Run the whole pipeline for a set of species: hydrate, then analyse and install each one.
 *
 * Analysis follows its own species' hydration rather than waiting for the batch, so a run stopped by
 * rate limiting still leaves every completed species installed.
 */
export async function runPipeline(
  ctx: FeederContext,
  db: SpeciesDatabase,
  speciesLabels: string[],
  opts?: { allowDowngrade?: boolean; skipHydrate?: boolean; onProgress?: ProgressFn },
): Promise<RunReport> {
  const report: RunReport = { hydrated: [], installs: [], errors: [], halted: false };
  const log = opts?.onProgress ?? (() => {});

  for (const [i, label] of speciesLabels.entries()) {
    log(`[${i + 1}/${speciesLabels.length}] ${label}`);
    try {
      if (!opts?.skipHydrate) {
        const h = await hydrateSpecies(ctx, label, log);
        report.hydrated.push(h);
        log(`    hydrated ${h.fetched}/${h.occurrences} (${h.unmatched} unmatched)`);
        if (h.halted) {
          report.halted = true;
          log("    EDSM rate limit reached — run again later to resume from the checkpoint.");
          break;
        }
      }
      const install = await analyseAndInstallSpecies(ctx, db, label, opts);
      report.installs.push(install);
      log(describeInstall(install));
    } catch (e) {
      report.errors.push({ speciesLabel: label, error: String(e instanceof Error ? e.message : e) });
      log(`    error: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  return report;
}

/**
 * What moved, in one block.
 *
 * Automation makes this more important, not less: without it "it updated itself" and "it broke
 * itself" look the same from the outside.
 */
export function formatRunReport(report: RunReport): string {
  const lines: string[] = [];
  const installed = report.installs.filter((r) => r.outcome.kind === "installed");
  const refused = report.installs.filter((r) => r.outcome.kind === "refused-downgrade");
  const broken = report.installs.filter((r) => r.outcome.kind === "unreadable-after-write");
  const noRow = report.installs.filter((r) => r.outcome.kind === "no-species-row");

  lines.push("");
  lines.push(`installed        ${installed.length}`);
  const grew = installed.filter(
    (r) =>
      r.outcome.kind === "installed" &&
      r.outcome.previousSamples != null &&
      r.outcome.samples > r.outcome.previousSamples,
  );
  const fresh = installed.filter((r) => r.outcome.kind === "installed" && r.outcome.previousSamples == null);
  if (fresh.length) lines.push(`  first profile  ${fresh.length}`);
  if (grew.length) lines.push(`  gained samples ${grew.length}`);
  if (refused.length) lines.push(`REFUSED downgrade ${refused.length}   (nothing written)`);
  if (broken.length) lines.push(`BROKEN            ${broken.length}   written but not resolvable by the app`);
  if (noRow.length)
    lines.push(`no species row    ${noRow.length}   built, but the app has no row to attach it to`);
  if (report.errors.length) lines.push(`errors            ${report.errors.length}`);

  for (const r of [...refused, ...broken, ...noRow]) lines.push(describeInstall(r));
  for (const e of report.errors) lines.push(`  error      ${e.speciesLabel.padEnd(26)} ${e.error}`);

  if (report.halted) {
    lines.push("");
    lines.push(
      "Run halted by EDSM rate limiting. Checkpoints are written — run the same command again to resume.",
    );
  }
  lines.push("");
  lines.push("Re-run `npm run probe` to see what this did to recall and decidability.");
  return lines.join("\n");
}
