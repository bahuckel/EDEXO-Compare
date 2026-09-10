/**
 * Why a body is showing candidates, which the commander has to be able to tell apart.
 *
 * An auto scan describes a body completely and reports no organics: the game shows a signal count on
 * screen, the journal never writes one, and only an FSS or a DSS puts it in a file. So a candidate
 * list can be backed by a real count or by nothing but the conditions, and those are very different
 * claims wearing the same clothes.
 */
import { describe, expect, it } from "vitest";
import { bodyHasExoMarkers, bodyHasJournalExoEvidence, exoMarkerBasis } from "../src/server/systemMap.js";
import type { BodyExoState } from "../src/shared/types.js";

const body = (over: Partial<BodyExoState> = {}): BodyExoState =>
  ({
    key: "1:2",
    bodyName: "Test 2",
    bodyId: 2,
    systemAddress: 1,
    starSystem: "Test",
    biologicalSignals: null,
    genusHints: null,
    dssComplete: false,
    scan: null,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-09-10T00:00:00Z",
    ...over,
  }) as BodyExoState;

const landableScan = { Landable: true, PlanetClass: "High metal content body" } as BodyExoState["scan"];

describe("what the list is standing on", () => {
  it("calls an auto-scanned body conditions-only", () => {
    // Blu Thua VH-G b38-1 1: a complete AutoScan, no FSSBodySignals anywhere in the journal.
    const b = body({ scan: landableScan });
    expect(exoMarkerBasis(b)).toBe("conditions");
    expect(bodyHasExoMarkers(b)).toBe(true);
  });

  it("prefers a real signal count over the conditions", () => {
    expect(exoMarkerBasis(body({ scan: landableScan, biologicalSignals: 1 }))).toBe("signals");
  });

  it("prefers a DSS genus list over a count", () => {
    const b = body({
      scan: landableScan,
      biologicalSignals: 1,
      genusHints: [{ genusLocalised: "Bacterium" }] as BodyExoState["genusHints"],
    });
    expect(exoMarkerBasis(b)).toBe("genus");
  });

  it("prefers what the commander scanned on foot over everything", () => {
    const b = body({
      scan: landableScan,
      biologicalSignals: 1,
      confirmedVariants: ["Bacterium Aurasus - Teal"],
    });
    expect(exoMarkerBasis(b)).toBe("scanned");
  });
});

describe("bodies with nothing to say", () => {
  it("says none for a body that was never scanned", () => {
    expect(exoMarkerBasis(body())).toBe("none");
    expect(bodyHasExoMarkers(body())).toBe(false);
  });

  it("says none for a body nobody can land on", () => {
    // A gas giant's conditions cannot suit anything this app predicts; offering a list would be
    // noise dressed as a prediction.
    const b = body({ scan: { Landable: false, PlanetClass: "Class I gas giant" } as BodyExoState["scan"] });
    expect(exoMarkerBasis(b)).toBe("none");
    expect(bodyHasExoMarkers(b)).toBe(false);
  });

  it("says none when the class is missing, however landable it claims to be", () => {
    const b = body({ scan: { Landable: true } as BodyExoState["scan"] });
    expect(exoMarkerBasis(b)).toBe("none");
  });
});

describe("what the map is allowed to mark as carrying life", () => {
  /**
   * The map's bio filter and its bio-body count say "biological signals", so they must only ever
   * mark bodies that have them. On Blu Thua ML-P b47-2 the wide test marked every landable rock in
   * the system — nineteen bodies where the journal knows of nine.
   */
  it("marks a body the journal reports signals on", () => {
    expect(bodyHasJournalExoEvidence(body({ biologicalSignals: 1 }))).toBe(true);
  });

  it("does not mark a body that is only landable and described", () => {
    const b = body({
      scan: { BodyName: "x", BodyID: 1, StarSystem: "s", SystemAddress: 1, Landable: true, PlanetClass: "Rocky body" },
    });
    // The candidate list still runs — it is the mark on the map that would be a claim.
    expect(bodyHasExoMarkers(b)).toBe(true);
    expect(bodyHasJournalExoEvidence(b)).toBe(false);
  });

  it("does not mark a body with nothing at all", () => {
    expect(bodyHasJournalExoEvidence(body())).toBe(false);
  });
});
