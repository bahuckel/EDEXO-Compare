/**
 * The ED-DSN colour-variant tables, loaded once.
 *
 * `data/species/eddsn-colour-variants.json` is 10 kB and read at most once per process. A missing
 * file is not an error: every lookup then returns null, the candidate line says "(unknown)", and the
 * app is exactly as useful as it was before this existed. That is the same failure mode the region
 * map and the spatial catalogue chose.
 *
 * The file carries its own provenance block. The tables are a transcription of a published reference
 * — see `src/shared/colourVariants.ts` for what they fixed and how they were checked.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ColourVariantRule } from "../shared/colourVariants.js";

interface ColourVariantFile {
  formatVersion?: number;
  byGenus?: Record<string, ColourVariantRule>;
  bySpecies?: Record<string, ColourVariantRule>;
  corpusFills?: { byGenus?: Record<string, Record<string, string>> };
}

let cached: ColourVariantFile | null | undefined;

export function eddsnColourVariantsPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "species", "eddsn-colour-variants.json");
}

function load(projectRoot: string): ColourVariantFile | null {
  if (cached !== undefined) return cached;
  const file = eddsnColourVariantsPath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ColourVariantFile;
    cached = parsed?.byGenus || parsed?.bySpecies ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

function isRule(v: unknown): v is ColourVariantRule {
  const r = v as ColourVariantRule | undefined;
  return !!r && (r.source === "star" || r.source === "material") && !!r.map;
}

/**
 * The rule for one species: its own table when ED-DSN publishes one, else the genus table.
 *
 * Genera whose species all share a table (Aleoida, Stratum, Tussock…) are stored once under the
 * genus; genera that split (Bacterium, Osseus, Concha…) are stored per species. Looking up the
 * species first is what makes the split work — see `shared/colourVariants.ts`.
 *
 * `corpusFills` supplies star classes ED-DSN leaves blank that the owner has scanned himself. They
 * are merged *under* the transcription, never over it, so a later ED-DSN update simply wins.
 */
export function colourVariantRuleFor(
  projectRoot: string,
  genusDataDir: string,
  displayName: string,
): ColourVariantRule | null {
  const data = load(projectRoot);
  if (!data) return null;
  const sp = data.bySpecies?.[displayName.trim().toLowerCase()];
  const gen = data.byGenus?.[genusDataDir.trim().toLowerCase()];
  const base = isRule(sp) ? sp : isRule(gen) ? gen : null;
  if (!base) return null;
  if (base.source !== "star") return base;
  const fills = data.corpusFills?.byGenus?.[genusDataDir.trim().toLowerCase()];
  if (!fills) return base;
  return { source: "star", map: { ...fills, ...base.map } };
}

/** Test seam — the file is process-wide, so a test that swaps it must be able to put it back. */
export function setEddsnColourVariantsForTests(v: ColourVariantFile | null | undefined): void {
  cached = v;
}
