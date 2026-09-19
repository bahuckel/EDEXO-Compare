/**
 * Which star decides whether a system is the commander's discovery.
 *
 * The game credits the system to whoever first scanned its **arrival star**, and that is what puts a
 * name on it and pays the cartographic bonus. This used to be read off `BodyID 0`.
 *
 * That is wrong, and the owner found it: `Pru Aihm BL-U b33-2` has no body zero. Its lowest body is
 * **2**, the star named "A", and every body in the system reads `WasDiscovered: false` — he had
 * plainly discovered it. With no body zero to record, the system got no entry at all, and the
 * first-discovery filter drops an unknown rather than claiming it, so the system vanished from a
 * list it belonged at the top of. Multi-star systems routinely start numbering above zero.
 *
 * The rule is the **arrival star**, which the journal names exactly: `DistanceFromArrivalLS` is `0`
 * for it and nothing else. In that system it is body 2 at 0.0 LS while the other stars sit at 2,283
 * and 350,734 LS.
 *
 * "Lowest-numbered star" was tried first and is not the same thing: it lets a secondary speak for
 * the system whenever the primary went unscanned, which is what `firstDiscovery.test.ts` exists to
 * prevent — 672 of 1,159 first-scanned systems have a primary somebody else had found. That test
 * caught it, which is the second time tonight an existing test stopped a plausible-looking change.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 7_777_777;

function scan(over: Record<string, unknown>): JournalLine {
  return {
    timestamp: "2026-09-19T00:00:00Z",
    event: "Scan",
    ScanType: "AutoScan",
    StarSystem: "Probe",
    SystemAddress: SYS,
    ...over,
  } as unknown as JournalLine;
}

/** The arrival star: `StarType` marks a star, `DistanceFromArrivalLS: 0` marks *the* one. */
const arrivalStar = (bodyId: number, wasDiscovered: boolean) =>
  scan({
    BodyID: bodyId,
    BodyName: `Probe ${bodyId}`,
    StarType: "M",
    DistanceFromArrivalLS: 0,
    WasDiscovered: wasDiscovered,
  });

/** A star further out. Its flag is about itself and says nothing about the system. */
const distantStar = (bodyId: number, wasDiscovered: boolean, ls: number) =>
  scan({
    BodyID: bodyId,
    BodyName: `Probe ${bodyId}`,
    StarType: "M",
    DistanceFromArrivalLS: ls,
    WasDiscovered: wasDiscovered,
  });

/** A planet: carries the same flag, about itself. */
const planet = (bodyId: number, wasDiscovered: boolean) =>
  scan({ BodyID: bodyId, BodyName: `Probe ${bodyId}`, PlanetClass: "Icy body", WasDiscovered: wasDiscovered });

const verdict = (store: GameStateStore) => store.mainStarWasDiscoveredBySystem.get(SYS);

describe("the arrival star decides the system", () => {
  it("reads a system whose arrival star is body 2 — the case that was missed", () => {
    /*
      Pru Aihm BL-U b33-2, reduced. No body zero anywhere; the arrival star is body 2 at 0.0 LS and
      says nobody had been there. Under the old body-zero rule the store held no entry at all and the
      filter treated the system as unknown, so it vanished from a list it belonged at the top of.
    */
    const store = new GameStateStore();
    store.apply(planet(10, false));
    store.apply(arrivalStar(2, false));
    store.apply(planet(18, false));
    expect(verdict(store)).toBe(false);
  });

  it("ignores a distant star, however low its body id", () => {
    /*
      The guard `firstDiscovery.test.ts` was written for: 672 of 1,159 first-scanned systems have a
      primary somebody else had found, so letting a secondary answer would inflate the filter badly.
    */
    const store = new GameStateStore();
    store.apply(distantStar(1, false, 2283));
    expect(verdict(store)).toBeUndefined();
  });

  it("prefers the arrival star over a body-zero fallback", () => {
    const store = new GameStateStore();
    store.apply(scan({ BodyID: 0, BodyName: "Probe 0", StarType: "M", WasDiscovered: true }));
    store.apply(arrivalStar(2, false));
    expect(verdict(store)).toBe(false);
  });

  it("still uses body zero when a scan carries no distance at all", () => {
    // The old rule, kept: it is right whenever it applies, and older journals are thinner.
    const store = new GameStateStore();
    store.apply(scan({ BodyID: 0, BodyName: "Probe 0", StarType: "M", WasDiscovered: true }));
    expect(verdict(store)).toBe(true);
  });

  it("keeps the first answer when the arrival star is scanned again", () => {
    // A later visit reports the system as discovered — by him. Overwriting erases his own find.
    const store = new GameStateStore();
    store.apply(arrivalStar(2, false));
    store.apply(arrivalStar(2, true));
    expect(verdict(store)).toBe(false);
  });

  it("ignores planets and belt clusters, whatever their number", () => {
    const store = new GameStateStore();
    store.apply(planet(1, true));
    store.apply(arrivalStar(4, false));
    expect(verdict(store)).toBe(false);
  });

  it("says nothing when no star was scanned with the flag", () => {
    // Unknown is not "yes". The filter drops these rather than claiming them.
    const store = new GameStateStore();
    store.apply(planet(3, false));
    store.apply(scan({ BodyID: 2, BodyName: "Probe 2", StarType: "M", DistanceFromArrivalLS: 0 }));
    expect(verdict(store)).toBeUndefined();
  });
});
