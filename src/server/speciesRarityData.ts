/**
 * Species rarity and region counts — dynamic (owner, 2026-09-27: "make it dynamic, so if we add more
 * data for certain regions and so on, it can change"). The tier rules are in `shared/speciesRarity.ts`.
 *
 * Counts are added up from three places, and the tiers are worked out from the total every time it
 * changes, so a species can move up or down a tier and a region can start (or stop) counting it:
 *
 * 1. `data/rarity/species-rarity.json` — EDSM's codex dump, shipped (`docs/perf/build_species_rarity.py`).
 * 2. Extra count files, same shape, added on top: every `*.json` in `data/rarity/extra/` (data
 *    we ship later) and in `species-rarity-extra/` beside the user settings (anything a commander adds).
 * 3. The commander's own biological codex entries **newer than the dump** (`dumpUntil`): one per new
 *    system, per species and region. Older ones are already in EDSM's count and are not added twice.
 *
 * A missing shipped file is not an error: no species gets a tier and the matcher keeps the older
 * EDAstro region gate (`regionSpeciesData.ts`), exactly as before this existed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { regionJoinKey } from "../shared/regionMap.js";
import { codexSpeciesKey } from "../shared/codexLog.js";
import {
  judgeTierRegionalPresence,
  rarityTierFor,
  rarityTierForShare,
  regionalRarityFor,
  type RegionalRarity,
  type SpeciesRarity,
  type TierRegionVerdict,
} from "../shared/speciesRarity.js";
import { resolveUserSettingsJsonPath } from "./paths.js";

interface RarityFile {
  dumpUntil?: string;
  species: Record<string, { systems: number; regions: Record<string, number> }>;
}

interface Counts {
  species: Map<string, { systems: number; regions: Map<string, number> }>;
}

interface Loaded extends Counts {
  /** Region join key → its share of all species-system records (how explored it is). */
  regionShare: Map<string, number>;
  /** Region join key → all species-system records in it. */
  regionTotals: Map<string, number>;
  /** All species-system records, galaxy-wide. */
  all: number;
}

let base: { root: string; counts: Counts | null; dumpUntil: string } | null = null;
let merged: { signature: string; data: Loaded | null } | null = null;
/** Own sightings newer than the dump, as resolved species ids: `id|regionKey|system`. */
let overlay: { signature: string; rows: string[] } = { signature: "", rows: [] };

export function speciesRarityPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "rarity", "species-rarity.json");
}

function extraDirs(projectRoot: string): string[] {
  // Not under data/species/: the species loader reads every folder there as a genus.
  const dirs = [path.join(projectRoot, "data", "rarity", "extra")];
  try {
    dirs.push(path.join(path.dirname(resolveUserSettingsJsonPath()), "species-rarity-extra"));
  } catch {
    /* no user data folder in this context */
  }
  return dirs;
}

function addFile(into: Counts, file: RarityFile): void {
  for (const [id, row] of Object.entries(file.species ?? {})) {
    const cur = into.species.get(id) ?? { systems: 0, regions: new Map<string, number>() };
    cur.systems += Number.isFinite(row.systems) ? row.systems : 0;
    for (const [name, n] of Object.entries(row.regions ?? {})) {
      const k = regionJoinKey(name);
      cur.regions.set(k, (cur.regions.get(k) ?? 0) + (Number.isFinite(n) ? n : 0));
    }
    into.species.set(id, cur);
  }
}

function readJson(file: string): RarityFile | null {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as RarityFile;
    return j?.species && typeof j.species === "object" ? j : null;
  } catch {
    return null;
  }
}

function loadBase(projectRoot: string): { counts: Counts | null; dumpUntil: string } {
  if (base?.root === projectRoot) return base;
  const main = existsSync(speciesRarityPath(projectRoot)) ? readJson(speciesRarityPath(projectRoot)) : null;
  let counts: Counts | null = null;
  if (main) {
    counts = { species: new Map() };
    addFile(counts, main);
    for (const dir of extraDirs(projectRoot)) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)
        .filter((n) => n.toLowerCase().endsWith(".json"))
        .sort()) {
        const extra = readJson(path.join(dir, f));
        if (extra) addFile(counts, extra);
      }
    }
  }
  base = { root: projectRoot, counts, dumpUntil: main?.dumpUntil ?? "" };
  return base;
}

function data(projectRoot: string): Loaded | null {
  const b = loadBase(projectRoot);
  const signature = `${projectRoot}|${overlay.signature}`;
  if (merged?.signature === signature) return merged.data;
  let out: Loaded | null = null;
  if (b.counts) {
    const species = new Map<string, { systems: number; regions: Map<string, number> }>();
    for (const [id, row] of b.counts.species)
      species.set(id, { systems: row.systems, regions: new Map(row.regions) });
    // Each new system once per species galaxy-wide, and once per species and region.
    const galaxySeen = new Set<string>();
    for (const r of overlay.rows) {
      const [id, rk, sys] = r.split("|") as [string, string, string];
      const row = species.get(id);
      if (!row) continue;
      if (!galaxySeen.has(`${id}|${sys}`)) {
        galaxySeen.add(`${id}|${sys}`);
        row.systems += 1;
      }
      row.regions.set(rk, (row.regions.get(rk) ?? 0) + 1);
    }
    const regionTotals = new Map<string, number>();
    let all = 0;
    for (const row of species.values()) {
      for (const [k, n] of row.regions) {
        regionTotals.set(k, (regionTotals.get(k) ?? 0) + n);
        all += n;
      }
    }
    const regionShare = new Map<string, number>();
    for (const [k, n] of regionTotals) regionShare.set(k, all > 0 ? n / all : 0);
    out = { species, regionShare, regionTotals, all };
  }
  merged = { signature, data: out };
  return out;
}

