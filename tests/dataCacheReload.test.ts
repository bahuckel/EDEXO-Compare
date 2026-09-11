/**
 * "Refresh exomastery" has to actually refresh everything.
 *
 * The launcher button promises one thing: what is on disk under `data/` is what the app is now
 * using. It keeps that promise by clearing every module-level cache — and the list of caches is
 * maintained by hand, so it goes stale the moment somebody memoises a new file and does not think
 * of the button. That is exactly what happened over one session: the ED-DSN colour tables, the
 * photo-credits manifest and the region × species table were all added with caches and none of
 * them was on the list, so editing those files and pressing Refresh did nothing, silently.
 *
 * These tests pin the two halves of that: each cache can be dropped, and dropping it really does
 * send the next read back to disk rather than to a memo.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearEddsnColourVariantsCache,
  colourVariantRuleFor,
  setEddsnColourVariantsForTests,
} from "../src/server/eddsnColourVariants.js";
import {
  clearPhotoCreditsCache,
  photoContributorFor,
  setPhotoCreditsForTests,
} from "../src/server/photoCredits.js";
import {
  clearRegionSpeciesCache,
  regionalPresence,
  setRegionSpeciesForTests,
} from "../src/server/regionSpeciesData.js";

const roots: string[] = [];

function rootWith(relativePath: string, body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "edexo-reload-"));
  roots.push(root);
  const file = join(root, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(body), "utf8");
  return root;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  clearEddsnColourVariantsCache();
  clearPhotoCreditsCache();
  clearRegionSpeciesCache();
});

describe("the colour-variant tables", () => {
  it("re-read the file after the cache is cleared", () => {
    const root = rootWith("data/species/eddsn-colour-variants.json", {
      bySpecies: { "bacterium aurasus": { source: "star", map: { A: "Lime" } } },
    });
    expect(colourVariantRuleFor(root, "bacterium", "Bacterium Aurasus")?.map.A).toBe("Lime");

    // Something else poisons the cache — which is what a stale memo is, from the caller's side.
    setEddsnColourVariantsForTests(null);
    expect(colourVariantRuleFor(root, "bacterium", "Bacterium Aurasus")).toBeNull();

    clearEddsnColourVariantsCache();
    expect(colourVariantRuleFor(root, "bacterium", "Bacterium Aurasus")?.map.A).toBe("Lime");
  });
});

describe("the photo-credits manifest", () => {
  it("re-reads the file after the cache is cleared", () => {
    const root = rootWith("data/species/photo-credits.json", {
      contributors: { falrenica: { name: "CMDR FALrenica" } },
      byFile: { "Bacterium-aurasus-Lime.jpg": "falrenica" },
    });
    expect(photoContributorFor(root, "Bacterium-aurasus-Lime.jpg")?.name).toBe("CMDR FALrenica");

    setPhotoCreditsForTests(null);
    expect(photoContributorFor(root, "Bacterium-aurasus-Lime.jpg")).toBeNull();

    clearPhotoCreditsCache();
    expect(photoContributorFor(root, "Bacterium-aurasus-Lime.jpg")?.name).toBe("CMDR FALrenica");
  });
});

describe("the region × species table", () => {
  const table = {
    regions: {
      "7": { name: "Inner Orion Spur", bioSystems: 100000, species: { "stratum_stratum_tectonicas": 9000 } },
    },
    speciesIds: ["stratum_stratum_tectonicas"],
  };

  it("re-reads the file after the cache is cleared", () => {
    const root = rootWith("data/exomastery/region-species.json", table);
    expect(regionalPresence(root, 7, "stratum_stratum_tectonicas")?.regionName).toBe("Inner Orion Spur");

    setRegionSpeciesForTests(null);
    expect(regionalPresence(root, 7, "stratum_stratum_tectonicas")).toBeNull();

    clearRegionSpeciesCache();
    expect(regionalPresence(root, 7, "stratum_stratum_tectonicas")?.regionName).toBe("Inner Orion Spur");
  });

  it("drops the derived vocabulary with the file, not just the file", () => {
    const root = rootWith("data/exomastery/region-species.json", table);
    // Prime both the file cache and the vocabulary built from it.
    expect(regionalPresence(root, 7, "stratum_stratum_tectonicas")).not.toBeNull();
    // A vocabulary that outlived its file would answer "unknown" for a species the new file names.
    clearRegionSpeciesCache();
    const verdict = regionalPresence(root, 7, "stratum_stratum_tectonicas");
    expect(verdict?.presence).not.toBe("unknown");
  });
});
