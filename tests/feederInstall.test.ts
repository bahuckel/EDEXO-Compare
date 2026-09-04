import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeciesDatabase } from "../src/shared/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let sandbox: string;

/**
 * The installer writes into `data/species/**`, so it is pointed at a throwaway tree. Both the
 * feeder's own `speciesDataDir()` and the app loader's project root have to move together, or the
 * post-write verification would check the real repository.
 */
vi.mock("../src/feeder/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/feeder/paths.js")>("../src/feeder/paths.js");
  return {
    ...actual,
    get PROJECT_ROOT() {
      return sandbox;
    },
    speciesDataDir: () => path.join(sandbox, "data", "species"),
  };
});

const { findSpeciesEntryForLabel, installProfile, profileSampleCount, resolveInstallPath } =
  await import("../src/feeder/install.js");
const { loadSpeciesDatabaseFromTree } = await import("../src/server/speciesTreeLoader.js");

let db: SpeciesDatabase;

/** A minimal profile in the shape the builder emits — enough for the loader to call it usable. */
function profile(speciesLabel: string, samples: number) {
  return {
    formatVersion: 1 as const,
    speciesLabel,
    genus: speciesLabel.split(" ")[0]!,
    source: "exomastery_feeder" as const,
    generatedAt: new Date().toISOString(),
    sampleCount: samples,
    numerics: {
      "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: samples, mode: 0.2, modeCount: samples },
    },
    categorical: {},
    materials: {},
    atmosphereComposition: {},
    solidComposition: {},
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "edexo-feeder-"));
  // Copy the genus JSON only: the installer needs species rows, not the 1.1 MB of profiles.
  for (const genus of ["stratum", "bacterium", "brain-tree"]) {
    const dst = path.join(sandbox, "data", "species", genus);
    mkdirSync(dst, { recursive: true });
    const src = path.join(repoRoot, "data", "species", genus, `${genus}_new.json`);
    writeFileSync(path.join(dst, `${genus}_new.json`), readFileSync(src));
  }
  if (!db) db = loadSpeciesDatabaseFromTree(repoRoot);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("findSpeciesEntryForLabel", () => {
  it("matches the Spansh capitalisation of an ordinary species", () => {
    expect(findSpeciesEntryForLabel(db, "Stratum Tectonicas")?.id).toBe("stratum_stratum_tectonicas");
  });

  it("matches the colour-variant genera despite reversed word order", () => {
    // Spansh writes "Aureum Brain Tree"; the app row is "Brain Tree Aureum". This mismatch alone
    // left 8 Brain Tree and 8 Sinuous Tubers rows with no profile while their samples sat in the
    // corpus, un-installable.
    expect(findSpeciesEntryForLabel(db, "Aureum Brain Tree")?.displayName).toBe("Brain Tree Aureum");
    expect(findSpeciesEntryForLabel(db, "Prasinum Sinuous Tubers")?.displayName).toBe(
      "Sinuous Tubers Prasinum",
    );
  });

  it("refuses to guess when a label has no row, rather than attaching it to a near neighbour", () => {
    // The app carries one `Anemone` row; the corpus has six colour variants. Folding them together
    // would invent a habitat none of them has.
    expect(findSpeciesEntryForLabel(db, "Croceum Anemone")).toBeNull();
    expect(findSpeciesEntryForLabel(db, "Bark Mounds")).toBeNull();
    expect(findSpeciesEntryForLabel(db, "")).toBeNull();
  });
});

describe("profileSampleCount", () => {
  it("prefers the declared count and falls back to the rollups", () => {
    expect(profileSampleCount({ sampleCount: 42 })).toBe(42);
    expect(profileSampleCount({ numerics: { "body.gravity": { count: 17 } } })).toBe(17);
    expect(profileSampleCount({})).toBe(0);
  });
});

