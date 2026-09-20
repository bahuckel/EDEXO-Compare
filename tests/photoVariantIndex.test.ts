/**
 * A colour may have more than one photograph.
 *
 * `Fungoida Bullarum - Gold 2` is the first, and there was never a reason for it to be the last —
 * one colour on two bodies can look quite unlike itself, so a commander photographing both is adding
 * information rather than duplicating a file. Two things refused it:
 *
 * - **`variantColourOf` compared the tail for equality with a colour**, so `…-Gold-2` read as the
 *   colour `gold2`, matched nothing, and the photograph was invisible to the app — no error, no
 *   warning, just a file in the tree nothing ever shows.
 * - **The importer's filename pattern allowed only letters and spaces after the dash**, so a
 *   trailing digit made the whole name unreadable and the file was reported as a typo.
 *
 * A run of digits after the colour is now an index and nothing else. The closed
 * {@link VARIANT_COLOURS} list still does the deciding, so `…-Golden.jpg` is as unreadable as it
 * always was — the point of the list is that it cannot be talked into inventing a colour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const resolver = readFileSync(path.resolve(__dirname, "../src/server/speciesPhotos.ts"), "utf8");
const importer = readFileSync(path.resolve(__dirname, "../scripts/import-my-photos.ts"), "utf8");

/** `variantColourOf`, transcribed — the module reads the species tree and cannot be imported here. */
const VARIANT_COLOURS = [
  "amethyst",
  "aquamarine",
  "blue",
  "cobalt",
  "cyan",
  "emerald",
  "gold",
  "green",
  "grey",
  "indigo",
  "lime",
  "magenta",
  "maroon",
  "mauve",
  "mulberry",
  "ocher",
  "orange",
  "peach",
  "red",
  "sage",
  "teal",
  "turquoise",
  "white",
  "yellow",
] as const;

const normStem = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "");

function variantColourOf(file: string, speciesStem: string): string | null {
  const n = normStem(file);
  if (!speciesStem || !n.startsWith(speciesStem)) return null;
  const tail = n.slice(speciesStem.length);
  if (!tail) return null;
  const hit = VARIANT_COLOURS.find(
    (c) => tail === c || (tail.startsWith(c) && /^\d+$/.test(tail.slice(c.length))),
  );
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : null;
}

/** The importer's pattern, transcribed from the script for the same reason. */
function parseName(file: string) {
  const m = /^(.*?)\s*-\s*([A-Za-z][A-Za-z ]*?)\s*(?:[-(\s]\s*(\d+)\s*\)?)?\s*\.(jpe?g|png|webp)$/i.exec(
    file,
  );
  if (!m) return null;
  return { species: m[1]!.trim(), colour: m[2]!.trim(), index: (m[3] ?? "").trim() };
}

const STEM = "fungoidabullarum";

describe("a second photograph of the same colour", () => {
  it("still reads as that colour, indexed or not", () => {
    expect(variantColourOf("Fungoida-bullarum-Gold.jpg", STEM)).toBe("Gold");
    expect(variantColourOf("Fungoida-bullarum-Gold-2.jpg", STEM)).toBe("Gold");
    expect(variantColourOf("Fungoida-bullarum-Gold-17.jpg", STEM)).toBe("Gold");
    // And the spellings the resolver has always been indifferent to keep working.
    expect(variantColourOf("fungoida bullarum gold 2.png", STEM)).toBe("Gold");
  });

  it("does not turn a longer word into a colour", () => {
    /*
      The digits have to be the whole remainder. This is what keeps the closed colour list doing the
      deciding — the alternative, "any word after the species", would read a stray suffix as a
      colour and quietly file a photograph under something the species cannot be.
    */
    expect(variantColourOf("Fungoida-bullarum-Golden.jpg", STEM)).toBeNull();
    expect(variantColourOf("Fungoida-bullarum-Gold2x.jpg", STEM)).toBeNull();
    expect(variantColourOf("Fungoida-bullarum-2.jpg", STEM)).toBeNull();
    expect(variantColourOf("Fungoida-bullarum.jpg", STEM)).toBeNull();
  });

  it("reads the index off every spelling a commander might use", () => {
    for (const [file, index] of [
      ["Fungoida Bullarum - Gold.jpg", ""],
      ["Fungoida Bullarum - Gold 2.jpg", "2"],
      ["Fungoida Bullarum - Gold-2.jpg", "2"],
      ["Fungoida Bullarum - Gold (2).jpg", "2"],
    ] as const) {
      const p = parseName(file);
      expect(p, file).toBeTruthy();
      expect(p!.colour, file).toBe("Gold");
      expect(p!.index, file).toBe(index);
    }
  });

  it("keeps the colour out of the index and the index out of the colour", () => {
    // A two-word colour still parses, and does not swallow a number that is not there.
    const p = parseName("Aleoida Arcus - Light Green.jpg");
    expect(p?.colour).toBe("Light Green");
    expect(p?.index).toBe("");
  });

  it("gives the indexed file its own name, so the second does not overwrite the first", () => {
    expect(importer).toContain('const suffix = parsed.index ? `-${parsed.index}` : "";');
    expect(importer).toContain('${canonicalColour.replace(/\\s+/g, "_")}${suffix}.${parsed.ext}');
  });

  it("lets the unindexed photograph lead its colour, so the hero does not change under him", () => {
    /*
      `heroPhotoUrlFor` takes the first variant of the predicted colour, so this sort decides the
      face of the species. Two orderings were wrong before this one: readdir order, which is the
      filesystem's business and differs between machines, and plain filename order, where `-` sorts
      before `.` and `…-Gold-2.jpg` therefore came out ahead of `…-Gold.jpg`. Adding a second
      photograph must not silently replace the first.
    */
    expect(resolver).toContain("variantIndexOf(a.f, speciesStem) - variantIndexOf(b.f, speciesStem)");
    expect(resolver).toContain("function variantIndexOf(");
  });

  it("reads the index a filename carries, or zero", () => {
    const variantIndexOf = (file: string, stem: string): number => {
      const n = normStem(file);
      if (!stem || !n.startsWith(stem)) return 0;
      const m = /(\d+)$/.exec(n.slice(stem.length));
      return m ? Number(m[1]) : 0;
    };
    expect(variantIndexOf("Fungoida-bullarum-Gold.jpg", STEM)).toBe(0);
    expect(variantIndexOf("Fungoida-bullarum-Gold-2.jpg", STEM)).toBe(2);
    expect(variantIndexOf("Fungoida-bullarum-Gold-17.jpg", STEM)).toBe(17);
    // 0 before 2 before 17 — numeric, not lexical, or the tenth photograph would sort before the second.
    expect([17, 2, 0].sort((a, b) => a - b)).toEqual([0, 2, 17]);
  });
});
