/**
 * Exploration values against the owner's own system map (tests/fixtures/sell-values-2026-10-03.json,
 * built by docs/perf/build_sell_fixture.py from docs/sell values.csv and his journals; 2026-10-03).
 *
 * Every value in the fixture was read off the game's system map, at a fleet carrier (x0.75). The
 * formula is the one the app sells by: 3.3 constants, the Odyssey +30 % on a mapped body, 2.6 for a
 * first discovery, 1.25 for an efficient map — and the arrival star carrying the honk: a third of
 * every other body's scan value (planets at least 500), which the system map shows on it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bodyScanValueCredits,
  starScanValueCredits,
  systemHonkCredits,
} from "../src/server/explorationValue.js";
import { isTerraformableState } from "../src/shared/terraformState.js";

interface Body {
  kind: "star" | "planet";
  arrival: boolean;
  firstDiscoverer: boolean;
  value: number | null;
  starType?: string;
  stellarMass?: number;
  planetClass?: string;
  massEM?: number;
  terraformState?: string;
  mappedByMe?: boolean;
  firstMapper?: boolean;
  efficient?: boolean;
}
const fx = JSON.parse(readFileSync("tests/fixtures/sell-values-2026-10-03.json", "utf8")) as {
  carrierFactor: number;
  systems: Body[][];
};
const C = fx.carrierFactor;

function own(b: Body): number {
  if (b.kind === "star") return starScanValueCredits(b.stellarMass ?? 0, b.starType, b.firstDiscoverer).value;
  const v = bodyScanValueCredits(
    b.planetClass,
    isTerraformableState(b.terraformState),
    b.massEM ?? 0,
    b.firstDiscoverer,
    b.firstMapper === true,
    true,
    b.efficient === true,
  );
  return b.mappedByMe ? v.dssMapped : v.fss;
}
const close = (got: number, want: number) => Math.abs(got - want) <= Math.max(2, want * 0.005);
const tf = (b: Body) => isTerraformableState(b.terraformState);

describe("the owner's system map values", () => {
  const bodies = fx.systems.flat().filter((b) => b.value != null && b.value > 0 && !b.arrival);

  it("every star and non-terraformable planet, mapped or not, within 0.5 %", () => {
    const plain = bodies.filter((b) => !tf(b));
    const off = plain.filter((b) => !close(own(b) * C, b.value!));
    expect(plain.length).toBeGreaterThan(700);
    /*
      Two of 756 are off, both kept as found: a 0.02-Earth-mass rocky body mapped efficiently at
      1,649 where the formula says 1,700 (the Odyssey minimum, 555, would have to be about 500 for
      that one), and a high metal content body at 258,272 — ten times the formula, the value of a
      terraformable, so most likely a body the journal does not call one or a misread screenshot.
    */
    expect(off.map((b) => `${b.planetClass} ${b.value}`)).toEqual([
      "Rocky body 1649",
      "High metal content body 258272",
    ]);
  });

  it("terraformables: never above the formula, and most of them on it", () => {
    const t = bodies.filter(tf);
    for (const b of t) expect(b.value!).toBeLessThanOrEqual(own(b) * C * 1.005);
    expect(t.filter((b) => close(own(b) * C, b.value!)).length / t.length).toBeGreaterThan(0.7);
  });

  it("the arrival star carries the honk of every other body", () => {
    let checked = 0;
    for (const sys of fx.systems) {
      const arrival = sys.find((b) => b.arrival);
      if (!arrival?.value) continue;
      const others = sys.filter((b) => b !== arrival);
      // A terraformable's scan value is a range (see above); its third would move the sum.
      if (others.some(tf)) continue;
      const honk = systemHonkCredits(
        others.map((b) =>
          b.kind === "star"
            ? { kind: "star", stellarMass: b.stellarMass ?? 0, starType: b.starType }
            : {
                kind: "planet",
                planetClass: b.planetClass,
                terraformable: false,
                massEM: b.massEM ?? 0,
              },
        ),
        arrival.firstDiscoverer,
      );
      expect(close((own(arrival) + honk) * C, arrival.value), `system with ${sys.length} bodies`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});
