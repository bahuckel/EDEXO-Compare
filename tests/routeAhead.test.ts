import { describe, expect, it } from "vitest";
import { analyzeNavRouteFuel, type NavRouteWaypointDTO } from "../src/server/navRouteFuel.js";
import type { StarRolesConfig } from "../src/server/systemMap.js";

const roles: StarRolesConfig = {
  fuelPrefixes: ["K", "G", "B", "F", "O", "A", "M"],
  neutronExact: ["N"],
  blackHoleExact: ["H"],
  whiteDwarfPrefix: "D",
};

/** Seven systems 10 ly apart in a line: A(K) B(T) C(M) D(K) E(T) F(N) G(K). */
function route(): NavRouteWaypointDTO[] {
  const classes = ["K", "T", "M", "K", "T", "N", "K"];
  return classes.map((c, i) => ({
    systemAddress: i + 1,
    starSystem: String.fromCharCode(65 + i),
    starPos: [i * 10, 0, 0] as [number, number, number],
    starClass: c,
  }));
}

/** The last jump burned 1 t over 10 ly, so every leg here costs 1 t. */
function analyse(fuelTotalT: number | null, currentSystemAddress = 1) {
  return analyzeNavRouteFuel({
    route: route(),
    currentSystemAddress,
    fuelTotalT,
    lastFsdFuelT: 1,
    lastFsdDistLy: 10,
    loadoutMaxJumpLy: 50,
    starRoles: roles,
  });
}

describe("route strip: the hops ahead and the refuel mark", () => {
  it("lists every remaining hop with its class and no pump when the tank lasts", () => {
    const a = analyse(20);
    expect(a?.ahead.map((h) => h.starClass)).toEqual(["T", "M", "K", "T", "N", "K"]);
    expect(a?.ahead.map((h) => h.scoopable)).toEqual([false, true, true, false, false, true]);
    expect(a?.ahead.every((h) => h.refuel === "none")).toBe(true);
    expect(a?.refuelInHops).toBeNull();
    expect(a?.refuelLevel).toBe("none");
  });

  it("puts the pump on the last scoop the tank still reaches (the web UI's rule)", () => {
    // budget 3 t → three legs reachable (B, C, D); scoops at C and D → the pump sits on D
    const a = analyse(3.06);
    expect(a?.fuelCanFinishPlottedRoute).toBe(false);
    expect(a?.jumpsToLastScoopableOnRoute).toBe(3);
    expect(a?.refuelInHops).toBe(3);
    expect(a?.refuelLevel).toBe("yellow");
    expect(a?.ahead[2]).toMatchObject({ starClass: "K", refuel: "yellow" });
    expect(a?.ahead.filter((h) => h.refuel !== "none")).toHaveLength(1);
  });

  it("keeps the web UI's colour: two jumps of margin is still yellow", () => {
    // budget 2 t → B (no scoop) and C (scoop) reachable; the pump sits on C, the alert says yellow
    const a = analyse(2.06);
    expect(a?.refuelInHops).toBe(2);
    expect(a?.refuelLevel).toBe("yellow");
    expect(a?.ahead[1]?.refuel).toBe("yellow");
  });

  it("goes red with no scoop within reach", () => {
    // budget 1 t → only B (a brown dwarf) is reachable: nothing to scoop before running dry
    const a = analyse(1.06);
    expect(a?.refuelInHops).toBeNull();
    expect(a?.refuelLevel).toBe("red");
    expect(a?.ahead.every((h) => h.refuel === "none")).toBe(true);
  });

  it("is empty off the plot", () => {
    const a = analyse(20, 999);
    expect(a?.onPlot).toBe(false);
    expect(a?.ahead).toEqual([]);
  });

  it("stops at the destination", () => {
    const a = analyse(20, 7);
    expect(a?.ahead).toEqual([]);
    expect(a?.refuelLevel).toBe("none");
  });
});
