/**
 * One place for how numbers and units read (plan 3.4a, Fable review 9.4): credits, light seconds,
 * light years and percentages were written seven, two, four and three ways across the screens.
 *
 * - Credits: short scale on anything read at a glance (`7.94 M`, `612 k`, `1.2 B`; "k" only from
 *   100,000 and "B" for billions: owner, 2026-09-27/28), the exact figure in titles and tables.
 * - Light seconds: `Ls`, capital L, always.
 * - Light years: one decimal below 100 ly (a jump), whole and grouped above (a distance), kly from
 *   10,000; "here" for a place under a light year away.
 * - Percent: no space before `%`, as most of the app already wrote it; `<1%` for a share that
 *   rounds to nothing but is not nothing.
 */

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/* ------------------------------------------------------------------ credits */

/** Short scale for chips and cards: `7.94 M`, `612 M`, `612 k`, `12,000`. */
export function fmtCrShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sig = (v: number) =>
    Math.abs(v) < 10 ? v.toFixed(2) : Math.abs(v) < 100 ? v.toFixed(1) : v.toFixed(0);
  if (abs >= 1e9) return `${sig(n / 1e9)} B`;
  if (abs >= 1e6) return `${sig(n / 1e6)} M`;
  // "k" only from 100,000 (owner, 2026-09-28): below that the whole figure is short enough to read.
  if (abs >= 1e5) return `${sig(n / 1e3)} k`;
  return GROUPED.format(Math.round(n));
}

/** Exact figure with the unit, for titles and tables. */
export function fmtCrExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${GROUPED.format(Math.round(n))} CR`;
}

/** A range as one short figure when the ends meet, else `low – high`. */
export function fmtCrRangeShort(min: number, max: number): string {
  return min === max ? fmtCrShort(min) : `${fmtCrShort(min)} – ${fmtCrShort(max)}`;
}

export function fmtCrRangeExact(min: number, max: number): string {
  return min === max
    ? fmtCrExact(min)
    : `${GROUPED.format(Math.round(min))} – ${GROUPED.format(Math.round(max))} CR`;
}

/**
 * Compact credits for a chart tick or a running total: `1.2 B`, `625 M`, `4.0 M`, `250 k`, `12,000`.
 * One decimal fewer than {@link fmtCrShort}, so a column of ticks lines up.
 */
export function fmtCrTick(v: number): string {
  const n = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (n >= 1e9) return `${sign}${(n / 1e9).toFixed(n >= 1e10 ? 0 : 2)} B`;
  if (n >= 1e6) return `${sign}${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M`;
  if (n >= 1e5) return `${sign}${Math.round(n / 1e3)} k`;
  return `${sign}${GROUPED.format(Math.round(n))}`;
}

/* ------------------------------------------------------------------ distances */

/** `4.2 Ls`, `318 Ls`, `12.4k Ls`; `~` in front when the distance is an orbit estimate. */
export function fmtLs(ls: number, estimate = false): string {
  const n = ls < 10 ? ls.toFixed(1) : ls < 10_000 ? String(Math.round(ls)) : `${(ls / 1000).toFixed(1)}k`;
  return `${estimate ? "~" : ""}${n} Ls`;
}

/** The game's own figure, to two decimals at most: `0 Ls`, `12.34 Ls`, `1,234.5 Ls`. */
export function fmtLsExact(ls: number): string {
  return `${ls === 0 ? "0" : ls.toLocaleString("en-US", { maximumFractionDigits: 2 })} Ls`;
}

/** `8.4 ly` for a jump, `1,234 ly` for a distance, `12.3 kly` across the galaxy; `—` when there is none. */
export function fmtLy(ly: number | null | undefined): string {
  if (ly == null || !Number.isFinite(ly)) return "—";
  const a = Math.abs(ly);
  if (a < 100) return `${ly.toFixed(1)} ly`;
  if (a < 10_000) return `${GROUPED.format(Math.round(ly))} ly`;
  return `${(ly / 1000).toFixed(1)} kly`;
}

/** How far a place is from the commander: `here` under a light year (the same system), else {@link fmtLy}. */
export function fmtLyAway(ly: number | null | undefined): string {
  if (ly != null && Number.isFinite(ly) && ly < 1) return "here";
  return fmtLy(ly);
}

/* ------------------------------------------------------------------ percent */

/** A percentage already in percent: `12%`, `<1%`, `12.5%` with `digits`. */
export function fmtPct(pct: number, digits = 0): string {
  if (!Number.isFinite(pct)) return "—";
  if (digits === 0 && pct > 0 && pct < 1) return "<1%";
  return `${pct.toFixed(digits)}%`;
}
