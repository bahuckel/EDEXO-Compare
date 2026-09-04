import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  EncyclopediaExomasteryFieldTier,
  ExomasteryCompositionGroupDTO,
  ExomasteryCompositionSummaryDTO,
  ExomasteryDetailDTO,
  ExomasteryStatDetailDTO,
  ExomasteryStatDistributionDTO,
  ExomasteryVarietyItemDTO,
  ExplorationScanRecord,
  JournalHostStarObservation,
  OtherMatchDetailCardDTO,
  PlanetScan,
  SpeciesEntry,
} from "../shared/types.js";
import { journalPressureToAtm, journalSurfaceGravityToG } from "../shared/journalPhysics.js";
import { journalStarPrimarySpectralLetter } from "../shared/genusStarColorSoft.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import {
  classifyHostMkPath,
  computeMkAxisStepDistance,
  isFeederHostStarLuminosityPath,
  isFeederHostStarSpectralPath,
  isFeederHostStarSubclassPath,
  harvardSpectralSlot,
  parseLooseSpectralMk,
  harvardSpectralStepDistance,
  stellarSubclassStepDistance,
  yerkesLuminosityStepDistance,
} from "../shared/stellarProximity.js";
import {
  cellIsUsable,
  type AtmosphereBandCell,
  type AtmosphereBands,
  type PercentileBand,
} from "../feeder/atmosphereBands.js";
import { exomasteryHabitatTierWeight } from "./exomasteryHabitatTiers.js";
import { shouldOmitExomasterySciencePath } from "./exomasteryPathHygiene.js";
import { getSpeciesDataDir } from "./paths.js";

/** Astronomical unit in metres — journal `SemiMajorAxis` is in metres; exomastery numerics use AU. */
const AU_METERS = 149_597_870_700;

/** Journal `OrbitalPeriod` / `RotationPeriod` are seconds; feeder / EDSM rollups use days. */
const SECONDS_PER_DAY = 86_400;

/** Journal `Composition` Ice / Metal / Rock are 0–1 fractions; feeder rollups use 0–100%. */
const SOLID_FRACTION_ELEMENT_KEYS = new Set(["ice", "metal", "rock"]);

function journalSolidPercentFromRaw(elementKey: string, raw: number): number {
  return SOLID_FRACTION_ELEMENT_KEYS.has(elementKey.toLowerCase()) ? raw * 100 : raw;
}

/** One numeric/material rollup from feeder (mode = most common bucket after rounding). */
export interface ExomasteryNumericRollup {
  min: number;
  max: number;
  mean: number;
  count?: number;
  mode?: number;
  modeCount?: number;
}

export interface ExomasteryProfileV1 {
  formatVersion: number;
  speciesLabel?: string;
  genus?: string;
  /**
   * Feeder profile JSON: number of distinct EDSM bodies merged into this profile (`bodies.length`).
   * When absent, UI falls back to {@link maxExomasteryProfileSampleCount}.
   */
  sampleCount?: number;
  numerics: Record<string, ExomasteryNumericRollup>;
  materials: Record<string, ExomasteryNumericRollup>;
  atmosphereComposition: Record<string, ExomasteryNumericRollup>;
  solidComposition: Record<string, ExomasteryNumericRollup>;
  /**
   * Histogram of habitat labels. For host-star matching vs the commander’s journal, use path keys like
   * `exo.host_star_spectral_primary` with single-letter / `TTS` tokens (feeder should aggregate from `starSummaries`).
   */
  categorical?: Record<string, Record<string, number>>;
  /**
   * Temperature and pressure percentiles per atmosphere type, written by the feeder.
   *
   * Absent on profiles built before the bands existed; every scoring path falls back to the pooled
   * rollups when a cell is missing or too thin to describe a range.
   */
  atmosphereBands?: AtmosphereBands;
}

const profileCache = new Map<string, ExomasteryProfileV1 | null | undefined>();

/** Drop parsed profiles so the next load re-reads `*_exomastery*.json` from disk (e.g. after feeder export). */
export function clearExomasteryProfileCache(): void {
  profileCache.clear();
}

export function speciesSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Filename candidates aligned with feeder exports + genus JSON `id` slugs. */
export function exomasteryProfileCandidateFilenames(entry: SpeciesEntry): string[] {
  const names = new Set<string>();
  const add = (raw: string) => {
    const s = speciesSlug(raw);
    if (!s) return;
    names.add(`${s}_exomastery.json`);
    names.add(`${s}_exomastery_profile.json`);
  };
  add(entry.displayName);
  add(`${entry.genus} ${entry.displayName}`.trim());
  add(entry.id.replace(/__+/g, "_"));
  return [...names];
}

function profileLooksUsable(j: Record<string, unknown>): boolean {
  const nonempty = (o: unknown) => Boolean(o && typeof o === "object" && Object.keys(o as object).length > 0);
  return (
    nonempty(j.numerics) ||
    nonempty(j.materials) ||
    nonempty(j.atmosphereComposition) ||
    nonempty(j.solidComposition) ||
    nonempty(j.categorical)
  );
}

/** Shared matching for `exomastery/*.json` (profile rollups or EDSM row exports). */
export function exomasterySpeciesLabelMatchesEntry(
  entry: SpeciesEntry,
  speciesLabel: string | undefined,
  basenameNoExt: string,
): boolean {
  return profileSpeciesLabelMatchesEntry(speciesLabel, entry, basenameNoExt);
}

function profileSpeciesLabelMatchesEntry(
  speciesLabel: string | undefined,
  entry: SpeciesEntry,
  basenameNoExt: string,
): boolean {
  const fromJson = typeof speciesLabel === "string" ? speciesLabel.trim() : "";
  if (fromJson) {
    const n = speciesSlug(fromJson);
    if (n === speciesSlug(entry.displayName)) return true;
    if (n === speciesSlug(`${entry.genus} ${entry.displayName}`.trim())) return true;
    if (fromJson.toLowerCase() === entry.displayName.trim().toLowerCase()) return true;
    if (fromJson.toLowerCase() === `${entry.genus} ${entry.displayName}`.trim().toLowerCase()) return true;
  }
  const fn = speciesSlug(basenameNoExt);
  if (fn && fn === speciesSlug(entry.displayName)) return true;
  if (fn && fn === speciesSlug(`${entry.genus} ${entry.displayName}`.trim())) return true;
  if (fn && fn === speciesSlug(entry.id.replace(/__+/g, "_"))) return true;
  return false;
}

/**
 * Feeder JSON stores crust/air/solid rollups under `body.materials.*`, `body.atmosphereComposition.*`,
 * `body.solidComposition.*` inside `numerics`. Move them into the composition maps so
 * {@link buildExomasteryDetail} / {@link crustMaterialValue} compare journal % to profile mode.
 */
function hoistFeederCompositionRollups(prof: ExomasteryProfileV1): void {
  const num = prof.numerics;
  if (!num || typeof num !== "object") return;
  const del: string[] = [];
  for (const path of Object.keys(num)) {
    const m = /^body\.materials\.(.+)$/i.exec(path);
    if (m?.[1]) {
      prof.materials[m[1]] = num[path]!;
      del.push(path);
      continue;
    }
    const a = /^body\.atmosphereComposition\.(.+)$/i.exec(path);
    if (a?.[1]) {
      prof.atmosphereComposition[a[1]] = num[path]!;
      del.push(path);
      continue;
    }
    const s = /^body\.solidComposition\.(.+)$/i.exec(path);
    if (s?.[1]) {
      prof.solidComposition ??= {};
      prof.solidComposition[s[1]] = num[path]!;
      del.push(path);
    }
  }
  for (const k of del) delete num[k];
}

function normalizeLoadedProfile(j: Record<string, unknown>): ExomasteryProfileV1 {
  const prof = j as unknown as ExomasteryProfileV1;
  prof.numerics ??= {};
  prof.materials ??= {};
  prof.atmosphereComposition ??= {};
  prof.solidComposition ??= {};
  const sc = j.sampleCount;
  if (typeof sc === "number" && Number.isFinite(sc) && sc >= 0) prof.sampleCount = Math.trunc(sc);
  hoistFeederCompositionRollups(prof);
  return prof;
}

/**
 * Feeder exports under `data/species/<genusDir>/exomastery/*.json`, matched by `speciesLabel` (or filename slug).
 */
function tryLoadExomasteryFromGenusSubdir(base: string, entry: SpeciesEntry): ExomasteryProfileV1 | null {
  const sub = join(base, "exomastery");
  if (!existsSync(sub) || !statSync(sub).isDirectory()) return null;
  let files: string[];
  try {
    files = readdirSync(sub);
  } catch {
    return null;
  }
  const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json")).sort((a, b) => a.localeCompare(b));
  for (const f of jsonFiles) {
    const p = join(sub, f);
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (!profileLooksUsable(j)) continue;
      const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
      const stem = f.replace(/\.json$/i, "");
      if (!profileSpeciesLabelMatchesEntry(label, entry, stem)) continue;
      return normalizeLoadedProfile(j);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Absolute path to the feeder profile JSON that {@link loadExomasteryProfile} would read for this entry, if any.
 */
export function resolveExomasteryProfileJsonPath(projectRoot: string, entry: SpeciesEntry): string | null {
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const sub = join(base, "exomastery");
  if (existsSync(sub) && statSync(sub).isDirectory()) {
    let files: string[];
    try {
      files = readdirSync(sub);
    } catch {
      files = [];
    }
    const jsonFiles = files
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));
    for (const f of jsonFiles) {
      const p = join(sub, f);
      try {
        const raw = readFileSync(p, "utf8");
        const j = JSON.parse(raw) as Record<string, unknown>;
        if (!profileLooksUsable(j)) continue;
        const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
        const stem = f.replace(/\.json$/i, "");
        if (!profileSpeciesLabelMatchesEntry(label, entry, stem)) continue;
        return p;
      } catch {
        continue;
      }
    }
  }
  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    const p = join(base, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Max `count` observed on numeric rollups (0 = none / unknown). */
export function maxExomasteryProfileSampleCount(profile: ExomasteryProfileV1): number {
  let m = 0;
  const bump = (r: ExomasteryNumericRollup) => {
    if (typeof r.count === "number" && r.count > m) m = r.count;
  };
  for (const r of Object.values(profile.numerics)) bump(r);
  for (const r of Object.values(profile.materials)) bump(r);
  for (const r of Object.values(profile.atmosphereComposition)) bump(r);
  for (const r of Object.values(profile.solidComposition ?? {})) bump(r);
  return m;
}

/** Distinct feeder bodies merged into profile — prefers feeder JSON `sampleCount`, else rollup max `count`. */
export function feederProfileBodyCount(profile: ExomasteryProfileV1): number {
  const n = profile.sampleCount;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return Math.trunc(n);
  return maxExomasteryProfileSampleCount(profile);
}

/** Optional profile JSON: `species/<genus>/exomastery/*.json` first, then legacy `*_exomastery*.json` in genus root. */
export function loadExomasteryProfile(projectRoot: string, entry: SpeciesEntry): ExomasteryProfileV1 | null {
  // Keyed by root as well as species: the app only ever has one project root, but the feeder status
  // builder takes one as a parameter, and a cache that ignores it would answer for the wrong tree.
  const cacheKey = `${projectRoot}::${entry.genusDataDir}::${entry.id}`;
  if (profileCache.has(cacheKey)) {
    const c = profileCache.get(cacheKey);
    return c === undefined ? null : c;
  }
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);

  const fromSub = tryLoadExomasteryFromGenusSubdir(base, entry);
  if (fromSub) {
    profileCache.set(cacheKey, fromSub);
    return fromSub;
  }

  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    const p = join(base, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (profileLooksUsable(j)) {
        const prof = normalizeLoadedProfile(j);
        profileCache.set(cacheKey, prof);
        return prof;
      }
    } catch {
      /* try next filename */
    }
  }
  profileCache.set(cacheKey, null);
  return null;
}

