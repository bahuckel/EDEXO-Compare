/**
 * Rarity tiers and the tier region rule (owner, 2026-09-27).
 */
import { describe, expect, it } from "vitest";
import {
  judgeTierRegionalPresence,
  rarityTierFor,
  rarityTierForShare,
  rarityTierInfo,
  regionalRarityFor,
  tierRegionDetail,
} from "../src/shared/speciesRarity.js";
import { speciesRarity, tierRegionalPresence } from "../src/server/speciesRarityData.js";
import { getProjectRoot } from "../src/server/paths.js";

describe("rarity tiers", () => {
  it("abundance tiers (region limits) cut at 2.5k / 7.5k / 19k / 50k systems", () => {
    expect(rarityTierFor(883)).toBe("legendary");
    expect(rarityTierFor(2_500)).toBe("epic");
    expect(rarityTierFor(6_521)).toBe("epic");
    expect(rarityTierFor(7_500)).toBe("rare");
    expect(rarityTierFor(19_000)).toBe("uncommon");
    expect(rarityTierFor(50_000)).toBe("common");
    expect(
      [...["legendary", "epic", "rare", "uncommon", "common"]].map(
        (t) => rarityTierInfo(t as never).regionLimit,
      ),
    ).toEqual([1, 3, 10, 25, 50]);
  });

  it("badge tiers cut on the share of bodies: 0.3 % / 1 % / 3 % / 10 %", () => {
    expect(rarityTierForShare(0.0023)).toBe("legendary");
    expect(rarityTierForShare(0.0048)).toBe("epic");
    expect(rarityTierForShare(0.02)).toBe("rare");
    expect(rarityTierForShare(0.05)).toBe("uncommon");
    expect(rarityTierForShare(0.36)).toBe("common");
  });

  it("gives a species a tier per region only where it is found", () => {
    const body = { share: 0.02, bodies: 40, of: 2000 };
    expect(regionalRarityFor("The Veils", 30, 60_000, body)).toMatchObject({ found: false });
    expect(regionalRarityFor("The Veils", 60, 60_000, body)).toMatchObject({ found: true, tier: "rare" });
    expect(regionalRarityFor("Xibalba", 2, 900, { share: 0.4, bodies: 4, of: 10 })).toMatchObject({
      found: true,
      tier: "common",
    });
  });

  it("needs the tier's limit in a region, and stays quiet where the region is too little explored", () => {
    expect(judgeTierRegionalPresence(50_000, 50, 0.1).presence).toBe("present");
    expect(judgeTierRegionalPresence(50_000, 49, 0.1).presence).toBe("absent");
    // 883 × 0.0005 < 1: a legendary species cannot be expected even once there.
    expect(judgeTierRegionalPresence(883, 0, 0.0005).presence).toBe("unknown");
    expect(judgeTierRegionalPresence(883, 0, 0.01).presence).toBe("absent");
    expect(judgeTierRegionalPresence(883, 1, 0.01).presence).toBe("present");
    expect(tierRegionDetail("Trojan Belt", judgeTierRegionalPresence(53_585, 0, 0.05), true)).toContain(
      "never logged in Trojan Belt",
    );
  });

  it("reads the shipped EDSM table", () => {
    const root = getProjectRoot();
    expect(speciesRarity(root, "fonticulua_fonticulua_fluctus")?.tier).toBe("legendary");
    expect(speciesRarity(root, "bacterium_bacterium_aurasus")?.tier).toBe("common");
    expect(speciesRarity(root, "tussock_tussock_stigmasis")?.tier).toBe("epic");
    // Amphora plants grow in five regions; Inner Orion Spur is not one of them.
    expect(tierRegionalPresence(root, "Inner Orion Spur", "amphora_amphora_plant")?.presence).toBe("absent");
    expect(tierRegionalPresence(root, "Hawking's Gap", "amphora_amphora_plant")?.presence).toBe("present");
    // Spelling: the map says "Formidine Rift", EDSM "The Formidine Rift".
    expect(tierRegionalPresence(root, "Formidine Rift", "bacterium_bacterium_aurasus")).not.toBeNull();
  });
});

describe("dynamic rarity", () => {
  it("maps codex names to our species, including the name-reversed and grouped ones", async () => {
    const { speciesIdForCodexKey } = await import("../src/server/speciesRarityData.js");
    const byName = new Map([
      ["stratum tectonicas", "stratum_stratum_tectonicas"],
      ["bacterium vesicula", "bacterium_bacterium_vesicula"],
      ["brain tree roseum", "brain_trees_brain_tree_roseum"],
      ["sinuous tubers viride", "sinuous_tuber_sinuous_tubers_viride"],
      ["anemone", "anemone_anemone"],
      ["amphora plant", "amphora_amphora_plant"],
    ]);
    expect(speciesIdForCodexKey("stratum tectonicas", byName)).toBe("stratum_stratum_tectonicas");
    expect(speciesIdForCodexKey("bacteria vesicula", byName)).toBe("bacterium_bacterium_vesicula");
    expect(speciesIdForCodexKey("roseum brain tree", byName)).toBe("brain_trees_brain_tree_roseum");
    expect(speciesIdForCodexKey("viride sinuous tubers", byName)).toBe("sinuous_tuber_sinuous_tubers_viride");
    expect(speciesIdForCodexKey("luteolum anemone", byName)).toBe("anemone_anemone");
    expect(speciesIdForCodexKey("amphora plants", byName)).toBe("amphora_amphora_plant");
    expect(speciesIdForCodexKey("sulphur dioxide fumarole", byName)).toBeNull();
  });

  it("adds the commander's sightings newer than the dump, once per system, and not older ones", async () => {
    const m = await import("../src/server/speciesRarityData.js");
    const root = getProjectRoot();
    m.clearSpeciesRarityCache();
    const species = [{ id: "fonticulua_fonticulua_fluctus", displayName: "Fonticulua fluctus" }];
    const before = m.speciesRarity(root, "fonticulua_fonticulua_fluctus")!.systems;
    const trojan = m.tierRegionalPresence(root, "Trojan Belt", "amphora_amphora_plant")!.count;
    const sightings = new Map([
      ["fonticulua fluctus|trojanbelt|111", "2026-09-27T10:00:00Z"],
      ["fonticulua fluctus|trojanbelt|222", "2026-09-27T11:00:00Z"],
      ["fonticulua fluctus|thevoid|111", "2026-09-27T12:00:00Z"], // same system again: once galaxy-wide
      ["fonticulua fluctus|trojanbelt|333", "2020-01-01T00:00:00Z"], // before the dump: already counted
    ]);
    expect(m.syncRaritySightings(root, sightings, species)).toBe(true);
    expect(m.speciesRarity(root, "fonticulua_fonticulua_fluctus")!.systems).toBe(before + 2);
    const tv = m.tierRegionalPresence(root, "Trojan Belt", "fonticulua_fonticulua_fluctus")!;
    expect(tv.count).toBeGreaterThanOrEqual(2);
    expect(m.tierRegionalPresence(root, "Trojan Belt", "amphora_amphora_plant")!.count).toBe(trojan);
    expect(m.syncRaritySightings(root, sightings, species)).toBe(false); // nothing new
    m.clearSpeciesRarityCache();
    expect(m.speciesRarity(root, "fonticulua_fonticulua_fluctus")!.systems).toBe(before);
  });
});
