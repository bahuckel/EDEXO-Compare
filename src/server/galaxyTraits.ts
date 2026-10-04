/**
 * The galaxy map's filters (owner, 2026-10-04, overnight Q14): "Star Type, Planet Type" and the exobio
 * genera, shop style, and the systems that have the thing lit while the rest dim or go.
 *
 * The answer is a **bitset over bio-index ordinals** — the number every point on the map already
 * carries (overview point k is ordinal k × stride, a tile point names its own) — so the client can mark
 * its points without a second list of systems. 5.3 M systems are 660 kB of bits.
 *
 * Facets combine the way a shop's do: any of the ticks inside one facet, all of the facets that have a
 * tick. Exobio (genera and species), main star, stars present, planet types, features.
 *
 * Star and body traits come from `data/galaxy/system-traits.bin.gz` (scripts/build-system-traits.ts).
 * Without it the Bodies tab says so and only exobio filters.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { loadBioIndex, type BioIndex } from "./bioIndex.js";
import { getProjectRoot } from "./paths.js";
import { BODY_TRAITS, STAR_CLASSES } from "../shared/galaxyTraits.js";

export const TRAITS_MAGIC = "EDXTRT01";

export interface SystemTraits {
  count: number;
  /** Main star class per ordinal (STAR_CLASSES index, 255 = not recorded). */
  main: Uint8Array;
  /** Star classes present per ordinal (bit per STAR_CLASSES). */
  stars: Uint32Array;
  /** Planet classes and features present per ordinal (bit per BODY_TRAITS). */
  bodies: Uint32Array;
}

export function systemTraitsPath(projectRoot = getProjectRoot()): string {
  return path.join(projectRoot, "data", "galaxy", "system-traits.bin.gz");
}

/** Read a traits buffer (already gunzipped). Throws on a wrong magic or a short file. */
export function parseSystemTraits(raw: Buffer): SystemTraits {
  if (raw.toString("ascii", 0, 8) !== TRAITS_MAGIC) throw new Error("not a system-traits file");
  const count = raw.readUInt32LE(8);
  const pad = (12 + count) % 4 ? 4 - ((12 + count) % 4) : 0;
  const starsAt = 12 + count + pad;
  if (raw.length < starsAt + count * 8) throw new Error("system-traits file is short");
  // Copied out of the (possibly unaligned) Buffer pool into arrays of their own.
  const main = new Uint8Array(raw.subarray(12, 12 + count));
  const stars = new Uint32Array(count);
  const bodies = new Uint32Array(count);
  Buffer.from(stars.buffer).set(raw.subarray(starsAt, starsAt + count * 4));
  Buffer.from(bodies.buffer).set(raw.subarray(starsAt + count * 4, starsAt + count * 8));
  return { count, main, stars, bodies };
}

let cached: SystemTraits | null | undefined;

/** The traits, or null on a build without the file. Read once and held. */
export function loadSystemTraits(file = systemTraitsPath()): SystemTraits | null {
  if (cached !== undefined) return cached;
  if (!existsSync(file)) return (cached = null);
  try {
    cached = parseSystemTraits(gunzipSync(readFileSync(file)));
  } catch (e) {
    console.warn(`ED Exo Compare — system traits unreadable, continuing without them: ${String(e)}`);
    cached = null;
  }
  return cached;
}

/** Let the 48 MB go when the map has been idle (galaxyMemory.ts); the next use reads it again. */
export function clearSystemTraits(): void {
  cached = undefined;
  countsCache = null;
}

/** Test seam. */
export function setSystemTraitsForTest(t: SystemTraits | null | undefined): void {
  cached = t;
  countsCache = null;
}

export interface GalaxyFilter {
  /** Species ids (bio-index ids). */
  species?: string[];
  /** Genus data dirs: every species of the genus. */
  genera?: string[];
  /** Main star class keys (STAR_CLASSES). */
  mainStars?: string[];
  /** Star class keys present anywhere in the system. */
  stars?: string[];
  /** Planet class keys (BODY_TRAITS, the planet part). */
  planets?: string[];
  /** Feature keys (BODY_TRAITS, the feature part). */
  features?: string[];
}

