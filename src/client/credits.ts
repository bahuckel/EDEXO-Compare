/**
 * Credit formatting for chips and cards (WEBUI-REDESIGN 1.4).
 *
 * Short scale on anything read at a glance — `7.94 M`, `612 M`, `23.4 k` — with the exact figure
 * one hover away (`title`). Tables keep `toLocaleString()`; a table is where exact belongs.
 */
export function fmtCrShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sig = (v: number) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0));
  if (abs >= 1e9) return `${sig(n / 1e9)} B`;
  if (abs >= 1e6) return `${sig(n / 1e6)} M`;
  if (abs >= 1e4) return `${sig(n / 1e3)} k`;
  return n.toLocaleString();
}

/** Exact figure with the unit, for titles and tables. */
export function fmtCrExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString()} CR`;
}

/** A range as one short figure when the ends meet, else `low – high`. */
export function fmtCrRangeShort(min: number, max: number): string {
  return min === max ? fmtCrShort(min) : `${fmtCrShort(min)} – ${fmtCrShort(max)}`;
}

export function fmtCrRangeExact(min: number, max: number): string {
  return min === max ? fmtCrExact(min) : `${min.toLocaleString()} – ${max.toLocaleString()} CR`;
}
