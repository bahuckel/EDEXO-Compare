/**
 * A packaged build ships each species photograph's 1024 px WebP card in place of its original
 * (review F-4.1c, scripts/packagedData.mjs). Every species must resolve to the same photos, variants
 * and credits from that tree as from the repository's, and the photo route must serve the card.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearSpeciesPhotoCache, resolveSpeciesPhoto } from "../src/server/speciesPhotos.js";
import { clearGenusPhotosFolderCache, loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
// @ts-expect-error — a plain .mjs build script, no types
import { isReplacedPhotoOriginal, ORIGINALS_FILE } from "../scripts/packagedData.mjs";

const REPO = process.cwd();
const SPECIES = join(REPO, "data", "species");
let packed: string;
let replaced = 0;

beforeAll(() => {
  packed = mkdtempSync(join(tmpdir(), "edexo-packed-photos-"));
  const dest = join(packed, "data", "species");
  const lists = new Map<string, string[]>();
  // The same filter as copyDataTree, over the species tree only (the rest of data/ is irrelevant here).
  cpSync(SPECIES, dest, {
    recursive: true,
    filter: (src) => {
      const rel = join("data", relative(join(REPO, "data"), src));
      if (isReplacedPhotoOriginal(rel)) {
        const d = relative(SPECIES, dirname(src));
        lists.set(d, [...(lists.get(d) ?? []), basename(src)]);
        replaced += 1;
        return false;
      }
      return true;
    },
  });
  for (const [d, names] of lists) writeFileSync(join(dest, d, "_cards", ORIGINALS_FILE), JSON.stringify(names));
});
afterAll(() => {
  rmSync(packed, { recursive: true, force: true });
  clearSpeciesPhotoCache();
  clearGenusPhotosFolderCache();
});

describe("photos with their originals replaced by cards", () => {
  it("left the originals out", () => {
    expect(replaced).toBeGreaterThan(150);
    const left = readdirSync(join(packed, "data", "species", "aleoida", "aleoida_photos")).filter((f) => /\.(jpe?g|png)$/i.test(f));
    expect(left).toEqual([]);
  });

  it("resolves every species to the same photos, variants and credits", () => {
    const db = loadSpeciesDatabaseFromTree(REPO);
    expect(db.species.length).toBeGreaterThan(100);
    let compared = 0;
    for (const e of db.species) {
      clearSpeciesPhotoCache();
      clearGenusPhotosFolderCache();
      const a = resolveSpeciesPhoto(e, REPO);
      clearSpeciesPhotoCache();
      clearGenusPhotosFolderCache();
      const b = resolveSpeciesPhoto(e, packed);
      expect({ id: e.id, ...b }).toEqual({ id: e.id, ...a });
      compared += 1;
    }
    expect(compared).toBe(db.species.length);
  });

  it("has a card for every original it left out", () => {
    for (const g of readdirSync(join(packed, "data", "species"))) {
      const cards = join(packed, "data", "species", g, `${g}_photos`, "_cards");
      const list = join(cards, ORIGINALS_FILE);
      if (!existsSync(list)) continue;
      for (const n of JSON.parse(readFileSync(list, "utf8")) as string[]) {
        expect(statSync(join(cards, n.replace(/\.[^.]+$/, ".webp"))).isFile()).toBe(true);
      }
    }
  });
});
