/**
 * A species' starlight range (server: `starlightRanges.ts`), as the Encyclopedia and the match
 * reasons show it. Earth = 1: the Sun's flux at 1 AU.
 */
export interface SpeciesStarlight {
  /** Outside the range the matcher lists the species as unlikely; false = shown for information. */
  gate: boolean;
  lo: number;
  hi: number;
  /** Clean bodies the range was measured on. */
  n: number;
  /** Share of the species' own bodies outside the range. */
  ownLoss?: number;
  /** Share of its genus siblings' bodies outside it, where temperature and host type already fit. */
  beyondT?: number | null;
}

/** "0.034" / "4.8" / "1,270": Earth-relative light at a readable precision. */
export function formatStarlight(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString("en-GB");
  if (v >= 1) return v.toPrecision(2);
  if (v < 1e-4) return v.toExponential(1);
  return String(Number(v.toPrecision(2)));
}
