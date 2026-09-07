/**
 * INCLUDE-BODY-IDS Phase 10 step 2 — per-sector, per-species evidence counts.
 *
 * The two rules that stop the map lying are the ones worth pinning: a body is counted once at its
 * strongest evidence, and the evidence kinds never merge into a single number.
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_KINDS,
  aggregateBySector,
  foldBodyEvidence,
  markerKind,
  strongerEvidence,
  summariseAggregate,
  type BodyEvidence,
} from "../src/shared/sectorAggregate.js";
import { genusKeyFromCodex, taxonFromSpeciesLabel } from "../src/feeder/sectorMapData.js";
import { sectorCellFromCoords } from "../src/shared/sectorName.js";

const at = (x: number, y: number, z: number, bodyKey: string, taxon: string, kind: BodyEvidence["kind"]): BodyEvidence => ({
  x,
  y,
  z,
  bodyKey,
  taxon,
  kind,
});

describe("evidence precedence", () => {
  it("orders weakest to strongest, and confirmed wins everything", () => {
    expect([...EVIDENCE_KINDS]).toEqual(["predicted", "signal", "genus", "confirmed"]);
    expect(strongerEvidence("predicted", "confirmed")).toBe("confirmed");
    expect(strongerEvidence("genus", "signal")).toBe("genus");
    expect(strongerEvidence("signal", "signal")).toBe("signal");
  });

  /**
   * A genus hit sits between a bare signal and a species because it is a real observation that
   * narrows the answer without settling it — knowing "Bacterium" rules out nineteen other genera.
   */
  it("puts a genus hit above a bare signal", () => {
    expect(strongerEvidence("genus", "signal")).toBe("genus");
    expect(strongerEvidence("genus", "confirmed")).toBe("confirmed");
  });
});

describe("one body, one count", () => {
  it("collapses a body's several observations to its strongest", () => {
    const folded = foldBodyEvidence([
      at(0, 0, 0, "b1", "bacterium aurasus", "signal"),
      at(0, 0, 0, "b1", "bacterium aurasus", "confirmed"),
      at(0, 0, 0, "b1", "bacterium aurasus", "genus"),
    ]);
    expect(folded.size).toBe(1);
    expect([...folded.values()][0]!.kind).toBe("confirmed");
  });

  it("does not collapse across taxa on the same body — two species is two dots", () => {
    const folded = foldBodyEvidence([
      at(0, 0, 0, "b1", "bacterium aurasus", "confirmed"),
      at(0, 0, 0, "b1", "frutexa acus", "confirmed"),
    ]);
    expect(folded.size).toBe(2);
  });

  it("without the collapse, one body would inflate a sector threefold", () => {
    const entries = aggregateBySector([
      at(0, 0, 0, "b1", "x", "signal"),
      at(0, 0, 0, "b1", "x", "genus"),
      at(0, 0, 0, "b1", "x", "confirmed"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.counts.bodies).toBe(1);
    expect(entries[0]!.counts.confirmed).toBe(1);
    expect(entries[0]!.counts.signal).toBe(0);
  });
});

describe("aggregation", () => {
  it("groups by sector cell and taxon, and keeps the kinds apart", () => {
    const entries = aggregateBySector([
      at(0, 0, 0, "b1", "bacterium aurasus", "confirmed"),
      at(10, 10, 10, "b2", "bacterium aurasus", "signal"), // same cell, 1280 ly is wide
      at(0, 0, 0, "b3", "frutexa acus", "confirmed"),
      at(-40000, 0, 0, "b4", "bacterium aurasus", "confirmed"), // a long way away
    ]);
    expect(entries).toHaveLength(3);
    const solCell = sectorCellFromCoords(0, 0, 0);
    const bact = entries.find((e) => e.taxon === "bacterium aurasus" && e.cell.x === solCell.x)!;
    expect(bact.counts).toEqual({ confirmed: 1, genus: 0, signal: 1, predicted: 0, bodies: 2 });
  });

  it("gives the marker the strongest colour present, not the commonest", () => {
    // 99 signals and one confirmed is still a confirmed sector.
    expect(markerKind({ confirmed: 1, genus: 0, signal: 99, predicted: 0, bodies: 100 })).toBe("confirmed");
    expect(markerKind({ confirmed: 0, genus: 0, signal: 1, predicted: 9, bodies: 10 })).toBe("signal");
    expect(markerKind({ confirmed: 0, genus: 0, signal: 0, predicted: 0, bodies: 0 })).toBeNull();
  });

  it("summarises without losing the split", () => {
    const s = summariseAggregate(
      aggregateBySector([
        at(0, 0, 0, "b1", "a", "confirmed"),
        at(0, 0, 0, "b2", "a", "signal"),
        at(-40000, 0, 0, "b3", "b", "genus"),
      ]),
    );
    expect(s.sectors).toBe(2);
    expect(s.taxa).toBe(2);
    expect(s.totals.confirmed).toBe(1);
    expect(s.totals.signal).toBe(1);
    expect(s.totals.genus).toBe(1);
    expect(s.byMarker.confirmed).toBe(1);
    expect(s.byMarker.genus).toBe(1);
  });

  it("handles an empty world", () => {
    expect(aggregateBySector([])).toEqual([]);
    const s = summariseAggregate([]);
    expect(s.entries).toBe(0);
    expect(s.totals.bodies).toBe(0);
  });
});

describe("taxon keys", () => {
  /**
   * EDDN's genus keys are the game's internal names. Stripping the wrapper gives something readable
   * that is still a *key*, not a label — §23.4 is the standing warning about presenting one as the
   * other.
   */
  it("reduces a codex genus key to a token", () => {
    expect(genusKeyFromCodex("$Codex_Ent_Bacterial_Genus_Name;")).toBe("bacterial");
    expect(genusKeyFromCodex("$Codex_Ent_Sphere_Name;")).toBe("sphere"); // Anemone, no _Genus infix
    expect(genusKeyFromCodex("$Codex_Ent_Ground_Struct_Ice_Name;")).toBe("ground_struct_ice");
  });

  it("passes an unrecognised key through rather than dropping the marker", () => {
    expect(genusKeyFromCodex("something else")).toBe("something else");
  });

  it("normalises a corpus species label the same way every time", () => {
    expect(taxonFromSpeciesLabel("  Bacterium Aurasus ")).toBe("bacterium aurasus");
  });
});
