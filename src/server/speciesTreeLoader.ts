import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { BRAIN_TREE_SYSTEM_REQUIREMENT } from "../shared/systemBodyGates.js";
import { gateForSpeciesId } from "../shared/spatialGates.js";
import { unrecognisedConditionKeys } from "./conditionKeyAudit.js";

/**
 * Warnings raised while reading the species tree, kept so `/api/status` can show them.
 *
 * A `console.warn` is invisible in a packaged Electron build — there is no console attached and
 * nothing writes it to a file, so the message reached nobody. Collected here and cleared on each
 * load, so the list always describes the tree currently in memory rather than accumulating.
 */
const speciesDataWarnings: string[] = [];

export function getSpeciesDataWarnings(): string[] {
  return [...speciesDataWarnings];
}

function clearSpeciesDataWarnings(): void {
  speciesDataWarnings.length = 0;
}
import { join, relative } from "node:path";
import type { SpeciesCriterion, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { applyCodexCriteriaPatchesFromFixesJson } from "./exoDataAlertFix.js";
import { isCodexAnyThinAtmospherePhrase } from "../shared/scanAtmosphereMatch.js";
import { colourVariantRuleFor } from "./eddsnColourVariants.js";
import { hasExomasteryProfileFile, loadExomasteryProfile } from "./exomasteryProfile.js";
import { getSpeciesDataDir } from "./paths.js";
import {
  asRecord,
  expandPlanetTypesToJournalClasses,
  normalizeAtmosphereToJournal,
  pickString,
  toStringArray,
  buildCriterionFromRecord,
  firstDefined,
} from "./speciesCriterionParser.js";
import {
  collectColorVariantNullSpectralKeys,
  collectColorVariantPreferredStellarSpectralKeys,
  readSpeciesColourRules,
  collectGenusColorVariantRich,
} from "./genusColourMeta.js";
export { buildCriterionFromRecord } from "./speciesCriterionParser.js";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Cache for {@link findGenusPhotosFolder}. The photo folder layout does not change while the app
 * runs; without this the directory scan ran per species match, per body, per snapshot push, and
 * again for every image request. Cleared by the species-tree watcher.
 */
const genusPhotosFolderCache = new Map<string, string | null>();

export function clearGenusPhotosFolderCache(): void {
  genusPhotosFolderCache.clear();
}

/** Subfolder like `Stratum_photos` next to genus json. */
export function findGenusPhotosFolder(genusDirPath: string, folderBaseName: string): string | null {
  const cacheKey = `${genusDirPath}::${folderBaseName}`;
  const cached = genusPhotosFolderCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const resolved = findGenusPhotosFolderUncached(genusDirPath, folderBaseName);
  genusPhotosFolderCache.set(cacheKey, resolved);
  return resolved;
}

function findGenusPhotosFolderUncached(genusDirPath: string, folderBaseName: string): string | null {
  const exactLo = `${folderBaseName.toLowerCase()}_photos`;
  try {
    const names = readdirSync(genusDirPath);
    for (const n of names) {
      if (!isDir(join(genusDirPath, n))) continue;
      if (n.toLowerCase() === exactLo) return join(genusDirPath, n);
    }
    for (const n of names) {
      if (!isDir(join(genusDirPath, n))) continue;
      if (n.toLowerCase().endsWith("_photos")) return join(genusDirPath, n);
    }
  } catch {
    return null;
  }
  return null;
}

/** `{genus}-notes.txt` in the genus folder (case-insensitive). */
export function findGenusNotesFile(genusDirPath: string, folderBaseName: string): string | null {
  const exactLo = `${folderBaseName.toLowerCase()}-notes.txt`;
  try {
    const files = readdirSync(genusDirPath).filter((n) => {
      try {
        return statSync(join(genusDirPath, n)).isFile();
      } catch {
        return false;
      }
    });
    for (const n of files) {
      if (n.toLowerCase() === exactLo) return join(genusDirPath, n);
    }
    for (const n of files) {
      const lo = n.toLowerCase();
      if (lo.includes("notes") && lo.endsWith(".txt")) return join(genusDirPath, n);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * `*_new.json` preferred when present, else `<folder>.json` (case-insensitive).
 *
 * `_new.json` is now the only shipped form and the source of truth: the 19 legacy `<genus>.json`
 * files were generated from it by hand-maintained tooling that nobody runs any more, so they were a
 * second copy that could only drift. The fallback stays because a commander can drop their own genus
 * JSON in through the data overlay, and theirs may use the older name.
 */
export function findGenusJsonPath(genusDirPath: string, folderBaseName: string): string | null {
  const wantNew = `${folderBaseName.toLowerCase()}_new.json`;
  const wantMain = `${folderBaseName.toLowerCase()}.json`;
  try {
    const names = readdirSync(genusDirPath).filter(
      (n) => n.toLowerCase().endsWith(".json") && n.toLowerCase() !== "package.json",
    );
    for (const n of names) {
      if (n.toLowerCase() === wantNew) return join(genusDirPath, n);
    }
    for (const n of names) {
      if (n.toLowerCase() === wantMain) return join(genusDirPath, n);
    }
    if (names.length === 1) return join(genusDirPath, names[0]!);
  } catch {
    return null;
  }
  return null;
}

/** Read genus `meta.general.min_sample_distance_m` / `meta.minSampleDistanceM` from a genus JSON path. */
export function readGenusMinSampleDistanceM(jsonPath: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf8");
  } catch {
    return null;
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const root = j as Record<string, unknown>;
  const meta = root.meta && typeof root.meta === "object" ? (root.meta as Record<string, unknown>) : null;
  if (meta) {
    const ms = meta.minSampleDistanceM;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return Math.round(ms);
    const gen =
      meta.general && typeof meta.general === "object" ? (meta.general as Record<string, unknown>) : null;
    const m2 = gen?.min_sample_distance_m;
    if (typeof m2 === "number" && Number.isFinite(m2) && m2 > 0) return Math.round(m2);
  }
  return null;
}

function readMinSampleDistanceFromMetaRecord(meta: Record<string, unknown> | null): number | undefined {
  if (!meta) return undefined;
  const ms = meta.minSampleDistanceM;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return Math.round(ms);
  const gen = asRecord(meta.general);
  const m2 = gen?.min_sample_distance_m;
  if (typeof m2 === "number" && Number.isFinite(m2) && m2 > 0) return Math.round(m2);
  return undefined;
}

/**
 * Conditions that no body scan can satisfy or refute.
 *
 * Brain Trees need particular other bodies present in the system; Electricae radialem needs a nebula
 * nearby; the Amphora plant needs a specific mix of system bodies. None of that is in a `Scan`, so
 * listing them as ordinary candidates implies a prediction that was never made — and inflates
 * ambiguity on every body they can technically sit on.
 *
 * Star-type conditions are excluded on purpose. `speciesMatchContext` already resolves the body's
 * parent star, so those species are predictable as soon as the gate is wired up; calling them
 * unpredictable would be wrong and would hide work that is worth doing.
 */
const PREDICTION_UNSUPPORTED_KEYS: { key: string; reason: string }[] = [
  { key: "requires_system_bodies", reason: "Depends on other bodies present in the system" },
  { key: "system_requirements", reason: "Depends on other bodies present in the system" },
  { key: "location_requirement", reason: "Depends on galactic location, such as nebula proximity" },
];

function detectPredictionUnsupported(
  row: Record<string, unknown>,
  speciesId?: string,
): { reason: string; sourceKey: string } | undefined {
  const nested = asRecord(row.criteria ?? row.Criteria ?? row.conditions ?? row.Conditions);
  /**
   * A `location_requirement` the app can now **measure** is no longer unsupported (Phase 7).
   *
   * Electricae radialem's nebula rule and the Sinuous Tubers' core rule both have a catalogue and a
   * measured threshold behind them, so the condition is evaluated rather than shrugged at. This is
   * §7.9 acceptance rule 6 — the flag comes off only where a real check replaced it, never as a
   * relabel — and the data keeps the condition documented either way.
   *
   * Brain Trees and Amphora keep the flag: their *other* condition needs the presence of a
   * companion body elsewhere in the system, which nothing here can answer. Half a check is not a
   * check.
   */
  const spatiallyChecked = speciesId ? gateForSpeciesId(speciesId) !== null : false;
  /**
   * The companion-body conditions are measured now, so their flag comes off for the same reason the
   * nebula rule's did: a real check replaced it. `buildCriteriaForRow` carries the requirement into
   * `systemBodyClassesAnyOf` and `demoteFailedSystemBodyGates` reads it against the system's scans,
   * abstaining until the honk is finished. The flag stays wherever no requirement could be read.
   */
  const systemBodiesChecked = systemBodyRequirementForRow(row) !== undefined;

  for (const { key, reason } of PREDICTION_UNSUPPORTED_KEYS) {
    if (key === "location_requirement" && spatiallyChecked) continue;
    if ((key === "requires_system_bodies" || key === "system_requirements") && systemBodiesChecked) continue;
    const v = nested?.[key] ?? row[key];
    if (v === undefined || v === null) continue;
    // `requires_system_bodies: false` is a row saying the requirement does *not* apply.
    if (v === false) continue;
    return { reason, sourceKey: key };
  }
  return undefined;
}

/**
 * The companion-body requirement a row carries, in the row's own spelling.
 *
 * Two shapes, because the two genera were transcribed from different pages. Amphora names the classes
 * inline; the Brain Trees say `requires_system_bodies: true` and leave the list to the genus file,
 * which is where {@link BRAIN_TREE_SYSTEM_REQUIREMENT} comes from. `false` is a row saying the rule
 * does not apply to that variant — Brain Tree Roseum — and must not be read as an empty list.
 */
function systemBodyRequirementForRow(row: Record<string, unknown>): string[] | undefined {
  const nested = asRecord(row.criteria ?? row.Criteria ?? row.conditions ?? row.Conditions);
  const inline = nested?.system_requirements ?? row.system_requirements;
  if (Array.isArray(inline)) {
    const list = inline.map((x) => String(x).trim()).filter(Boolean);
    if (list.length) return list;
  }
  const flag = nested?.requires_system_bodies ?? row.requires_system_bodies;
  if (flag === true) return [...BRAIN_TREE_SYSTEM_REQUIREMENT];
  return undefined;
}

function buildCriteriaForRow(row: Record<string, unknown>, speciesId?: string): SpeciesCriterion {
  const nested = asRecord(row.criteria ?? row.Criteria ?? row.conditions ?? row.Conditions);
  /**
   * A spawn rule written into the data and understood by nobody is worse than one that is missing:
   * the species then looks like it *passed* a condition that was never applied. Four real rules were
   * being dropped this way — see `conditionKeyAudit` — so say so.
   *
   * A warning rather than a throw: a commander with a hand-edited genus file should still get an
   * app. `tests/conditionKeys.test.ts` is where this is an error.
   */
  const unknown = unrecognisedConditionKeys(nested);
  if (unknown.length) {
    const note =
      `${speciesId ?? "species row"}: ignoring unknown condition key(s) ${unknown.join(", ")} — ` +
      "nothing in the matcher reads them, so the species is NOT gated on them.";
    if (!speciesDataWarnings.includes(note)) speciesDataWarnings.push(note);
    console.warn(`ED Exo Compare — ${note}`);
  }
  const merged: Record<string, unknown> = { ...row, ...(nested ?? {}) };
  return buildCriterionFromRecord(merged);
}

function slugId(genus: string, displayName: string, explicitId?: string): string {
  if (explicitId?.trim()) return explicitId.trim();
  const g = genus
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  const n = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${g}__${n}`;
}

function parseGenusFile(jsonPath: string, folderBaseName: string, projectRoot: string): SpeciesEntry[] {
  const speciesBase = getSpeciesDataDir(projectRoot);
  let rel: string;
  try {
    rel = relative(speciesBase, jsonPath);
    if (!rel || rel.startsWith("..")) {
      rel = jsonPath.slice(projectRoot.length).replace(/^[/\\]/, "");
    }
  } catch {
    rel = jsonPath.slice(projectRoot.length).replace(/^[/\\]/, "");
  }
  rel = rel.replace(/\\/g, "/");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return [];
  }

  const genusFromFile =
    (asRecord(parsed)?.genus as string) || (asRecord(parsed)?.Genus as string) || folderBaseName;

  const rows = extractSpeciesRows(parsed);
  const out: SpeciesEntry[] = [];

  const rootRecord = asRecord(parsed);
  const meta = asRecord(rootRecord?.meta);
  const genusStarColorNullSpectralClasses = collectColorVariantNullSpectralKeys(meta);
  const genusStarColorPreferredSpectralClasses = collectColorVariantPreferredStellarSpectralKeys(meta);
  const genusMinSampleDistanceM = readMinSampleDistanceFromMetaRecord(meta);
  const colorRich = collectGenusColorVariantRich(meta);
  const general = asRecord(rootRecord?.general) ?? asRecord(meta?.general);
  const planetReq = asRecord(general?.planet_requirements) ?? asRecord(meta?.genusWideRequirements) ?? null;
  const pr = planetReq ?? {};
  let genusPlanetTypes = toStringArray(pr.planet_types);
  if (!genusPlanetTypes?.length) genusPlanetTypes = toStringArray(pr.planet_types_hint);
  const genusAtmosphereRaw = toStringArray(
    firstDefined(pr, ["atmosphere", "Atmosphere", "atmosphereType", "AtmosphereType"]),
  );
  /**
   * `required_atmosphere_type` is the genus saying "without this, nothing here grows".
   *
   * Kept apart from `atmosphere`, which is the softer "these are the atmospheres we list". Only
   * Recepta declares one today; see `SpeciesCriterion.atmosphereTypeRequiredAnyOf` for why the
   * distinction had to exist.
   */
  const genusRequiredAtmosphere = toStringArray(
    firstDefined(pr, ["required_atmosphere_type", "requiredAtmosphereType"]),
  );

  rows.forEach((row, _idx) => {
    const r = row;
    const displayName = pickString(
      r,
      "displayName",
      "DisplayName",
      "name",
      "Name",
      "species",
      "Species",
      "speciesName",
      "Species_Localised",
      "localisedName",
      "LocalisedName",
    );
    if (!displayName) return;

    const description = pickString(r, "description", "Description", "desc", "summary", "Summary") ?? "";

    const photoFile = pickString(
      r,
      "photoFile",
      "photo",
      "Photo",
      "image",
      "Image",
      "codexImage",
      "codex_image",
    );

    const notes = pickString(r, "notes", "Notes", "remark", "tip");

    const id = slugId(genusFromFile, displayName, pickString(r, "id", "ID", "key", "Key"));

    const predictionUnsupported = detectPredictionUnsupported(r, id);
    const speciesColourRules = readSpeciesColourRules(r);

    let criteria = buildCriteriaForRow(r, id);
    const systemBodies = systemBodyRequirementForRow(r);
    if (systemBodies?.length) criteria = { ...criteria, systemBodyClassesAnyOf: systemBodies };

    /*
      Atmospheres the species rarely wins on. Read straight off the row rather than inferred: it is a
      claim about the corpus that somebody measured, and the measurement belongs next to the number.
    */
    const nested = asRecord(r.criteria ?? r.Criteria ?? r.conditions ?? r.Conditions);
    const unfavouredRaw =
      nested?.atmosphere_unfavoured ?? nested?.atmosphereUnfavoured ?? nested?.atmosphereUnfavouredAnyOf;
    if (Array.isArray(unfavouredRaw)) {
      const list = unfavouredRaw.map((x) => String(x).trim()).filter(Boolean);
      if (list.length) criteria = { ...criteria, atmosphereUnfavouredAnyOf: list };
    }
    if (!criteria.planetClassAnyOf?.length && genusPlanetTypes?.length) {
      criteria = {
        ...criteria,
        planetClassAnyOf: expandPlanetTypesToJournalClasses(genusPlanetTypes),
      };
    }
    if (!criteria.atmosphereTypeAnyOf?.length && genusAtmosphereRaw?.length) {
      const genusAnyThinOnly = genusAtmosphereRaw.every((x) => isCodexAnyThinAtmospherePhrase(String(x)));
      if (!genusAnyThinOnly) {
        criteria = {
          ...criteria,
          atmosphereTypeAnyOf: normalizeAtmosphereToJournal(genusAtmosphereRaw),
        };
      }
    }

    if (!criteria.atmosphereTypeRequiredAnyOf?.length && genusRequiredAtmosphere?.length) {
      criteria = {
        ...criteria,
        atmosphereTypeRequiredAnyOf: normalizeAtmosphereToJournal(genusRequiredAtmosphere),
      };
    }

    out.push({
      id,
      displayName,
      genus: genusFromFile.trim(),
      genusDataDir: folderBaseName,
      photoFile: photoFile ?? undefined,
      description,
      criteria,
      notes: notes ?? undefined,
      dataSourceRelPath: rel,
      ...(predictionUnsupported ? { predictionUnsupported } : {}),
      ...(genusStarColorNullSpectralClasses?.length ? { genusStarColorNullSpectralClasses } : {}),
      ...(genusStarColorPreferredSpectralClasses?.length ? { genusStarColorPreferredSpectralClasses } : {}),
      ...(genusMinSampleDistanceM != null ? { genusMinSampleDistanceM } : {}),
      ...(colorRich?.rule ? { genusColorVariantRule: colorRich.rule } : {}),
      ...(colorRich?.stellarMap && Object.keys(colorRich.stellarMap).length
        ? { genusColorStellarMapping: colorRich.stellarMap }
        : {}),
      ...(colorRich?.materialDriven ? { genusColorMaterialDriven: true } : {}),
      // The species' own colour rule. Each Bacterium maps the same material to a different colour,
      // so only this one can answer for it; the genus map cannot.
      ...(speciesColourRules ? { speciesColourRules } : {}),
    });
  });

  return out;
}

const SKIP_NON_SPECIES_ROOT_KEYS = new Set([
  "genus",
  "Genus",
  "formatVersion",
  "FormatVersion",
  "meta",
  "Meta",
  "general",
  "General",
  "color_variants",
  "species_distribution_rules",
  "Species_distribution_rules",
  "distributionReference",
  "DistributionReference",
  "authorNotes",
  "AuthorNotes",
  "notes",
  "Notes",
  "version",
  "Version",
  "metadata",
  "Metadata",
  "comment",
  "Comment",
]);

function extractSpeciesRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.map((x) => asRecord(x) ?? {}).filter((x) => Object.keys(x).length);
  }
  const root = asRecord(parsed);
  if (!root) return [];

  /** Hand-authored format: `"species": { "Stratum tectonicas": { "description", "conditions" } }` */
  for (const key of ["species", "Species"] as const) {
    const block = root[key];
    const blk = asRecord(block);
    if (blk && !Array.isArray(block)) {
      return Object.entries(blk).map(([speciesName, v]) => {
        const rec = asRecord(v) ?? {};
        return {
          ...rec,
          displayName: pickString(rec, "displayName", "DisplayName", "name", "Name") ?? speciesName,
          name: speciesName,
        };
      });
    }
    if (Array.isArray(block)) {
      return block.map((x) => asRecord(x) ?? {}).filter((x) => Object.keys(x).length);
    }
  }

  const arrays = [
    "entries",
    "Entries",
    "variants",
    "Variants",
    "data",
    "Data",
    "organisms",
    "Organisms",
  ] as const;
  for (const key of arrays) {
    const a = root[key];
    if (Array.isArray(a)) {
      return a.map((x) => asRecord(x) ?? {}).filter((x) => Object.keys(x).length);
    }
  }

  /** Legacy object map (rare) */
  const out: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(root)) {
    if (SKIP_NON_SPECIES_ROOT_KEYS.has(k)) continue;
    const rec = asRecord(v);
    if (rec) {
      out.push({ ...rec, name: rec.name ?? rec.species ?? k, displayName: rec.displayName ?? rec.Name ?? k });
    }
  }
  return out.length ? out : [];
}

/**
 * Load all species from `data/species/<genusDir>/` — prefers `<genus>_new.json`, then `<genus>.json`.
 */
/**
 * How many bodies a profile needs before its temperature range counts as an envelope.
 *
 * Swept rather than chosen, 2026-09-19, on one cache — decidable bodies and the recall it costs:
 *
 * ```
 *   off   497 (35.1 %)   13 missed   ambiguity 4.80    envelopes 0
 *   20    527 (37.2 %)   16 missed   ambiguity 4.71    envelopes 88
 *   50    522 (36.9 %)   16 missed   ambiguity 4.69    envelopes 78   <- shipped
 *   100   506 (35.7 %)   14 missed   ambiguity 4.78    envelopes 70
 *   200+  503 (35.5 %)   14 missed   ambiguity 4.79    envelopes 59 and fewer
 * ```
 *
 * Nearly all the benefit lives below 100: at that floor the gain collapses from +30 decidable bodies
 * to +6, and past 200 the numbers stop moving at all — those envelopes were deciding nothing.
 *
 * Fifty rather than twenty because it costs five decidable bodies, has the best ambiguity of any
 * setting, and drops the two cases that looked like the app asserting more than it knew: Stratum
 * frigus demoting a body on 25 observations, and araneamus on 35.
 */
export const OBSERVED_TEMP_MIN_SAMPLES = 50;

/**
 * Hang each species' observed temperature range on its entry, from the exomastery profile.
 *
 * Done here, once at load, so `matchSpecies` can read it without touching the disk — the matcher is
 * called for every species on every body and is deliberately free of file access.
 *
 * Only the range, and only when the profile has enough bodies behind it. A species with no profile,
 * or a thin one, simply gets no envelope and is never demoted for being outside it.
 */
/**
 * Mark every codex temperature ceiling that a sibling's floor shares.
 *
 * Codex bands are written inclusive at both ends, and many corpus temperatures are whole kelvin, so a
 * body reading exactly 180.0 K sat inside both Aleoida arcus (175–180) and coronamus (180–190). Across
 * every truth source the edge belongs to the species that **starts** there: on the shared edges
 * (155/160, 160, 165, 170, 175, 180, 190 K) hundreds of truth bodies sit exactly on a species'
 * floor — coronamus 72 at 180 K, gravis 95 at 190 K, Osseus fractus 132 at 180 K — and not one on
 * the lower species' ceiling. The only truths exactly on a ceiling are at 195 K and on Tubus
 * sororibus' 190 K, which no sibling starts at, so those ceilings stay inclusive.
 */
function attachSharedTemperatureEdges(species: SpeciesEntry[]): void {
  const floors = new Map<string, Map<number, string>>(); // genus -> floor K -> a sibling starting there
  for (const e of species) {
    const lo = e.criteria.surfaceTemperatureK?.min;
    if (lo === undefined || !Number.isFinite(lo)) continue;
    const m = floors.get(e.genusDataDir) ?? new Map<number, string>();
    if (!m.has(lo)) m.set(lo, e.displayName);
    floors.set(e.genusDataDir, m);
  }
  for (const e of species) {
    const hi = e.criteria.surfaceTemperatureK?.max;
    if (hi === undefined || !Number.isFinite(hi)) continue;
    const sibling = floors.get(e.genusDataDir)?.get(hi);
    if (sibling && sibling !== e.displayName) e.temperatureCeilingSharedWith = sibling;
  }
}

function attachObservedTemperatureEnvelopes(projectRoot: string, species: SpeciesEntry[]): void {
  for (const entry of species) {
    try {
      if (!hasExomasteryProfileFile(projectRoot, entry)) continue;
      const prof = loadExomasteryProfile(projectRoot, entry);
      const t = prof?.numerics?.["body.surfaceTemperature"];
      if (!t) continue;
      const { min, max, count } = t;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) continue;
      const n = count ?? 0;
      if (n < OBSERVED_TEMP_MIN_SAMPLES) continue;
      entry.observedTemperatureK = { min, max, count: n };
    } catch {
      /* a profile we cannot read is a species with no envelope, which is a fine state to be in */
    }
  }
}

export function loadSpeciesDatabaseFromTree(projectRoot: string): SpeciesDatabase {
  // The list describes the tree in memory, so a reload replaces it rather than appending to it.
  clearSpeciesDataWarnings();
  const base = getSpeciesDataDir(projectRoot);
  if (!existsSync(base) || !isDir(base)) {
    return { species: [] };
  }

  const species: SpeciesEntry[] = [];
  let loadedNew = 0;
  let loadedLegacy = 0;

  let dirs: string[];
  try {
    dirs = readdirSync(base).filter((n) => isDir(join(base, n)));
  } catch {
    return { species: [] };
  }

  for (const folderBaseName of dirs) {
    const genusPath = join(base, folderBaseName);
    const jsonPath = findGenusJsonPath(genusPath, folderBaseName);
    if (!jsonPath) continue;
    if (jsonPath.toLowerCase().endsWith("_new.json")) loadedNew++;
    else loadedLegacy++;
    const genusSpecies = parseGenusFile(jsonPath, folderBaseName, projectRoot);
    applyCodexCriteriaPatchesFromFixesJson(jsonPath, genusSpecies);
    // Attached here rather than in the genus parser: the tables live in one file for the whole
    // tree, and which of them applies is a species question, not a genus one.
    for (const e of genusSpecies) {
      const rule = colourVariantRuleFor(projectRoot, e.genusDataDir, e.displayName);
      if (rule) e.colourVariant = rule;
    }
    species.push(...genusSpecies);
  }

  if (species.length) {
    const parts = [`loaded ${species.length} species`];
    if (loadedNew) parts.push(`${loadedNew} genus file(s) from *_new.json`);
    if (loadedLegacy) parts.push(`${loadedLegacy} from legacy *.json`);
    console.info(`ED Exo Compare — ${parts.join("; ")}`);
  }

  attachObservedTemperatureEnvelopes(projectRoot, species);
  attachSharedTemperatureEdges(species);
  return { species };
}