/**
 * Our species id for a codex species key ("stratum tectonicas", "roseum brain tree", "luteolum
 * anemone", "amphora plants"), given the database's display names.
 */
export function speciesIdForCodexKey(key: string, byName: ReadonlyMap<string, string>): string | null {
  const k = key.replace(/^bacteria /, "bacterium ");
  const direct = byName.get(k);
  if (direct) return direct;
  const m = /^(\w+) (brain tree|sinuous tubers)$/.exec(k);
  if (m) return byName.get(`${m[2]} ${m[1]}`) ?? null;
  if (k === "amphora plants") return byName.get("amphora plant") ?? null;
  return null;
}

/**
 * Feed the commander's biological codex sightings in (`GameStateStore.codexSightings`). Only those
 * newer than the dump count; the rest are already in EDSM's numbers. Cheap to call on every snapshot:
 * nothing is recomputed unless the sightings changed. Returns true when the counts changed.
 */
export function syncRaritySightings(
  projectRoot: string,
  sightings: ReadonlyMap<string, string>,
  species: readonly { id: string; displayName: string }[],
): boolean {
  const { dumpUntil } = loadBase(projectRoot);
  const signature = `${sightings.size}|${dumpUntil}|${species.length}`;
  if (signature === overlay.signature) return false;
  const byName = new Map(species.map((s) => [codexSpeciesKey(s.displayName), s.id]));
  const rows: string[] = [];
  for (const [k, ts] of sightings) {
    if (dumpUntil && ts <= dumpUntil) continue;
    const [key, rk, sys] = k.split("|") as [string, string, string];
    const id = speciesIdForCodexKey(key, byName);
    if (id) rows.push(`${id}|${rk}|${sys}`);
  }
  const changed = rows.join("\n") !== overlay.rows.join("\n");
  overlay = { signature, rows };
  return changed;
}

/*
 * The badge's share of bodies (owner, 2026-09-27): `data/rarity/body-share.json`, built by
 * docs/perf/build_body_rarity.py from the Spansh dump's DSS-mapped bio bodies × the codex. Per species:
 * its planet types, and galaxy-wide and per region the share of those bio bodies carrying it.
 */
interface BodyShare {
  share: number;
  bodies: number;
  of: number;
}
let bodyShare: {
  root: string;
  data: Map<string, { galaxy: BodyShare; regions: Map<string, BodyShare> }> | null;
} | null = null;

export function bodySharePath(projectRoot: string): string {
  return path.join(projectRoot, "data", "rarity", "body-share.json");
}

function loadBodyShare(projectRoot: string) {
  if (bodyShare?.root === projectRoot) return bodyShare.data;
  let out: Map<string, { galaxy: BodyShare; regions: Map<string, BodyShare> }> | null = null;
  try {
    const f = bodySharePath(projectRoot);
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8")) as {
        species?: Record<string, { galaxy: BodyShare; regions?: Record<string, BodyShare> }>;
      };
      out = new Map();
      for (const [id, row] of Object.entries(j.species ?? {})) {
        const regions = new Map<string, BodyShare>();
        for (const [name, v] of Object.entries(row.regions ?? {})) regions.set(regionJoinKey(name), v);
        out.set(id, { galaxy: row.galaxy, regions });
      }
    }
  } catch {
    out = null;
  }
  bodyShare = { root: projectRoot, data: out };
  return out;
}

/** Drop everything (Refresh exomastery re-reads the files; tests). */
export function clearSpeciesRarityCache(): void {
  bodyShare = null;
  base = null;
  merged = null;
  overlay = { signature: "", rows: [] };
}

/** A species' tier, or null when the data does not know it. */
export function speciesRarity(projectRoot: string, speciesId: string): SpeciesRarity | null {
  const row = data(projectRoot)?.species.get(speciesId);
  if (!row) return null;
  const share = loadBodyShare(projectRoot)?.get(speciesId)?.galaxy.share;
  return typeof share === "number"
    ? { tier: rarityTierForShare(share), systems: row.systems, share }
    : { tier: rarityTierFor(row.systems), systems: row.systems };
}

/** The tier rule's verdict for one species in one region (by name, any spelling), or null when unknown. */
export function tierRegionalPresence(
  projectRoot: string,
  regionName: string | null | undefined,
  speciesId: string,
): TierRegionVerdict | null {
  if (!regionName) return null;
  const d = data(projectRoot);
  const row = d?.species.get(speciesId);
  if (!d || !row) return null;
  const k = regionJoinKey(regionName);
  const share = d.regionShare.get(k);
  if (share === undefined) return null;
  return judgeTierRegionalPresence(row.systems, row.regions.get(k) ?? 0, share);
}

/**
 * A species' tier in one region (by name, any spelling), or null when the data does not know it:
 * found by the system counts (its region limit), tiered by the share of bodies there.
 */
export function regionalRarity(
  projectRoot: string,
  regionName: string | null | undefined,
  speciesId: string,
): RegionalRarity | null {
  if (!regionName) return null;
  const d = data(projectRoot);
  const row = d?.species.get(speciesId);
  if (!d || !row) return null;
  const k = regionJoinKey(regionName);
  if (!d.regionTotals.has(k)) return null;
  const body = loadBodyShare(projectRoot)?.get(speciesId)?.regions.get(k) ?? null;
  return regionalRarityFor(regionName, row.regions.get(k) ?? 0, row.systems, body);
}
