import type { EdsmBody } from "./edsm.js";
import { buildAtmosphereBands, type AtmosphereBands } from "./atmosphereBands.js";
import {
  extractAtmospherePercents,
  extractMaterialPercents,
  extractSolidComposition,
  flattenForStats,
  speciesFileSlug,
} from "./flatten.js";
import {
  type FeederStarSummary,
  resolveFeederHostSummaryForBody,
  resolveParentStarSummaryFromParents,
  syntheticStarTypeFromFeederSummary,
} from "./feederStarHost.js";

/** Must align with ED Exo Compare {@link loadExomasteryProfile} categorical host-star matchers. */
/**
 * Spectral class of the star the body actually orbits, resolved from its `parents` chain where
 * possible (see {@link resolveParentStarSummaryFromParents}) and from the body designation
 * otherwise. The key name predates the fix; ED Exo Compare has always compared it against the
 * body's parent star, so the value now matches what the consumer expects.
 */
export const EXO_HOST_STAR_SPECTRAL_PRIMARY = "exo.host_star_spectral_primary";
/** Spectral class of the system's primary star, kept separately now the host is resolved properly. */
export const EXO_SYSTEM_PRIMARY_SPECTRAL = "exo.system_primary_spectral";
/** How the host star was resolved: "parents" (exact) or "designation" (heuristic fallback). */
export const EXO_HOST_STAR_SOURCE = "exo.host_star_source";

export interface PlanetSampleContext {
  targetBody: EdsmBody | null;
  systemName?: string;
  /** Spansh/CSV occurrence body designation (often full `{System} …`). */
  bodyName?: string;
  starSummaries?: FeederStarSummary[];
  /** The system's primary star, recorded separately from the body's own host. */
  systemPrimaryStar?: FeederStarSummary;
}

export interface NumericRange {
  min: number;
  max: number;
  mean: number;
  count: number;
  /** Most common value after rounding samples to stable buckets (typical thriving habitat). */
  mode: number;
  modeCount: number;
}

export interface ExomasteryProfileV1 {
  formatVersion: 1;
  speciesLabel: string;
  genus: string;
  source: "exomastery_feeder";
  generatedAt: string;
  sampleCount: number;
  /** Flattened numeric paths under planet (prefix "body.") */
  numerics: Record<string, NumericRange>;
  /** String / bool path -> value -> count */
  categorical: Record<string, Record<string, number>>;
  materials: Record<string, NumericRange>;
  atmosphereComposition: Record<string, NumericRange>;
  solidComposition: Record<string, NumericRange>;
  /** Human summary for “most / least likely” preview */
  summaryLines?: string[];
  /**
   * Temperature and pressure percentiles per atmosphere type.
   *
   * The rollups above are one band over every body the species has ever been seen on, which fails
   * open: Osseus discus reads 80–641 K because fourteen methane bodies sit under a population of
   * 626 water ones at 402–449 K. Per-atmosphere cells are the same measurement taken where the
   * question is actually asked. See `atmosphereBands.ts`.
   */
  atmosphereBands?: AtmosphereBands;
}

function roundBucketKey(v: number): string {
  if (!Number.isFinite(v)) return "nan";
  const a = Math.abs(v);
  if (a >= 10_000) return String(Math.round(v));
  if (a >= 100) return String(Math.round(v * 10) / 10);
  if (a >= 1) return String(Math.round(v * 10_000) / 10_000);
  return String(Math.round(v * 1e8) / 1e8);
}

function modeFromBucketMeans(arr: number[]): { mode: number; modeCount: number } {
  const buckets = new Map<string, { sum: number; c: number }>();
  for (const v of arr) {
    const k = roundBucketKey(v);
    const cur = buckets.get(k);
    if (cur) {
      cur.c++;
      cur.sum += v;
    } else buckets.set(k, { sum: v, c: 1 });
  }
  let best = { mode: arr[0]!, modeCount: 0 };
  for (const { sum, c } of buckets.values()) {
    if (c > best.modeCount) best = { mode: sum / c, modeCount: c };
  }
  return best;
}

function rollupNumbers(arr: number[]): NumericRange {
  if (arr.length === 0) throw new Error("rollupNumbers: empty");
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const { mode, modeCount } = modeFromBucketMeans(arr);
  return { min, max, mean, count: arr.length, mode, modeCount };
}

function pushNum(acc: Map<string, number[]>, path: string, v: number) {
  const list = acc.get(path) ?? [];
  list.push(v);
  acc.set(path, list);
}

function finalizeNums(m: Map<string, number[]>): Record<string, NumericRange> {
  const out: Record<string, NumericRange> = {};
  for (const [k, arr] of m) {
    if (arr.length === 0) continue;
    out[k] = rollupNumbers(arr);
  }
  return out;
}

