/**
 * Boxels (guild tester report, 2026-09-30: "boxel scanning — easy to use, the end system number if
 * known, full system lookups, possible predictions of discoveries").
 *
 * A procedurally named system says where it sits: `Eol Prou AB-C d1-23` is system 23 of boxel
 * `AB-C d1` in the Eol Prou sector. Boxel scanning is flying every system of one boxel, -0 upwards.
 * The mass code (the letter, a to h) says how big the boxel's cube is and, roughly, what its stars are.
 */

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

/** Cube size and a rule of thumb for what the mass code holds. */
export const MASS_CODES: Record<string, { cubeLy: number; hint: string }> = {
  a: { cubeLy: 10, hint: "the lightest: brown dwarfs and small M dwarfs" },
  b: { cubeLy: 20, hint: "mostly M red dwarfs" },
  c: { cubeLy: 40, hint: "K and M stars, some white dwarfs" },
  d: { cubeLy: 80, hint: "F, G and K stars: the common main sequence" },
  e: { cubeLy: 160, hint: "A and F stars, and giants" },
  f: { cubeLy: 320, hint: "B stars and bright giants" },
  g: { cubeLy: 640, hint: "O stars and supergiants" },
  h: { cubeLy: 1280, hint: "the heaviest: black holes and the largest stars" },
};

export interface BoxelRowDTO {
  n: number;
  name: string;
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
  /** Bodies he scanned across its flown systems, and the FSS totals of those systems when known. */
  bodiesScanned: number;
  bodiesTotal: number | null;
  /** Notable bodies found across its flown systems. */
  notable: number;
  /** The commander is in this boxel now. */
  current: boolean;
  total: number;
  /** The lowest system number neither flown nor skipped; null when the boxel is done. */
  next: string | null;
}
