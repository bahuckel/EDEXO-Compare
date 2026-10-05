/**
 * Which boxels to fly for what (owner, 2026-10-05: "get people to do boxel searching depending on what
 * they are looking for … Looking for > Black holes > app points him to f, g, h mass boxels").
 *
 * The rates come from the Spansh dump (shared/boxelRates.ts): per mass code, the share of systems with
 * bodies known that hold the target, for every boxel or AA-A boxels only. The boxel names come from the
 * boxel's place in its sector: its letters and number are that place read in base 26,
 *
 *   position = L1 + 26·L2 + 676·L3 + 17576·N = x + 128·y + 16384·z
 *
 * with x, y, z the boxel's column, layer and row inside the sector at its mass code (0 … 2^(7−code)−1;
 * checked on 19,986 of 20,000 dump systems against their id64), so every boxel of a sector can be named
 * and placed without asking anyone.
 */
import { BOXEL_BIO_GOLDEN, BOXEL_BIO_RATES } from "./boxelBioRates.js";
import { BOXEL_RATES } from "./boxelRates.js";
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "./sectorName.js";

export const MASS_CODE_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type MassCode = (typeof MASS_CODE_LETTERS)[number];

export interface BoxelTarget {
  key: string;
  label: string;
  group: "Signals" | "Worlds" | "Stars" | "Genus" | "Species";
  /** Rates per 1,000 systems instead of a share (a count of bodies, not of systems). */
  perThousand?: boolean;
}

/** What a commander can look for; `key` is the study's metric (`star:X`: a star of that class anywhere in the system). */
export const BOXEL_TARGETS: readonly BoxelTarget[] = [
  { key: "bio", label: "Exobiology (biological signals)", group: "Signals" },
  { key: "geo", label: "Geology (geological signals)", group: "Signals" },
  { key: "elw", label: "Earth-like world", group: "Worlds" },
  { key: "ww", label: "Water world", group: "Worlds" },
  { key: "aw", label: "Ammonia world", group: "Worlds" },
  { key: "tf", label: "Terraformable", group: "Worlds" },
  { key: "heRich", label: "Helium-rich gas giant", group: "Worlds", perThousand: true },
  { key: "star:H", label: "Black hole", group: "Stars" },
  { key: "star:N", label: "Neutron star", group: "Stars" },
  { key: "star:D", label: "White dwarf", group: "Stars" },
  { key: "star:W", label: "Wolf-Rayet star", group: "Stars" },
  { key: "star:C", label: "Carbon star (C, CN, CJ, CH, CHd, CS, MS, S)", group: "Stars" },
  { key: "star:O", label: "O star", group: "Stars" },
  { key: "star:B", label: "B star", group: "Stars" },
  { key: "star:A", label: "A star", group: "Stars" },
  { key: "star:F", label: "F star", group: "Stars" },
  { key: "star:G", label: "G star", group: "Stars" },
  { key: "star:K", label: "K star", group: "Stars" },
  { key: "star:M", label: "M red dwarf", group: "Stars" },
  { key: "star:L", label: "L brown dwarf", group: "Stars" },
  { key: "star:T", label: "T brown dwarf", group: "Stars" },
  { key: "star:Y", label: "Y brown dwarf", group: "Stars" },
  { key: "star:TTS", label: "T Tauri star", group: "Stars" },
  { key: "star:AeBe", label: "Herbig Ae/Be star", group: "Stars" },
  { key: "star:SG", label: "Giant or supergiant", group: "Stars" },
];

/** The genera and species EDAstro's codex file has, as targets (their share is of systems with biology logged). */
export const BOXEL_BIO_TARGETS: readonly BoxelTarget[] = (() => {
  const keys = new Set<string>();
  for (const r of Object.values(BOXEL_BIO_RATES)) for (const k of Object.keys(r.all.hits)) keys.add(k);
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map(
      (key) =>
        ({
          key,
          label: key.slice(key.indexOf(":") + 1),
          group: key.startsWith("g:") ? "Genus" : "Species",
        }) as BoxelTarget,
    );
})();

export const ALL_BOXEL_TARGETS: readonly BoxelTarget[] = [...BOXEL_TARGETS, ...BOXEL_BIO_TARGETS];

