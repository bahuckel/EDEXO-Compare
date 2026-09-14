/**
 * A moon's biological signal count is about that moon.
 *
 * `propagateExoAmongSimilarMoons` shares exo knowledge between sibling moons that scan alike, which
 * is right for genus *hints* — a genus growing next door is worth suggesting here. It was also
 * copying the **count**, and a count is not shareable: `FSSBodySignals` is the game stating how many
 * signals one specific rock has.
 *
 * The report that found it, from `Plio Aip NM-U d3-13`:
 *
 * ```
 *   02:01:08  FSSBodySignals   4 b   bio=3
 *   02:01:19  FSSBodySignals   4 c   bio=2
 *   02:03:50  SAASignalsFound  4 b   bio=3  Genuses: Bacterium, Tubus, Tussock
 * ```
 *
 * 4 b's DSS overwrote 4 c's two with three and carried 4 b's genera across, so the panel raised
 * "1 genus missing from the candidate list" against a body that never had three signals and was
 * never DSS'd. The gate it accused was right: 4 c is 154 K and every Tubus starts at 160.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 458177514787;
const T = "2026-09-14T02:00:00Z";

/** Two moons of planet 16, scanning alike enough for the propagation to consider them siblings. */
function moonScan(bodyId: number, name: string, tempK: number): JournalLine {
  return {
    timestamp: T,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: name,
    BodyID: bodyId,
    Parents: [{ Planet: 16 }, { Star: 0 }],
    StarSystem: "Plio Aip NM-U d3-13",
    SystemAddress: SYS,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    Landable: true,
    SurfaceTemperature: tempK,
    SurfaceGravity: 0.83,
    SurfacePressure: 1351.3,
    Radius: 724824.375,
    MassEM: 0.001094,
    Composition: { Ice: 0, Rock: 0.91023, Metal: 0.08977 },
  } as unknown as JournalLine;
}

function fssSignals(bodyId: number, name: string, count: number): JournalLine {
  return {
    timestamp: T,
    event: "FSSBodySignals",
    BodyName: name,
    BodyID: bodyId,
    SystemAddress: SYS,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: count }],
  } as unknown as JournalLine;
}

function saaSignals(bodyId: number, name: string, count: number, genera: string[]): JournalLine {
  return {
    timestamp: T,
    event: "SAASignalsFound",
    BodyName: name,
    BodyID: bodyId,
    SystemAddress: SYS,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: count }],
    Genuses: genera.map((g) => ({ Genus: `$Codex_Ent_${g}_Genus_Name;`, Genus_Localised: g })),
  } as unknown as JournalLine;
}

const jump = {
  timestamp: T,
  event: "FSDJump",
  StarSystem: "Plio Aip NM-U d3-13",
  SystemAddress: SYS,
  StarPos: [4824.875, 674.71875, 9529.875],
} as unknown as JournalLine;

let store: InstanceType<Awaited<typeof import("../src/server/gameState.js")>["GameStateStore"]>;

beforeEach(async () => {
  const { GameStateStore } = await import("../src/server/gameState.js");
  store = new GameStateStore();
  store.apply(jump);
  store.apply(moonScan(18, "Plio Aip NM-U d3-13 4 b", 167.038818));
  store.apply(moonScan(20, "Plio Aip NM-U d3-13 4 c", 154.121689));
});

function body(bodyId: number) {
  return [...store.bodies.values()].find((b) => b.bodyId === bodyId && b.systemAddress === SYS);
}

