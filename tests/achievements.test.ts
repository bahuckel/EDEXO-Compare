/**
 * Achievements (owner, 2026-09-27): which codex entries count, how the sets are cut, the steps, and
 * what the journal records. The rules are in src/shared/dto/achievements.ts.
 */
import { describe, expect, it } from "vitest";
import {
  achievementDto,
  achievementStep,
  achievementThresholds,
  buildAchievementSets,
  achievementProgress,
  groupCodexKeys,
  STAR_GROUPS,
  systemNameKey,
  WORLD_GROUPS,
  isLegacyPlantKey,
  plantEntry,
  type PlantEntry,
} from "../src/shared/achievements.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

describe("which codex entries are plants", () => {
  it("takes the sampled genera with their variant as the name", () => {
    expect(plantEntry("codex_ent_fungoids_01_tellurium", "Fungoida Setisis - Yellow")).toEqual({
      key: "codex_ent_fungoids_01_tellurium",
      name: "Fungoida Setisis - Yellow",
      genus: "Fungoida",
      legacy: false,
    });
  });
  it("spells EDSM's four 'Bacteria' entries as Bacterium, so they join the genus", () => {
    expect(plantEntry("codex_ent_bacterial_04_polonium", "Bacteria Acies - Magenta")?.genus).toBe(
      "Bacterium",
    );
  });
  it("takes the legacy plants under their own genus", () => {
    expect(plantEntry("codex_ent_sphereefgh_02", "Prasinum Bioluminescent Anemone")?.genus).toBe("Anemone");
    expect(plantEntry("codex_ent_seed", "Roseum Brain Tree")?.genus).toBe("Brain Tree");
    expect(plantEntry("codex_ent_tubeabcd_01", "Prasinum Sinuous Tubers")?.genus).toBe("Sinuous Tubers");
    expect(plantEntry("codex_ent_vents", "Amphora Plants")?.legacy).toBe(true);
    expect(plantEntry("codex_ent_cone", "Bark Mounds")?.legacy).toBe(true);
    expect(plantEntry("codex_ent_ground_struct_ice", "Crystalline Shards")?.legacy).toBe(true);
  });
  it("takes Ingensradices unicus (HIP 87621, not in EDSM's dump yet) as a sampled plant of its own genus", () => {
    expect(plantEntry("codex_ent_ingensradices_unicus", "Ingensradices Unicus")).toMatchObject({
      genus: "Ingensradices",
      legacy: false,
    });
  });
  it("does not mistake Tubus for Sinuous Tubers", () => {
    expect(plantEntry("codex_ent_tubus_01_a", "Tubus Conifer - Indigo")).toMatchObject({
      genus: "Tubus",
      legacy: false,
    });
    expect(isLegacyPlantKey("codex_ent_tubus_01_a")).toBe(false);
  });
  it("leaves out geology, space life and clouds", () => {
    expect(plantEntry("codex_ent_fumarole_watergeysers", "Water Fumarole")).toBeNull();
    expect(plantEntry("codex_ent_s_seed_sdtp01_bl", "Caeruleum peduncle Pod")).toBeNull();
    expect(plantEntry("codex_ent_gas_clds_blue", "Caeruleum Lagrange Cloud")).toBeNull();
    expect(plantEntry("codex_ent_l_cry_iccry_bl", "Lindigoticum Ice Crystals")).toBeNull();
  });
});

describe("steps", () => {
  it("bronze 25 %, silver 50 %, gold all, never below one", () => {
    expect(achievementThresholds(1)).toEqual([1, 1, 1]);
    expect(achievementThresholds(4)).toEqual([1, 2, 4]);
    expect(achievementThresholds(775)).toEqual([194, 388, 775]);
    expect(achievementThresholds(0)).toEqual([0, 0, 0]);
  });
  it("counts the step reached", () => {
    expect(achievementStep(0, 8)).toBe(0);
    expect(achievementStep(2, 8)).toBe(1);
    expect(achievementStep(4, 8)).toBe(2);
    expect(achievementStep(8, 8)).toBe(3);
    expect(achievementStep(0, 0)).toBe(0);
  });
});

