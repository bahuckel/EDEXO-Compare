/**
 * Achievements: which codex entries are plants, how they group into sets, and how far a set is done.
 * Pure — the server feeds it the codex catalogue, the rarity tiers and the commander's completions
 * (`server/achievements.ts`); the rules are in `dto/achievements.ts`.
 *
 * An entry is one colour variant, keyed the way both the journal and EDSM's codex dump key it
 * (`$Codex_Ent_Fungoids_01_Tellurium_Name;` → `codex_ent_fungoids_01_tellurium`). A completion is
 * `regionJoinKey|entryKey`: the game keeps its codex per region, and so do the region sets.
 */
import type {
  AchievementDTO,
  AchievementEntryDTO,
  AchievementKind,
  AchievementStep,
} from "./dto/achievements.js";
import type { RarityTier } from "./speciesRarity.js";

/** The sampled genera, by the codex key's first word. Their genus is the variant name's first word. */
const SAMPLED =
  /^codex_ent_(aleoids|bacterial|cactoid|clypeus|conchas|electricae|fonticulus|fumerolas|fungoids|ingensradices|osseus|recepta|shrubs|stratum|tubus|tussocks)_/;

/** The legacy surface plants — logged by the composition scanner, never sampled three times. */
const LEGACY: [RegExp, string][] = [
  [/^codex_ent_sphere(abcd|efgh)?(_\d+)?$/, "Anemone"],
  [/^codex_ent_seed(abcd|efgh)?(_\d+)?$/, "Brain Tree"],
  [/^codex_ent_tube(abcd|efgh)?(_\d+)?$/, "Sinuous Tubers"],
  [/^codex_ent_ground_struct_ice$/, "Crystalline Shards"],
  [/^codex_ent_vents$/, "Amphora Plants"],
  [/^codex_ent_cone$/, "Bark Mounds"],
];

export interface PlantEntry {
  key: string;
  name: string;
  genus: string;
  legacy: boolean;
}

/**
 * The plant a codex entry is, or null for geology, space life, clouds and anything else. Geology
 * shares the "Biological and Geological" category with the plants, so the key decides, not the category.
 */
export function plantEntry(key: string, name: string): PlantEntry | null {
  const k = key.trim().toLowerCase();
  if (SAMPLED.test(k)) {
    // EDSM spells four of them "Bacteria Acies - Magenta"; the game and the rest say Bacterium.
    const full = name.trim().replace(/^Bacteria\s/, "Bacterium ");
    const genus = full.split(/\s+/)[0] ?? "";
    return genus ? { key: k, name: full, genus, legacy: false } : null;
  }
  for (const [re, genus] of LEGACY) if (re.test(k)) return { key: k, name: name.trim(), genus, legacy: true };
  return null;
}

/** Does a legacy entry key count on its codex line alone? (Sampled ones need the third sample.) */
export function isLegacyPlantKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return LEGACY.some(([re]) => re.test(k));
}

/** Bronze, silver and gold: 25 %, 50 % and all of the set, never below one entry. */
export function achievementThresholds(total: number): [number, number, number] {
  if (total <= 0) return [0, 0, 0];
  return [Math.max(1, Math.ceil(total * 0.25)), Math.max(1, Math.ceil(total * 0.5)), total];
}

export function achievementStep(done: number, total: number): AchievementStep {
  if (total <= 0) return 0;
  const [b, s, g] = achievementThresholds(total);
  return done >= g ? 3 : done >= s ? 2 : done >= b ? 1 : 0;
}

export const STEP_NAMES = ["", "Bronze", "Silver", "Gold"] as const;

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** What the catalogue is built from. */
export interface AchievementInputs {
  entries: ReadonlyMap<string, PlantEntry>;
  /** Region display name → its join key and the entry keys found there. */
  regions: readonly { name: string; key: string; entries: ReadonlySet<string> }[];
  /** Galaxy tier of an entry's species, when known. */
  galaxyTier: (entryKey: string) => RarityTier | null;
  /** Regional verdict for an entry's species: not found → left out; tier when known. */
  regionTier: (regionName: string, entryKey: string) => { found: boolean; tier?: RarityTier } | null;
  /** `regionJoinKey|entryKey` → ISO time of first completion. */
  done: ReadonlyMap<string, string>;
  /** Names he chose, by achievement id ("galaxy" → "End Game"). */
  names?: Readonly<Record<string, string>>;
  /** Region join key → the non-plant codex entries (stars, worlds) EDSM has there. */
  regionBodies?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Region join key → the points of interest chosen for its Sights set, or absent when the commander
   * has not downloaded the EDAstro file. `key` is the system name ({@link systemNameKey}).
   */
  regionPois?: ReadonlyMap<string, readonly { key: string; label: string; hint: string }[]> | null;
}

