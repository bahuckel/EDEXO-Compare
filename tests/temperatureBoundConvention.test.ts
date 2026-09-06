import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

let root: string;
const saved = process.env.EDEXO_SPECIES_DATA_DIR;

/**
 * `temperature_K: [min, max]`, where **`null` means no upper bound and a number means that number**.
 *
 * The loader used to treat `999` *or anything ≥ 500* as unbounded. That threshold was a landmine
 * rather than a convention: it fired on the six `999`s in `stratum_new.json` and on nothing else, so
 * the only thing it could ever do in future was silently unbound a species whose codex row genuinely
 * stops at 600 K. The fourth case below is the one the old rule got wrong.
 */
function genus(name: string, pairs: [number, number | null][]): void {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}_new.json`),
    JSON.stringify({
      genus: name,
      species: pairs.map(([lo, hi], i) => ({
        name: `${name} sp${i}`,
        conditions: { planet_types: ["Rocky"], temperature_K: [lo, hi] },
      })),
    }),
    "utf8",
  );
}

function maxima(): (number | undefined)[] {
  return loadSpeciesDatabaseFromTree(path.dirname(root))
    .species.sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((s) => s.criteria.surfaceTemperatureK?.max);
}

beforeEach(() => {
  const box = mkdtempSync(path.join(tmpdir(), "edexo-tempconv-"));
  root = path.join(box, "species");
  mkdirSync(root, { recursive: true });
  process.env.EDEXO_SPECIES_DATA_DIR = root;
});

afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_SPECIES_DATA_DIR;
  else process.env.EDEXO_SPECIES_DATA_DIR = saved;
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("the temperature upper-bound convention", () => {
  it("reads null as no upper bound", () => {
    genus("alpha", [[165, null]]);
    expect(maxima()).toEqual([undefined]);
  });

  it("keeps a real maximum", () => {
    genus("alpha", [[165, 195]]);
    expect(maxima()).toEqual([195]);
  });

  /** Older and hand-edited files still say 999; it works, and the convention says write null. */
  it("still honours the deprecated 999 sentinel", () => {
    genus("alpha", [[165, 999]]);
    expect(maxima()).toEqual([undefined]);
  });

  /**
   * The point of the change. Under the old `hi >= 500` rule this species was unbounded, which would
   * have quietly offered it on bodies hundreds of kelvin past where its codex row stops.
   */
  it("treats a genuine high maximum as a maximum, not as a sentinel", () => {
    genus("alpha", [[400, 600]]);
    expect(maxima()).toEqual([600]);
  });

  it("handles a mixed genus without cross-contamination", () => {
    genus("alpha", [
      [165, null],
      [180, 195],
      [400, 600],
    ]);
    expect(maxima()).toEqual([undefined, 195, 600]);
  });
});
