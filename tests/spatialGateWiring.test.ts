/**
 * The wiring between the spatial gates and the rest of the app.
 *
 * Phase 7 built `evaluateSpatialGate` and proved the thresholds, and `spatialGates.test.ts` covers
 * that arithmetic. It did not cover whether anything *reaches* it, and two things did not:
 *
 * 1. **The commander had no position.** `commanderPos` is read off `StarPos`, and the journal merge
 *    cache stores it — but a cache written before that field existed restores as `null`, and the
 *    fast path never replays a line that could fill it. `/api/commander-position` answered
 *    `{"position":null,"system":"Swoilz KI-E b4-9"}`: the system was known, the coordinate was not.
 *    A missing coordinate is deliberately *not* a gate failure, so every gate silently did nothing
 *    and Electricae radialem stayed in the strict list 175 ly from the nearest nebula.
 * 2. **A gate that cannot be evaluated looked like a gate that passed.** Phase 7 removed
 *    `predictionUnsupported` from the gated species — correctly, they are measurable now — but the
 *    genus split keyed its "no percentages" rule on exactly that flag. With no coordinate there is
 *    nothing to measure and the split came back, which is the bug the owner reported.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillCommanderPosition } from "../src/server/edexoBootstrap.js";
import { GameStateStore } from "../src/server/gameState.js";
import { demoteFailedSpatialGates } from "../src/server/matchSpecies.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { SpeciesEntry, SpeciesMatch } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cat = loadSpatialCatalogue(root)!;
const db = loadSpeciesDatabaseFromTree(root);

/** Swoilz KI-E b4-9 — the owner's home system, 175 ly from R Cra. */
const HOME = { x: 137, y: -88.84375, z: 298.09375 };

type Pending = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;

function entry(id: string): SpeciesEntry {
  const e = db.species.find((s) => s.id === id);
  if (!e) throw new Error(`no species row for ${id}`);
  return e;
}

const pending = (id: string): Pending => ({ entry: entry(id), reasons: [] });

describe("demoting on a failed gate", () => {
  it("moves a gated species to the unlikely tier at the owner's home system", () => {
    const strict: Pending[] = [pending("electricae_electricae_radialem"), pending("electricae_electricae_pluma")];
    const unlikely: Pending[] = [];

    demoteFailedSpatialGates(strict, unlikely, { systemCoords: HOME }, cat);

    expect(strict.map((m) => m.entry.id)).toEqual(["electricae_electricae_pluma"]);
    expect(unlikely).toHaveLength(1);
    expect(unlikely[0]!.unlikely).toBe(true);
    // The reader is told the distance and the rule, not merely that it was demoted.
    const reason = unlikely[0]!.unlikelyReasons!.at(-1)!;
    expect(reason.field).toBe("Nebula");
    expect(reason.soft).toBe(true);
    expect(reason.detail).toMatch(/175 ly/);
  });

  it("leaves a gated species alone where its gate passes", () => {
    // Inside the Coalsack, well within 150 ly of a catalogued nebula.
    const strict: Pending[] = [pending("electricae_electricae_radialem")];
    const unlikely: Pending[] = [];
    demoteFailedSpatialGates(strict, unlikely, { systemCoords: { x: 340, y: 10, z: 210 } }, cat);
    expect(unlikely).toHaveLength(0);
    expect(strict[0]!.spatialGateUnresolved).toBeUndefined();
  });
});

describe("when the gate cannot be evaluated", () => {
  /**
   * The third answer. Not a pass and not a failure — and it has to be *visible*, because an
   * unmarked survivor is indistinguishable from one that was measured and cleared.
   */
  it("marks a gated species rather than letting it look measured", () => {
    for (const ctx of [{}, { systemCoords: undefined }, null, undefined]) {
      const strict: Pending[] = [
        pending("electricae_electricae_radialem"),
        pending("electricae_electricae_pluma"),
      ];
      const unlikely: Pending[] = [];
      demoteFailedSpatialGates(strict, unlikely, ctx, cat);

      // Nothing is demoted — absence of a coordinate is not evidence of absence.
      expect(strict).toHaveLength(2);
      expect(unlikely).toHaveLength(0);
      expect(strict[0]!.spatialGateUnresolved).toBe(true);
      // pluma is star-gated, not spatial, so it carries no gate and no mark.
      expect(strict[1]!.spatialGateUnresolved).toBeUndefined();
    }
  });

  it("marks them the same way when the catalogue itself is missing", () => {
    const strict: Pending[] = [pending("sinuous_tuber_sinuous_tubers_prasinum")];
    demoteFailedSpatialGates(strict, [], { systemCoords: HOME }, null);
    expect(strict[0]!.spatialGateUnresolved).toBe(true);
  });
});

describe("recovering the commander's position from the logs", () => {
  let dir: string;
  const write = (name: string, lines: unknown[]) =>
    writeFileSync(path.join(dir, name), lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-starpos-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the last StarPos out of the newest log", async () => {
    write("a.log", [{ event: "Location", StarSystem: "Old", StarPos: [1, 2, 3] }]);
    write("b.log", [
      { event: "FSDJump", StarSystem: "Mid", StarPos: [10, 20, 30] },
      { event: "Scan", BodyName: "Mid 1" },
      { event: "FSDJump", StarSystem: "New", StarPos: [137, -88.84375, 298.09375] },
    ]);

    const store = new GameStateStore();
    await backfillCommanderPosition(store, [path.join(dir, "a.log"), path.join(dir, "b.log")]);
    // The newest line in the newest file, not the first hit.
    expect(store.commanderPos).toEqual(HOME);
  });

  it("falls back to an older log when the newest carries no position", async () => {
    write("a.log", [{ event: "Location", StarSystem: "Old", StarPos: [1, 2, 3] }]);
    write("b.log", [{ event: "Music", MusicTrack: "MainMenu" }]);

    const store = new GameStateStore();
    await backfillCommanderPosition(store, [path.join(dir, "a.log"), path.join(dir, "b.log")]);
    expect(store.commanderPos).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("does not overwrite a position the replay already established", async () => {
    write("a.log", [{ event: "FSDJump", StarSystem: "Elsewhere", StarPos: [1, 2, 3] }]);
    const store = new GameStateStore();
    store.commanderPos = HOME;
    await backfillCommanderPosition(store, [path.join(dir, "a.log")]);
    expect(store.commanderPos).toEqual(HOME);
  });

  it("leaves the position null when no log carries one, rather than inventing an origin", async () => {
    write("a.log", [{ event: "Music", MusicTrack: "MainMenu" }]);
    const store = new GameStateStore();
    await backfillCommanderPosition(store, [path.join(dir, "a.log")]);
    expect(store.commanderPos).toBeNull();
  });

  it("ignores a malformed StarPos instead of storing NaN", async () => {
    write("a.log", [
      { event: "FSDJump", StarSystem: "Good", StarPos: [5, 6, 7] },
      { event: "FSDJump", StarSystem: "Bad", StarPos: ["x", null, 3] },
    ]);
    const store = new GameStateStore();
    await backfillCommanderPosition(store, [path.join(dir, "a.log")]);
    expect(store.commanderPos).toEqual({ x: 5, y: 6, z: 7 });
  });

  it("survives a log it cannot read and keeps searching", async () => {
    write("a.log", [{ event: "Location", StarSystem: "Old", StarPos: [1, 2, 3] }]);
    const store = new GameStateStore();
    await backfillCommanderPosition(store, [path.join(dir, "a.log"), path.join(dir, "does-not-exist.log")]);
    expect(store.commanderPos).toEqual({ x: 1, y: 2, z: 3 });
  });
});
