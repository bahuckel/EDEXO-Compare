/*
  Achievements (owner, 2026-09-27). The rules, in his answers:

  - A plant counts once its third sample is done; a legacy plant (Anemone, Brain Tree, Sinuous Tubers,
    Crystalline Shards, Amphora, Bark Mounds) once its codex entry is logged. Journals only.
  - Every colour variant is an entry of its own: "End Game" is every variant of every plant.
  - Four kinds: galaxy totals, genus completion, rarity collections, region sets (the region, and each
    genus found there). A variant never found in a region is left out of that region's sets.
  - Per region, not only exobiology (2026-09-28): a Sampler (one plant of each rarity tier), Stars and
    Worlds (codex entries for curated classes EDSM has there), and Sights — five EDAstro points of
    interest to arrive at, one achievement per region, waiting for the commander's POI download.
  - Tiers are steps inside one achievement: bronze at 25 %, silver at 50 %, gold at 100 % of the set.
  - One achievement can be tracked; its plants are marked in the UI and in a HUD section.
*/
import type { RarityTier } from "../speciesRarity.js";

export type AchievementKind =
  | "galaxy"
  | "genus"
  | "rarity"
  | "region"
  | "regionGenus"
  | "regionRarity"
  /** One plant of each rarity tier found in the region. */
  | "regionSampler"
  /** Codex entries for the curated star classes, in the region. */
  | "regionStars"
  /** Codex entries for the curated world classes, in the region. */
  | "regionWorlds"
  /** Visit a handful of EDAstro points of interest in the region (needs the POI download). */
  | "regionSights";

/** 0 = none yet, 1 = bronze, 2 = silver, 3 = gold. */
export type AchievementStep = 0 | 1 | 2 | 3;

export interface AchievementDTO {
  /** "galaxy", "galaxy:genus:fonticulua", "region:theveils:tier:rare", … */
  id: string;
  name: string;
  kind: AchievementKind;
  /** Region display name, for region kinds. */
  region?: string;
  genus?: string;
  tier?: RarityTier;
  done: number;
  total: number;
  step: AchievementStep;
  /** Entries needed for bronze, silver and gold. */
  thresholds: [number, number, number];
  /** Needs the EDAstro points-of-interest download. */
  needsPoi?: boolean;
}

export interface AchievementsDTO {
  /** False when the codex catalogue file is missing from this build. */
  available: boolean;
  /** Galaxy-wide achievements first, then region by region. */
  achievements: AchievementDTO[];
  trackedId: string | null;
  /** The commander's current region (joined spelling), so the list can open on it. */
  currentRegion: string | null;
  /** False until the EDAstro points-of-interest file is downloaded: the Sights sets wait for it. */
  poiData: boolean;
  source: string;
}

export interface AchievementEntryDTO {
  /** EDSM / journal codex entry key, e.g. "codex_ent_fonticulus_05_m". */
  key: string;
  /** "Fonticulua Fluctus - Amethyst". */
  name: string;
  genus: string;
  done: boolean;
  /** Where it was completed (galaxy sets), when done. */
  doneIn?: string;
  /** ISO time it was first completed, when done. */
  doneAt?: string;
  legacy: boolean;
  /** For a star / world class or a point of interest: where or what (the POI's system). */
  hint?: string;
}

export interface AchievementDetailDTO {
  achievement: AchievementDTO;
  entries: AchievementEntryDTO[];
}

/** The tracked achievement, as the app bar and the HUD section show it. */
export interface TrackedAchievementDTO extends AchievementDTO {
  /** Plants in the current system that would advance it: body, species and the colours that count. */
  here: { bodyKey: string; body: string; species: string; colours: string[] }[];
  /** For star, world and sight sets: what is still to do (a few), with the distance for a sight. */
  todo?: { label: string; hint?: string; distanceLy?: number }[];
}

/** On a species row: this plant, here, would advance the tracked achievement. */
export interface AchievementAdvanceDTO {
  id: string;
  name: string;
  /** Variant names that would count ("Fonticulua Fluctus - Amethyst"). */
  variants: string[];
}
