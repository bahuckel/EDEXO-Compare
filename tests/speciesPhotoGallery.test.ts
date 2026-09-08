/**
 * More than one photograph per species.
 *
 * The rule is deliberately narrow: a species' extra photos are its primary filename with a number
 * after it. It runs *after* the species has been identified by exact filename, so anything looser
 * would pull a sibling species into the gallery — the Frutexa acus bug again, but silent, because a
 * gallery of the wrong plant still looks like a gallery.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSpeciesPhotoCache, resolveSpeciesPhoto } from "../src/server/speciesPhotos.js";
import type { SpeciesEntry } from "../src/shared/types.js";

function makeTree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "edexo-photos-"));
  const dir = join(root, "data", "species", "aleoida", "aleoida_photos");
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "x");
  return root;
}

const entry = {
  id: "aleoida_aleoida_arcus",
  displayName: "Aleoida arcus",
  genus: "Aleoida",
  genusDataDir: "aleoida",
} as unknown as SpeciesEntry;

function resolve(files: string[]) {
  const root = makeTree(files);
  try {
    clearSpeciesPhotoCache();
    const r = resolveSpeciesPhoto(entry, root);
    return { ...r, names: r.photoUrls.map((u) => decodeURIComponent(u.split("/").pop() ?? "")) };
  } finally {
    rmSync(root, { recursive: true, force: true });
    clearSpeciesPhotoCache();
  }
}

describe("one photo", () => {
  it("still returns a single-entry list, so callers never special-case it", () => {
    const r = resolve(["Aleoida-arcus.png"]);
    expect(r.names).toEqual(["Aleoida-arcus.png"]);
    expect(r.photoUrls[0]).toBe(r.photoUrl);
  });

  it("gives the placeholder a list too", () => {
    const r = resolve([]);
    expect(r.photoUrls).toHaveLength(1);
    expect(r.photoUrls[0]).toBe(r.photoUrl);
  });
});

describe("numbered siblings", () => {
  it("collects them in numeric order, primary first", () => {
    const r = resolve([
      "Aleoida-arcus.png",
      "Aleoida-arcus-3.png",
      "Aleoida-arcus-2.jpg",
      "Aleoida-arcus-10.png",
    ]);
    // 10 after 9, not after 1 — the sort is numeric, not lexical.
    expect(r.names).toEqual([
      "Aleoida-arcus.png",
      "Aleoida-arcus-2.jpg",
      "Aleoida-arcus-3.png",
      "Aleoida-arcus-10.png",
    ]);
  });

  it("accepts any separator, because the comparison ignores punctuation", () => {
    const r = resolve(["Aleoida-arcus.png", "Aleoida-arcus_2.png", "Aleoida arcus 3.png"]);
    expect(r.names).toHaveLength(3);
    expect(r.names[0]).toBe("Aleoida-arcus.png");
  });

  it("does not pull in a different species", () => {
    // `Aleoida-arcus-2` is a second photo; `Aleoida-coronamus` is a different plant, and
    // `Aleoida-arcusella` is neither — a prefix match without the digit rule would take both.
    const r = resolve([
      "Aleoida-arcus.png",
      "Aleoida-arcus-2.png",
      "Aleoida-coronamus.png",
      "Aleoida-arcusella.png",
    ]);
    expect(r.names).toEqual(["Aleoida-arcus.png", "Aleoida-arcus-2.png"]);
  });

  it("does not collect siblings for a species matched only by similarity", () => {
    // No file is named for arcus, so the resolver falls back to a fuzzy hit. Anything numbered
    // beside *that* file says nothing about this species, so the gallery stays at one.
    const r = resolve(["Aleoida-arcuss.png", "Aleoida-arcuss-2.png"]);
    expect(r.photoUrls).toHaveLength(1);
    expect(r.photoNote).toBeTruthy();
  });
});
