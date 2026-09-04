import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { SpeciesCriterion, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { applyCodexCriteriaPatchesFromFixesJson } from "./exoDataAlertFix.js";
import { isCodexAnyThinAtmospherePhrase } from "../shared/scanAtmosphereMatch.js";
import {
  isStellarSpectralMappingKey,
  normalizeStellarMappingKey,
  sortStellarSpectralKeysForDisplay,
} from "../shared/starSpectralKeys.js";
import { getSpeciesDataDir } from "./paths.js";

export const SPECIES_SUBDIR = "species";

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

/** `*_new.json` preferred when present, else `<folder>.json` (case-insensitive). */
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Hand-written JSON uses short labels; journal `Scan` uses these `PlanetClass` strings. */
function expandPlanetTypesToJournalClasses(labels: string[]): string[] {
  const out = new Set<string>();
  for (const raw of labels) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t.includes("rocky ice")) out.add("Rocky ice body");
    else if (t.includes("high metal")) out.add("High metal content body");
    else if (t === "metal rich" || t.includes("metal rich")) out.add("Metal rich body");
    else if (t === "icy" || t === "icy body" || t.startsWith("icy ")) out.add("Icy body");
    else if (t === "rocky" || t === "rocky body") out.add("Rocky body");
    else if (t.includes("water world")) out.add("Water world");
    else if (t.includes("earth") && t.includes("like")) out.add("Earth-like world");
    else if (t.endsWith(" body") && t.length > 5) {
      out.add(raw.trim().replace(/\s+/g, " "));
    }
    /** Unknown short label — skip rather than inventing a wrong PlanetClass. */
  }
  return [...out];
}

const ATMOSPHERE_PHRASE_TO_JOURNAL: Record<string, string> = {
  "carbon dioxide": "CarbonDioxide",
  co2: "CarbonDioxide",
  "sulphur dioxide": "SulphurDioxide",
  "sulfur dioxide": "SulphurDioxide",
  ammonia: "Ammonia",
  water: "Water",
  oxygen: "Oxygen",
  nitrogen: "Nitrogen",
  methane: "Methane",
  argon: "Argon",
  neon: "Neon",
  helium: "Helium",
  hydrogen: "Hydrogen",
};

function stripAtmosphereQualifier(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*/g, "").trim();
}

/** Map human-readable atmosphere phrases to journal `AtmosphereType` tokens. */
function normalizeAtmosphereToJournal(labels: string[]): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const s = raw.trim();
    if (!s) continue;
    const lo = s.toLowerCase().replace(/_/g, " ");
    if (
      lo === "none" ||
      lo === "vacuum" ||
      lo === "airless" ||
      lo.includes("no atmosphere") ||
      lo === "no atmosphere"
    ) {
      out.push("");
      continue;
    }
    if (!/\s/.test(s) && /^[A-Z][a-zA-Z]+$/.test(s)) {
      out.push(s);
      continue;
    }
    const stripped = stripAtmosphereQualifier(s);
    const tryKeys = [s.toLowerCase().replace(/\s+/g, " "), stripped.toLowerCase().replace(/\s+/g, " ")];
    let mapped = false;
    for (const k of tryKeys) {
      if (ATMOSPHERE_PHRASE_TO_JOURNAL[k]) {
        out.push(ATMOSPHERE_PHRASE_TO_JOURNAL[k]!);
        mapped = true;
        break;
      }
      const beforeDash =
        k
          .split(/\s*-\s*/)[0]
          ?.trim()
          .toLowerCase() ?? "";
      if (beforeDash && beforeDash !== k && ATMOSPHERE_PHRASE_TO_JOURNAL[beforeDash]) {
        out.push(ATMOSPHERE_PHRASE_TO_JOURNAL[beforeDash]!);
        mapped = true;
        break;
      }
    }
    if (mapped) continue;
    const compact = stripped.replace(/[\s-]+/g, "");
    if (compact) out.push(compact.charAt(0).toUpperCase() + compact.slice(1));
  }
  return [...new Set(out)];
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    const parts = v
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [v.trim()];
  }
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return undefined;
}