describe("installProfile", () => {
  it("writes where the app's loader will find it", () => {
    const r = installProfile(db, profile("Stratum Tectonicas", 100));
    expect(r.outcome.kind).toBe("installed");
    if (r.outcome.kind !== "installed") return;
    expect(r.outcome.previousSamples).toBeNull();
    expect(existsSync(r.outcome.path)).toBe(true);
    expect(r.outcome.path).toContain(path.join("stratum", "exomastery"));
    // Stamped with the app's own name for the species, not Spansh's. The loader identifies a
    // profile by its speciesLabel, so the file has to be named the way the reader names it.
    const written = JSON.parse(readFileSync(r.outcome.path, "utf8"));
    expect(written.speciesLabel).toBe("Stratum tectonicas");
    expect(written.sourceSpeciesLabel).toBe("Stratum Tectonicas");
  });

  it("rewrites the Spansh word order and genus so the loader can read the file", () => {
    // "Aureum Brain Tree" also carries genus "Aureum", because the builder takes the genus to be
    // the first word of the landmark. Written as-is, all eight Brain Tree profiles are files the
    // app never opens - which is what the post-write check caught.
    const r = installProfile(db, profile("Aureum Brain Tree", 2));
    expect(r.outcome.kind).toBe("installed");
    if (r.outcome.kind !== "installed") return;
    const written = JSON.parse(readFileSync(r.outcome.path, "utf8"));
    expect(written.speciesLabel).toBe("Brain Tree Aureum");
    // "Brain Trees" is what the app calls the genus; the point is that it is the app's string.
    expect(written.genus).toBe("Brain Trees");
    expect(written.sourceSpeciesLabel).toBe("Aureum Brain Tree");
  });

  it("refuses a profile built from fewer samples than the one in place", () => {
    // An interrupted hydration produces exactly this, and at the file level it is indistinguishable
    // from a good run. Nobody is watching each step any more, so the pipeline has to notice.
    expect(installProfile(db, profile("Stratum Tectonicas", 1280)).outcome.kind).toBe("installed");
    const r = installProfile(db, profile("Stratum Tectonicas", 300));
    expect(r.outcome.kind).toBe("refused-downgrade");
    if (r.outcome.kind !== "refused-downgrade") return;
    expect(r.outcome.previousSamples).toBe(1280);
    expect(r.outcome.samples).toBe(300);
    // Nothing written: the good profile survives.
    expect(JSON.parse(readFileSync(r.outcome.path, "utf8")).sampleCount).toBe(1280);
  });

  it("allows the downgrade when the caller asks for it", () => {
    installProfile(db, profile("Stratum Tectonicas", 1280));
    const r = installProfile(db, profile("Stratum Tectonicas", 300), { allowDowngrade: true });
    expect(r.outcome.kind).toBe("installed");
  });

  it("overwrites the existing file in place rather than adding a second one", () => {
    // The loader picks by sorted filename, so leaving two files for one species means the stale one
    // can win.
    const first = installProfile(db, profile("Stratum Tectonicas", 100));
    if (first.outcome.kind !== "installed") throw new Error("setup failed");
    const dir = path.dirname(first.outcome.path);
    const odd = path.join(dir, "aaa_renamed_by_hand.json");
    writeFileSync(odd, readFileSync(first.outcome.path));
    rmSync(first.outcome.path);

    const second = installProfile(db, profile("Stratum Tectonicas", 200));
    expect(second.outcome.kind).toBe("installed");
    if (second.outcome.kind !== "installed") return;
    expect(path.basename(second.outcome.path)).toBe("aaa_renamed_by_hand.json");
    expect(second.outcome.previousSamples).toBe(100);
  });

  it("reports a label the app has no row for instead of writing it somewhere", () => {
    const r = installProfile(db, profile("Croceum Anemone", 4));
    expect(r.outcome.kind).toBe("no-species-row");
  });
});

describe("resolveInstallPath", () => {
  it("names a first profile after the app's own species slug", () => {
    const entry = db.species.find((e) => e.id === "bacterium_bacterium_aurasus")!;
    expect(path.basename(resolveInstallPath(entry))).toBe("bacterium_aurasus_exomastery.json");
  });
});
