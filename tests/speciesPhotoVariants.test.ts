/**
 * A photograph of the variant the commander is actually going to find.
 *
 * Two things had to be true at once, and now both are: the app works out which colour a body will
 * grow, and the owner is photographing the variants one at a time. Without the pairing the card
 * shows *a* Bacterium vesicula, which is a different plant from the one waiting on the surface.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { resolveSpeciesPhoto, clearSpeciesPhotoCache } from "../src/server/speciesPhotos.js";
import { photoContributorFor, clearPhotoCreditsCache } from "../src/server/photoCredits.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabaseFromTree(root);
const find = (n: string): SpeciesEntry => {
  const e = db.species.find((x) => x.displayName.toLowerCase() === n.toLowerCase());
  if (!e) throw new Error(`no species entry for ${n}`);
  return e;
};

describe("colour-variant photographs", () => {
  it("finds every Bacterium vesicula variant the owner has photographed", () => {
    /*
      Read off the folder rather than frozen into a list. The batches keep coming -- Cyan arrived
      after this test was written and broke it -- and a test that fails whenever the owner takes
      another photograph is testing the photographs, not the code that finds them.
    */
    const dir = join(root, "data", "species", "bacterium", "bacterium_photos");
    const onDisk = readdirSync(dir)
      .map((f) => /^Bacterium-vesicula-(.+)\.(png|jpe?g|webp)$/i.exec(f)?.[1])
      .filter((c): c is string => !!c)
      .sort();
    expect(onDisk.length, "the owner has photographed some vesicula variants").toBeGreaterThan(1);
    const p = resolveSpeciesPhoto(find("Bacterium vesicula"), root);
    expect(p.photoVariants.map((v) => v.colour).sort()).toEqual(onDisk);
  });

  it("shows the commander's own photographs and retires ED-DSN's of that species", () => {
    /*
      This reverses what the variants originally did. They used to join the gallery and leave the
      shipped image as the primary; the owner asked for the opposite once he had photographed enough
      of them himself — "remove ED-DSN photos for every Genus+Species I have photographed". He walked
      to the plant and took the picture; ED-DSN's of the same species is redundant beside it, and
      misleading when the two are different colour variants.
    */
    const p = resolveSpeciesPhoto(find("Bacterium vesicula"), root);
    // One of the owner's own, whichever colours he has: never the shipped single image.
    expect(p.photoVariants.some((v) => v.url === p.photoUrl)).toBe(true);
    expect(p.photoUrls.some((u) => /Bacterium-vesicula\.(png|jpe?g|webp)/i.test(u))).toBe(false);
    expect(p.photoUrls).toContain(p.photoUrl);
    for (const v of p.photoVariants) expect(p.photoUrls).toContain(v.url);
  });

  it("says nothing about a species nobody has photographed by variant", () => {
    expect(resolveSpeciesPhoto(find("Bacterium tela"), root).photoVariants).toEqual([]);
  });

  it("does not read a number or a stray suffix as a colour", () => {
    // `Aleoida-arcus-2.png` is a second photograph, not an "Arcus 2" variant.
    for (const e of db.species) {
      for (const v of resolveSpeciesPhoto(e, root).photoVariants) {
        expect(v.colour, `${e.displayName} → ${v.url}`).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });
});

describe("who took the photograph", () => {
  it("credits the owner's own images to him, not to ED-DSN", () => {
    const p = resolveSpeciesPhoto(find("Stratum tectonicas"), root);
    const variant = p.photoVariants[0]!;
    expect(p.photoCreditByUrl?.[variant.url]?.name).toContain("FALrenica");
  });

  it("leaves the shipped images on the standing ED-DSN credit", () => {
    /*
      Absent, not "ED-DSN": the default lives in one place and only the exceptions travel.

      Checked on a species the owner has *not* photographed, since one he has no longer shows an
      ED-DSN image to credit.
    */
    const p = resolveSpeciesPhoto(find("Bacterium tela"), root);
    expect(p.photoCreditByUrl?.[p.photoUrl]).toBeUndefined();
    expect(photoContributorFor(root, "Bacterium-vesicula.png")).toBeNull();
  });

  it("credits every file the importer recorded", () => {
    expect(photoContributorFor(root, "Bacterium-vesicula-Lime.jpg")?.name).toContain("Bahuckel");
  });
});

/**
 * A photograph the commander took retires ED-DSN's of the same species.
 *
 * His report: he photographed Bacterium Bullaris and still saw ED-DSN's picture and credit. He
 * walked to that plant; showing somebody else's photograph of the same species beside his is
 * redundant at best, and misleading when the two are different colour variants.
 */
describe("a species the commander has photographed", () => {
  it("shows only his photographs, not ED-DSN's of the same species", () => {
    const root = mkdtempSync(join(tmpdir(), "edexo-photos-"));
    try {
      const dir = join(root, "data", "species", "bacterium", "bacterium_photos");
      mkdirSync(dir, { recursive: true });
      // ED-DSN's, under the plain species name, and his, named with the colour.
      writeFileSync(join(dir, "Bacterium-bullaris.png"), "x");
      writeFileSync(join(dir, "Bacterium-bullaris-Lime.jpg"), "x");
      mkdirSync(join(root, "data", "species"), { recursive: true });
      writeFileSync(
        join(root, "data", "species", "photo-credits.json"),
        JSON.stringify({
          contributors: { falrenica: { name: "Bahuckel — CMDR FALrenica" } },
          byFile: { "Bacterium-bullaris-Lime.jpg": "falrenica" },
        }),
      );
      clearPhotoCreditsCache();
      clearSpeciesPhotoCache();

      const resolved = resolveSpeciesPhoto(
        {
          id: "bacterium_bacterium_bullaris",
          displayName: "Bacterium Bullaris",
          genus: "Bacterium",
          genusDataDir: "bacterium",
        } as never,
        root,
      );

      expect(resolved.photoUrls.some((u) => u.includes("Bacterium-bullaris-Lime"))).toBe(true);
      // The whole point: ED-DSN's picture of this species is gone, not merely demoted.
      expect(resolved.photoUrls.some((u) => /Bacterium-bullaris\.png/i.test(u))).toBe(false);
      // And the credit that travels with it is his.
      expect(Object.values(resolved.photoCreditByUrl ?? {})[0]?.name).toContain("FALrenica");
    } finally {
      rmSync(root, { recursive: true, force: true });
      clearPhotoCreditsCache();
      clearSpeciesPhotoCache();
    }
  });
});
