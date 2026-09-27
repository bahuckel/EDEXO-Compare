/**
 * Species rarity (owner, 2026-09-27): RPG-style tiers per species, all colours together.
 *
 *   Common (gray) · Uncommon (green) · Rare (blue) · Epic (purple) · Legendary (gold)
 *
 * The tier is how many distinct systems EDSM's codex has the species in, galaxy-wide
 * (`data/rarity/species-rarity.json`, built by `docs/perf/build_species_rarity.py`). Galaxy-wide on
 * purpose: "its share of the life on its ideal planet type" was tried and read Tussock stigmasis as
 * common (23 % of rocky sulphur-dioxide worlds, which are simply rare planets) and every region-locked
 * species as rare.
 *
 * The tier also sets the **region limit**: how many systems in a region a species needs before the
 * app believes it grows there. Common 50, down to 1 for Legendary — a species seen in 883 systems in
 * the whole galaxy cannot be asked for fifty in one region (his words: "less and less down to 1 for
 * extremely rare ones like Fluctus"). Below the limit it is marked unlikely, never hidden.
 *
 * Measured before shipping (docs/codex-edsm-27092026.md): built from EDSM before 2026-01-01, 0.13 % of
 * the 778,617 sightings since fell where it would have said "unlikely"; on his journals none of the
 * species he actually found would have been.
 */

export type RarityTier = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface RarityTierInfo {
  tier: RarityTier;
  label: string;
  /** Fewest galaxy-wide systems for this tier (inclusive). */
  minSystems: number;
  /** Systems a region needs before the species counts as growing there. */
  regionLimit: number;
  /**
   * Fewest share of bodies for this tier (inclusive): of the bio bodies of the planet types the
   * species grows on, the fraction that carry it — the tier the badge shows.
   */
  minShare: number;
  colour: string;
}

/** Rarest first. */
export const RARITY_TIERS: readonly RarityTierInfo[] = [
  // Cut-offs set on EDSM alone (2k/6k/15k/40k), raised 25 % when EDAstro's extra pairs were added
  // (owner, 2026-09-27, "option 2") so every species keeps the tier he approved.
  { tier: "legendary", label: "Legendary", minSystems: 0, regionLimit: 1, minShare: 0, colour: "#f5b83d" },
  { tier: "epic", label: "Epic", minSystems: 2_500, regionLimit: 3, minShare: 0.003, colour: "#b77cf2" },
  { tier: "rare", label: "Rare", minSystems: 7_500, regionLimit: 10, minShare: 0.01, colour: "#4f9cf5" },
  {
    tier: "uncommon",
    label: "Uncommon",
    minSystems: 19_000,
    regionLimit: 25,
    minShare: 0.03,
    colour: "#4cc46a",
  },
  { tier: "common", label: "Common", minSystems: 50_000, regionLimit: 50, minShare: 0.1, colour: "#9aa0a8" },
];

export function rarityTierInfo(tier: RarityTier): RarityTierInfo {
  return RARITY_TIERS.find((t) => t.tier === tier)!;
}

/**
 * The tier the badge shows: from the share of bodies (owner, 2026-09-27: "per region, per body count
 * with even 1 bio signal of a certain type"). `data/rarity/body-share.json`.
 */
export function rarityTierForShare(share: number): RarityTier {
  let tier: RarityTier = "legendary";
  for (const t of RARITY_TIERS) if (share >= t.minShare) tier = t.tier;
  return tier;
}

/**
 * The **abundance** tier from galaxy-wide system counts — what sets a species' region limit (how many
 * systems a region needs before it counts as growing there). Kept apart from the badge's body share on
 * purpose: by body share Tussock stigmasis is common where it grows, but it is logged in only ~6,500
 * systems and could never show fifty in most regions.
 */
export function rarityTierFor(systems: number): RarityTier {
  let tier: RarityTier = "legendary";
  for (const t of RARITY_TIERS) if (systems >= t.minSystems) tier = t.tier;
  return tier;
}

