/**
 * A photograph of the variant the commander is actually going to find.
 *
 * Two things had to be true at once, and now both are: the app works out which colour a body will
 * grow, and the owner is photographing the variants one at a time. Without the pairing the card
 * shows *a* Bacterium vesicula, which is a different plant from the one waiting on the surface.
 */
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { resolveSpeciesPhoto } from "../src/server/speciesPhotos.js";
import { photoContributorFor } from "../src/server/photoCredits.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabaseFromTree(root);
const find = (n: string): SpeciesEntry => {
  const e = db.species.find((x) => x.displayName.toLowerCase() === n.toLowerCase());
  if (!e) throw new Error(`no species entry for ${n}`);
  return e;
};

describe("colour-variant photographs", () => {
  it("finds the three Bacterium vesicula variants the owner photographed", () => {
    const p = resolveSpeciesPhoto(find("Bacterium vesicula"), root);
    expect(p.photoVariants.map((v) => v.colour).sort()).toEqual(["Lime", "Orange", "Red"]);
  });

  it("keeps the species' own photograph as the primary", () => {
    // The variants join the gallery; they do not displace the image the species already had.
    const p = resolveSpeciesPhoto(find("Bacterium vesicula"), root);
    expect(p.photoUrl).toContain("Bacterium-vesicula.");
    expect(p.photoUrl).not.toMatch(/-(Lime|Orange|Red)\./);
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
    // Absent, not "ED-DSN": the default lives in one place and only the exceptions travel.
    const p = resolveSpeciesPhoto(find("Bacterium vesicula"), root);
    expect(p.photoCreditByUrl?.[p.photoUrl]).toBeUndefined();
    expect(photoContributorFor(root, "Bacterium-vesicula.png")).toBeNull();
  });

  it("credits every file the importer recorded", () => {
    expect(photoContributorFor(root, "Bacterium-vesicula-Lime.jpg")?.name).toContain("Bahuckel");
  });
});
