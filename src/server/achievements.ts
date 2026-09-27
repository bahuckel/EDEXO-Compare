/**
 * Achievements (owner, 2026-09-27) — the catalogue, the commander's progress, and the tracked one.
 *
 * The catalogue is EDSM's codex dump per region (`data/codex/edsm-codex-regions.json`, the Codex map's
 * file): the plant entries found in each region, with the rarity tiers from `speciesRarityData.ts`,
 * and the star and world entries for the non-exobiology sets (2026-09-28). The Sights sets come from
 * the EDAstro points-of-interest file, when the commander has downloaded it.
 *
 * Progress is all journal: `GameStateStore.achievementDone` (plants), `codexMapLogged` (stars,
 * worlds), `visitedSystems` (sights). The rules and the set shapes are in `shared/achievements.ts`;
 * the names he chose are in `data/achievements/names.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  achievementDto,
  achievementEntries,
  achievementProgress,
  buildAchievementSets,
  isEntryDone,
  plantEntry,
  systemNameKey,
  type AchievementProgress,
  type AchievementSet,
  type PlantEntry,
} from "../shared/achievements.js";
import { codexSpeciesKey } from "../shared/codexLog.js";
import { regionJoinKey } from "../shared/regionMap.js";
import type {
  AchievementAdvanceDTO,
  AchievementDetailDTO,
  AchievementsDTO,
  TrackedAchievementDTO,
} from "../shared/types.js";
import { codexRegionsData } from "./codexMap.js";
import { poiRecords, readPoiStatus, type PoiRecord } from "./edastroPoi.js";
import { matchCacheEpoch } from "./matchCacheEpoch.js";
import { regionForSystem } from "./regionMapData.js";
import { regionalRarity, speciesIdForCodexKey, speciesRarity } from "./speciesRarityData.js";

export interface AchievementStoreView {
  achievementDone: ReadonlyMap<string, string>;
  trackedAchievementId: string | null;
  commanderPos: { x: number; y: number; z: number } | null;
  /** Every codex entry, any category: `regionJoinKey|entryKey`. */
  codexMapLogged?: ReadonlySet<string>;
  /** System address → name, every system arrived in. */
  visitedSystems?: ReadonlyMap<number, string>;
}

type SpeciesList = readonly { id: string; displayName: string }[];

interface Catalogue {
  signature: string;
  source: string;
  entries: Map<string, PlantEntry>;
  sets: AchievementSet[];
  byId: Map<string, AchievementSet>;
  /** Our species id → its plant entries. */
  bySpecies: Map<string, PlantEntry[]>;
  regionNames: Map<string, string>;
  /** Sight key (system name) → where it is, for the tracked set's distances. */
  poiCoords: Map<string, { x: number; y: number; z: number }>;
  poiData: boolean;
}

let memo: Catalogue | null = null;
let names: { root: string; value: Record<string, string> } | null = null;

export function achievementNamesPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "achievements", "names.json");
}

function loadNames(projectRoot: string): Record<string, string> {
  if (names?.root === projectRoot) return names.value;
  let value: Record<string, string> = {};
  try {
    const f = achievementNamesPath(projectRoot);
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) if (!k.startsWith("_") && typeof v === "string") value[k] = v;
    }
  } catch {
    value = {};
  }
  names = { root: projectRoot, value };
  return value;
}

/** Refresh exomastery / tests: re-read the names and rebuild the sets. */
export function clearAchievementsCache(): void {
  memo = null;
  names = null;
}