describe("a sibling's own signal count", () => {
  it("survives a neighbour's DSS", () => {
    store.apply(fssSignals(18, "Plio Aip NM-U d3-13 4 b", 3));
    store.apply(fssSignals(20, "Plio Aip NM-U d3-13 4 c", 2));
    store.apply(saaSignals(18, "Plio Aip NM-U d3-13 4 b", 3, ["Bacterial", "Tubus", "Tussocks"]));

    expect(body(18)?.biologicalSignals).toBe(3);
    // The regression: this read 3, and the panel then demanded a third genus from a two-signal body.
    expect(body(20)?.biologicalSignals).toBe(2);
  });

  it("survives a neighbour's FSS too", () => {
    store.apply(fssSignals(20, "Plio Aip NM-U d3-13 4 c", 2));
    store.apply(fssSignals(18, "Plio Aip NM-U d3-13 4 b", 3));
    expect(body(20)?.biologicalSignals).toBe(2);
  });

  it("still fills in a moon the game has said nothing about", () => {
    // The propagation earns its place here: a sibling with no count of its own inherits one, which is
    // how a moon the commander never honked individually still shows up as worth a look.
    store.apply(fssSignals(18, "Plio Aip NM-U d3-13 4 b", 3));
    expect(body(20)?.biologicalSignals).toBe(3);
  });

  /**
   * The ordering that actually fired it.
   *
   * `FSSBodySignals` arrives *before* each `Scan` in the real journal, so the counts are already in
   * place when the scan establishes the moon's parent and `syncExoStateFromSiblingMoons` runs. That
   * path took the larger of the two counts, which is a second overwrite in a different function —
   * and the tests above never reached it, because they scan first. Both guards are needed.
   */
  it("survives the real journal ordering, where FSS precedes the Scan", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const s = new GameStateStore();
    s.apply(jump);
    s.apply(fssSignals(18, "Plio Aip NM-U d3-13 4 b", 3));
    s.apply(moonScan(18, "Plio Aip NM-U d3-13 4 b", 167.038818));
    s.apply(fssSignals(20, "Plio Aip NM-U d3-13 4 c", 2));
    s.apply(moonScan(20, "Plio Aip NM-U d3-13 4 c", 154.121689));
    s.apply(saaSignals(18, "Plio Aip NM-U d3-13 4 b", 3, ["Bacterial", "Tubus", "Tussocks"]));

    const four_c = [...s.bodies.values()].find((b) => b.bodyId === 20 && b.systemAddress === SYS);
    const four_b = [...s.bodies.values()].find((b) => b.bodyId === 18 && b.systemAddress === SYS);
    expect(four_b?.biologicalSignals).toBe(3);
    expect(four_c?.biologicalSignals).toBe(2);
  });

  /**
   * The commander's own DSS is the last word on which genera a body has.
   *
   * A DSS writes three lines at the same second, and the trailing `Scan` re-runs the sibling sync:
   *
   * ```
   *   SAAScanComplete   4 c
   *   SAASignalsFound   4 c   Genuses: Bacterium, Tussock
   *   Scan              4 c
   * ```
   *
   * That last line merged the neighbour's Tubus back over the answer the game had just given, so a
   * genus the commander had personally confirmed absent kept showing on the candidate list.
   */
  it("does not re-add a neighbour's genus after this body's own DSS ruled it out", () => {
    store.apply(fssSignals(18, "Plio Aip NM-U d3-13 4 b", 3));
    store.apply(fssSignals(20, "Plio Aip NM-U d3-13 4 c", 2));
    store.apply(saaSignals(18, "Plio Aip NM-U d3-13 4 b", 3, ["Bacterial", "Tubus", "Tussocks"]));

    // 4 c's own DSS: two genera, and the game is naming all of them.
    store.apply({
      timestamp: T, event: "SAAScanComplete", BodyName: "Plio Aip NM-U d3-13 4 c", BodyID: 20, SystemAddress: SYS,
    } as unknown as JournalLine);
    store.apply(saaSignals(20, "Plio Aip NM-U d3-13 4 c", 2, ["Bacterial", "Tussocks"]));
    // The `Scan` the DSS emits immediately afterwards — the line that used to undo it.
    store.apply(moonScan(20, "Plio Aip NM-U d3-13 4 c", 154.121689));

    const hints = (body(20)?.genusHints ?? []).map((h) => h.Genus_Localised ?? "");
    expect(hints).toHaveLength(2);
    expect(hints.some((h) => /tubus/i.test(h))).toBe(false);
    // The neighbour is untouched: its own DSS really did find three.
    expect((body(18)?.genusHints ?? []).length).toBe(3);
  });

  it("carries the genera across regardless, because a hint is not a count", () => {
    store.apply(fssSignals(20, "Plio Aip NM-U d3-13 4 c", 2));
    store.apply(saaSignals(18, "Plio Aip NM-U d3-13 4 b", 3, ["Bacterial", "Tubus", "Tussocks"]));
    const hints = (body(20)?.genusHints ?? []).map((h) => h.Genus_Localised);
    expect(hints.length).toBeGreaterThan(0);
    expect(body(20)?.biologicalSignals).toBe(2);
  });
});
