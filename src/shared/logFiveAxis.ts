/**
 * A chart axis where every gridline is five times the last.
 *
 * The owner's ask (2026-09-20): `1 M -> 5 M -> 25 M -> 125 M -> 625 M -> 3.125 bn`, and the lines
 * may follow the data rather than being fixed.
 *
 * **Base five is not a stylistic choice here, it is the fit.** Across his own income sources the
 * smallest is 6,899,678 CR and the largest 7,771,860,600 — a ratio of **1,126x**. Linear, the
 * smallest bar is 0.09 % of the largest: one pixel beside a full-height column, and five of seven
 * rows unreadable. Base 10 puts that whole range in 3.05 decades, which is too few gridlines to read
 * a difference against. Base 5 gives **4.37**, so a chart with five or six lines shows every row at
 * a length you can compare by eye.
 *
 * ### Zero is the hard part
 *
 * `log(0)` is negative infinity, and zero is *common*: a 24-hour window with no combat has no bond
 * income at all. Every function here treats a non-positive value as sitting exactly on the baseline,
 * so the row still draws, still carries its label, and reads as "none" rather than vanishing. A
 * missing row looks like a broken panel; a flat one looks like a fact.
 */

export const AXIS_BASE = 5;

export interface LogFiveAxis {
  /** The gridline at or below the smallest positive value. Bars are measured from here. */
  min: number;
  /** The gridline at or above the largest value. */
  max: number;
  /** Every gridline from `min` to `max`, each five times the last. */
  ticks: number[];
}

/** Largest power of five that is <= `v`, as an absolute value. `v <= 0` has no answer. */
function powerOfFiveAtOrBelow(v: number): number {
  const exponent = Math.floor(Math.log(v) / Math.log(AXIS_BASE));
  return AXIS_BASE ** exponent;
}

/**
 * Choose the gridlines for a set of values.
 *
 * `anchor` is where the ladder is allowed to start — a million for credits, so the lines land on the
 * round numbers the owner wrote rather than on 5^8 = 390,625. The ladder still climbs in fives from
 * there, which is what he asked for; only the first rung is chosen for legibility.
 *
 * With no positive value at all — a window in which nothing was earned — the axis is still returned,
 * one decade wide, so the chart draws its frame and its empty rows instead of collapsing.
 */
export function buildLogFiveAxis(values: readonly number[], anchor = 1_000_000): LogFiveAxis {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positive.length === 0) {
    return { min: anchor, max: anchor * AXIS_BASE, ticks: [anchor, anchor * AXIS_BASE] };
  }

  const lo = Math.min(...positive);
  const hi = Math.max(...positive);

  /*
    Start from the anchor and walk, rather than computing a power of five directly: the anchor is a
    round number of the owner's choosing and is not itself a power of five, so the ladder has to be
    built from it in both directions.
  */
  let min = anchor;
  while (min > lo) min /= AXIS_BASE;
  while (min * AXIS_BASE <= lo) min *= AXIS_BASE;
  // A value below the anchor's own ladder still needs a floor it sits above.
  if (min > lo) min = powerOfFiveAtOrBelow(lo);

  const ticks: number[] = [min];
  let t = min;
  // The guard is a safety net, not a limit: 40 rungs of five is 9e27, past any credit total.
  while (t < hi && ticks.length < 40) {
    t *= AXIS_BASE;
    ticks.push(t);
  }
  return { min, max: ticks[ticks.length - 1]!, ticks };
}

/**
 * Where a value sits on the axis, 0 at `min` and 1 at `max`.
 *
 * Non-positive, or at or below the floor, is 0 — the baseline. See the header: this is what keeps an
 * empty category on screen as a labelled flat row.
 */
export function logFiveFraction(value: number, axis: LogFiveAxis): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (axis.max <= axis.min) return 0;
  const span = Math.log(axis.max / axis.min);
  const at = Math.log(value / axis.min);
  if (at <= 0) return 0;
  return Math.min(1, at / span);
}

/** Compact credits for a tick label: 1.2 bn, 625 M, 4.0 M, 12 k. */
export function formatCredits(v: number): string {
  const n = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (n >= 1e9) return `${sign}${(n / 1e9).toFixed(n >= 1e10 ? 0 : 2)} bn`;
  if (n >= 1e6) return `${sign}${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M`;
  if (n >= 1e3) return `${sign}${Math.round(n / 1e3)} k`;
  return `${sign}${Math.round(n)}`;
}
