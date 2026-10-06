/**
 * Boxels (guild tester report, 2026-09-30: "boxel scanning — easy to use, the end system number if
 * known, full system lookups, possible predictions of discoveries").
 *
 * A procedurally named system says where it sits: `Eol Prou AB-C d1-23` is system 23 of boxel
 * `AB-C d1` in the Eol Prou sector. Boxel scanning is flying every system of one boxel, -0 upwards.
 * The mass code (the letter, a to h) says how big the boxel's cube is and, roughly, what its stars are.
 */
import type { NotableKind } from "./notices.js";

export interface BoxelName {
  sector: string;
  /** `AB-C d1` */
  boxel: string;
  massCode: string;
  /** Every system of the boxel is `${prefix}${n}`. */
  prefix: string;
  /** The system number, when a whole system name was given. */
  index: number | null;
}

const PROCGEN = /^(.*\S)\s+([A-Z]{2}-[A-Z])\s+([a-h])(?:(\d+)-)?(\d+)?$/i;

/**
 * Any system of a boxel, or the boxel itself (`… AB-C d1-` or `… AB-C d1-0`), → the boxel. Null for a
 * catalogue name (HIP 1234, Sol), which belongs to no boxel.
 */
export function parseBoxel(raw: string): BoxelName | null {
  const s = raw.trim().replace(/-$/, "-0");
  const m = PROCGEN.exec(s);
  if (!m) return null;
  const [, sector, letters, mass, n1, n2] = m;
  const L = letters!.toUpperCase();
  const code = mass!.toLowerCase();
  // `d1-23`: boxel 1, system 23. `d23`: boxel 0 (the number is left out), system 23.
  const boxel = n1 !== undefined ? `${L} ${code}${n1}` : `${L} ${code}`;
  return {
    sector: sector!,
    boxel,
    massCode: code,
    prefix: n1 !== undefined ? `${sector} ${L} ${code}${n1}-` : `${sector} ${L} ${code}`,
    index: n2 !== undefined ? Number(n2) : null,
  };
}