function mergeRange(
  target: { min?: number; max?: number } | undefined,
  minV: number | undefined,
  maxV: number | undefined,
): { min?: number; max?: number } | undefined {
  const out: { min?: number; max?: number } = { ...(target ?? {}) };
  if (minV !== undefined) out.min = out.min !== undefined ? Math.max(out.min, minV) : minV;
  if (maxV !== undefined) out.max = out.max !== undefined ? Math.min(out.max, maxV) : maxV;
  if (out.min === undefined && out.max === undefined) return undefined;
  return out;
}

function buildCriterionFromRecord(src: Record<string, unknown>): SpeciesCriterion {
  const c: SpeciesCriterion = {};

  const pcTypes = toStringArray(firstDefined(src, ["planet_types", "planetTypes", "worldTypes"]));
  const pcOther = toStringArray(
    firstDefined(src, [
      "planetClassAnyOf",
      "planetClasses",
      "planetClass",
      "PlanetClass",
      "WorldType",
      "worldType",
      "bodyClass",
      "BodyClass",
      "allowedPlanetClasses",
      "PlanetClasses",
      "planet",
      "Planet",
      "Body",
    ]),
  );
  const pc = pcTypes?.length ? expandPlanetTypesToJournalClasses(pcTypes) : pcOther;
  if (pc?.length) {
    const adjusted: string[] = [];
    for (const x of pc) {
      if (/\bbody\b/i.test(x)) adjusted.push(x);
      else adjusted.push(...expandPlanetTypesToJournalClasses([x]));
    }
    c.planetClassAnyOf = [...new Set(adjusted)];
  }

  const atRaw = toStringArray(
    firstDefined(src, [
      "atmosphereTypeAnyOf",
      "atmosphereTypes",
      "atmosphereType",
      "AtmosphereType",
      "atmospheres",
      "atmosphere",
      "Atmosphere",
    ]),
  );
  if (atRaw?.length) {
    const anyThinOnly = atRaw.every((x) => isCodexAnyThinAtmospherePhrase(String(x)));
    if (!anyThinOnly) {
      c.atmosphereTypeAnyOf = normalizeAtmosphereToJournal(atRaw);
    }
  }

  const land = toBool(src.landable ?? src.Landable);
  if (land !== undefined) c.landable = land;

  const sg = asRecord(src.surfaceGravity ?? src.SurfaceGravity);
  if (sg) {
    c.surfaceGravity = {
      min: toNumber(sg.min ?? sg.minG ?? sg.minimum),
      max: toNumber(sg.max ?? sg.maxG ?? sg.maximum),
    };
  } else {
    const gMin = toNumber(firstDefined(src, ["gravityMin", "surfaceGravityMin", "minGravity", "gMin"]));
    const gMax = toNumber(firstDefined(src, ["gravityMax", "surfaceGravityMax", "maxGravity", "gMax"]));
    const maxG = toNumber(src.max_gravity ?? src.maxGravity);
    const fromRange = mergeRange(undefined, gMin, gMax);
    if (fromRange) {
      c.surfaceGravity = { ...fromRange };
      if (maxG !== undefined) {
        c.surfaceGravity.max =
          c.surfaceGravity.max !== undefined ? Math.min(c.surfaceGravity.max, maxG) : maxG;
      }
    } else if (maxG !== undefined) {
      c.surfaceGravity = { max: maxG };
    }
  }

  const tkAny = firstDefined(src, ["temperature_K", "temperatureK", "temp_K"]);
  const tkRec = asRecord(tkAny);
  if (tkRec && !Array.isArray(tkAny)) {
    c.surfaceTemperatureK = {
      min: toNumber(tkRec.min ?? tkRec.minK),
      max: toNumber(tkRec.max ?? tkRec.maxK),
    };
  } else if (Array.isArray(tkAny) && tkAny.length >= 2) {
    const lo = toNumber(tkAny[0]);
    const hi = toNumber(tkAny[1]);
    const openEnded = hi === undefined || hi >= 500 || hi === 999;
    c.surfaceTemperatureK = { min: lo, max: openEnded ? undefined : hi };
  } else {
    const st = asRecord(src.surfaceTemperatureK ?? src.surfaceTemperature ?? src.temperatureK);
    if (st) {
      c.surfaceTemperatureK = {
        min: toNumber(st.min ?? st.minK),
        max: toNumber(st.max ?? st.maxK),
      };
    } else {
      const tMin = toNumber(
        firstDefined(src, [
          "minTemperature",
          "tempMin",
          "temperatureMin",
          "surfaceTemperatureMinK",
          "minTempK",
        ]),
      );
      const tMax = toNumber(
        firstDefined(src, [
          "maxTemperature",
          "tempMax",
          "temperatureMax",
          "surfaceTemperatureMaxK",
          "maxTempK",
        ]),
      );
      const t = mergeRange(undefined, tMin, tMax);
      if (t) c.surfaceTemperatureK = t;
    }
  }

  const sp = asRecord(src.surfacePressure ?? src.SurfacePressure);
  if (sp) {
    c.surfacePressure = {
      min: toNumber(sp.min),
      max: toNumber(sp.max),
    };
  } else {
    const pMin = toNumber(firstDefined(src, ["pressureMin", "minPressure", "surfacePressureMin"]));
    const pMax = toNumber(firstDefined(src, ["pressureMax", "maxPressure", "surfacePressureMax"]));
    const p = mergeRange(undefined, pMin, pMax);
    if (p) c.surfacePressure = p;
  }

  const vol = toStringArray(src.volcanismIncludes ?? src.volcanism ?? src.Volcanism);
  if (vol?.length) c.volcanismIncludes = vol;

  const pst = toStringArray(
    firstDefined(src, [
      "parentStarTypeIncludesAnyOf",
      "parentStarTypeIncludes",
      "parent_star_type_includes",
      "starTypeIncludes",
      "StarTypeIncludes",
    ]),
  );
  if (pst?.length) {
    const lo = pst.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (lo.length) c.parentStarTypeIncludesAnyOf = lo;
  }

  const orbitRec = asRecord(
    firstDefined(src, ["orbitDistanceFromParentStarLs", "orbit_ls", "orbitFromStarLs", "orbit_from_star_ls"]),
  );
  if (orbitRec) {
    c.orbitDistanceFromParentStarLs = {
      min: toNumber(orbitRec.min),
      max: toNumber(orbitRec.max),
    };
  }

  const apc = pickString(
    src,
    "atmospherePressureCategory",
    "pressureCategory",
    "atmosphere_pressure",
    "atmospherePressure",
  );
  if (apc) {
    const lo = apc.trim().toLowerCase();
    if (lo === "thin" || lo === "thick") c.atmospherePressureCategory = lo;
  }

  const gsi = toStringArray(
    firstDefined(src, [
      "geologicalSignalIncludes",
      "geological_signals",
      "fssGeologicalIncludes",
      "scannerGeologicalIncludes",
    ]),
  );
  if (gsi?.length) {
    const lo = gsi.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (lo.length) c.geologicalSignalIncludes = lo;
  }

  const watm = toNumber(
    firstDefined(src, [
      "whenAtmosphereLinkedMaxTempK",
      "when_atmosphere_max_temp_k",
      "atmosphereLinkedMaxTempK",
      "co2MaxTempK",
    ]),
  );
  if (watm !== undefined) c.whenAtmosphereLinkedMaxTempK = watm;

  const watmAt = toStringArray(
    firstDefined(src, [
      "whenAtmosphereLinkedAtmosphereAnyOf",
      "when_atmosphere_linked_atmosphere_any_of",
      "atmosphereLinkedAtmosphereAnyOf",
    ]),
  );
  if (watmAt?.length) c.whenAtmosphereLinkedAtmosphereAnyOf = normalizeAtmosphereToJournal(watmAt);

  if (toBool(src.volcanismActiveRequired ?? src.requires_active_volcanism) === true) {
    c.volcanismActiveRequired = true;
  }

  const mnotes = toStringArray(
    firstDefined(src, ["matchContextNotes", "habitatConditionNotes", "conditionNotes", "codexNotes"]),
  );
  if (mnotes?.length) c.matchContextNotes = mnotes.map((s) => s.trim()).filter(Boolean);

  return c;
}

