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

/**
 * Marks written before the body name came from Status.json.
 *
 * `ScanOrganic` has no `BodyName`, so the old derivation produced `"body 22"` — a string nothing
 * else in the app uses, which meant a recorded plant could never match the surface it was taken on.
 * The position is unrecoverable, so those marks are repaired rather than dropped: the name is
 * cleared and the radar falls back to the body key, which was always correct.
 */
describe("surface marks written by an older build", () => {
  it("clears a placeholder body name instead of discarding the position", async () => {
    /*
      Into a temp directory, never the real one. `resolveSurfaceMarksPath` is derived from the user
      data dir, and this file holds positions that nothing can recreate — a test that writes over a
      commander's own marks destroys data, which is exactly what happened once before this guard.
    */
    const previous = process.env.EDEXO_USER_DATA_DIR;
    const dir = mkdtempSync(join(tmpdir(), "edexo-marks-"));
    roots.push(dir);
    process.env.EDEXO_USER_DATA_DIR = dir;
    const { resetInstallPathCache } = await import("../src/server/paths.js");
    resetInstallPathCache();
    const { loadSurfaceMarks, saveSurfaceMarks } = await import("../src/server/surfaceMarksFile.js");
    saveSurfaceMarks({
      formatVersion: 1,
      samples: [
        { bodyKey: "1:22", bodyNameNorm: "body 22", latDeg: 1, lonDeg: 2, label: "Bacterium Acies", atIso: "x" },
        { bodyKey: "1:23", bodyNameNorm: "smojai uj-f b13-0 b 4", latDeg: 3, lonDeg: 4, label: "Keep", atIso: "y" },
      ],
      ship: null,
    });
    const back = loadSurfaceMarks();
    expect(back.samples).toHaveLength(2);
    expect(back.samples[0]!.bodyNameNorm).toBe("");
    // The coordinates are the irreplaceable part and must survive the repair untouched.
    expect(back.samples[0]!.latDeg).toBe(1);
    expect(back.samples[1]!.bodyNameNorm).toBe("smojai uj-f b13-0 b 4");

    if (previous === undefined) delete process.env.EDEXO_USER_DATA_DIR;
    else process.env.EDEXO_USER_DATA_DIR = previous;
    resetInstallPathCache();
  });
});