function mergeMat(acc: Record<string, number[]>, mat: Record<string, number>) {
  for (const [el, pct] of Object.entries(mat)) {
    if (!acc[el]) acc[el] = [];
    acc[el].push(pct);
  }
}

function finalizeMat(acc: Record<string, number[]>): Record<string, NumericRange> {
  const out: Record<string, NumericRange> = {};
  for (const [k, arr] of Object.entries(acc)) {
    if (!arr.length) continue;
    out[k] = rollupNumbers(arr);
  }
  return out;
}

/** Build profile from saved planet contexts (must include targetBody). */
export function buildProfileFromPlanetContexts(
  speciesLabel: string,
  genus: string,
  contexts: PlanetSampleContext[],
): ExomasteryProfileV1 {
  const numerics = new Map<string, number[]>();
  const categorical: Record<string, Record<string, number>> = {};
  const materialsAcc: Record<string, number[]> = {};
  const atmoAcc: Record<string, number[]> = {};
  const solidAcc: Record<string, number[]> = {};

  const bodies = contexts.map((c) => c.targetBody).filter(Boolean) as EdsmBody[];

  for (const body of bodies) {
    const o = body as unknown as Record<string, unknown>;
    const flat = flattenForStats(o, "body", 0, new Map());
    for (const [path, val] of flat) {
      if (typeof val === "number") pushNum(numerics, path, val);
      else if (typeof val === "string" || typeof val === "boolean") {
        const key = String(val);
        categorical[path] ??= {};
        categorical[path][key] = (categorical[path][key] ?? 0) + 1;
      }
    }
    mergeMat(materialsAcc, extractMaterialPercents(o));
    mergeMat(atmoAcc, extractAtmospherePercents(o));
    mergeMat(solidAcc, extractSolidComposition(o));
  }

  const bump = (key: string, value: string) => {
    categorical[key] ??= {};
    categorical[key][value] = (categorical[key][value] ?? 0) + 1;
  };

  for (const ctx of contexts) {
    const summaries = ctx.starSummaries;
    const bodyNm = ctx.bodyName?.trim() ?? "";
    const sysNm = (typeof ctx.systemName === "string" ? ctx.systemName : "").trim();
    if (!summaries?.length || !bodyNm) continue;

    // Exact where the body's parent chain is known; the designation heuristic only as a fallback.
    let hit = resolveParentStarSummaryFromParents(
      (ctx.targetBody as unknown as Record<string, unknown> | null)?.parents,
      summaries,
    );
    let source = "parents";
    if (!hit) {
      source = "designation";
      hit = resolveFeederHostSummaryForBody(bodyNm, sysNm, summaries);
      if (!hit && summaries.length === 1) hit = summaries[0]!;
    }
    if (!hit) continue;

    const syn = syntheticStarTypeFromFeederSummary(hit).trim();
    if (!syn) continue;
    bump(EXO_HOST_STAR_SPECTRAL_PRIMARY, syn);
    bump(EXO_HOST_STAR_SOURCE, source);

    const primary = ctx.systemPrimaryStar;
    if (primary) {
      const psyn = syntheticStarTypeFromFeederSummary(primary).trim();
      if (psyn) bump(EXO_SYSTEM_PRIMARY_SPECTRAL, psyn);
    }
  }

  /**
   * Read from the same bodies as everything else, but grouped by atmosphere rather than pooled.
   * EDSM reports pressure in atmospheres already, which is the unit the app compares against.
   */
  const atmosphereBands = buildAtmosphereBands(
    bodies.map((b) => {
      const o = b as unknown as Record<string, unknown>;
      return {
        atmosphereType: typeof o.atmosphereType === "string" ? o.atmosphereType : null,
        surfaceTemperatureK: typeof o.surfaceTemperature === "number" ? o.surfaceTemperature : null,
        surfacePressureAtm: typeof o.surfacePressure === "number" ? o.surfacePressure : null,
      };
    }),
  );

  const summaryLines: string[] = [];
  const numDone = finalizeNums(numerics);
  for (const [k, r] of Object.entries(numDone).slice(0, 80)) {
    summaryLines.push(
      `${k}: typical (modal) ${r.mode.toFixed(6)} (${r.modeCount}/${r.count} samples); range ${r.min} … ${r.max}`,
    );
  }

  return {
    formatVersion: 1,
    speciesLabel,
    genus,
    source: "exomastery_feeder",
    generatedAt: new Date().toISOString(),
    sampleCount: bodies.length,
    numerics: numDone,
    categorical,
    materials: finalizeMat(materialsAcc),
    atmosphereComposition: finalizeMat(atmoAcc),
    solidComposition: finalizeMat(solidAcc),
    summaryLines,
    atmosphereBands,
  };
}

export { speciesFileSlug };
export { genusFileSlug } from "./flatten.js";