export function hasExomasteryProfileFile(projectRoot: string, entry: SpeciesEntry): boolean {
  return loadExomasteryProfile(projectRoot, entry) != null;
}

/** Basename for download: JSON under `exomastery/` (matched by speciesLabel) or legacy genus-root file. */
export function resolveExomasteryExportBasename(projectRoot: string, entry: SpeciesEntry): string | null {
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const sub = join(base, "exomastery");
  if (existsSync(sub)) {
    try {
      const cand = readdirSync(sub)
        .filter((f) => f.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));
      for (const f of cand) {
        try {
          const j = JSON.parse(readFileSync(join(sub, f), "utf8")) as Record<string, unknown>;
          const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
          const stem = f.replace(/\.json$/i, "");
          if (profileSpeciesLabelMatchesEntry(label, entry, stem)) return f;
        } catch {
          continue;
        }
      }
    } catch {
      /* */
    }
  }
  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    if (existsSync(join(base, name))) return name;
  }
  return null;
}

function similarityToRollup(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const span = Math.max(r.max - r.min, Math.abs(mode) * 0.02, 1e-9);
  const d = Math.abs(v - mode);
  return Math.max(0, Math.min(1, 1 - d / span));
}

/**
 * The same shape as {@link similarityToRollup} with both of its estimators replaced.
 *
 * `mode` is the densest 0.1 K bucket over every body of the species — Tussock virgam's holds 4 of
 * 579 samples — and `max − min` is one outlier wide: Osseus discus reads 80–641 K because fourteen
 * methane bodies sit under 626 water ones. A span that wide makes every temperature look close to
 * the centre, so the term stops discriminating and the candidate survives on a parameter that should
 * have ruled it out.
 *
 * p50 and p1–p99 of the cell for *this body's atmosphere* are the same two quantities measured
 * where the question is actually asked.
 */
function similarityToBand(v: number, band: PercentileBand): number {
  const centre = band.p50;
  const halfWidth = Math.max((band.p99 - band.p1) / 2, Math.abs(centre) * 0.02, 1e-9);
  const d = Math.abs(v - centre);
  // Full credit at the centre, zero two half-widths out — so a body inside p1–p99 always scores > 0.
  return Math.max(0, Math.min(1, 1 - d / (2 * halfWidth)));
}

/** Crust / atmosphere / solid %: ≤1 percentage point from modal → full credit; then distance-scaled. */
function similarityToRollupComposition(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const d = Math.abs(v - mode);
  if (d <= 1) return 1;
  const span = Math.max(r.max - r.min, Math.abs(mode) * 0.02, 1e-9);
  return Math.max(0, Math.min(1, 1 - d / span));
}

function modeCategoricalLabel(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let n = -1;
  for (const [k, c] of Object.entries(counts)) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
}

function normalizeCategoricalValueForCompare(path: string, val: string): string {
  const low = path.toLowerCase();
  const t = val.trim();
  if (low.includes("atmosphere") && !low.includes("composition")) {
    if (/^no atmosphere$/i.test(t) || /^none$/i.test(t)) return "No atmosphere";
  }
  return t;
}

/** Collapse thin vs thick atmospheric labels and CO₂ spellings for categorical matching. */
function normalizeAtmosphereCompareKey(path: string, val: string): string {
  if (!path.toLowerCase().includes("atmosphere") || path.toLowerCase().includes("composition")) {
    return normalizeCategoricalValueForCompare(path, val).toLowerCase().trim();
  }
  let t = normalizeCategoricalValueForCompare(path, val).toLowerCase().trim();
  t = t.replace(/^thin\s+/, "");
  t = t.replace(/^thick\s+/, "");
  t = t.replace(/\s+atmosphere$/, "");
  t = t.replace(/carbondioxide/g, "carbon dioxide");
  t = t.replace(/\bco2\b/g, "carbon dioxide");
  t = t.trim();
  /** Ammonia is the gas; "thin"/"thick" only describe pressure (handled separately via pressure stat). */
  if (t === "ammonia" || /^ammonia(\s|$)/.test(t)) t = "ammonia";
  return t.trim();
}

/** Atmosphere *type* compare key for EDSM/CSV rows (thin/thick stripped; ammonia normalized). */
export function exomasteryAtmosphereTypeCompareKey(val: string): string {
  return normalizeAtmosphereCompareKey("body.atmosphere", val);
}

function categoricalSimilarity(scanVal: string, profileMode: string, path?: string): number {
  if (!path) {
    const a = scanVal.toLowerCase().trim();
    const b = profileMode.toLowerCase().trim();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    return 0;
  }
  const low = path.toLowerCase();
  if (low.includes("atmosphere") && !low.includes("composition")) {
    const a = normalizeAtmosphereCompareKey(path, scanVal);
    const b = normalizeAtmosphereCompareKey(path, profileMode);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    return 0;
  }
  if (
    /(\bhost\b.*\bstar\b)|(\bexo\.host)|(\bfeeder\b.*host.*star)|(primary[_.\s]*stellar)|(stellar.*spectral.*host)/i.test(
      low,
    )
  ) {
    const mkAxis = classifyHostMkPath(low);
    if (mkAxis && path) {
      const d = computeMkAxisStepDistance(mkAxis, profileMode, scanVal);
      if (d != null) {
        if (d === 0) return 1;
        if (d === 1) return 0.9;
        if (d === 2) return 0.75;
        if (d === 3) return 0.55;
        return 0.35;
      }
    }
    const ka = spectralKeysFromJournalStarType(scanVal.trim());
    const kb = spectralKeysFromJournalStarType(profileMode.trim());
    if (ka.length && kb.length) {
      const a = ka.includes("TTS") ? "TTS" : ka[0]!;
      const b = kb.includes("TTS") ? "TTS" : kb[0]!;
      if (a === b) return 1;
      const ca = harvardSpectralSlot(a);
      const cb = harvardSpectralSlot(b);
      const hd = harvardSpectralStepDistance(ca, cb);
      if (hd != null) {
        if (hd === 0) return 1;
        if (hd === 1) return 0.9;
        if (hd === 2) return 0.75;
        if (hd === 3) return 0.55;
        return 0.35;
      }
      if (a.charAt(0) === b.charAt(0)) return 0.9;
      return 0;
    }
  }
  const a0 = normalizeCategoricalValueForCompare(path, scanVal);
  const b0 = normalizeCategoricalValueForCompare(path, profileMode);
  const a = a0.toLowerCase().trim();
  const b = b0.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  return 0;
}

function categoricalImportance(counts: Record<string, number>): number {
  const vals = Object.values(counts).filter((n) => n > 0);
  if (vals.length === 0) return 0.08;
  const total = vals.reduce((a, b) => a + b, 0);
  const mx = Math.max(...vals);
  return Math.max(0.06, mx / total);
}

function rollupImportance(r: ExomasteryNumericRollup): number {
  const c = r.count;
  const mc = r.modeCount;
  if (typeof c === "number" && c > 0 && typeof mc === "number" && mc > 0) {
    return Math.max(0.06, mc / c);
  }
  const mode = r.mode ?? r.mean;
  const span = (r.max - r.min) / (Math.abs(mode) + 1e-9);
  return Math.max(0.06, 1 / (1 + span));
}

