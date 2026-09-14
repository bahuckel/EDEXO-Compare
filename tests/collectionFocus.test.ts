/**
 * The collection marker: which species are still worth a detour.
 *
 * The path is mocked from the first line so a test run can never read or write the commander's real
 * `%LOCALAPPDATA%` file — the prediction-audit tests learned that the hard way by resolving the live
 * one before anybody noticed.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edexo-focus-"));
const settingsPath = join(dir, "settings.json");

vi.mock("../src/server/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/paths.js")>("../src/server/paths.js");
  return { ...actual, resolveUserSettingsJsonPath: () => settingsPath };
});

const {
  DEFAULT_COLLECTION_FOCUS,
  collectionFocusPath,
  loadCollectionFocusConfig,
  saveCollectionFocusConfig,
  ownScanCountsBySpecies,
  computeCollectionFocus,
  clearCollectionFocusCache,
} = await import("../src/server/collectionFocus.js");
const { loadSpeciesDatabaseFromTree } = await import("../src/server/speciesTreeLoader.js");

const root = join(import.meta.dirname, "..");
const db = loadSpeciesDatabaseFromTree(root);

/** A body carrying one confirmed lock, shaped the way the store holds it. */
function bodyWith(locks: { genus: string; species: string; variant?: string }[]) {
  return {
    organicGenusLocks: locks.map((l) => ({
      genusLocalised: l.genus,
      genusSymbol: "",
      speciesLocalised: l.species,
      speciesSymbol: "",
      variantLocalised: l.variant ?? "",
    })),
  } as never;
}

beforeEach(() => {
  clearCollectionFocusCache();
  rmSync(collectionFocusPath(), { force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the config file", () => {
  it("lands beside the user settings, never in the repository", () => {
    expect(collectionFocusPath()).toBe(join(dir, "edexo-collection-focus.json"));
  });

  it("returns defaults when the file has never been written", () => {
    expect(loadCollectionFocusConfig()).toEqual(DEFAULT_COLLECTION_FOCUS);
  });

  it("survives a corrupt file rather than failing the snapshot that reads it", () => {
    writeFileSync(collectionFocusPath(), "{ this is not json", "utf8");
    expect(loadCollectionFocusConfig()).toEqual(DEFAULT_COLLECTION_FOCUS);
  });

  it("round-trips what it was given", () => {
    saveCollectionFocusConfig({ ...DEFAULT_COLLECTION_FOCUS, targetScans: 7, dismissed: ["a"] });
    const back = loadCollectionFocusConfig();
    expect(back.targetScans).toBe(7);
    expect(back.dismissed).toEqual(["a"]);
  });
});

describe("own scan counts", () => {
  it("counts distinct bodies, not journal lines", () => {
    // One plant is Log, Sample, Sample, Analyse — four events, and the store keeps a lock per event.
    // Counting those would retire a species after a single patch of ground.
    const one = bodyWith([
      { genus: "Stratum", species: "Stratum Tectonicas" },
      { genus: "Stratum", species: "Stratum Tectonicas" },
      { genus: "Stratum", species: "Stratum Tectonicas" },
    ]);
    const counts = ownScanCountsBySpecies([one], db);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it("adds up across separate bodies", () => {
    const b = () => bodyWith([{ genus: "Stratum", species: "Stratum Tectonicas" }]);
    const counts = ownScanCountsBySpecies([b(), b(), b()], db);
    expect(counts.get("stratum_stratum_tectonicas")).toBe(3);
  });
});

describe("what gets marked", () => {
  it("marks nothing at all when switched off", () => {
    const out = computeCollectionFocus([], db, root, { ...DEFAULT_COLLECTION_FOCUS, enabled: false });
    expect(out.size).toBe(0);
  });

  it("marks the thin end of the corpus and leaves the well-fed alone", () => {
    const out = computeCollectionFocus([], db, root, DEFAULT_COLLECTION_FOCUS);
    expect(out.size).toBeGreaterThan(0);
    // Fluctus rests on a handful of bodies; aurasus on thousands.
    expect(out.has("fonticulua_fonticulua_fluctus")).toBe(true);
    expect(out.has("bacterium_bacterium_aurasus")).toBe(false);
    for (const r of out.values()) expect(r.corpusBodies).toBeLessThan(DEFAULT_COLLECTION_FOCUS.corpusFloor);
  });

  it("drops a species once you have confirmed it enough times", () => {
    const cfg = { ...DEFAULT_COLLECTION_FOCUS, targetScans: 2 };
    const before = computeCollectionFocus([], db, root, cfg);
    expect(before.has("fonticulua_fonticulua_fluctus")).toBe(true);

    const b = () => bodyWith([{ genus: "Fonticulua", species: "Fonticulua Fluctus" }]);
    const after = computeCollectionFocus([b(), b()], db, root, cfg);
    expect(after.has("fonticulua_fonticulua_fluctus")).toBe(false);
  });

  it("honours a species you have told it to stop asking about", () => {
    const cfg = { ...DEFAULT_COLLECTION_FOCUS, dismissed: ["fonticulua_fonticulua_fluctus"] };
    const out = computeCollectionFocus([], db, root, cfg);
    expect(out.has("fonticulua_fonticulua_fluctus")).toBe(false);
  });
});
