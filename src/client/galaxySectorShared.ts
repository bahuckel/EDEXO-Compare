/**
 * Constants, types and small helpers the galaxy sector map's panels share. Split out of GalaxySectorMap.tsx (code review D, 2026-09-27).
 */
import type { GalaxySearchMark } from "./GalaxySearchPanel";
import { CAMERA_SIDE, CAMERA_TOP } from "./galaxyProjection";
import { cellTotals } from "@shared/sectorMapFile.js";

/** One identity for "no search", so an unsearched map does not hand its plots a new array each render. */
export const EMPTY_HITS: readonly GalaxySearchMark[] = [];

/** Strongest-first, and the order the legend reads in. */
export type Kind = "confirmed" | "genus" | "signal" | "predicted";

export const KIND_COLOUR: Record<Kind, string> = {
  // Green for a fact, blue for a possibility — the owner's own choice.
  confirmed: "#3fb950",
  genus: "#58a6ff",
  signal: "#58a6ff",
  predicted: "#8b949e",
};

/**
 * `signal` is drawn **hollow** rather than in a fourth hue.
 *
 * Genus and signal are both "blue" in the owner's scheme, and two blues a shade apart are the kind of
 * distinction that survives a design review and fails on a real monitor at a glance. Filled versus
 * outlined separates them by shape as well as colour, which also survives colour blindness — and it
 * carries the meaning: a hollow marker is a body nobody has opened.
 */
export const KIND_FILLED: Record<Kind, boolean> = {
  confirmed: true,
  genus: true,
  signal: false,
  predicted: false,
};

/** The owner's tooltip: confirmed, genus hits, FSS-only, in that order. */
export function evidenceSummary(t: { confirmed: number; genus: number; signal: number; predicted: number }): string {
  const parts: string[] = [];
  if (t.confirmed) parts.push(`${t.confirmed} confirmed`);
  if (t.genus) parts.push(`${t.genus} genus-only`);
  if (t.signal) parts.push(`${t.signal} signal-only`);
  if (t.predicted) parts.push(`${t.predicted} predicted`);
  return parts.length > 0 ? parts.join(" · ") : "nothing recorded";
}

export function strongestKind(t: ReturnType<typeof cellTotals>): Kind | null {
  if (t.confirmed > 0) return "confirmed";
  if (t.genus > 0) return "genus";
  if (t.signal > 0) return "signal";
  if (t.predicted > 0) return "predicted";
  return null;
}

/**
 * A view is now a starting camera, not a fixed pair of axis pickers.
 *
 * The two used to be separate code paths that happened to look similar. They are one camera at two
 * angles, and saying so is what lets the commander tilt to anything between — which is the only way
 * out of the edge-on view, where a galaxy 100 000 ly across and 2 000 thick draws as a line.
 */
export interface Projection {
  id: "top" | "side";
  label: string;
  hint: string;
  camera: { yaw: number; pitch: number };
}

export const PROJECTIONS: Projection[] = [
  {
    id: "top",
    label: "Top",
    hint: "Looking down on the galactic plane. Drag to pan, wheel to zoom, double-click to reset.",
    camera: CAMERA_TOP,
  },
  {
    id: "side",
    label: "Side",
    hint: "Edge-on, tilted slightly so near and far separate. Yaw spins the galaxy; pitch tips it.",
    camera: CAMERA_SIDE,
  },
];

/**
 * The plot's own coordinate space, which is not pixels.
 *
 * The svg scales to the width it is given, so these set the *aspect* and the units everything else
 * is expressed in. They doubled when the two projections stopped sitting side by side and each took
 * the full width of the page: at 520 x 380 stretched across 1400 px, every stroke and marker radius
 * was being blown up by 2.7x, so a 1 px line drew as nearly 3. Wider units keep the linework the
 * size it was designed at.
 *
 * The shape is deliberately landscape and flatter than before: the galaxy is 100 000 ly across and
 * about 2 000 thick, and the top view is the one anybody actually reads.
 */
export const VIEW_W = 1040;
export const VIEW_H = 560;
export const PAD = 28;

export interface CommanderPosition {
  position: { x: number; y: number; z: number } | null;
  system: string | null;
}

/**
 * The ship in the two coordinate systems the map needs at once.
 *
 * `x/y/z` are cell units, because that is what the plots are drawn in. `ly` is where the ship
 * actually is, which the sector drill-down needs — inside one 1 280 ly box, cell units are all the
 * same number.
 */
export interface CommanderCell {
  x: number;
  y: number;
  z: number;
  key: string;
  system: string | null;
  ly: { x: number; y: number; z: number };
}