export type BoxelLetters = "any" | "AA-A";

/** Under this many systems a rate is not shown: too few to say. */
export const MIN_SYSTEMS = 2000;
/** The same for systems with biology logged (EDAstro's codex file is smaller). */
export const MIN_BIO_SYSTEMS = 500;

export interface MassCodeRate {
  code: MassCode;
  /** Share of systems (0–1), or per 1,000 systems for a `perThousand` target. */
  rate: number;
  hits: number;
  systems: number;
}

/** One mass code's rate for a target, or null when the sample is too small (or AA-A for a body count). */
export function massCodeRate(
  code: MassCode,
  key: string,
  letters: BoxelLetters = "any",
): MassCodeRate | null {
  if (key.startsWith("g:") || key.startsWith("sp:")) {
    const b = BOXEL_BIO_RATES[code];
    const bc = b ? (letters === "AA-A" ? b.aaA : b.all) : null;
    if (!bc || bc.n < MIN_BIO_SYSTEMS) return null;
    const hits = bc.hits[key] ?? 0;
    return { code, rate: hits / bc.n, hits, systems: bc.n };
  }
  const r = BOXEL_RATES[code];
  if (!r) return null;
  const c = letters === "AA-A" ? r.aaA : r.all;
  if (c.n < MIN_SYSTEMS) return null;
  if (key === "heRich") {
    if (letters !== "any") return null;
    return { code, rate: (r.heliumRichBodies / c.n) * 1000, hits: r.heliumRichBodies, systems: c.n };
  }
  const hits = c.hits[key] ?? 0;
  return { code, rate: hits / c.n, hits, systems: c.n };
}

/** The mass codes for a target, best first (those with too few systems left out). */
export function rankMassCodes(key: string, letters: BoxelLetters = "any"): MassCodeRate[] {
  return MASS_CODE_LETTERS.map((c) => massCodeRate(c, key, letters))
    .filter((r): r is MassCodeRate => r != null)
    .sort((a, b) => b.rate - a.rate);
}

