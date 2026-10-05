/**
 * The Boxels screen's facts for a flown system (server/snapshotSystemInfo.ts boxelJournalFacts):
 * stars with luminosity, notable kinds, and Helium gas giants on the exact class only (owner,
 * 2026-10-05: "we need to be 100% sure that we differentiate them").
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { boxelJournalFacts } from "../src/server/snapshotSystemInfo.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 99_001;
const scan = (BodyID: number, extra: Record<string, unknown>) =>
  ({
    timestamp: "2026-10-05T10:00:00Z",
    event: "Scan",
    ScanType: "Detailed",
    StarSystem: "Eol Prou AB-C d1-4",
    SystemAddress: SYS,
    BodyName: `Eol Prou AB-C d1-4 ${BodyID}`,
    BodyID,
    DistanceFromArrivalLS: BodyID === 0 ? 0 : 100 * BodyID,
    ...extra,
  }) as unknown as JournalLine;

describe("a flown system's facts for the Boxels table", () => {
  it("reads its stars, notables and planet types, a Helium-rich gas giant never as Helium", () => {
    const s = new GameStateStore();
    s.apply({
      timestamp: "2026-10-05T09:59:00Z",
      event: "FSDJump",
      StarSystem: "Eol Prou AB-C d1-4",
      SystemAddress: SYS,
      StarPos: [0, 0, 0],
    } as unknown as JournalLine);
    s.apply(scan(0, { StarType: "K", Subclass: 5, Luminosity: "Va", StellarMass: 0.7 }));
    s.apply(scan(1, { StarType: "M", Subclass: 3, Luminosity: "V", StellarMass: 0.3 }));
    s.apply(scan(2, { PlanetClass: "Helium gas giant", TerraformState: "" }));
    s.apply(scan(3, { PlanetClass: "Helium rich gas giant", TerraformState: "" }));
    s.apply(scan(4, { PlanetClass: "Earthlike body", TerraformState: "Terraformable" }));
    s.apply(scan(5, { PlanetClass: "High metal content body", TerraformState: "Terraformable" }));
    const f = boxelJournalFacts(s, SYS);
    expect(f.mainStar).toBe("K5 Va");
    expect(f.otherStars).toEqual(["M3 V"]);
    expect(f.starClasses).toEqual(["K", "M"]);
    expect(f.notables).toEqual([
      { kind: "earthlike", n: 1 },
      { kind: "terraformable", n: 1 },
      { kind: "helium", n: 1 },
    ]);
    expect(f.bodyTypes).toEqual(expect.arrayContaining(["helium_gg", "elw", "hmc", "terraformable"]));
    expect(f.bodies.scanned).toBe(6);
  });
});