describe("the sets", () => {
  const e = (key: string, name: string): [string, PlantEntry] => [key, plantEntry(key, name)!];
  const entries = new Map([
    e("codex_ent_stratum_01_a", "Stratum Excutitus - Teal"),
    e("codex_ent_stratum_01_b", "Stratum Excutitus - Green"),
    e("codex_ent_fonticulus_05_m", "Fonticulua Fluctus - Amethyst"),
    e("codex_ent_sphere", "Luteolum Anemone"),
  ]);
  const tiers: Record<string, "common" | "rare" | "legendary"> = {
    codex_ent_stratum_01_a: "common",
    codex_ent_stratum_01_b: "common",
    codex_ent_fonticulus_05_m: "rare",
    codex_ent_sphere: "legendary",
  };
  const build = (done: Map<string, string>) =>
    buildAchievementSets({
      entries,
      regions: [
        {
          name: "The Veils",
          key: "veils",
          entries: new Set(["codex_ent_stratum_01_a", "codex_ent_fonticulus_05_m", "codex_ent_sphere"]),
        },
        { name: "Inner Orion Spur", key: "innerorionspur", entries: new Set(["codex_ent_stratum_01_b"]) },
      ],
      done,
      names: { galaxy: "End Game" },
      galaxyTier: (k) => tiers[k] ?? null,
      // The anemone record in The Veils is below its region limit: not found there.
      regionTier: (region, k) =>
        region === "The Veils" && k === "codex_ent_sphere"
          ? { found: false }
          : { found: true, tier: tiers[k] },
    });

  it("cuts galaxy, genus, rarity and region sets, named as he chose", () => {
    const sets = build(new Map());
    const ids = sets.map((s) => s.id);
    expect(sets[0]).toMatchObject({ id: "galaxy", name: "End Game" });
    expect(sets[0]!.entries).toHaveLength(4);
    expect(ids).toContain("galaxy:genus:stratum");
    expect(ids).toContain("galaxy:tier:legendary");
    expect(ids).toContain("region:veils");
    expect(ids).toContain("region:veils:genus:fonticulua");
    expect(ids).toContain("region:veils:tier:rare");
    expect(sets.find((s) => s.id === "region:veils:genus:fonticulua")!.name).toBe("Fonticulua — The Veils");
  });

  it("leaves a variant not found in a region out of that region's sets", () => {
    const veils = build(new Map()).find((s) => s.id === "region:veils")!;
    expect(veils.entries).not.toContain("codex_ent_sphere");
  });

  it("…unless the commander completed it there, which is found by definition", () => {
    const veils = build(new Map([["veils|codex_ent_sphere", "2026-09-27T00:00:00Z"]])).find(
      (s) => s.id === "region:veils",
    )!;
    expect(veils.entries).toContain("codex_ent_sphere");
  });

  it("counts a region set only in its region, a galaxy set anywhere", () => {
    const done = new Map([["innerorionspur|codex_ent_stratum_01_a", "2026-09-27T00:00:00Z"]]);
    const sets = build(done);
    const p = achievementProgress(done);
    const galaxy = achievementDto(
      sets.find((s) => s.id === "galaxy:genus:stratum")!,
      p,
    );
    const veils = achievementDto(
      sets.find((s) => s.id === "region:veils:genus:stratum")!,
      p,
    );
    expect(galaxy).toMatchObject({ done: 1, total: 2, step: 2 });
    expect(veils).toMatchObject({ done: 0, total: 1, step: 0 });
  });
});

describe("the non-exobiology sets (2026-09-28)", () => {
  const entries = new Map([
    ["codex_ent_stratum_01_a", plantEntry("codex_ent_stratum_01_a", "Stratum Excutitus - Teal")!],
    ["codex_ent_fonticulus_05_m", plantEntry("codex_ent_fonticulus_05_m", "Fonticulua Fluctus - Amethyst")!],
  ]);
  const tiers: Record<string, "common" | "rare"> = {
    codex_ent_stratum_01_a: "common",
    codex_ent_fonticulus_05_m: "rare",
  };
  const bodies = new Set([
    "codex_ent_black_holes",
    "codex_ent_neutron_stars",
    "codex_ent_da_type",
    "codex_ent_dab_type",
    "codex_ent_wn_type",
    "codex_ent_earth_likes",
    "codex_ent_standard_water_worlds",
    "codex_ent_green_giant_with_water_life",
    "codex_ent_a_type",
  ]);
  const build = (pois: Map<string, { key: string; label: string; hint: string }[]> | null) =>
    buildAchievementSets({
      entries,
      regions: [{ name: "The Veils", key: "veils", entries: new Set(entries.keys()) }],
      done: new Map(),
      galaxyTier: (k) => tiers[k] ?? null,
      regionTier: (_r, k) => ({ found: true, tier: tiers[k] }),
      regionBodies: new Map([["veils", bodies]]),
      regionPois: pois,
    });

  it("groups star and world codex entries into their classes, any subclass counting", () => {
    const stars = groupCodexKeys(STAR_GROUPS, bodies);
    expect(stars.map((g) => g.key)).toEqual(["blackhole", "neutron", "whitedwarf", "wolfrayet"]);
    expect(stars.find((g) => g.key === "whitedwarf")!.anyOf).toEqual([
      "codex_ent_da_type",
      "codex_ent_dab_type",
    ]);
    const worlds = groupCodexKeys(WORLD_GROUPS, bodies);
    expect(worlds.map((g) => g.key)).toEqual(["earthlike", "waterworld", "gglwater", "green"]);
  });

  it("a star class counts once any of its codex entries is logged in the region", () => {
    const set = build(null).find((s) => s.id === "region:veils:stars")!;
    const p = achievementProgress(
      new Map(),
      new Set(["veils|codex_ent_dab_type", "innerorionspur|codex_ent_black_holes"]),
    );
    expect(achievementDto(set, p)).toMatchObject({ done: 1, total: 4 });
  });

  it("the sampler wants one plant of each tier found in the region", () => {
    const set = build(null).find((s) => s.id === "region:veils:sampler")!;
    expect(set.entries).toEqual(["common", "rare"]);
    const p = achievementProgress(new Map([["veils|codex_ent_fonticulus_05_m", "2026-09-28T00:00:00Z"]]));
    expect(achievementDto(set, p)).toMatchObject({ done: 1, total: 2, step: 2 });
  });

  it("sights wait for the POI download, then count a visit to the system", () => {
    const waiting = build(null).find((s) => s.id === "region:veils:sights")!;
    expect(waiting).toMatchObject({ needsPoi: true, entries: [] });
    const set = build(
      new Map([
        [
          "veils",
          [
            {
              key: systemNameKey("Col 69 Sector AB-C d1"),
              label: "Pretty nebula",
              hint: "Col 69 Sector AB-C d1 · Nebula",
            },
            { key: systemNameKey("Hen 2-333"), label: "Big star", hint: "Hen 2-333 · Star" },
          ],
        ],
      ]),
    ).find((s) => s.id === "region:veils:sights")!;
    const p = achievementProgress(new Map(), new Set(), new Set([systemNameKey("  HEN 2-333 ")]));
    expect(achievementDto(set, p)).toMatchObject({ done: 1, total: 2, needsPoi: true });
  });
});

