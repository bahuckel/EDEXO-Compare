/**
 * Fuel per jump by the drive's own law, fitted on the commander's jumps (shared/fsdFuel.ts; owner,
 * 2026-10-08), and the route's fuel with it (server/navRouteFuel.ts).
 */
import { describe, expect, it } from "vitest";
import {
  emptyFsdFuel,
  fsdFuelJump,
  fsdFuelLoadout,
  fsdFuelModel,
  fuelForJump,
  maxJumpLy,
} from "../src/shared/fsdFuel.js";
import { analyzeNavRouteFuel } from "../src/server/navRouteFuel.js";

// The owner's Mandalay: 369.3 t unladen, a 5A SCO drive with 5.72 t most per jump, 32 t tank.
const loadout = {
  event: "Loadout",
  ShipID: 12,
  UnladenMass: 369.3,
  MaxJumpRange: 71.634071,
  Modules: [
    { Slot: "FrameShiftDrive", Engineering: { Modifiers: [{ Label: "MaxFuelPerJump", Value: 5.72 }] } },
  ],
};
// The law his 300 jumps fit: fuel = k · (distance · mass)^2.449.
const P = 2.449;
const K = 5.72 / (67.38 * 401.3) ** P;
function flown(n: number) {
  const st = emptyFsdFuel();
  fsdFuelLoadout(st, loadout);
  let tank = 32;
  for (let i = 0; i < n; i++) {
    const d = 30 + ((i * 7) % 38); // 30 … 67 ly
    const used = K * (d * (369.3 + tank)) ** P;
    tank -= used;
    fsdFuelJump(st, { event: "FSDJump", JumpDist: d, FuelUsed: used, FuelLevel: tank });
    if (tank < 10) tank = 32;
  }
  return st;
}

describe("fuel per jump", () => {
  it("fits the drive's power and constant from the jumps", () => {
    const m = fsdFuelModel(flown(30))!;
    expect(m.fitted).toBe(true);
    expect(m.p).toBeCloseTo(P, 3);
    expect(fuelForJump(m, 60, 25)).toBeCloseTo(K * (60 * 394.3) ** P, 4);
  });

  it("gives the longest jump on this tank: about 67.4 ly full, 72 ly nearly empty", () => {
    const m = fsdFuelModel(flown(30))!;
    expect(maxJumpLy(m, 32)).toBeCloseTo(67.38, 1);
    expect(maxJumpLy(m, 5.72)!).toBeGreaterThan(71.5);
    expect(maxJumpLy(m, 2)!).toBeLessThan(maxJumpLy(m, 5.72)!); // less fuel than one full jump needs
  });

  it("leaves out boosted jumps, and starts over for another ship", () => {
    const st = flown(10);
    const n = st.samples.length;
    fsdFuelJump(st, { event: "FSDJump", JumpDist: 260, FuelUsed: 5.72, FuelLevel: 20, BoostUsed: 4 });
    expect(st.samples).toHaveLength(n);
    fsdFuelLoadout(st, { ...loadout, ShipID: 99 });
    expect(st.samples).toEqual([]);
  });

  it("assumes the class A power until the jumps are varied enough to fit it", () => {
    const st = emptyFsdFuel();
    fsdFuelLoadout(st, loadout);
    fsdFuelJump(st, { event: "FSDJump", JumpDist: 40, FuelUsed: 1.5, FuelLevel: 30 });
    const m = fsdFuelModel(st)!;
    expect(m.fitted).toBe(false);
    expect(m.p).toBe(2.45);
  });
});

describe("the route's fuel with the drive's law", () => {
  const roles = {
    fuelPrefixes: ["K", "G"],
    neutronExact: ["N"],
    blackHoleExact: ["H"],
    whiteDwarfPrefix: "D",
  };
  // Three 66 ly legs after a 30 ly jump, 13 t in the tank: the old rule says 3 × 3.5 t, the law 3 × 4.8 t.
  const route = [0, 66, 132, 198].map((x, i) => ({
    systemAddress: i + 1,
    starSystem: `S${i}`,
    starPos: [x, 0, 0] as [number, number, number],
    starClass: "M",
  }));
  const base = {
    route,
    currentSystemAddress: 1,
    fuelTotalT: 13,
    lastFsdFuelT: K * (30 * 386) ** P,
    lastFsdDistLy: 30,
    loadoutMaxJumpLy: 71.63,
    starRoles: roles,
  };

  it("the old rule (last jump × distance²) said the tank lasts; the drive's law says two legs", () => {
    expect(analyzeNavRouteFuel(base)!.fuelCanFinishPlottedRoute).toBe(true);
    const a = analyzeNavRouteFuel({ ...base, fuelModel: fsdFuelModel(flown(30)) })!;
    expect(a.fuelCanFinishPlottedRoute).toBe(false);
    expect(a.fuelJumpsReachableOnPlottedRoute).toBe(2);
  });

  it("stops at a leg longer than this tank's longest jump", () => {
    const far = [
      ...route.slice(0, 2),
      { ...route[2]!, starPos: [66 + 69.5, 0, 0] as [number, number, number] },
    ];
    const a = analyzeNavRouteFuel({
      ...base,
      route: far,
      fuelTotalT: 30,
      fuelModel: fsdFuelModel(flown(30)),
    })!;
    expect(a.fuelJumpsReachableOnPlottedRoute).toBe(1); // 69.5 ly with ~25 t aboard is out of reach
  });
});