function collectColorVariantNullSpectralKeys(metaRec: Record<string, unknown> | null): string[] | undefined {
  if (!metaRec) return undefined;
  const cv = asRecord(metaRec.color_variants);
  const mapping = asRecord(cv?.mapping);
  if (!mapping) return undefined;
  const out: string[] = [];
  for (const [k, v] of Object.entries(mapping)) {
    if (v !== null) continue;
    const key = k.trim();
    if (key) out.push(key);
  }
  return out.length ? out : undefined;
}

/** Stellar spectral keys (`TTS` or single-letter) whose mapping value is not JSON `null` — for soft UI hints. */
function collectColorVariantPreferredStellarSpectralKeys(
  metaRec: Record<string, unknown> | null,
): string[] | undefined {
  if (!metaRec) return undefined;
  const cv = asRecord(metaRec.color_variants);
  const mapping = asRecord(cv?.mapping);
  if (!mapping) return undefined;
  const acc = new Set<string>();
  for (const [kRaw, v] of Object.entries(mapping)) {
    if (v === null) continue;
    const kTrim = kRaw.trim();
    if (!isStellarSpectralMappingKey(kTrim)) continue;
    acc.add(normalizeStellarMappingKey(kTrim));
  }
  if (!acc.size) return undefined;
  return sortStellarSpectralKeysForDisplay([...acc]);
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

function collectGenusColorVariantRich(meta: Record<string, unknown> | null): {
  rule?: string;
  stellarMap?: Record<string, string>;
  materialDriven?: boolean;
} | null {
  if (!meta) return null;
  const cv = asRecord(meta.color_variants);
  const mapping = asRecord(cv?.mapping);
  const ruleRaw = cv?.rule;
  const rule = typeof ruleRaw === "string" && ruleRaw.trim() ? ruleRaw.trim() : undefined;
  if (!mapping) {
    return rule ? { rule } : null;
  }
  let nonStellar = 0;
  const stellarMap: Record<string, string> = {};
  for (const [kRaw, v] of Object.entries(mapping)) {
    const kTrim = kRaw.trim();
    if (!kTrim) continue;
    if (v === null) continue;
    const vs = typeof v === "string" ? v.trim() : "";
    if (!vs) continue;
    if (isStellarSpectralMappingKey(kTrim)) {
      stellarMap[normalizeStellarMappingKey(kTrim)] = vs;
    } else {
      nonStellar++;
    }
  }
  const materialDriven = nonStellar > 0;
  const out: { rule?: string; stellarMap?: Record<string, string>; materialDriven?: boolean } = {};
  if (rule) out.rule = rule;
  if (Object.keys(stellarMap).length) out.stellarMap = stellarMap;
  if (materialDriven) out.materialDriven = true;
  return Object.keys(out).length ? out : null;
}

function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
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
): { reason: string; sourceKey: string } | undefined {
  const nested = asRecord(row.criteria ?? row.Criteria ?? row.conditions ?? row.Conditions);
  for (const { key, reason } of PREDICTION_UNSUPPORTED_KEYS) {
    const v = nested?.[key] ?? row[key];
    if (v === undefined || v === null) continue;
    // `requires_system_bodies: false` is a row saying the requirement does *not* apply.
    if (v === false) continue;
    return { reason, sourceKey: key };
  }
  return undefined;
}

function buildCriteriaForRow(row: Record<string, unknown>): SpeciesCriterion {
  const nested = asRecord(row.criteria ?? row.Criteria ?? row.conditions ?? row.Conditions);
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

  rows.forEach((row, idx) => {
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

    const predictionUnsupported = detectPredictionUnsupported(r);

    let criteria = buildCriteriaForRow(r);
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
export function loadSpeciesDatabaseFromTree(projectRoot: string): SpeciesDatabase {
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
    species.push(...genusSpecies);
  }

  if (species.length) {
    const parts = [`loaded ${species.length} species`];
    if (loadedNew) parts.push(`${loadedNew} genus file(s) from *_new.json`);
    if (loadedLegacy) parts.push(`${loadedLegacy} from legacy *.json`);
    console.info(`ED Exo Compare — ${parts.join("; ")}`);
  }

  return { species };
}