export interface SpeciesRarity {
  /** Badge tier: from the body share when known, else from the system count. */
  tier: RarityTier;
  /** Distinct systems in the codex data, galaxy-wide. */
  systems: number;
  /** Share of bio bodies of its planet types that carry it, galaxy-wide. */
  share?: number;
}

/**
 * A species' rarity **in one region** (owner, 2026-09-27: "a common plant in one region can be
 * uncommon or rare in another … if it's not found it's excluded from the quests/achievements").
 *
 * Regions are explored very unevenly, so counts cannot be compared across them. The tier is the
 * species' share of the region's recorded biology, scaled to the galaxy's size and put through the
 * same cut-offs as the galaxy tier: a species that is 3 % of the galaxy's records and 3 % of a
 * region's has the same tier in both. Not `found` (below its region limit, or never logged) means
 * no regional tier: it is left out of that region's quests.
 */
export interface RegionalRarity {
  region: string;
  found: boolean;
  /** Only when found. */
  tier?: RarityTier;
  /** Systems in this region with the species. */
  count: number;
  /** Share of this region's bio bodies of its planet types that carry it. */
  share?: number;
  /** …as bodies: estimated with it, and of its types in all. */
  bodies?: number;
  of?: number;
}

/**
 * The regional tier: found by the system counts (its region limit), tiered by the body share there.
 */
export function regionalRarityFor(
  regionName: string,
  count: number,
  galaxySystems: number,
  body: { share: number; bodies: number; of: number } | null,
): RegionalRarity {
  const need = rarityTierInfo(rarityTierFor(galaxySystems)).regionLimit;
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  if (n < need) return { region: regionName, found: false, count: n };
  if (!body || !(body.of > 0)) return { region: regionName, found: true, count: n };
  return {
    region: regionName,
    found: true,
    tier: rarityTierForShare(body.share),
    count: n,
    share: body.share,
    bodies: body.bodies,
    of: body.of,
  };
}

export type TierRegionPresence = "absent" | "present" | "unknown";

export interface TierRegionVerdict {
  presence: TierRegionPresence;
  /** Systems in this region with the species. */
  count: number;
  /** Systems its tier needs in a region. */
  need: number;
  tier: RarityTier;
}

/**
 * Does this species grow in this region, by its tier's limit?
 *
 * `unknown` when the region is too little explored to reach the limit even if the species grew there
 * (galaxy count × the region's share of all recorded biology < limit): a rare species in a region few
 * commanders visit has simply not been looked for.
 */
export function judgeTierRegionalPresence(
  galaxySystems: number,
  regionCount: number,
  regionShare: number,
): TierRegionVerdict {
  const tier = rarityTierFor(galaxySystems);
  const need = rarityTierInfo(tier).regionLimit;
  const count = Number.isFinite(regionCount) && regionCount > 0 ? regionCount : 0;
  if (count >= need) return { presence: "present", count, need, tier };
  if (!(galaxySystems * regionShare >= need)) return { presence: "unknown", count, need, tier };
  return { presence: "absent", count, need, tier };
}

/** The line a commander sees on a species the tier rule marks unlikely (or passes). */
export function tierRegionDetail(regionName: string, v: TierRegionVerdict, demoted: boolean): string {
  const label = rarityTierInfo(v.tier).label;
  if (!demoted) {
    return `${label}; logged in ${v.count.toLocaleString()} system${v.count === 1 ? "" : "s"} in ${regionName} (EDSM codex).`;
  }
  const seen = v.count === 0 ? "never logged" : `logged in only ${v.count} system${v.count === 1 ? "" : "s"}`;
  return (
    `${seen} in ${regionName}: a ${label.toLowerCase()} species needs ${v.need} before it counts as growing ` +
    `there (EDSM codex). Listed as a low-probability find rather than excluded.`
  );
}