const bitsOf = (list: readonly { key: string }[], keys: string[] | undefined): number => {
  let m = 0;
  for (const k of keys ?? []) {
    const i = list.findIndex((t) => t.key === k);
    if (i >= 0) m |= 1 << i;
  }
  return m >>> 0;
};

/**
 * Which ordinals pass the filter, as bits (ordinal i is bit i & 7 of byte i >> 3). `matched` counts
 * them. An empty filter passes nothing — the caller should not ask.
 *
 * `speciesGenus` maps a bio-index species id to its genus dir, for the genus ticks.
 */
export function galaxyFilterMask(
  filter: GalaxyFilter,
  index: Pick<BioIndex, "systemCount" | "species" | "forEachRegionSpecies">,
  traits: SystemTraits | null,
  speciesGenus: (speciesId: string) => string | null,
): { bits: Uint8Array; matched: number } {
  const n = index.systemCount;
  const bits = new Uint8Array((n + 7) >> 3);
  const wantedSpecies = new Set<number>();
  const genera = new Set(filter.genera ?? []);
  const species = new Set(filter.species ?? []);
  index.species.forEach((id, i) => {
    const g = speciesGenus(id);
    if (species.has(id) || (g != null && genera.has(g))) wantedSpecies.add(i);
  });
  const exobio = genera.size + species.size > 0;
  // A tick that names nothing in the index (a genus nobody recorded) still narrows to nothing.
  let bio: Uint8Array | null = null;
  if (exobio) {
    bio = new Uint8Array(n);
    if (wantedSpecies.size)
      index.forEachRegionSpecies((i, _r, s) => {
        if (s >= 0 && wantedSpecies.has(s)) bio![i] = 1;
      });
  }
  const mainMask = bitsOf(STAR_CLASSES, filter.mainStars);
  const starMask = bitsOf(STAR_CLASSES, filter.stars);
  const planetMask = bitsOf(BODY_TRAITS, filter.planets);
  const featureMask = bitsOf(BODY_TRAITS, filter.features);
  const wantsTraits = mainMask || starMask || planetMask || featureMask;
  if (!exobio && !wantsTraits) return { bits, matched: 0 };
  if (wantsTraits && (!traits || traits.count !== n)) return { bits, matched: 0 };
  let matched = 0;
  for (let i = 0; i < n; i++) {
    if (bio && !bio[i]) continue;
    if (traits && wantsTraits) {
      if (mainMask && (traits.main[i] === 255 || !((mainMask >>> traits.main[i]!) & 1))) continue;
      if (starMask && !(traits.stars[i]! & starMask)) continue;
      if (planetMask && !(traits.bodies[i]! & planetMask)) continue;
      if (featureMask && !(traits.bodies[i]! & featureMask)) continue;
    }
    bits[i >> 3]! |= 1 << (i & 7);
    matched++;
  }
  return { bits, matched };
}

/**
 * How many systems hold each trait, for the picker's counts. Computed once per process (a 5 M pass,
 * ~60 ms) and held.
 */
let countsCache: { main: number[]; stars: number[]; bodies: number[] } | null = null;
export function systemTraitCounts(traits: SystemTraits): { main: number[]; stars: number[]; bodies: number[] } {
  if (countsCache) return countsCache;
  const main = new Array<number>(STAR_CLASSES.length).fill(0);
  const stars = new Array<number>(STAR_CLASSES.length).fill(0);
  const bodies = new Array<number>(BODY_TRAITS.length).fill(0);
  for (let i = 0; i < traits.count; i++) {
    const m = traits.main[i]!;
    if (m < main.length) main[m]! += 1;
    const s = traits.stars[i]!;
    if (s) for (let b = 0; b < stars.length; b++) if ((s >>> b) & 1) stars[b]! += 1;
    const t = traits.bodies[i]!;
    if (t) for (let b = 0; b < bodies.length; b++) if ((t >>> b) & 1) bodies[b]! += 1;
  }
  countsCache = { main, stars, bodies };
  return countsCache;
}

/** The index the map plots, for the route. */
export function galaxyFilterIndex(): BioIndex | null {
  return loadBioIndex();
}
