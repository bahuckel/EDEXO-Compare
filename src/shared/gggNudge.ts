/**
 * The nudge, by eye (owner, 2026-10-08): which gas giants to photograph to see whether a giant got CMDR
 * Arcanic's random "nudge" — from its colours rather than from the data, which cannot show it.
 *
 * Each of the seven cloud layers takes the colour of the temperature band it sits in (between two
 * cracks, shared/gggLadder.ts). A nudge moves the bottom layer to another temperature before the
 * ladder is built, so a nudged giant's layers can sit in other bands than its shown temperature
 * says. Modelled here as he describes it: the bottom moves to a value in the class's nudge range,
 * never below the shown temperature (so below the range it always moves, inside it only sometimes).
 *
 * A photo is worth taking of:
 * - a giant always nudged by his rule whose layers would sit in clearly other bands if it were not
 *   (at least `ALWAYS_MIN_LAYERS` layers change whatever the nudge did): a look that matches the
 *   shown temperature means no nudge;
 * - a giant in a maybe range whose layers can change (`MAYBE_MIN_LAYERS`): nudged or not, by eye;
 * - a giant that cannot be nudged, as the reference for what each band looks like in its class, until
 *   `REFERENCES_PER_CLASS` of the class have been logged.
 * Only on the developer's own PC (server/gggResearch.ts); nobody else is asked for photos.
 */
import {
  cracksOf,
  gasGiantDensity,
  ladderClassOf,
  ladderRungs,
  nudgeOf,
  nudgeRange,
  type LadderClass,
} from "./gggLadder.js";

export const ALWAYS_MIN_LAYERS = 3;
export const MAYBE_MIN_LAYERS = 2;
export const REFERENCES_PER_CLASS = 10;

export interface NudgeLook {
  cls: LadderClass;
  /** His nudge state for the shown temperature. */
  nudge: "none" | "maybe" | "always";
  density: number;
  /** Band per layer (0 = below the class's first crack), bottom layer first. */
  bandsShown: number[];
  /** The band patterns a nudge can give, most likely first (share of the nudge range). */
  bandsNudged: { bands: number[]; share: number }[];
  /** Layers in another band than the shown temperature's, at least and at most, over the nudge range. */
  changedMin: number;
  changedMax: number;
}

const SAMPLES = 120;

/** The bands of the seven layers with and without a nudge, or null when the ladder does not apply. */
export function nudgeLook(opts: {
  planetClass: string | null | undefined;
  tempK: number | null | undefined;
  massEM: number | null | undefined;
  radiusM: number | null | undefined;
}): NudgeLook | null {
  const cls = ladderClassOf(opts.planetClass);
  const T = opts.tempK;
  if (!cls || T == null || !Number.isFinite(T) || T <= 0) return null;
  if (!opts.massEM || !opts.radiusM || opts.massEM <= 0 || opts.radiusM <= 0) return null;
  const density = gasGiantDensity(opts.massEM, opts.radiusM);
  const cracks = cracksOf(cls);
  const bandsOf = (t: number) => ladderRungs(cls, t, density).map((v) => cracks.filter((c) => v > c).length);
  const bandsShown = bandsOf(T);
  const nudge = nudgeOf(cls, T);
  const patterns = new Map<string, { bands: number[]; n: number }>();
  let changedMin = 0;
  let changedMax = 0;
  if (nudge !== "none") {
    const [lo, hi] = nudgeRange(cls);
    changedMin = 7;
    for (let i = 0; i <= SAMPLES; i++) {
      const bands = bandsOf(Math.max(T, lo + ((hi - lo) * i) / SAMPLES));
      const changed = bands.filter((b, k) => b !== bandsShown[k]).length;
      changedMin = Math.min(changedMin, changed);
      changedMax = Math.max(changedMax, changed);
      const key = bands.join(",");
      const p = patterns.get(key) ?? { bands, n: 0 };
      p.n++;
      patterns.set(key, p);
    }
  }
  const bandsNudged = [...patterns.values()]
    .sort((a, b) => b.n - a.n)
    .map((p) => ({ bands: p.bands, share: p.n / (SAMPLES + 1) }));
  return { cls, nudge, density, bandsShown, bandsNudged, changedMin, changedMax };
}

/** `3× 114–210 K, 3× 210–270 K, 1× 270–370 K`. */
export function bandsText(cls: LadderClass, bands: readonly number[]): string {
  const edges = [0, ...cracksOf(cls)];
  const count = new Map<number, number>();
  for (const b of bands) count.set(b, (count.get(b) ?? 0) + 1);
  return [...count]
    .sort((a, b) => a[0] - b[0])
    .map(([b, n]) => {
      const lo = edges[b]!;
      const hi = edges[b + 1];
      return `${n}× ${b === 0 ? `below ${hi}` : hi == null ? `above ${lo}` : `${lo}–${hi}`} K`;
    })
    .join(", ");
}

export type PhotoReason = "always" | "maybe" | "reference";

/** Whether this giant is worth a photo, and why; `referencesLogged`: photos-wanted references of its class so far. */
export function photoReason(look: NudgeLook, referencesLogged: number): PhotoReason | null {
  if (look.nudge === "always") return look.changedMin >= ALWAYS_MIN_LAYERS ? "always" : null;
  if (look.nudge === "maybe") return look.changedMax >= MAYBE_MIN_LAYERS ? "maybe" : null;
  return referencesLogged < REFERENCES_PER_CLASS ? "reference" : null;
}

/** The notice's line: what to look for. */
export function photoText(look: NudgeLook, reason: PhotoReason): string {
  const shown = bandsText(look.cls, look.bandsShown);
  if (reason === "reference") return `Reference, cannot be nudged: its layers are ${shown}.`;
  const nudged = look.bandsNudged
    .slice(0, 2)
    .map((p) => bandsText(look.cls, p.bands))
    .join(" or ");
  const lead = reason === "always" ? "Always nudged by Arcanic's rule" : "Can be nudged";
  return `${lead}. Not nudged its layers would be ${shown}; nudged ${nudged}.`;
}