export function formatPathLabel(path: string): string {
  const tail = path.includes(".") ? (path.split(".").pop() ?? path) : path;
  return tail
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

export function exomasteryPathTailLower(path: string): string {
  return (path.includes(".") ? (path.split(".").pop() ?? path) : path).toLowerCase().trim();
}

/**
 * Convert a feeder rollup value to display units (atm, g, AU, …) for the given EDSM-style path.
 */
export function exomasteryRollupValueDisplay(
  path: string,
  raw: number,
): { displayNumber: number; suffix: string } {
  if (!Number.isFinite(raw)) return { displayNumber: raw, suffix: "" };
  const low = path.toLowerCase();
  if (
    low.includes("surfacepressure") ||
    (low.includes("pressure") &&
      !low.includes("composition") &&
      !low.includes("percent") &&
      !low.includes("%"))
  ) {
    return { displayNumber: journalPressureToAtm(raw), suffix: " atm" };
  }
  if (low.includes("gravity") && !low.includes("tidal")) {
    const v = Math.abs(raw) > 50 ? journalSurfaceGravityToG(raw) : raw;
    return { displayNumber: v, suffix: " g" };
  }
  if (low.includes("semimajoraxis") || low.includes("semimajor")) {
    const v = Math.abs(raw) > 1e8 ? raw / AU_METERS : raw;
    return { displayNumber: v, suffix: " AU" };
  }
  if (low.includes("distancefromarrival") || low.includes("distancetoarrival")) {
    return { displayNumber: raw, suffix: " LS" };
  }
  if (low.includes("orbitalperiod")) {
    return { displayNumber: raw, suffix: " d" };
  }
  if (low.includes("rotationperiod") || low.includes("rotationalperiod")) {
    return { displayNumber: raw, suffix: " d" };
  }
  if (low.includes("radius") && !low.includes("semimajor")) {
    return { displayNumber: raw, suffix: " km" };
  }
  if (low.includes("surfacetemperature") || low.includes("surfacetemp")) {
    return { displayNumber: raw, suffix: " K" };
  }
  return { displayNumber: raw, suffix: "" };
}

/** Normalized display using path units (atm, g, AU to 3 dp, axial tilt °, …). */
export function formatExomasteryValueForPath(path: string, raw: number): string {
  if (!Number.isFinite(raw)) return "—";
  const low = path.toLowerCase();
  if (low.includes("semimajoraxis") || low.includes("semimajor")) {
    const { displayNumber } = exomasteryRollupValueDisplay(path, raw);
    return `${displayNumber.toFixed(3)} AU`;
  }
  if (low.includes("axialtilt") || low.includes("axial_tilt")) {
    const deg = (raw * 180) / Math.PI;
    return `${deg.toFixed(2)}°`;
  }
  const { displayNumber, suffix } = exomasteryRollupValueDisplay(path, raw);
  return `${formatExomasteryNum(displayNumber)}${suffix}`;
}

/** Composition rollups (crust / atmosphere / solid) are percentages. */
export function exomasteryCompositionRollupDisplay(raw: number): { displayNumber: number; suffix: string } {
  return { displayNumber: raw, suffix: " %" };
}

/** en-US grouping: comma thousands, dot decimal — `1,234,567.89` for large values; preserves precision for small magnitudes. */
export function formatExomasteryNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0.00";
  if (abs >= 1) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 0.01) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function relativePercentDisplay(v: number, mode: number): { pct: number | null; huge: boolean } {
  const den = Math.max(Math.abs(mode), 1e-9);
  const raw = (Math.abs(v - mode) / den) * 100;
  if (!Number.isFinite(raw)) return { pct: null, huge: false };
  if (raw > 200) return { pct: null, huge: true };
  return { pct: Math.round(raw * 10) / 10, huge: false };
}

/** Map EDSM-style profile paths to values from journal scan / exploration record (SI + AU as stored in profile). */
function valueForNumericPath(
  path: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): number | null {
  const low = path.toLowerCase();
  if (low.endsWith(".gravity") || low === "body.gravity" || low.includes("surfacegravity")) {
    const raw = scan.SurfaceGravity ?? rec?.surfaceGravity;
    if (raw != null && Number.isFinite(raw)) return journalSurfaceGravityToG(raw);
    return null;
  }
  if (
    low.includes("surfacetemperature") ||
    low.endsWith(".surfacetemperature") ||
    low.includes("surfacetemp")
  ) {
    const t = scan.SurfaceTemperature ?? rec?.surfaceTemperature;
    if (t != null && Number.isFinite(t)) return t;
    return null;
  }
  if (low.includes("surfacepressure") || low.endsWith(".surfacepressure")) {
    const p = scan.SurfacePressure ?? rec?.surfacePressure;
    if (p != null && Number.isFinite(p)) return journalPressureToAtm(p);
    return null;
  }
  if (low.includes("earthmass") || low.includes("earthmasses")) {
    const m = scan.MassEM ?? rec?.massEM;
    if (m != null && Number.isFinite(m)) return m;
    return null;
  }
  if (low.includes("radius") && !low.includes("semimajor")) {
    const rad = scan.radius ?? rec?.radius;
    if (rad != null && Number.isFinite(rad)) return rad / 1000;
    return null;
  }
  if (low.includes("semimajoraxis") || low.includes("semimajor")) {
    const meters = rec?.semiMajorAxis ?? scan.SemiMajorAxis;
    if (meters != null && Number.isFinite(meters)) return meters / AU_METERS;
    return null;
  }
  if (low.includes("orbitalperiod")) {
    const o = scan.OrbitalPeriod ?? rec?.orbitalPeriod;
    if (o != null && Number.isFinite(o)) return o / SECONDS_PER_DAY;
    return null;
  }
  if (low.includes("eccentricity") || low.includes("orbitaleccentricity")) {
    const e = scan.Eccentricity ?? rec?.eccentricity;
    if (e != null && Number.isFinite(e)) return e;
  }
  if (low.includes("orbitalinclination") || low.includes("orbitalincline")) {
    const i = scan.OrbitalInclination ?? rec?.orbitalInclination;
    if (i != null && Number.isFinite(i)) return i;
  }
  if (low.includes("periapsis") || low.includes("argofperiapsis")) {
    const p = scan.Periapsis ?? rec?.periapsis;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("ascendingnode") || low.includes("longitudeofascendingnode")) {
    const p = scan.AscendingNode ?? rec?.ascendingNode;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("meananomaly")) {
    const p = scan.MeanAnomaly ?? rec?.meanAnomaly;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("distancefromarrival") || low.includes("distancetoarrival")) {
    const d = rec?.distanceFromArrivalLs;
    if (d != null && Number.isFinite(d)) return d;
  }
  if (low.includes("rotationperiod") || low.includes("rotationalperiod")) {
    const rp = scan.RotationPeriod ?? rec?.rotationPeriod;
    if (rp != null && Number.isFinite(rp)) return rp / SECONDS_PER_DAY;
    return null;
  }
  if (low.includes("axialtilt") || low.includes("axial_tilt")) {
    const ax = scan.AxialTilt ?? rec?.axialTilt;
    if (ax != null && Number.isFinite(ax)) return ax;
  }
  if (low.includes("systemaddress")) {
    const a = scan.SystemAddress;
    if (typeof a === "number" && Number.isFinite(a)) return a;
  }
  if ((low.includes("bodyid") || low.endsWith(".bodyid")) && !low.includes("parent")) {
    const id = scan.BodyID;
    if (typeof id === "number" && Number.isFinite(id)) return id;
  }
  return null;
}

/** Journal / DSS atmosphere summary; "No atmosphere" when explicitly airless (supports categorical + composition). */
function normalizeAtmosphereType(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string | null {
  const raw = (scan.AtmosphereType ?? rec?.atmosphereType ?? "").trim();
  const atm = (scan.Atmosphere ?? rec?.atmosphere ?? "").trim();
  const t = raw || atm;
  if (!t) return null;
  if (/^no atmosphere$/i.test(t) || /^none$/i.test(t)) return "No atmosphere";
  if (/^no atmosphere$/i.test(atm)) return "No atmosphere";
  return t;
}

function isNoAtmosphereScan(scan: PlanetScan, rec: ExplorationScanRecord | null | undefined): boolean {
  return normalizeAtmosphereType(scan, rec) === "No atmosphere";
}

function compositionChevron(
  current: number,
  mode: number,
  isMissing: boolean,
): "up" | "down" | "dash" | "none" {
  if (isMissing || !Number.isFinite(current) || !Number.isFinite(mode)) return "none";
  const d = Math.abs(current - mode);
  if (d <= 1) return "dash";
  return current > mode ? "up" : "down";
}

/** Journal `Percent` is usually a float; coerce strings from some parsers / exports. */
function journalPercentNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function journalMaterialsArray(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): unknown[] | null {
  const fromRec = rec?.materials;
  if (Array.isArray(fromRec) && fromRec.length > 0) return fromRec;
  const fromScan = scan.materials;
  if (Array.isArray(fromScan) && fromScan.length > 0) return fromScan as unknown[];
  return null;
}

/** Crust materials %: journal detailed `Materials` or exploration merge; known + absent element ⇒ 0%. */
function crustMaterialValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  sym: string,
): { v: number | null; known: boolean } {
  const raw = journalMaterialsArray(scan, rec);
  if (raw == null) return { v: null, known: false };
  const want = sym.toLowerCase();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").toLowerCase();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (name === want && pct != null) return { v: pct, known: true };
  }
  return { v: 0, known: true };
}

function journalAtmosphereCompositionArray(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): unknown[] | null {
  const fromRec = rec?.atmosphereComposition;
  if (Array.isArray(fromRec) && fromRec.length > 0) return fromRec as unknown[];
  const fromScan = scan.atmosphereComposition;
  if (Array.isArray(fromScan) && fromScan.length > 0) return fromScan as unknown[];
  return null;
}

/** Atmosphere constituent %: explicit airless ⇒ 0% for every gas; else journal or DSS composition array. */
function atmoGasValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  sym: string,
): { v: number | null; known: boolean } {
  if (isNoAtmosphereScan(scan, rec)) return { v: 0, known: true };
  const raw = journalAtmosphereCompositionArray(scan, rec);
  if (raw == null) return { v: null, known: false };
  const want = sym.toLowerCase();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").toLowerCase();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (name === want && pct != null) return { v: pct, known: true };
  }
  return { v: 0, known: true };
}

function journalCompositionObject(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): Record<string, unknown> | null {
  const c = (rec?.composition ?? scan.composition) as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  if (Object.keys(c).length === 0) return null;
  return c;
}

/** Distinct material element names present in merged journal with a numeric percent. */
function collectJournalMaterialElementNames(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string[] {
  const raw = journalMaterialsArray(scan, rec);
  if (!raw) return [];
  const names: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").trim();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (!name || pct == null) continue;
    names.push(name);
  }
  return names;
}

/** Atmosphere constituent names present in merged journal with a numeric percent. */
function collectJournalAtmosphereGasNames(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string[] {
  const raw = journalAtmosphereCompositionArray(scan, rec);
  if (!raw) return [];
  const names: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").trim();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (!name || pct == null) continue;
    names.push(name);
  }
  return names;
}

/** Solid composition keys present in merged journal with a numeric value. */
function collectJournalSolidKeys(scan: PlanetScan, rec: ExplorationScanRecord | null | undefined): string[] {
  const comp = journalCompositionObject(scan, rec);
  if (!comp) return [];
  return Object.keys(comp).filter((k) => {
    const v = comp[k];
    return typeof v === "number" && Number.isFinite(v);
  });
}

function solidValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  el: string,
): { v: number | null; known: boolean } {
  const comp = journalCompositionObject(scan, rec);
  if (!comp) return { v: null, known: false };
  const key = Object.keys(comp).find((k) => k.toLowerCase() === el.toLowerCase());
  if (key == null) return { v: 0, known: true };
  const v = comp[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return { v: null, known: false };
  return { v: journalSolidPercentFromRaw(el, v), known: true };
}

/** String fields from scan/rec for profile categorical paths (EDSM/journal wording). */
function valueForCategoricalPath(
  path: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): string | null {
  const low = path.toLowerCase();

  if (isFeederHostStarSubclassPath(path)) {
    const sc = journalHost?.subclass;
    return sc != null && Number.isFinite(sc) ? String(Math.round(sc)) : null;
  }
  if (isFeederHostStarLuminosityPath(path)) {
    const lum = journalHost?.luminosity?.trim();
    return lum?.length ? lum : null;
  }
  if (
    /(\bhost\b.*\bstar\b.*(class|letter|spectral))|(\bexo\.host\b)|(\bfeeder\b.*host.*star)|(primary[_.\s]*stellar)/i.test(
      low,
    ) ||
    isFeederHostStarSpectralPath(path)
  ) {
    const letter = journalHost?.spectralLetter?.trim();
    if (letter) return letter;
    const h = journalHost?.starTypeRaw?.trim();
    if (!h) return null;
    const x = journalStarPrimarySpectralLetter(h);
    return x === "—" ? null : x;
  }
  if (low.includes("atmosphere") && !low.includes("composition")) {
    return normalizeAtmosphereType(scan, rec);
  }
  if (low.includes("planetclass") || low.includes("bodytype") || low.includes("subtype")) {
    const s = (scan.PlanetClass ?? rec?.planetClass ?? rec?.bodyType ?? "").trim();
    return s || null;
  }
  if (low.includes("volcanism")) {
    const s = (scan.Volcanism ?? rec?.volcanism ?? "").trim();
    return s || null;
  }
  if (low.includes("terraform")) {
    const s = (scan.TerraformState ?? rec?.terraformState ?? "").trim();
    return s || null;
  }
  return null;
}

/**
 * The band cell for this body's atmosphere.
 *
 * Matched through the same normalisation the categorical scorer uses, because the two sides spell it
 * differently: EDSM writes "Thin Carbon dioxide" and the journal writes "CarbonDioxide". Null when
 * the profile predates the bands, the body has no atmosphere reading, or the cell is too thin to
 * describe a range — every one of which falls back to the pooled rollup rather than to nothing.
 */
function bandCellForScan(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): AtmosphereBandCell | null {
  const bands = profile.atmosphereBands;
  if (!bands) return null;
  const atmo = normalizeAtmosphereType(scan, rec);
  if (!atmo) return null;
  const want = exomasteryAtmosphereTypeCompareKey(atmo);
  if (!want) return null;
  for (const [key, cell] of Object.entries(bands)) {
    if (exomasteryAtmosphereTypeCompareKey(key) !== want) continue;
    return cellIsUsable(cell) ? cell : null;
  }
  return null;
}

/** Which band a numeric path should be scored against, when one is available. */
function bandForNumericPath(path: string, cell: AtmosphereBandCell | null): PercentileBand | null {
  if (!cell) return null;
  const low = path.toLowerCase();
  if (low.includes("surfacetemperature") || low.includes("surfacetemp")) return cell.surfaceTemperatureK;
  if (low.includes("surfacepressure")) return cell.surfacePressureAtm;
  return null;
}

function collectWeightedHabitatScores(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): { score: number; importance: number }[] {
  const out: { score: number; importance: number }[] = [];

  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));

  /**
   * Measured importance scaled by the parameter's tier. Sample concentration says how *consistent* a
   * parameter is across the feeder sample, not how much it decides where a species grows; the tier
   * supplies the part concentration cannot know. See {@link exomasteryHabitatTierWeight}.
   */
  const push = (path: string, score: number, importance: number) => {
    out.push({ score, importance: importance * exomasteryHabitatTierWeight(path) });
  };

  const bandCell = bandCellForScan(profile, scan, rec);

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;
    const v = valueForNumericPath(path, scan, rec);
    if (v == null) continue;
    // Temperature and pressure are scored against the cell for this body's atmosphere when there is
    // one; everything else, and every thin cell, still uses the pooled rollup.
    const band = bandForNumericPath(path, bandCell);
    push(path, band ? similarityToBand(v, band) : similarityToRollup(v, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.materials)) {
    const { v, known } = crustMaterialValue(scan, rec, el);
    if (!known) continue;
    push(`materials.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const { v, known } = atmoGasValue(scan, rec, el);
    if (!known) continue;
    push(`atmosphereComposition.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const { v, known } = solidValue(scan, rec, el);
    if (!known) continue;
    push(`solidComposition.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const modeVal = modeCategoricalLabel(counts);
    if (!modeVal) continue;
    const scanVal = valueForCategoricalPath(path, scan, rec, journalHost);
    if (!scanVal) continue;
    push(path, categoricalSimilarity(scanVal, modeVal, path), categoricalImportance(counts));
  }
  return out;
}

/** Small additive boosts on raw 0–1 habitat blend: tight solids / crust lines with presence.
 * Strict gate fields (planet class, atmosphere, temp, pressure) are **not** boosted here — they are already
 * enforced by `speciesMatchesCriteria` from genus JSON; boosting from `MatchReason` duplicated that signal
 * and kept weak exomastery fits from filtering (everything looked “non‑zero”).
 */
function computeHabitatExtraBoosts(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): number {
  let add = 0;
  let solidBonus = 0;
  for (const [el, rollup] of Object.entries(profile.solidComposition ?? {})) {
    const { v, known } = solidValue(scan, rec, el);
    if (!known) continue;
    const sim = similarityToRollupComposition(v ?? 0, rollup);
    if (sim >= 0.88) solidBonus += 0.014;
  }
  add += Math.min(0.042, solidBonus);

  let crustBonus = 0;
  for (const [el, rollup] of Object.entries(profile.materials)) {
    const cur = crustMaterialValue(scan, rec, el);
    if (!cur.known) continue;
    const bodyPct = cur.v ?? 0;
    if (bodyPct <= 0.01) continue;
    const sim = similarityToRollupComposition(bodyPct, rollup);
    if (sim >= 0.82) crustBonus += 0.0055;
  }
  add += Math.min(0.033, crustBonus);

  return Math.min(0.18, add);
}

/**
 * 0–100 weighted habitat match vs feeder profile (importance from mode concentration in exomastery data).
 * Does not apply same-genus deck display — see {@link applyExomasteryGenusCompetitivePercent}.
 */
export function exomasteryHabitatQualityPercent(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): number | null {
  const fields = collectWeightedHabitatScores(profile, scan, rec, journalHost);
  if (fields.length === 0) return null;
  const num = fields.reduce((s, f) => s + f.importance * f.score, 0);
  const den = fields.reduce((s, f) => s + f.importance, 0);
  if (den <= 0) return null;
  let q = num / den;
  q += computeHabitatExtraBoosts(profile, scan, rec);
  q = Math.max(0, Math.min(1, q));
  return Math.round(q * 1000) / 10;
}

/** @deprecated Use {@link exomasteryHabitatQualityPercent}. */
export function exomasterySimilarityPercent(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): number | null {
  return exomasteryHabitatQualityPercent(profile, scan, rec, journalHost);
}

/** Top dimensions with the strongest central tendency in the feeder sample (for spawn-variation hints). */
export function buildExomasteryVarietyHints(profile: ExomasteryProfileV1): ExomasteryVarietyItemDTO[] {
  const rows: { label: string; concentration: number; rank: number }[] = [];
  /**
   * Ranked by tier-weighted concentration, displayed with the true one. A tightly clustered orbital
   * period is a real fact about the sample and stays in the list, but it must not head a panel the
   * commander reads as "what this species cares about" - the same demotion the scorer applies.
   */
  const addRow = (path: string, label: string, concentration: number) => {
    rows.push({ label, concentration, rank: concentration * exomasteryHabitatTierWeight(path) });
  };

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const vals = Object.values(counts).filter((n) => n > 0);
    if (vals.length === 0) continue;
    const total = vals.reduce((a, b) => a + b, 0);
    const mx = Math.max(...vals);
    addRow(path, formatPathLabel(path), (mx / total) * 100);
  }

  const addNumericTightness = (labelPrefix: string, map: Record<string, ExomasteryNumericRollup>) => {
    for (const [k, r] of Object.entries(map)) {
      const pathKey = labelPrefix === "Stat" ? k : `${labelPrefix.toLowerCase()}.${k}`;
      if (shouldOmitExomasterySciencePath(pathKey)) continue;
      const mode = r.mode ?? r.mean;
      const span = (r.max - r.min) / (Math.abs(mode) + 1e-9);
      const tight = 1 / (1 + span / 8);
      addRow(pathKey, `${labelPrefix} · ${k}`, tight * 100);
    }
  };
  addNumericTightness("Stat", profile.numerics);
  addNumericTightness("Crust", profile.materials);
  addNumericTightness("Atmosphere", profile.atmosphereComposition);
  addNumericTightness("Solid", profile.solidComposition ?? {});

  rows.sort((a, b) => b.rank - a.rank || b.concentration - a.concentration);
  return rows.map((r, i) => ({
    id: `exo-var-${i}-${r.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}`,
    label: r.label,
    concentrationPercent: Math.round(r.concentration * 10) / 10,
  }));
}

function summarizeCompositionMatch(
  items: { label: string; score: number }[],
): ExomasteryCompositionSummaryDTO {
  if (items.length === 0) {
    return { overallMatchPercent: null, best: null, worst: null };
  }
  const avg = items.reduce((s, x) => s + x.score, 0) / items.length;
  const sorted = [...items].sort((a, b) => a.score - b.score);
  const worst = sorted[0]!;
  const best = sorted[sorted.length - 1]!;
  return {
    overallMatchPercent: Math.round(avg * 10) / 10,
    best: { label: best.label, matchPercent: Math.round(best.score * 10) / 10 },
    worst: { label: worst.label, matchPercent: Math.round(worst.score * 10) / 10 },
  };
}

function inferHostSpectralCohortMode(profile: ExomasteryProfileV1): string | null {
  for (const [p, c] of Object.entries(profile.categorical ?? {})) {
    if (!isFeederHostStarSpectralPath(p)) continue;
    const m = modeCategoricalLabel(c);
    if (m) return m;
  }
  return null;
}

function statsHaveMkAxis(
  stats: ExomasteryStatDetailDTO[],
  axis: NonNullable<ReturnType<typeof classifyHostMkPath>>,
): boolean {
  return stats.some((s) => s.kind === "categorical" && classifyHostMkPath(s.chartPath ?? "") === axis);
}

function buildSupplementalHostMkRows(
  stats: ExomasteryStatDetailDTO[],
  profile: ExomasteryProfileV1,
  journalHost: JournalHostStarObservation | null | undefined,
  nid: () => string,
): ExomasteryStatDetailDTO[] {
  if (!journalHost) return [];
  const cohort = inferHostSpectralCohortMode(profile);
  const parsedCohort = parseLooseSpectralMk(cohort ?? "");
  const out: ExomasteryStatDetailDTO[] = [];

  const synthetic = (
    chartPath: string,
    label: string,
    typical: string,
    current: string,
    axis: NonNullable<ReturnType<typeof classifyHostMkPath>>,
    steps: number | null,
  ): ExomasteryStatDetailDTO => ({
    id: nid(),
    kind: "categorical",
    chartPath,
    label,
    typicalDisplay: typical,
    currentDisplay: current,
    isMissing: !current || !typical,
    diffPoints: null,
    diffRelativePercent: null,
    chevron: "none",
    compact: false,
    stellarProximitySteps: steps != null ? Math.min(4, steps) : null,
    stellarProximityAxis: axis,
    categoricalCloseness:
      steps === 0 ? "match" : steps === 1 ? "close" : steps != null && steps >= 2 ? "different" : undefined,
  });

  if (
    cohort &&
    !statsHaveMkAxis(stats, "spectral") &&
    journalHost.spectralLetter &&
    parsedCohort.spectralSlot
  ) {
    const st = harvardSpectralStepDistance(parsedCohort.spectralSlot, journalHost.spectralLetter);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.spectral_harvard",
          "Host spectral (Harvard · EDSM cohort vs journal)",
          parsedCohort.spectralSlot,
          journalHost.spectralLetter,
          "spectral",
          st,
        ),
      );
    }
  }

  if (!statsHaveMkAxis(stats, "subclass") && parsedCohort.subclass != null && journalHost.subclass != null) {
    const st = stellarSubclassStepDistance(parsedCohort.subclass, journalHost.subclass);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.subclass",
          "Host subclass (0–9 · EDSM cohort vs journal)",
          String(parsedCohort.subclass),
          String(journalHost.subclass),
          "subclass",
          st,
        ),
      );
    }
  }

  if (!statsHaveMkAxis(stats, "luminosity") && parsedCohort.luminosity && journalHost.luminosity) {
    const st = yerkesLuminosityStepDistance(parsedCohort.luminosity, journalHost.luminosity);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.luminosity_yerkes",
          "Host luminosity (Yerkes · EDSM cohort vs journal)",
          parsedCohort.luminosity,
          journalHost.luminosity,
          "luminosity",
          st,
        ),
      );
    }
  }

  return out;
}

export function buildNumericDistributionDto(
  displayPath: string,
  rollup: ExomasteryNumericRollup,
  current: number | null,
): ExomasteryStatDistributionDTO | null {
  const mode = rollup.mode ?? rollup.mean;
  if (!Number.isFinite(rollup.min) || !Number.isFinite(rollup.max) || !Number.isFinite(mode)) return null;
  const lo = rollup.min;
  const hi = rollup.max;
  return {
    min: lo,
    max: hi,
    mode,
    current: current != null && Number.isFinite(current) ? current : null,
    displayPath,
    minLabel: formatExomasteryValueForPath(displayPath, lo),
    maxLabel: formatExomasteryValueForPath(displayPath, hi),
  };
}

function compositionChartKeyToDistributionPath(chartKey: string): string {
  const k = chartKey.toLowerCase();
  if (k.startsWith("material:")) {
    const rest = chartKey.slice("material:".length);
    return rest.includes(".") ? rest : `body.materials.${rest}`;
  }
  if (k.startsWith("atmosphere:")) {
    const rest = chartKey.slice("atmosphere:".length);
    return rest.includes(".") ? rest : `body.atmosphereComposition.${rest}`;
  }
  if (k.startsWith("solid:")) {
    const rest = chartKey.slice("solid:".length);
    return rest.includes(".") ? rest : `body.solidComposition.${rest}`;
  }
  return chartKey;
}

function buildCompositionDistributionDto(
  chartKey: string,
  rollup: ExomasteryNumericRollup,
  cur: number | null,
  known: boolean,
): ExomasteryStatDistributionDTO | null {
  const mode = rollup.mode ?? rollup.mean;
  if (!Number.isFinite(rollup.min) || !Number.isFinite(rollup.max) || !Number.isFinite(mode)) return null;
  const lo = rollup.min;
  const hi = rollup.max;
  const fmt = (n: number) => `${formatExomasteryNum(n)}%`;
  return {
    min: lo,
    max: hi,
    mode,
    current: known && cur != null && Number.isFinite(cur) ? cur : null,
    displayPath: compositionChartKeyToDistributionPath(chartKey),
    minLabel: fmt(lo),
    maxLabel: fmt(hi),
  };
}

/** Current observation for a feeder profile display path (numerics + composition %). */
export function exomasteryObservationForProfilePath(
  displayPath: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): { value: number | null; known: boolean } {
  const low = displayPath.toLowerCase();
  // The composition helpers return { v, known }; this function's contract is { value, known }.
  // Returning them unmapped left `value` undefined, so every composition, atmosphere-gas and
  // material row in the exomastery cards read as "no observation" even when one existed.
  if (low.includes("solidcomposition") || low.includes("solid_composition")) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = solidValue(scan, rec, tail);
    return { value: v, known };
  }
  if (low.includes("atmospherecomposition") || (low.includes("atmosphere") && low.includes("composition"))) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = atmoGasValue(scan, rec, tail);
    return { value: v, known };
  }
  if (low.includes("materials")) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = crustMaterialValue(scan, rec, tail);
    return { value: v, known };
  }
  const v = valueForNumericPath(displayPath, scan, rec);
  return { value: v, known: v != null };
}

/** Per-field breakdown for UI modal (numeric + categorical; composition in {@link ExomasteryDetailDTO.compositionGroups}). */
export function buildExomasteryDetail(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): ExomasteryDetailDTO {
  const stats: ExomasteryStatDetailDTO[] = [];
  let idx = 0;
  const nid = () => `xo-${idx++}`;

  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));

  const atmosphereClimateStats: ExomasteryStatDetailDTO[] = [];
  const CLIMATE_NUMERIC_TAILS = new Set(["surfacegravity", "surfacetemperature", "surfacepressure"]);

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;

    const v = valueForNumericPath(path, scan, rec);
    const mode = r.mode ?? r.mean;
    const missing = v == null || !Number.isFinite(v);
    const relDisp =
      !missing && Number.isFinite(mode) ? relativePercentDisplay(v!, mode) : { pct: null, huge: false };
    const curForDist = missing ? null : v!;
    const distribution = buildNumericDistributionDto(path, r, curForDist);
    const stat: ExomasteryStatDetailDTO = {
      id: nid(),
      kind: "numeric",
      chartPath: path,
      label: formatPathLabel(path),
      typicalDisplay: formatExomasteryValueForPath(path, mode),
      currentDisplay: missing ? "—" : formatExomasteryValueForPath(path, v!),
      isMissing: missing,
      diffPoints: null,
      diffRelativePercent: relDisp.pct,
      diffHuge: relDisp.huge,
      chevron: "none",
      compact: false,
      distribution,
    };
    if (CLIMATE_NUMERIC_TAILS.has(tail)) {
      atmosphereClimateStats.push(stat);
      continue;
    }
    stats.push(stat);
  }

  const makeCompRow = (
    kind: "material" | "atmosphere" | "solid",
    chartKey: string,
    el: string,
    rollup: ExomasteryNumericRollup,
    cur: { v: number | null; known: boolean },
  ): ExomasteryStatDetailDTO => {
    const mode = rollup.mode ?? rollup.mean;
    const missing = !cur.known;
    const curN = cur.known ? (cur.v ?? 0) : NaN;
    const dpp = cur.known && Number.isFinite(mode) ? Math.round(Math.abs(curN - mode) * 10) / 10 : null;
    let relVsTyp: number | null = null;
    let diffHuge = false;
    if (cur.known && Number.isFinite(mode) && Math.abs(mode) > 1e-6) {
      const raw = (Math.abs(curN - mode) / Math.abs(mode)) * 100;
      if (raw > 200) diffHuge = true;
      else relVsTyp = Math.round(raw * 10) / 10;
    }
    const curForComp = cur.known ? (cur.v ?? null) : null;
    return {
      id: nid(),
      kind,
      chartPath: chartKey,
      label: el,
      typicalDisplay: `${formatExomasteryNum(mode)}%`,
      currentDisplay: missing ? "—" : `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: missing,
      diffPoints: dpp,
      diffRelativePercent: relVsTyp,
      diffHuge,
      chevron: compositionChevron(curN, mode, missing),
      compact: true,
      distribution: buildCompositionDistributionDto(chartKey, rollup, curForComp, cur.known),
    };
  };

  const crustRows: ExomasteryStatDetailDTO[] = [];
  const crustScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.materials)) {
    const cur = crustMaterialValue(scan, rec, el);
    crustRows.push(makeCompRow("material", `material:${el}`, el, r, cur));
    if (cur.known) {
      crustScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const atmoRows: ExomasteryStatDetailDTO[] = [];
  const atmoScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const cur = atmoGasValue(scan, rec, el);
    atmoRows.push(makeCompRow("atmosphere", `atmosphere:${el}`, el, r, cur));
    if (cur.known) {
      atmoScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const solidRows: ExomasteryStatDetailDTO[] = [];
  const solidScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const cur = solidValue(scan, rec, el);
    solidRows.push(makeCompRow("solid", `solid:${el}`, el, r, cur));
    if (cur.known) {
      solidScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const profMatLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  for (const name of collectJournalMaterialElementNames(scan, rec)) {
    const low = name.toLowerCase();
    if (profMatLower.has(low)) continue;
    const cur = crustMaterialValue(scan, rec, name);
    if (!cur.known) continue;
    crustRows.push({
      id: nid(),
      kind: "material",
      chartPath: `material:journal-extra:${low}`,
      label: name,
      typicalDisplay: "—",
      currentDisplay: `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const profGasLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  for (const name of collectJournalAtmosphereGasNames(scan, rec)) {
    const low = name.toLowerCase();
    if (profGasLower.has(low)) continue;
    const cur = atmoGasValue(scan, rec, name);
    if (!cur.known) continue;
    atmoRows.push({
      id: nid(),
      kind: "atmosphere",
      chartPath: `atmosphere:journal-extra:${low}`,
      label: name,
      typicalDisplay: "—",
      currentDisplay: `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const profSolidLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));
  for (const key of collectJournalSolidKeys(scan, rec)) {
    if (profSolidLower.has(key.toLowerCase())) continue;
    const cur = solidValue(scan, rec, key);
    if (!cur.known) continue;
    solidRows.push({
      id: nid(),
      kind: "solid",
      chartPath: `solid:journal-extra:${key.toLowerCase()}`,
      label: key,
      typicalDisplay: "—",
      currentDisplay: cur.v != null && Number.isFinite(cur.v) ? `${formatExomasteryNum(cur.v)}%` : "—",
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const byCompDiff = (a: ExomasteryStatDetailDTO, b: ExomasteryStatDetailDTO) =>
    (a.diffPoints ?? 9999) - (b.diffPoints ?? 9999) || a.label.localeCompare(b.label);
  crustRows.sort(byCompDiff);
  atmoRows.sort(byCompDiff);
  solidRows.sort(byCompDiff);

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const modeVal = modeCategoricalLabel(counts);
    if (!modeVal) continue;
    const scanVal = valueForCategoricalPath(path, scan, rec, journalHost);
    const missing = !scanVal;
    const modeDisp = normalizeCategoricalValueForCompare(path, modeVal);
    const curDisp = scanVal ? normalizeCategoricalValueForCompare(path, scanVal) : "—";
    const sim = !missing && scanVal ? categoricalSimilarity(scanVal, modeVal, path) : 0;
    const closeness: "match" | "close" | "different" | undefined =
      !missing && scanVal ? (sim >= 1 ? "match" : sim >= 0.85 ? "close" : "different") : undefined;
    const mkAxis = classifyHostMkPath(path);
    let stellarProximitySteps: number | undefined;
    let stellarProximityAxis: ExomasteryStatDetailDTO["stellarProximityAxis"];
    if (!missing && scanVal && mkAxis) {
      const raw = computeMkAxisStepDistance(mkAxis, modeDisp, curDisp);
      if (raw != null) {
        stellarProximitySteps = Math.min(4, raw);
        stellarProximityAxis = mkAxis;
      }
    }
    stats.push({
      id: nid(),
      kind: "categorical",
      chartPath: path,
      label: formatPathLabel(path),
      typicalDisplay: modeDisp,
      currentDisplay: missing ? "—" : curDisp,
      isMissing: missing,
      diffPoints: null,
      diffRelativePercent: null,
      chevron: "none",
      compact: false,
      categoricalCloseness: closeness,
      ...(stellarProximitySteps != null ? { stellarProximitySteps, stellarProximityAxis } : {}),
    });
  }

  const supplementalMk = buildSupplementalHostMkRows(stats, profile, journalHost, nid);
  if (supplementalMk.length > 0) stats.unshift(...supplementalMk);

  const compositionGroups: ExomasteryCompositionGroupDTO[] = [];
  if (solidRows.length > 0 || crustRows.length > 0) {
    compositionGroups.push({
      id: "crust",
      title: "Crust & surface",
      summary: summarizeCompositionMatch([...solidScores, ...crustScores]),
      rows: [...solidRows, ...crustRows],
    });
  }
  if (atmoRows.length) {
    compositionGroups.push({
      id: "atmosphere",
      title: "Atmosphere composition (gases)",
      summary: summarizeCompositionMatch(atmoScores),
      rows: atmoRows,
    });
  }

  return {
    stats,
    compositionGroups,
    ...(atmosphereClimateStats.length > 0 ? { atmosphereClimateStats } : {}),
  };
}

/**
 * DSS / journal-only breakdown — same duplex/table shape as {@link buildExomasteryDetail},
 * “Typical (mode)” inactive (em dash). Climate block is temp + pressure + atmosphere gases; crust lists all journal materials & solids.
 */
export function buildBodyScanExomasteryDetail(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): ExomasteryDetailDTO {
  let idx = 0;
  const nid = () => `jr-${idx++}`;
  const row = (
    path: string,
    label: string,
    disp: string,
    missing: boolean,
    kind: ExomasteryStatDetailDTO["kind"] = "numeric",
    compact = false,
  ): ExomasteryStatDetailDTO => ({
    id: nid(),
    kind,
    chartPath: path,
    label,
    typicalDisplay: "—",
    currentDisplay: missing ? "—" : disp,
    isMissing: missing,
    diffPoints: null,
    diffRelativePercent: null,
    diffHuge: false,
    chevron: "none",
    compact,
  });

  const atmosphereClimateStats: ExomasteryStatDetailDTO[] = [];

  const temp = scan.SurfaceTemperature ?? rec?.surfaceTemperature;
  atmosphereClimateStats.push(
    row(
      "journal.climate.surface_temperature",
      "Surface temperature",
      temp != null ? `${temp.toFixed(2)} K` : "—",
      temp == null,
    ),
  );

  const press = scan.SurfacePressure ?? rec?.surfacePressure;
  const atm = press != null ? journalPressureToAtm(press) : null;
  atmosphereClimateStats.push(
    row(
      "journal.climate.surface_pressure",
      "Surface pressure",
      atm != null ? `${atm.toFixed(6)} atm` : "—",
      atm == null,
    ),
  );

  const rawGas = journalAtmosphereCompositionArray(scan, rec);
  if (rawGas) {
    for (const m of rawGas) {
      if (!m || typeof m !== "object") continue;
      const o = m as Record<string, unknown>;
      const name = String(o.Name ?? o.name ?? "").trim();
      const pct = journalPercentNumber(o.Percent ?? o.percent);
      if (!name || pct == null) continue;
      atmosphereClimateStats.push({
        ...row(
          `journal.climate.gas.${name.toLowerCase()}`,
          name,
          `${formatExomasteryNum(pct)}%`,
          false,
          "atmosphere",
          true,
        ),
      });
    }
  }

  const bodyTraitStats: ExomasteryStatDetailDTO[] = [];
  const rawG = scan.SurfaceGravity ?? rec?.surfaceGravity;
  const gEarth = rawG != null && Number.isFinite(rawG) ? journalSurfaceGravityToG(rawG) : null;
  bodyTraitStats.push(
    row(
      "journal.body.surface_gravity",
      "Gravity",
      gEarth != null ? `${gEarth.toFixed(3)} Earth g` : "—",
      gEarth == null,
    ),
  );

  const mass = scan.MassEM ?? rec?.massEM;
  bodyTraitStats.push(
    row(
      "journal.body.mass_em",
      "Earth masses",
      mass != null && Number.isFinite(mass) ? formatExomasteryNum(mass) : "—",
      mass == null || !Number.isFinite(mass),
    ),
  );

  const pClass = scan.PlanetClass ?? rec?.planetClass;
  bodyTraitStats.push(
    row("journal.body.planet_class", "Planet class", (pClass ?? "—").trim() || "—", !pClass?.trim()),
  );

  const atTyp = scan.AtmosphereType ?? rec?.atmosphereType ?? scan.Atmosphere ?? rec?.atmosphere;
  bodyTraitStats.push(
    row("journal.body.atmosphere_type", "Atmosphere type", (atTyp ?? "—").trim() || "—", !atTyp?.trim()),
  );

  const volc = scan.Volcanism ?? rec?.volcanism;
  bodyTraitStats.push(
    row("journal.body.volcanism", "Volcanism type", (volc ?? "—").trim() || "—", !volc?.trim()),
  );

  const bodyType = rec?.bodyType;
  bodyTraitStats.push(
    row("journal.body.body_type", "Type", (bodyType ?? "—").trim() || "—", !bodyType?.trim()),
  );

  const subCls = rec?.subclass;
  bodyTraitStats.push(
    row(
      "journal.body.subclass",
      "Sub type",
      subCls != null && Number.isFinite(subCls) ? String(subCls) : "—",
      subCls == null || !Number.isFinite(subCls),
    ),
  );

  const terra = scan.TerraformState ?? rec?.terraformState;
  bodyTraitStats.push(
    row("journal.body.terraform", "Terraform state", (terra ?? "—").trim() || "—", !terra?.trim()),
  );

  const rad = scan.radius ?? rec?.radius;
  bodyTraitStats.push(
    row(
      "journal.body.radius",
      "Radius",
      rad != null && Number.isFinite(rad) ? `${formatExomasteryNum(rad / 1000)} km` : "—",
      rad == null || !Number.isFinite(rad),
    ),
  );

  const surfaceTraitStats: ExomasteryStatDetailDTO[] = [];
  const tidal = scan.TidalLock ?? rec?.tidalLock;
  surfaceTraitStats.push(
    row(
      "journal.surface.tidal_lock",
      "Tidal lock",
      tidal === true ? "Yes" : tidal === false ? "No" : "—",
      tidal == null,
    ),
  );
  const foot = scan.WasFootfalled;
  if (foot !== undefined) {
    surfaceTraitStats.push(
      row("journal.surface.was_footfalled", "Surface footfall (scan flag)", foot ? "Yes" : "No", false),
    );
  }

  const orbitTraitStats: ExomasteryStatDetailDTO[] = [];
  const sma = scan.SemiMajorAxis ?? rec?.semiMajorAxis;
  orbitTraitStats.push(
    row(
      "journal.orbit.semi_major_axis",
      "Semi-major axis",
      sma != null && Number.isFinite(sma) ? `${formatExomasteryNum(sma / AU_METERS)} AU` : "—",
      sma == null || !Number.isFinite(sma),
    ),
  );
  const op = scan.OrbitalPeriod ?? rec?.orbitalPeriod;
  orbitTraitStats.push(
    row(
      "journal.orbit.orbital_period",
      "Orbital period",
      op != null && Number.isFinite(op) ? `${formatExomasteryNum(op / SECONDS_PER_DAY)} d` : "—",
      op == null || !Number.isFinite(op),
    ),
  );
  const ecc = scan.Eccentricity ?? rec?.eccentricity;
  orbitTraitStats.push(
    row(
      "journal.orbit.eccentricity",
      "Eccentricity",
      ecc != null && Number.isFinite(ecc) ? formatExomasteryNum(ecc) : "—",
      ecc == null || !Number.isFinite(ecc),
    ),
  );
  const inc = scan.OrbitalInclination ?? rec?.orbitalInclination;
  orbitTraitStats.push(
    row(
      "journal.orbit.inclination",
      "Orbital inclination",
      inc != null && Number.isFinite(inc) ? `${formatExomasteryNum(inc)} rad` : "—",
      inc == null || !Number.isFinite(inc),
    ),
  );
  const peri = scan.Periapsis ?? rec?.periapsis;
  orbitTraitStats.push(
    row(
      "journal.orbit.periapsis",
      "Periapsis",
      peri != null && Number.isFinite(peri) ? `${formatExomasteryNum(peri)} rad` : "—",
      peri == null || !Number.isFinite(peri),
    ),
  );
  const an = scan.AscendingNode ?? rec?.ascendingNode;
  orbitTraitStats.push(
    row(
      "journal.orbit.ascending_node",
      "Ascending node",
      an != null && Number.isFinite(an) ? `${formatExomasteryNum(an)} rad` : "—",
      an == null || !Number.isFinite(an),
    ),
  );
  const ma = scan.MeanAnomaly ?? rec?.meanAnomaly;
  orbitTraitStats.push(
    row(
      "journal.orbit.mean_anomaly",
      "Mean anomaly",
      ma != null && Number.isFinite(ma) ? `${formatExomasteryNum(ma)} rad` : "—",
      ma == null || !Number.isFinite(ma),
    ),
  );
  const rp = scan.RotationPeriod ?? rec?.rotationPeriod;
  orbitTraitStats.push(
    row(
      "journal.orbit.rotation_period",
      "Rotation period",
      rp != null && Number.isFinite(rp) ? `${formatExomasteryNum(rp / SECONDS_PER_DAY)} d` : "—",
      rp == null || !Number.isFinite(rp),
    ),
  );
  const ax = scan.AxialTilt ?? rec?.axialTilt;
  orbitTraitStats.push(
    row(
      "journal.orbit.axial_tilt",
      "Axial tilt",
      ax != null && Number.isFinite(ax) ? `${formatExomasteryNum(ax)} rad` : "—",
      ax == null || !Number.isFinite(ax),
    ),
  );
  const distLs = rec?.distanceFromArrivalLs;
  orbitTraitStats.push(
    row(
      "journal.orbit.distance_from_arrival",
      "Distance from arrival",
      distLs != null && Number.isFinite(distLs) ? `${formatExomasteryNum(distLs)} LS` : "—",
      distLs == null || !Number.isFinite(distLs),
    ),
  );

  const miscTraitStats: ExomasteryStatDetailDTO[] = [];
  miscTraitStats.push(
    row(
      "journal.misc.system_address",
      "System address",
      typeof scan.SystemAddress === "number" ? String(scan.SystemAddress) : "—",
      typeof scan.SystemAddress !== "number",
    ),
  );
  miscTraitStats.push(row("journal.misc.body_id", "Body ID", String(scan.BodyID), false));

  const matRows: ExomasteryStatDetailDTO[] = [];
  for (const name of collectJournalMaterialElementNames(scan, rec)) {
    const cur = crustMaterialValue(scan, rec, name);
    if (!cur.known) continue;
    matRows.push({
      ...row(
        `journal.crust.material.${name.toLowerCase()}`,
        name,
        `${formatExomasteryNum(cur.v ?? 0)}%`,
        false,
        "material",
        true,
      ),
    });
  }
  matRows.sort((a, b) => a.label.localeCompare(b.label));

  const solidJRows: ExomasteryStatDetailDTO[] = [];
  const comp = journalCompositionObject(scan, rec);
  if (comp) {
    for (const key of collectJournalSolidKeys(scan, rec)) {
      const rawV = comp[key];
      const v = typeof rawV === "number" && Number.isFinite(rawV) ? rawV : null;
      if (v == null) continue;
      const disp = journalSolidPercentFromRaw(key, v);
      solidJRows.push({
        ...row(
          `journal.crust.solid.${key.toLowerCase()}`,
          key,
          `${formatExomasteryNum(disp)}%`,
          false,
          "solid",
          true,
        ),
      });
    }
  }
  solidJRows.sort((a, b) => a.label.localeCompare(b.label));

  const crustCombined = [...solidJRows, ...matRows];
  const emptySummary: ExomasteryCompositionSummaryDTO = {
    overallMatchPercent: null,
    best: null,
    worst: null,
  };
  const compositionGroups: ExomasteryCompositionGroupDTO[] =
    crustCombined.length > 0
      ? [{ id: "crust", title: "Crust & surface", summary: emptySummary, rows: crustCombined }]
      : [];

  return {
    stats: [...bodyTraitStats, ...surfaceTraitStats, ...orbitTraitStats, ...miscTraitStats],
    compositionGroups,
    atmosphereClimateStats,
  };
}

function rollupRelativeBandPercent(r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const den = Math.max(Math.abs(mode), 1e-12);
  return ((r.max - r.min) / den) * 100;
}

function rollupBodyVsModePercent(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const den = Math.max(Math.abs(mode), 1e-12);
  return (Math.abs(v - mode) / den) * 100;
}

/** Same basis as encyclopedia `diffRelativePercent` for numerics (|v−mode|/|mode|×100). */
function deviationPercentVsRollupMode(v: number, r: ExomasteryNumericRollup): number {
  return rollupBodyVsModePercent(v, r);
}

function bodyInsideTrainingRange(v: number, r: ExomasteryNumericRollup): boolean {
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) return true;
  const lo = Math.min(r.min, r.max);
  const hi = Math.max(r.min, r.max);
  return v >= lo && v <= hi;
}

/**
 * Same breakpoints as client `deviationToTier` in exomasteryHabitatDetailInner (habitat / encyclopedia).
 * Lower deviation from mode → blue/green; larger → orange/red.
 */
function otherMatchHighlightFromDeviation(
  devPct: number,
  v: number | null,
  r: ExomasteryNumericRollup,
): EncyclopediaExomasteryFieldTier | "neutral" {
  if (v == null || !Number.isFinite(v)) return "neutral";
  let driver = devPct;
  if (!bodyInsideTrainingRange(v, r)) {
    driver = Math.max(driver, 11);
  }
  if (driver < 1) return "blue";
  if (driver <= 5) return "green";
  if (driver <= 7.5) return "yellow";
  if (driver <= 10) return "orange";
  return "red";
}

function otherMatchPriorityFromHighlight(
  h: EncyclopediaExomasteryFieldTier | "neutral",
  tightBand: boolean,
): number {
  const bandBoost = tightBand ? -3 : 0;
  switch (h) {
    case "blue":
      return 3 + bandBoost;
    case "green":
      return 14 + bandBoost;
    case "yellow":
      return 48 + bandBoost;
    case "orange":
      return 125 + bandBoost;
    case "red":
      return 230 + bandBoost;
    default:
      return 305 + bandBoost;
  }
}

function hostMkStepsToHighlight(steps: number | null): EncyclopediaExomasteryFieldTier | "neutral" {
  if (steps == null) return "neutral";
  if (steps <= 0) return "blue";
  if (steps === 1) return "green";
  if (steps === 2) return "yellow";
  if (steps === 3) return "orange";
  return "red";
}

function pushHostStarOtherMatchDeckCards(
  out: OtherMatchDetailCardDTO[],
  profile: ExomasteryProfileV1,
  journalHost: JournalHostStarObservation | null | undefined,
): void {
  if (!journalHost) return;
  const cohort = inferHostSpectralCohortMode(profile);
  if (!cohort) return;
  const parsed = parseLooseSpectralMk(cohort);
  let id = 0;
  const add = (
    shortTitle: string,
    top: string,
    bottom: string,
    steps: number | null,
    tooltip: string,
  ): void => {
    const highlight = hostMkStepsToHighlight(steps);
    const priority = otherMatchPriorityFromHighlight(highlight, false);
    out.push({
      id: `exo-host-deck-${id++}`,
      priority,
      shortTitle,
      topLegend: "Feeder cohort",
      topValue: top,
      bottomLegend: "Journal host",
      bottomValue: bottom,
      tooltip,
      highlight,
    });
  };
  if (journalHost.spectralLetter && parsed.spectralSlot) {
    const st = harvardSpectralStepDistance(parsed.spectralSlot, journalHost.spectralLetter);
    if (st != null) {
      add(
        "Host · spectral class",
        String(parsed.spectralSlot),
        journalHost.spectralLetter,
        st,
        "Harvard coarse class steps vs exomastery feeder mode (same-genus similarity).",
      );
    }
  }
  if (parsed.subclass != null && journalHost.subclass != null) {
    const st = stellarSubclassStepDistance(parsed.subclass, journalHost.subclass);
    if (st != null) {
      add(
        "Host · subclass",
        String(parsed.subclass),
        String(journalHost.subclass),
        st,
        "Subclass digit (0–9) distance — same-genus similarity.",
      );
    }
  }
  if (parsed.luminosity && journalHost.luminosity) {
    const st = yerkesLuminosityStepDistance(parsed.luminosity, journalHost.luminosity);
    if (st != null) {
      add(
        "Host · luminosity (Yerkes)",
        parsed.luminosity,
        journalHost.luminosity,
        st,
        "Yerkes luminosity class distance — weighted strongly in the similarity index.",
      );
    }
  }
}

/** Per-chip colour weight for similarity “deck” score (blue strongest; red none). */
const OTHER_MATCH_HIGHLIGHT_UNIT: Record<EncyclopediaExomasteryFieldTier | "neutral", number> = {
  blue: 1,
  green: 0.28,
  yellow: 0.06,
  orange: 0.012,
  red: 0,
  neutral: 0.08,
};

/** Tier multiplier: 1 = genus-_new style primary body fields; 2 = solid fractions; 3 = crust; 4 = other numerics / misc. */
const OTHER_MATCH_TIER_UNIT: Record<1 | 2 | 3 | 4, number> = {
  1: 1,
  2: 0.5,
  3: 0.35,
  4: 0.18,
};

/**
 * Orbital geometry, recognised by chip title rather than by feeder path. Same demotion the habitat
 * scorer applies through its `background` tier; checked before anything else so a loose keyword
 * cannot promote an orbital chip back into tier 1.
 */
const ORBITAL_GEOMETRY_CHIP =
  /(semi[- ]?major|orbital period|rotation(al)? period|tidal|eccentric|inclination|periapsis|ascending node|mean anomaly)/i;

function otherMatchCardTierFromTitle(shortTitle: string): 1 | 2 | 3 | 4 {
  const t = shortTitle.trim();
  if (ORBITAL_GEOMETRY_CHIP.test(t)) return 4;
  if (t.startsWith("Host ·")) return 1;
  if (t.startsWith("Solid ·")) return 2;
  if (t.startsWith("Crust ·")) return 3;
  if (t.startsWith("Atmosphere ·")) return 1;
  const low = t.toLowerCase();
  if (
    /\bplanet\b/.test(low) ||
    low.includes("atmosphere") ||
    low.includes("gravity") ||
    low.includes("temperature") ||
    low.includes("pressure") ||
    low.includes("terraform") ||
    low.includes("landable") ||
    low.includes("volcan") ||
    (low.includes("mass") && (low.includes("earth") || low.includes("em"))) ||
    low.includes("radius")
  ) {
    return 1;
  }
  return 4;
}

/**
 * Single scalar “deck strength” from other-match chips: tier (primary vs solid vs crust vs other) × highlight colour.
 * Used for same-genus deck share (sum-normalized vs siblings in {@link applyExomasteryGenusCompetitivePercent}), not habitat quality.
 */
export function exomasteryOtherMatchCardDeckScore(cards: OtherMatchDetailCardDTO[]): number {
  let sum = 0;
  for (const c of cards) {
    const tier = otherMatchCardTierFromTitle(c.shortTitle);
    const hi = (c.highlight ?? "neutral") as keyof typeof OTHER_MATCH_HIGHLIGHT_UNIT;
    const hw = OTHER_MATCH_HIGHLIGHT_UNIT[hi] ?? OTHER_MATCH_HIGHLIGHT_UNIT.neutral;
    let hostBoost = 1;
    if (c.shortTitle.startsWith("Host · luminosity")) hostBoost = 1.58;
    else if (c.shortTitle.startsWith("Host ·")) hostBoost = 1.14;
    sum += OTHER_MATCH_TIER_UNIT[tier] * hw * hostBoost;
  }
  return Math.round(sum * 1000) / 1000;
}

/**
 * Candidate species — “Other match details”: compact feeder vs body chips (priority + colors align with encyclopedia deviation tiers).
 */
export function buildOtherMatchDetailCards(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  similarityPercent: number | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): OtherMatchDetailCardDTO[] {
  const out: OtherMatchDetailCardDTO[] = [];
  pushHostStarOtherMatchDeckCards(out, profile, journalHost ?? null);
  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));
  const hasSim = similarityPercent != null && Number.isFinite(similarityPercent) && similarityPercent >= 0;

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    if (/solidcomposition/i.test(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;
    const v = valueForNumericPath(path, scan, rec);
    const mode = r.mode ?? r.mean;
    const tightBand = rollupRelativeBandPercent(r) < 0.1;
    const hasValue = v != null && Number.isFinite(v);
    if (hasSim) {
      if (!(tightBand || hasValue)) continue;
    } else if (v == null && !tightBand) continue;

    const devPct = hasValue ? deviationPercentVsRollupMode(v!, r) : 100;
    const highlight = hasValue ? otherMatchHighlightFromDeviation(devPct, v!, r) : "neutral";
    const priority = otherMatchPriorityFromHighlight(highlight, tightBand);
    const label = formatPathLabel(path);
    const dispMode = formatExomasteryValueForPath(path, mode);
    const dispCur = hasValue ? formatExomasteryValueForPath(path, v!) : "—";
    const spanNote = `${formatExomasteryValueForPath(path, r.min)} … ${formatExomasteryValueForPath(path, r.max)}`;
    out.push({
      id: `exo-${tail}-${Math.abs(hashStringSimple(path))}`.replace(/[^a-z0-9_-]/gi, "-"),
      priority,
      shortTitle: label,
      topLegend: "Typical (mode)",
      topValue: dispMode,
      bottomLegend: "This body",
      bottomValue: dispCur,
      tooltip: `Exomastery sample (${r.count ?? "?"} bodies): min–max ${spanNote}. Band vs mode: ${rollupRelativeBandPercent(r).toFixed(4)}%. Δ vs mode: ${hasValue ? `${devPct.toFixed(2)}%` : "—"}.`,
      highlight,
    });
  }

  for (const [el, r] of Object.entries(profile.materials)) {
    const cur = crustMaterialValue(scan, rec, el);
    if (!cur.known) continue;
    const curN = cur.v ?? 0;
    const mode = r.mode ?? r.mean;
    const tightBand = rollupRelativeBandPercent(r) < 0.1;
    const devPct = deviationPercentVsRollupMode(curN, r);
    const highlight = otherMatchHighlightFromDeviation(devPct, curN, r);
    const priority = otherMatchPriorityFromHighlight(highlight, tightBand);
    const dpp = Number.isFinite(mode) ? Math.round(Math.abs(curN - mode) * 10) / 10 : null;
    out.push({
      id: `exo-mat-${el.replace(/[^a-z0-9]+/gi, "-")}`,
      priority,
      shortTitle: `Crust · ${el}`,
      topLegend: "Typical (mode %)",
      topValue: `${formatExomasteryNum(mode)}%`,
      bottomLegend: "This body",
      bottomValue: `${formatExomasteryNum(curN)}%`,
      tooltip: `Crust element ${el}: feeder ${formatExomasteryNum(r.min)}–${formatExomasteryNum(r.max)}% · n=${r.count ?? "?"}. Δ vs mode: ${dpp ?? "—"} pp · ${devPct.toFixed(2)}% rel.`,
      highlight,
    });
  }

  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const cur = atmoGasValue(scan, rec, el);
    if (!cur.known) continue;
    const curN = cur.v ?? 0;
    const mode = r.mode ?? r.mean;
    const tightBand = rollupRelativeBandPercent(r) < 0.1;
    const devPct = deviationPercentVsRollupMode(curN, r);
    const highlight = otherMatchHighlightFromDeviation(devPct, curN, r);
    const priority = otherMatchPriorityFromHighlight(highlight, tightBand);
    const dpp = Number.isFinite(mode) ? Math.round(Math.abs(curN - mode) * 10) / 10 : null;
    out.push({
      id: `exo-atmo-${el.replace(/[^a-z0-9]+/gi, "-")}`,
      priority,
      shortTitle: `Atmosphere · ${el}`,
      topLegend: "Typical (mode %)",
      topValue: `${formatExomasteryNum(mode)}%`,
      bottomLegend: "This body",
      bottomValue: `${formatExomasteryNum(curN)}%`,
      tooltip: `Atmosphere gas ${el}: feeder ${formatExomasteryNum(r.min)}–${formatExomasteryNum(r.max)}% · n=${r.count ?? "?"}. Δ vs mode: ${dpp ?? "—"} pp · ${devPct.toFixed(2)}% rel.`,
      highlight,
    });
  }

  const seenSolidKeys = new Set<string>();
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const elK = el.toLowerCase();
    if (seenSolidKeys.has(elK)) continue;
    seenSolidKeys.add(elK);
    const cur = solidValue(scan, rec, el);
    if (!cur.known) continue;
    const curN = cur.v ?? 0;
    const mode = r.mode ?? r.mean;
    const tightBand = rollupRelativeBandPercent(r) < 0.1;
    const devPct = deviationPercentVsRollupMode(curN, r);
    const highlight = otherMatchHighlightFromDeviation(devPct, curN, r);
    const priority = otherMatchPriorityFromHighlight(highlight, tightBand);
    const dpp = Number.isFinite(mode) ? Math.round(Math.abs(curN - mode) * 10) / 10 : null;
    out.push({
      id: `exo-solid-${el.replace(/[^a-z0-9]+/gi, "-")}`,
      priority,
      shortTitle: `Solid · ${el}`,
      topLegend: "Typical (mode %)",
      topValue: `${formatExomasteryNum(mode)}%`,
      bottomLegend: "This body",
      bottomValue: `${formatExomasteryNum(curN)}%`,
      tooltip: `Solid fraction ${el}: feeder ${formatExomasteryNum(r.min)}–${formatExomasteryNum(r.max)}% · n=${r.count ?? "?"}. Δ vs mode: ${dpp ?? "—"} pp · ${devPct.toFixed(2)}% rel.`,
      highlight,
    });
  }

  const dedup = new Map<string, OtherMatchDetailCardDTO>();
  for (const c of out) {
    const k = `${c.shortTitle.toLowerCase()}|${c.topValue}|${c.bottomValue}`;
    if (!dedup.has(k)) dedup.set(k, c);
  }
  const merged = [...dedup.values()];
  merged.sort((a, b) => a.priority - b.priority || a.shortTitle.localeCompare(b.shortTitle));
  return merged.slice(0, 120);
}

function hashStringSimple(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