/** GEC names arrive HTML-escaped ("Icarus&#39; Cradle"). */
function decodeEntities(t: string): string {
  return t
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** How many sights a region's set holds (owner: "4-5 in every galactic region"). */
export const SIGHTS_PER_REGION = 5;

/**
 * The points of interest for each region's Sights set: planetary and stellar ones with a system to
 * fly to, best rated first, three planetary and two stellar where the region has them, one per
 * system. Stable for a given file, so progress does not wander between refreshes.
 */
export function chooseRegionSights(
  rows: readonly PoiRecord[],
  regionOf: (r: PoiRecord) => string,
): Map<string, PoiRecord[]> {
  const byRegion = new Map<string, PoiRecord[]>();
  for (const r of rows) {
    if ((r.group !== "planetary" && r.group !== "stellar") || !r.system.trim()) continue;
    const rk = regionOf(r);
    if (!rk) continue;
    const list = byRegion.get(rk) ?? [];
    list.push(r);
    byRegion.set(rk, list);
  }
  const rank = (a: PoiRecord, b: PoiRecord) =>
    (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  const out = new Map<string, PoiRecord[]>();
  for (const [rk, list] of byRegion) {
    const picked: PoiRecord[] = [];
    const systems = new Set<string>();
    const take = (r: PoiRecord) => {
      const sk = systemNameKey(r.system);
      if (picked.length >= SIGHTS_PER_REGION || systems.has(sk)) return;
      systems.add(sk);
      picked.push(r);
    };
    const planetary = list.filter((r) => r.group === "planetary").sort(rank);
    const stellar = list.filter((r) => r.group === "stellar").sort(rank);
    planetary.slice(0, 3).forEach(take);
    stellar.slice(0, 2).forEach(take);
    [...list].sort(rank).forEach(take);
    out.set(rk, picked);
  }
  return out;
}

function catalogue(
  projectRoot: string,
  done: ReadonlyMap<string, string>,
  species: SpeciesList,
): Catalogue | null {
  const data = codexRegionsData(projectRoot);
  if (!data) return null;
  const poi = readPoiStatus();
  // Completions add entries to region sets (done there = found there), so their count is in the key;
  // so is the POI file, which the commander can download at any time.
  const signature = `${projectRoot}|${done.size}|${matchCacheEpoch()}|${species.length}|${poi.haveData ? poi.fetchedAtMs : "-"}`;
  if (memo?.signature === signature) return memo;

  const entries = new Map<string, PlantEntry>();
  const typeIndex: (string | null)[] = [];
  const bodyIndex: (string | null)[] = [];
  for (const [key, name, kind] of data.types) {
    const e = kind === "bio" ? plantEntry(key, name) : null;
    if (e) entries.set(e.key, e);
    typeIndex.push(e ? e.key : null);
    bodyIndex.push(kind === "bodies" ? key.toLowerCase() : null);
  }

  const byName = new Map(species.map((s) => [codexSpeciesKey(s.displayName), s.id]));
  const speciesOf = new Map<string, string | null>();
  const bySpecies = new Map<string, PlantEntry[]>();
  for (const e of entries.values()) {
    const id = speciesIdForCodexKey(codexSpeciesKey(e.name), byName);
    speciesOf.set(e.key, id);
    if (!id) continue;
    const list = bySpecies.get(id) ?? [];
    list.push(e);
    bySpecies.set(id, list);
  }

  const regionNames = new Map<string, string>();
  const regionBodies = new Map<string, Set<string>>();
  const regions = Object.keys(data.regions)
    .sort()
    .map((name) => {
      const key = regionJoinKey(name);
      regionNames.set(key, name);
      const found = new Set<string>();
      for (const row of data.regions[name]?.bio ?? []) {
        for (const i of row[4]) {
          const k = typeIndex[i];
          if (k) found.add(k);
        }
      }
      const bodies = new Set<string>();
      for (const row of data.regions[name]?.bodies ?? []) {
        for (const i of row[4]) {
          const k = bodyIndex[i];
          if (k) bodies.add(k);
        }
      }
      regionBodies.set(key, bodies);
      return { name, key, entries: found };
    });

  const poiCoords = new Map<string, { x: number; y: number; z: number }>();
  let regionPois: Map<string, { key: string; label: string; hint: string }[]> | null = null;
  if (poi.haveData) {
    const chosen = chooseRegionSights(poiRecords(), (r) =>
      regionJoinKey(regionForSystem(projectRoot, r.x, r.y, r.z) ?? r.region),
    );
    regionPois = new Map();
    for (const [rk, list] of chosen) {
      regionPois.set(
        rk,
        list.map((r) => {
          const key = systemNameKey(r.system);
          poiCoords.set(key, { x: r.x, y: r.y, z: r.z });
          return { key, label: decodeEntities(r.name || r.system), hint: `${r.system} · ${r.typeLabel}` };
        }),
      );
    }
  }

  const sets = buildAchievementSets({
    entries,
    regions,
    done,
    names: loadNames(projectRoot),
    regionBodies,
    regionPois,
    galaxyTier: (k) => {
      const id = speciesOf.get(k);
      return id ? (speciesRarity(projectRoot, id)?.tier ?? null) : null;
    },
    regionTier: (region, k) => {
      const id = speciesOf.get(k);
      const r = id ? regionalRarity(projectRoot, region, id) : null;
      return r ? { found: r.found, ...(r.tier ? { tier: r.tier } : {}) } : null;
    },
  });
  memo = {
    signature,
    source: data.source.note,
    entries,
    sets,
    byId: new Map(sets.map((s) => [s.id, s])),
    bySpecies,
    regionNames,
    poiCoords,
    poiData: poi.haveData,
  };
  return memo;
}

let visitedMemo: { from: ReadonlyMap<number, string>; size: number; value: Set<string> } | null = null;

/** Everything the sets read progress from, off the store. */
export function progressOf(store: AchievementStoreView): AchievementProgress {
  const v = store.visitedSystems;
  let visited: Set<string> = new Set();
  if (v) {
    if (visitedMemo?.from !== v || visitedMemo.size !== v.size) {
      visitedMemo = { from: v, size: v.size, value: new Set([...v.values()].map(systemNameKey)) };
    }
    visited = visitedMemo.value;
  }
  return achievementProgress(store.achievementDone, store.codexMapLogged ?? new Set(), visited);
}

function currentRegionKey(projectRoot: string, store: AchievementStoreView): string | null {
  const p = store.commanderPos;
  if (!p) return null;
  const k = regionJoinKey(regionForSystem(projectRoot, p.x, p.y, p.z));
  return k || null;
}

export function achievementsList(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
): AchievementsDTO {
  const c = catalogue(projectRoot, store.achievementDone, species);
  if (!c) {
    return {
      available: false,
      achievements: [],
      trackedId: null,
      currentRegion: null,
      poiData: false,
      source: "",
    };
  }
  const p = progressOf(store);
  return {
    available: true,
    achievements: c.sets.map((s) => achievementDto(s, p)),
    trackedId:
      store.trackedAchievementId && c.byId.has(store.trackedAchievementId)
        ? store.trackedAchievementId
        : null,
    currentRegion: currentRegionKey(projectRoot, store),
    poiData: c.poiData,
    source: c.source,
  };
}

export function achievementDetail(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
  id: string,
): AchievementDetailDTO | null {
  const c = catalogue(projectRoot, store.achievementDone, species);
  const set = c?.byId.get(id);
  if (!c || !set) return null;
  const p = progressOf(store);
  return {
    achievement: achievementDto(set, p),
    entries: achievementEntries(set, c.entries, p, (k) => c.regionNames.get(k) ?? k),
  };
}

/** Is this a real achievement id (for the track endpoint)? */
export function achievementExists(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
  id: string,
): boolean {
  return !!catalogue(projectRoot, store.achievementDone, species)?.byId.has(id);
}

/**
 * The colours in a row's label that pick out one of a species' entries. A sampled variant is "Genus
 * Species - Colour"; a legacy one is its own species name ("Luteolum Anemone"), matched on its first
 * word. No usable label means every entry of the species could be the one growing here.
 */
function entriesForLabel(list: readonly PlantEntry[], colourLabel: string | null | undefined): PlantEntry[] {
  const label = (colourLabel ?? "").trim();
  if (!label || label.startsWith("(") || list.length === 1) return [...list];
  const words = new Set(
    label
      .split(/\s+or\s+|,/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  );
  const pick = list.filter((e) => {
    const dash = e.name.indexOf(" - ");
    const colour = dash >= 0 ? e.name.slice(dash + 3) : (e.name.split(/\s+/)[0] ?? "");
    return words.has(colour.trim().toLowerCase());
  });
  return pick.length ? pick : [...list];
}

/**
 * The tracked set, when there is one and it still exists, with the plant variants that would still
 * advance it: its own undone variants, or for the Sampler every variant of a tier not yet had.
 */
export function trackedSet(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
): { set: AchievementSet; open: Set<string>; progress: AchievementProgress } | null {
  const id = store.trackedAchievementId;
  if (!id) return null;
  const c = catalogue(projectRoot, store.achievementDone, species);
  const set = c?.byId.get(id);
  if (!c || !set) return null;
  const progress = progressOf(store);
  const open = new Set<string>();
  if ((set.source ?? "plant") === "plant") {
    for (const slot of set.entries) {
      if (isEntryDone(set, slot, progress)) continue;
      const g = set.groups?.find((x) => x.key === slot);
      for (const k of g ? g.anyOf : [slot]) open.add(k);
    }
  }
  return { set, open, progress };
}

/**
 * Would this plant, on a body in `regionName`, advance the tracked achievement? The variants that
 * would, or null. A region set only counts plants in its region.
 */
export function achievementAdvanceFor(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
  tracked: NonNullable<ReturnType<typeof trackedSet>>,
  speciesId: string,
  regionName: string | null | undefined,
  colourLabel: string | null | undefined,
): AchievementAdvanceDTO | null {
  const { set, open } = tracked;
  if (!open.size) return null;
  const rk = regionJoinKey(regionName ?? "");
  if (set.region && set.region.key !== rk) return null;
  const c = catalogue(projectRoot, store.achievementDone, species);
  const list = c?.bySpecies.get(speciesId);
  if (!list?.length) return null;
  const variants = entriesForLabel(list, colourLabel)
    .filter((e) => open.has(e.key))
    .map((e) => e.name);
  return variants.length ? { id: set.id, name: set.name, variants } : null;
}

/** How many open slots the HUD lists for a star, world or sight set. */
const TODO_SHOWN = 5;

/** The tracked achievement's progress, for the snapshot (the caller fills in `here`). */
export function trackedAchievementSummary(
  projectRoot: string,
  store: AchievementStoreView,
  species: SpeciesList,
): Omit<TrackedAchievementDTO, "here"> | null {
  const t = trackedSet(projectRoot, store, species);
  if (!t) return null;
  const dto = achievementDto(t.set, t.progress);
  if (!t.set.groups || (t.set.source ?? "plant") === "plant") return dto;
  const c = catalogue(projectRoot, store.achievementDone, species);
  const pos = store.commanderPos;
  const todo = t.set.groups
    .filter((g) => !isEntryDone(t.set, g.key, t.progress))
    .map((g) => {
      const at = c?.poiCoords.get(g.key);
      const distanceLy =
        at && pos ? Math.round(Math.hypot(at.x - pos.x, at.y - pos.y, at.z - pos.z)) : undefined;
      return {
        label: g.label,
        ...(g.hint ? { hint: g.hint } : {}),
        ...(distanceLy !== undefined ? { distanceLy } : {}),
      };
    })
    .sort((a, b) => (a.distanceLy ?? Infinity) - (b.distanceLy ?? Infinity))
    .slice(0, TODO_SHOWN);
  return { ...dto, todo };
}
