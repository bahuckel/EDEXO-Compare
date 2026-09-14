/**
 * Per-atmosphere temperature and pressure bands.
 *
 * A species gets one band today, over every body it has ever been seen on, and that is wrong in a
 * way that is easy to miss because it always fails *open*. Osseus discus:
 *
 * ```
 * whole species        80 – 641 K       (a 561 K band that excludes nothing)
 *   Thin Water   n=626  402 – 449 K     (the species, really)
 *   Thin Methane n= 14   80 – 107 K     (the tail that set the floor)
 * ```
 *
 * Fourteen bodies out of 645 widen the band by an order of magnitude, and the result is a gate that
 * passes every warm body in the galaxy. Stratum tectonicas is the same shape from the other side:
 * Thin Ammonia is 165–174 K, nine degrees wide, inside a whole-species band of 165–449 K.
 *
 * So: one band per (species, atmosphere), and **p1–p99 rather than min–max**, because a single
 * outlier body should not set an edge. Cells below {@link MIN_CELL_SAMPLES} are still recorded —
 * they are evidence the species grows there — but callers are told not to treat them as a range.
 *
 * Pressure gets the same treatment, and needs it more than the string does. `atmospherePressureCategory`
 * is on 99 of 108 species and 99.98 % of bodies carrying exobiology are "Thin …", so as a gate it
 * excludes essentially nothing; the number underneath separates Thin Ammonia (below 0.013 atm) from
 * Thin Water (never below 0.056 atm) with no overlap at all.
 */

/** Below this a cell is recorded but is not a usable range — one or two bodies say nothing about spread. */
export const MIN_CELL_SAMPLES = 20;

export interface PercentileBand {
  /** Bodies in this cell. */
  n: number;
  min: number;
  p1: number;
  p50: number;
  p99: number;
  max: number;
}

export interface AtmosphereBandCell {
  n: number;
  surfaceTemperatureK: PercentileBand | null;
  surfacePressureAtm: PercentileBand | null;
  /**
   * Size and mass, split the same way — because the atmosphere fractures these too.
   *
   * The pooled rollup was measured against 51,340 raw packs and 53 of 1,001 species/path pairs hold
   * two dense clusters with an empty middle. Every large one groups by atmosphere, and it is not
   * only temperature that splits:
   *
   * ```
   *   Clypeus Margaritus  Thin Water  n=326  T 392-449  g 0.046-0.063  r  327- 447
   *                       Thin CO2    n=321  T 190-195  g 0.078-0.270  r  562-1827
   *                       pooled             T 190-449  g 0.046-0.270  r  327-1827
   * ```
   *
   * A body at `g = 0.07` is impossible for Margaritus under either atmosphere, and the pooled range
   * scored it as ordinary. Gravity is the worst of the three (56 % of the pooled range empty for
   * Margaritus, 51 % for Tussock Capillum), radius next, mass close behind — they move together
   * because `g` is a function of the other two.
   *
   * Older profiles predate these fields and read back `undefined`, which falls through to the
   * pooled rollup exactly as before. Rebuilding a profile fills them in.
   */
  gravityG: PercentileBand | null;
  radiusKm: PercentileBand | null;
  earthMasses: PercentileBand | null;
}

/** Keyed by the body's `atmosphereType` exactly as EDSM reports it ("Thin Carbon dioxide"). */
export type AtmosphereBands = Record<string, AtmosphereBandCell>;

/**
 * Nearest-rank percentile on a sorted copy.
 *
 * Deliberately not interpolated: these are physical readings from real bodies, and an interpolated
 * p1 is a temperature no body was ever observed at.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.round((p / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))]!;
}

export function bandFrom(values: number[]): PercentileBand | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p1: percentile(sorted, 1),
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
  };
}

export interface BandSampleRow {
  atmosphereType: string | null | undefined;
  surfaceTemperatureK: number | null | undefined;
  surfacePressureAtm: number | null | undefined;
  gravityG: number | null | undefined;
  radiusKm: number | null | undefined;
  earthMasses: number | null | undefined;
}

/** Group observed bodies by atmosphere and reduce each cell to percentile bands. */
export function buildAtmosphereBands(rows: BandSampleRow[]): AtmosphereBands {
  type Cell = { t: number[]; p: number[]; g: number[]; r: number[]; m: number[]; n: number };
  const byAtmo = new Map<string, Cell>();
  const push = (into: number[], v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) into.push(v);
  };
  for (const r of rows) {
    const key = (r.atmosphereType ?? "").trim();
    if (!key) continue;
    const cell: Cell = byAtmo.get(key) ?? { t: [], p: [], g: [], r: [], m: [], n: 0 };
    cell.n++;
    push(cell.t, r.surfaceTemperatureK);
    push(cell.p, r.surfacePressureAtm);
    push(cell.g, r.gravityG);
    push(cell.r, r.radiusKm);
    push(cell.m, r.earthMasses);
    byAtmo.set(key, cell);
  }

  const out: AtmosphereBands = {};
  // Largest cell first, so a profile read by eye starts with where the species actually lives.
  for (const [atmo, cell] of [...byAtmo.entries()].sort((a, b) => b[1].n - a[1].n)) {
    out[atmo] = {
      n: cell.n,
      surfaceTemperatureK: bandFrom(cell.t),
      surfacePressureAtm: bandFrom(cell.p),
      gravityG: bandFrom(cell.g),
      radiusKm: bandFrom(cell.r),
      earthMasses: bandFrom(cell.m),
    };
  }
  return out;
}

/** True when a cell has enough bodies for its percentiles to describe a range rather than a scatter. */
export function cellIsUsable(cell: AtmosphereBandCell | undefined | null): boolean {
  return !!cell && cell.n >= MIN_CELL_SAMPLES;
}