/** One set: which entries it holds and, for region sets, the region they have to be done in. */
export interface AchievementSet {
  id: string;
  kind: AchievementKind;
  name: string;
  region?: { name: string; key: string };
  genus?: string;
  tier?: RarityTier;
  /** Slots: plant variant keys, or group keys when {@link groups} is set. */
  entries: string[];
  /** Where progress comes from; plants when absent. */
  source?: "plant" | "codex" | "visit";
  groups?: AchievementGroup[];
  /** Needs the EDAstro points-of-interest file the commander downloads. */
  needsPoi?: boolean;
}

const TIERS: RarityTier[] = ["common", "uncommon", "rare", "epic", "legendary"];
const TIER_LABEL: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** Every set, galaxy-wide first, then region by region (regions in the order given). */
export function buildAchievementSets(i: AchievementInputs): AchievementSet[] {
  const name = (id: string, fallback: string) => i.names?.[id]?.trim() || fallback;
  const out: AchievementSet[] = [];
  const all = [...i.entries.keys()].sort();
  const byGenus = (keys: Iterable<string>) => {
    const m = new Map<string, string[]>();
    for (const k of keys) {
      const g = i.entries.get(k)?.genus;
      if (!g) continue;
      const list = m.get(g) ?? [];
      list.push(k);
      m.set(g, list);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  };

  out.push({ id: "galaxy", kind: "galaxy", name: name("galaxy", "End Game"), entries: all });
  for (const [g, keys] of byGenus(all)) {
    const id = `galaxy:genus:${slug(g)}`;
    out.push({ id, kind: "genus", name: name(id, `${g} — Galaxy`), genus: g, entries: keys });
  }
  for (const t of TIERS) {
    const keys = all.filter((k) => i.galaxyTier(k) === t);
    if (!keys.length) continue;
    const id = `galaxy:tier:${t}`;
    out.push({ id, kind: "rarity", name: name(id, `${TIER_LABEL[t]} — Galaxy`), tier: t, entries: keys });
  }

  for (const r of i.regions) {
    const region = { name: r.name, key: r.key };
    // Found there: EDSM has it in the region and the rarity data does not call it absent — plus
    // anything the commander completed there, which is found by definition.
    const doneHere = new Set<string>();
    for (const k of i.done.keys()) {
      const bar = k.indexOf("|");
      if (bar > 0 && k.slice(0, bar) === r.key && i.entries.has(k.slice(bar + 1)))
        doneHere.add(k.slice(bar + 1));
    }
    const verdicts = new Map<string, { found: boolean; tier?: RarityTier } | null>();
    const verdict = (k: string) => {
      if (!verdicts.has(k)) verdicts.set(k, i.regionTier(r.name, k));
      return verdicts.get(k)!;
    };
    const keys = [...new Set([...r.entries, ...doneHere])]
      .filter((k) => i.entries.has(k) && (doneHere.has(k) || verdict(k)?.found !== false))
      .sort();
    if (!keys.length) continue;
    const rid = `region:${r.key}`;
    out.push({ id: rid, kind: "region", name: name(rid, `${r.name} — Complete`), region, entries: keys });
    // Sampler: one plant of each rarity tier found here.
    const tierGroups: AchievementGroup[] = TIERS.map((t) => ({
      key: t,
      label: `A ${TIER_LABEL[t].toLowerCase()} plant`,
      anyOf: keys.filter((k) => verdict(k)?.tier === t),
    })).filter((g) => g.anyOf.length > 0);
    if (tierGroups.length > 1) {
      const id = `${rid}:sampler`;
      out.push({
        id,
        kind: "regionSampler",
        name: name(id, `Sampler — ${r.name}`),
        region,
        entries: tierGroups.map((g) => g.key),
        groups: tierGroups,
      });
    }
    const bodies = i.regionBodies?.get(r.key);
    for (const [kind, suffix, label, table] of [
      ["regionStars", "stars", "Stars", STAR_GROUPS],
      ["regionWorlds", "worlds", "Worlds", WORLD_GROUPS],
    ] as const) {
      const groups = bodies ? groupCodexKeys(table, bodies) : [];
      if (!groups.length) continue;
      const id = `${rid}:${suffix}`;
      out.push({
        id,
        kind,
        name: name(id, `${label} — ${r.name}`),
        region,
        source: "codex",
        entries: groups.map((g) => g.key),
        groups,
      });
    }
    const pois = i.regionPois?.get(r.key);
    if (i.regionPois !== undefined && (i.regionPois === null || pois?.length)) {
      const groups: AchievementGroup[] = (pois ?? []).map((q) => ({
        key: q.key,
        label: q.label,
        anyOf: [q.key],
        hint: q.hint,
      }));
      const id = `${rid}:sights`;
      out.push({
        id,
        kind: "regionSights",
        name: name(id, `Sights — ${r.name}`),
        region,
        source: "visit",
        entries: groups.map((g) => g.key),
        groups,
        needsPoi: true,
      });
    }
    for (const [g, gk] of byGenus(keys)) {
      const id = `${rid}:genus:${slug(g)}`;
      out.push({
        id,
        kind: "regionGenus",
        name: name(id, `${g} — ${r.name}`),
        region,
        genus: g,
        entries: gk,
      });
    }
    for (const t of TIERS) {
      const tk = keys.filter((k) => verdict(k)?.tier === t);
      if (!tk.length) continue;
      const id = `${rid}:tier:${t}`;
      out.push({
        id,
        kind: "regionRarity",
        name: name(id, `${TIER_LABEL[t]} — ${r.name}`),
        region,
        tier: t,
        entries: tk,
      });
    }
  }
  return out;
}

/** Entry key → where and when it was first completed (any region), for galaxy sets. */
export function firstDoneByEntry(
  done: ReadonlyMap<string, string>,
): Map<string, { region: string; at: string }> {
  const out = new Map<string, { region: string; at: string }>();
  for (const [k, at] of done) {
    const bar = k.indexOf("|");
    if (bar <= 0) continue;
    const entry = k.slice(bar + 1);
    const prev = out.get(entry);
    if (!prev || at < prev.at) out.set(entry, { region: k.slice(0, bar), at });
  }
  return out;
}

/** A system name as the visit sets compare it. */
export function systemNameKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Everything a set's progress is read from — all of it from the journals. */
export interface AchievementProgress {
  /** Plants: `regionJoinKey|entryKey` → first time it counted. */
  plants: ReadonlyMap<string, string>;
  plantsAnywhere: ReadonlyMap<string, { region: string; at: string }>;
  /** Every codex entry, any category: `regionJoinKey|entryKey` (stars, worlds). */
  codex: ReadonlySet<string>;
  /** Systems arrived in, by {@link systemNameKey}. */
  visited: ReadonlySet<string>;
}

export function achievementProgress(
  plants: ReadonlyMap<string, string>,
  codex: ReadonlySet<string> = new Set(),
  visited: ReadonlySet<string> = new Set(),
): AchievementProgress {
  return { plants, plantsAnywhere: firstDoneByEntry(plants), codex, visited };
}

/**
 * When one slot of a set was done: the time for a plant, `true` when done with no time (a codex entry,
 * a visit), undefined when not. A plant set's slot is one variant; a group set's slot is done when any
 * of its keys is.
 */
export function slotDone(
  set: Pick<AchievementSet, "region" | "source" | "groups">,
  slot: string,
  p: AchievementProgress,
): string | true | undefined {
  const source = set.source ?? "plant";
  const keys = set.groups ? (set.groups.find((g) => g.key === slot)?.anyOf ?? []) : [slot];
  let best: string | true | undefined;
  for (const k of keys) {
    let at: string | true | undefined;
    if (source === "visit") at = p.visited.has(k) ? true : undefined;
    else if (source === "codex") at = set.region && p.codex.has(`${set.region.key}|${k}`) ? true : undefined;
    else at = set.region ? p.plants.get(`${set.region.key}|${k}`) : p.plantsAnywhere.get(k)?.at;
    if (at === undefined) continue;
    if (best === undefined || best === true || (typeof at === "string" && at < best)) best = at;
  }
  return best;
}

export function isEntryDone(
  set: Pick<AchievementSet, "region" | "source" | "groups">,
  slot: string,
  p: AchievementProgress,
): boolean {
  return slotDone(set, slot, p) !== undefined;
}

export function achievementDto(set: AchievementSet, p: AchievementProgress): AchievementDTO {
  const n = set.entries.filter((k) => isEntryDone(set, k, p)).length;
  const total = set.entries.length;
  return {
    id: set.id,
    name: set.name,
    kind: set.kind,
    ...(set.region ? { region: set.region.name } : {}),
    ...(set.genus ? { genus: set.genus } : {}),
    ...(set.tier ? { tier: set.tier } : {}),
    ...(set.needsPoi ? { needsPoi: true } : {}),
    done: n,
    total,
    step: achievementStep(n, total),
    thresholds: achievementThresholds(total),
  };
}

export function achievementEntries(
  set: AchievementSet,
  entries: ReadonlyMap<string, PlantEntry>,
  p: AchievementProgress,
  regionName: (key: string) => string,
): AchievementEntryDTO[] {
  const rows = set.entries.map((k): AchievementEntryDTO => {
    const at = slotDone(set, k, p);
    const when = typeof at === "string" ? { doneAt: at } : {};
    const g = set.groups?.find((x) => x.key === k);
    if (g) {
      return {
        key: k,
        name: g.label,
        genus: "",
        legacy: false,
        done: at !== undefined,
        ...when,
        ...(g.hint ? { hint: g.hint } : {}),
      };
    }
    const e = entries.get(k)!;
    const first = p.plantsAnywhere.get(k);
    return {
      key: k,
      name: e.name,
      genus: e.genus,
      legacy: e.legacy,
      done: at !== undefined,
      ...when,
      ...(!set.region && first ? { doneIn: regionName(first.region) } : {}),
    };
  });
  // Groups keep their curated order; plant variants read best alphabetically.
  return set.groups ? rows : rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** A slot that is done when any of its keys is: a class of star, a kind of world, a tier, a POI. */
export interface AchievementGroup {
  key: string;
  label: string;
  anyOf: string[];
  /** Shown under the label (the POI's system, "any of …"). */
  hint?: string;
}

/**
 * The curated star and world classes (owner, 2026-09-28: "visit some system with a specific star type
 * (or black hole) in the region"). Codex entry keys, matched by pattern so every subclass counts: any
 * white dwarf, any Wolf-Rayet. A class EDSM has never logged in a region is left out of it.
 */
export const STAR_GROUPS: { key: string; label: string; match: RegExp }[] = [
  { key: "blackhole", label: "Black hole", match: /^codex_ent_black_?holes?$|^codex_ent_supermassive/ },
  { key: "neutron", label: "Neutron star", match: /^codex_ent_neutron/ },
  { key: "whitedwarf", label: "White dwarf", match: /^codex_ent_d[a-z]*_type/ },
  { key: "wolfrayet", label: "Wolf-Rayet star", match: /^codex_ent_w[a-z]*_type/ },
  { key: "otype", label: "O-type star", match: /^codex_ent_o_type/ },
  { key: "carbon", label: "Carbon or S-type star", match: /^codex_ent_(c|cn|cj|ms|s)_type/ },
  { key: "ttauri", label: "T Tauri star", match: /^codex_ent_t_?tauri|^codex_ent_tts/ },
  { key: "herbig", label: "Herbig Ae/Be star", match: /^codex_ent_aebe_type/ },
  { key: "browndwarf", label: "Brown dwarf (L, T or Y)", match: /^codex_ent_(l|t|y)_type$/ },
  { key: "supergiant", label: "Any supergiant or hypergiant", match: /(super|hyper)giant$/ },
];

export const WORLD_GROUPS: { key: string; label: string; match: RegExp }[] = [
  { key: "earthlike", label: "Earth-like world", match: /^codex_ent_earth_likes$/ },
  { key: "waterworld", label: "Water world", match: /^codex_ent_(standard|trf)_water_worlds$/ },
  { key: "ammonia", label: "Ammonia world", match: /^codex_ent_(standard|trf)_ammonia_worlds$/ },
  { key: "gglwater", label: "Gas giant with water-based life", match: /_giant_with_water_life$/ },
  { key: "gglammonia", label: "Gas giant with ammonia-based life", match: /_giant_with_ammonia_life$/ },
  { key: "watergiant", label: "Water giant", match: /_water_giant$/ },
  { key: "helium", label: "Helium or helium-rich gas giant", match: /^codex_ent_standard_helium/ },
  { key: "green", label: "Green gas giant", match: /^codex_ent_green_/ },
];

/** Group codex keys into the curated classes. Classes with no key are dropped. */
export function groupCodexKeys(
  groups: readonly { key: string; label: string; match: RegExp }[],
  keys: Iterable<string>,
): AchievementGroup[] {
  const list = [...keys];
  return groups
    .map((g) => ({ key: g.key, label: g.label, anyOf: list.filter((k) => g.match.test(k)).sort() }))
    .filter((g) => g.anyOf.length > 0);
}