describe("what the journal records", () => {
  const SYS = 2_041_459_972_099;
  const organic = (ScanType: string, ts: string): JournalLine =>
    ({
      timestamp: ts,
      event: "ScanOrganic",
      ScanType,
      Genus: "$Codex_Ent_Fungoids_Genus_Name;",
      Genus_Localised: "Fungoida",
      Species: "$Codex_Ent_Fungoids_01_Name;",
      Species_Localised: "Fungoida Setisis",
      Variant: "$Codex_Ent_Fungoids_01_Tellurium_Name;",
      Variant_Localised: "Fungoida Setisis - Yellow",
      SystemAddress: SYS,
      Body: 22,
    }) as unknown as JournalLine;
  const codex = (name: string, localised: string, ts: string): JournalLine =>
    ({
      timestamp: ts,
      event: "CodexEntry",
      Name: name,
      Name_Localised: localised,
      SubCategory: "$Codex_SubCategory_Organic_Structures;",
      Category: "$Codex_Category_Biology;",
      Category_Localised: "Biological and Geological",
      Region_Localised: "The Veils",
      System: "Flyai Flyuae CH-C d59",
      SystemAddress: SYS,
      BodyID: 22,
    }) as unknown as JournalLine;

  it("a sampled plant counts on its third sample, in the region its codex line named", () => {
    const s = new GameStateStore();
    s.apply(organic("Log", "2026-09-27T09:30:01Z"));
    s.apply(
      codex("$Codex_Ent_Fungoids_01_Tellurium_Name;", "Fungoida Setisis - Yellow", "2026-09-27T09:30:01Z"),
    );
    s.apply(organic("Sample", "2026-09-27T09:32:00Z"));
    expect(s.achievementDone.size).toBe(0);
    s.apply(organic("Sample", "2026-09-27T09:34:00Z"));
    s.apply(organic("Analyse", "2026-09-27T09:34:00Z"));
    expect([...s.achievementDone]).toEqual([
      ["veils|codex_ent_fungoids_01_tellurium", "2026-09-27T09:34:00Z"],
    ]);
  });

  it("a legacy plant counts on its codex line alone", () => {
    const s = new GameStateStore();
    s.apply(
      codex("$Codex_Ent_SphereEFGH_02_Name;", "Prasinum Bioluminescent Anemone", "2026-09-27T10:00:00Z"),
    );
    expect(s.achievementDone.has("veils|codex_ent_sphereefgh_02")).toBe(true);
  });

  it("a sampled plant's codex line alone does not count", () => {
    const s = new GameStateStore();
    s.apply(
      codex("$Codex_Ent_Fungoids_01_Tellurium_Name;", "Fungoida Setisis - Yellow", "2026-09-27T09:30:01Z"),
    );
    expect(s.achievementDone.size).toBe(0);
  });

  it("survives the journal cache", () => {
    const s = new GameStateStore();
    s.apply(codex("$Codex_Ent_Cone_Name;", "Bark Mounds", "2026-09-27T10:00:00Z"));
    const t = new GameStateStore();
    expect(t.hydrateJournalMergePayload(s.serializeJournalMergePayload())).toBe(true);
    expect([...t.achievementDone]).toEqual([...s.achievementDone]);
  });
});
