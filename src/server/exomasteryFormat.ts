/**
 * How exomastery values are written for the reader: path labels, units, number formatting. Split out of exomasteryProfile.ts (code review D, 2026-09-27).
 */
import { journalPressureToAtm, journalSurfaceGravityToG } from "../shared/journalPhysics.js";
import { AU_METERS } from "./exomasteryBodyValues.js";

export function modeCategoricalLabel(counts: Record<string, number>): string | null {
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
    /*
      The feeder profiles' `body.surfacePressure` is already atmospheres (Tussock ignis: mode 0.0083).
      Converted again it read 0.00 atm for both the body and the species (2026-10-04, "Why this
      chance"); everything else here is the journal's pascals.
    */
    return { displayNumber: low.startsWith("body.") ? raw : journalPressureToAtm(raw), suffix: " atm" };
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

/*
  Built once. `toLocaleString(locale, options)` constructs a fresh Intl.NumberFormat on every call, and
  the exomastery detail cards call this thousands of times per snapshot: it was 49 % of all snapshot
  build time on the owner's history (code review §E, 2026-09-27). Same locale, same options, same text.
*/
const EXO_NUM_2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EXO_NUM_4 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const EXO_NUM_6 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** en-US grouping: comma thousands, dot decimal — `1,234,567.89` for large values; preserves precision for small magnitudes. */
export function formatExomasteryNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0.00";
  if (abs >= 1) return EXO_NUM_2.format(n);
  if (abs >= 0.01) return EXO_NUM_4.format(n);
  return EXO_NUM_6.format(n);
}

export function relativePercentDisplay(v: number, mode: number): { pct: number | null; huge: boolean } {
  const den = Math.max(Math.abs(mode), 1e-9);
  const raw = (Math.abs(v - mode) / den) * 100;
  if (!Number.isFinite(raw)) return { pct: null, huge: false };
  if (raw > 200) return { pct: null, huge: true };
  return { pct: Math.round(raw * 10) / 10, huge: false };
}