/** `7.3 %`, `1 in 83`, or `13.4 per 1,000`. */
export function formatBoxelRate(rate: number, perThousand = false): string {
  if (perThousand) return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)} per 1,000`;
  if (rate <= 0) return "none";
  if (rate >= 0.01) return `${(rate * 100).toFixed(1)} %`;
  return `1 in ${Math.round(1 / rate).toLocaleString("en")}`;
}

/* ---- naming and placing boxels ---------------------------------------------------------------- */

/** Boxels along each axis of a sector at a mass code (h: 1, g: 2 … a: 128). */
export function boxelsPerAxis(code: MassCode): number {
  return 1 << (7 - MASS_CODE_LETTERS.indexOf(code));
}

export function boxelCubeLy(code: MassCode): number {
  return SECTOR_SIZE_LY / boxelsPerAxis(code);
}

/** `AB-C d1` for a boxel position (the system names are `<sector> AB-C d1-<n>`). */
export function boxelNameAt(code: MassCode, position: number): string {
  const l1 = String.fromCharCode(65 + (position % 26));
  const l2 = String.fromCharCode(65 + (Math.floor(position / 26) % 26));
  const l3 = String.fromCharCode(65 + (Math.floor(position / 676) % 26));
  const n = Math.floor(position / 17576);
  return `${l1}${l2}-${l3} ${code}${n > 0 ? n : ""}`;
}

/** The position of a boxel name's letters and number (`AB-C d1` → …), or null. */
export function boxelPositionOf(boxel: string): number | null {
  const m = /^([A-Z])([A-Z])-([A-Z])\s+[a-h](\d+)?$/i.exec(boxel.trim());
  if (!m) return null;
  const v = (s: string) => s.toUpperCase().charCodeAt(0) - 65;
  return v(m[1]!) + 26 * v(m[2]!) + 676 * v(m[3]!) + 17576 * Number(m[4] ?? 0);
}

export interface SuggestedBoxel {
  boxel: string;
  position: number;
  /** The boxel's centre. */
  x: number;
  y: number;
  z: number;
  /** From the given point to the centre. */
  ly: number;
}

/** The corner of the sector a point is in. */
export function sectorCornerOf(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const f = (v: number, o: number) => o + Math.floor((v - o) / SECTOR_SIZE_LY) * SECTOR_SIZE_LY;
  return { x: f(p.x, SECTOR_ORIGIN.x), y: f(p.y, SECTOR_ORIGIN.y), z: f(p.z, SECTOR_ORIGIN.z) };
}

/**
 * The boxels of a mass code in the sector a point is in, nearest that point first. `AA-A` keeps the
 * boxels whose letters are AA-A: positions that are whole multiples of 17,576 — in d to h boxels only
 * the sector's corner boxel (position 0; any other multiple puts x past the sector's edge), in a to c a
 * few more (`AA-A c13` …).
 */
export function nearestBoxels(
  code: MassCode,
  point: { x: number; y: number; z: number },
  limit = 6,
  letters: BoxelLetters = "any",
): SuggestedBoxel[] {
  const per = boxelsPerAxis(code);
  const size = boxelCubeLy(code);
  const corner = sectorCornerOf(point);
  const at = (bx: number, by: number, bz: number): SuggestedBoxel => {
    const position = bx + 128 * by + 16384 * bz;
    const x = corner.x + (bx + 0.5) * size;
    const y = corner.y + (by + 0.5) * size;
    const z = corner.z + (bz + 0.5) * size;
    return {
      boxel: boxelNameAt(code, position),
      position,
      x,
      y,
      z,
      ly: Math.hypot(x - point.x, y - point.y, z - point.z),
    };
  };
  const out: SuggestedBoxel[] = [];
  if (letters === "AA-A") {
    for (let position = 0; ; position += 17576) {
      const bx = position % 128;
      const by = Math.floor(position / 128) % 128;
      const bz = Math.floor(position / 16384);
      if (bz >= per) break;
      if (bx < per && by < per) out.push(at(bx, by, bz));
    }
  } else {
    // A cube of boxels around the point's own, grown until it holds enough (a: 128³ in a sector).
    const clamp = (v: number) => Math.min(per - 1, Math.max(0, v));
    const cx = clamp(Math.floor((point.x - corner.x) / size));
    const cy = clamp(Math.floor((point.y - corner.y) / size));
    const cz = clamp(Math.floor((point.z - corner.z) / size));
    for (let r = 0; r < per && out.length < limit * 3; r++) {
      out.length = 0;
      for (let bx = clamp(cx - r); bx <= clamp(cx + r); bx++)
        for (let by = clamp(cy - r); by <= clamp(cy + r); by++)
          for (let bz = clamp(cz - r); bz <= clamp(cz + r); bz++) out.push(at(bx, by, bz));
      if (out.length >= per ** 3) break;
    }
  }
  return out.sort((a, b) => a.ly - b.ly).slice(0, limit);
}

export interface GoldenBoxel {
  code: MassCode;
  position: number;
  boxel: string;
  /** Share of systems with biology in boxels at this position, and in the rest of the mass code. */
  rate: number;
  rest: number;
  systems: number;
}

/**
 * The boxel positions where a genus or species is far more common than in the rest of its mass code
 * (the dump's golden list), best first.
 */
export function goldenBoxels(key: string): GoldenBoxel[] {
  return BOXEL_BIO_GOLDEN.filter((g) => g[0] === key)
    .map(([, code, position, systems, hits, rest]) => ({
      code: code as MassCode,
      position,
      boxel: boxelNameAt(code as MassCode, position),
      rate: hits / systems,
      rest,
      systems,
    }))
    .sort((a, b) => b.rate - a.rate);
}

/** A golden position's boxel in the sector a point is in, with its centre and distance. */
export function goldenInSector(g: GoldenBoxel, point: { x: number; y: number; z: number }): SuggestedBoxel {
  const size = boxelCubeLy(g.code);
  const corner = sectorCornerOf(point);
  const bx = g.position % 128;
  const by = Math.floor(g.position / 128) % 128;
  const bz = Math.floor(g.position / 16384);
  const x = corner.x + (bx + 0.5) * size;
  const y = corner.y + (by + 0.5) * size;
  const z = corner.z + (bz + 0.5) * size;
  return {
    boxel: g.boxel,
    position: g.position,
    x,
    y,
    z,
    ly: Math.hypot(x - point.x, y - point.y, z - point.z),
  };
}