/** The boxel's system number of a name, or null when the name is not in that boxel. */
export function boxelIndexOf(name: string, prefix: string): number | null {
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = name.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

/**
 * Cube size and what the mass code's main stars are, as measured on the Spansh dump (2026-10-05,
 * shared/boxelRates.ts; the old rules of thumb had e, f and h wrong).
 */
export const MASS_CODES: Record<string, { cubeLy: number; hint: string }> = {
  a: { cubeLy: 10, hint: "brown dwarfs (T, Y and L: 91 % of main stars)" },
  b: { cubeLy: 20, hint: "M red dwarfs (95 %)" },
  c: { cubeLy: 40, hint: "K stars (73 %), some G and M" },
  d: { cubeLy: 80, hint: "F and A stars, some G, and neutron stars (13 %)" },
  e: { cubeLy: 160, hint: "B stars (51 %) and neutron stars (27 %)" },
  f: { cubeLy: 320, hint: "black holes (51 %) and B stars (31 %)" },
  g: { cubeLy: 640, hint: "O stars (42 %) and black holes (40 %)" },
  h: { cubeLy: 1280, hint: "black holes (44 %) and Wolf-Rayet stars (26 %)" },
};

export interface BoxelRowDTO {
  n: number;
  name: string;
  /** Visited and the journals gave its address. */
  systemAddress?: number;
  /** In the commander's journals. */
  visited: boolean;
  /** Visited: bodies he scanned there, of the FSS body count when known ("15/15"). */
  bodies?: { scanned: number; total: number | null };
  /** Visited: how many notable bodies the Notable card finds there. */
  notable?: number;
  /** In the galaxy index (EDSM / Spansh records): what grows there, as far as anyone logged. */
  known: {
    species: string[];
    bodyCount: number;
    /** Biological signals were seen there (an FSS or DSS), whether or not a species was logged. */
    signals: boolean;
  } | null;
}

export interface BoxelDTO {
  query: string;
  sector: string;
  boxel: string;
  massCode: string;
  cubeLy: number;
  massHint: string;
  prefix: string;
  /** The last system number listed: what was asked for, else the highest seen. */
  end: number;
  rows: BoxelRowDTO[];
  visitedCount: number;
  knownCount: number;
  /** The species recorded most often in this boxel: what the rest may hold. */
  common: { name: string; systems: number }[];
  /** The lowest system number not yet visited. */
  nextUnvisited: string | null;
  /** The galaxy index is not loaded on this machine (no galaxy data): only the journals were read. */
  noIndex: boolean;
}

/**
 * A boxel the commander is scanning (owner, 2026-09-30): he types its last system, the app lists -0
 * up to it and ticks off the ones he has flown as he goes. Kept in `edexo-boxels.json`.
 */
export interface SavedBoxelDTO {
  id: string;
  /** The name he typed, e.g. `Eol Prou AB-C d1-57`. */
  lastSystem: string;
  sector: string;
  boxel: string;
  prefix: string;
  /** The last system number: -0 to this. */
  end: number;
  addedAt: string;
  /** Systems -0..end in his journals. */
  flown: number;
  /** System numbers he marked skipped (not flown, still counted as done). */
  skipped: number[];
  /** Systems past `end` that he has flown: the boxel goes further than the end he typed. */
  flownBeyond: number[];
  /**
   * Systems -0..end not flown that a route he plotted passes through (NavRoute.json, kept by the
   * NavRoute finder): they exist, as far as the game's own plotter knows.
   */
  routed?: number;
  /** He checked in the galaxy map that the next system does not exist: `end` is the boxel's last. */
  endKnown?: boolean;
  /** The system to search for in the galaxy map to find out whether the boxel goes on; null once known. */
  probe?: string | null;
  /** Bodies he scanned across its flown systems, and the FSS totals of those systems when known. */
  bodiesScanned: number;
  bodiesTotal: number | null;
  /** Notable bodies found across its flown systems. */
  notable: number;
  /** The commander is in this boxel now. */
  current: boolean;
  /** The boxel run (start / finish key): its next system is copied after every jump. */
  run?: boolean;
  total: number;
  /** The lowest system number neither flown nor skipped; null when the boxel is done. */
  next: string | null;
}

/** A notable body kind there and how many (null: the galaxy index says "at least one"). */
export interface BoxelNotableDTO {
  kind: NotableKind;
  n: number | null;
}

/**
 * One row of the Boxels screen (owner, 2026-10-05: "like My discoveries", every ticked boxel in one
 * table): a system of one saved boxel.
 *
 * Flown systems are read from the journals; the others from the galaxy index, which keeps every star
 * class (no luminosity) but only the bodies that matter for biology — so it has no Class I–V and no
 * Helium gas giants, and green / Helium gas giants come only from the journals (or a look-up).
 */
export interface BoxelTableRowDTO {
  boxelId: string;
  /** `AB-C d1` */
  boxel: string;
  sector: string;
  n: number;
  name: string;
  flown: boolean;
  /** Marked skipped in the saved boxel (not flown, counted as done). */
  skipped: boolean;
  /** When he last arrived there (journals). */
  visitedAt: string | null;
  /** Its address: from the journals when flown, else Spansh's id64 from a look-up; null when unknown. */
  systemAddress: number | null;
  /**
   * Where the facts come from: your journals, the galaxy index, a Spansh look-up, a route you plotted
   * (its main star class only), or nothing yet.
   */
  from: "journal" | "index" | "lookup" | "route" | null;
  /** Not flown, but a route he plotted passes through it (or he targeted it in the galaxy map). */
  onRoute?: boolean;
  /**
   * Nothing recorded about it, but a higher system of the boxel is known: systems are numbered from 0
   * without gaps for mass codes a-g (h boxels have gaps), so it exists — nobody has recorded it yet.
   */
  gap?: boolean;
  /** The boxel was looked up on Spansh and this system is not there: undiscovered, as far as anyone uploaded. */
  notOnSpansh?: boolean;
  /** "K5 V" from a scan, "K" from the index or the jump. */
  mainStar: string | null;
  otherStars: string[];
  /** STAR_CLASSES keys of every star, main first (the Star type filter). */
  starClasses: string[];
  /** Flown: bodies scanned of the FSS count; index: its body count (scanned null). */
  bodies: { scanned: number | null; total: number | null } | null;
  notables: BoxelNotableDTO[];
  /** BODY_TRAITS keys present (the Body type filter). */
  bodyTypes: string[];
  /** Biology signals (null: not counted), whether any were seen, and the species logged there. */
  bio: { signals: number | null; seen: boolean; species: string[] } | null;
}

export interface BoxelTableDTO {
  /** The ticked boxels, in the side menu's order. */
  boxels: SavedBoxelDTO[];
  rows: BoxelTableRowDTO[];
  /** The species recorded most often across the ticked boxels. */
  common: { name: string; systems: number }[];
  noIndex: boolean;
  /** The ticked boxels looked up on Spansh: when, and whether every page was read. */
  lookups: { boxelId: string; fetchedAt: string; complete: boolean; systems: number; highest: number }[];
}

/**
 * A boxel the commander flew through (owner, 2026-10-05, "Previous systems in your paths"): every one
 * the journals know, with what made it promising, notable ones first, and a Keep to save it.
 */
export interface PreviousBoxelDTO {
  prefix: string;
  boxel: string;
  sector: string;
  /** Systems of it he has flown, and the highest number among them. */
  flown: number;
  highest: number;
  /** When he was last in it. */
  lastVisit: string | null;
  /** The system he was last in there: Keep saves the boxel from it. */
  lastSystem: string;
  notables: BoxelNotableDTO[];
  bioSignals: number;
  species: string[];
  /** Star classes worth a return (STAR_CLASSES keys): O, B, Wolf-Rayet, carbon, neutron, black hole, Herbig, giants. */
  rareStars: string[];
  /** How promising, for the order: notables, rare stars and species. */
  score: number;
  /** Already one of his saved boxels. */
  saved: boolean;
}

/** A Spansh look-up of a boxel in progress, or the last one's outcome (server/boxelLookup.ts). */
export interface BoxelLookupStatus {
  prefix: string;
  boxel: string;
  running: boolean;
  pages: number;
  systems: number;
  note: string | null;
}
