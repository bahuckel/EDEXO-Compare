/**
 * The conditions about a different body in the same system.
 *
 * Asked for from the field: *"we are also checking other planets in the system — some plants only
 * spawn when certain bodies are present, do a check if we are including that."* We were not. Amphora
 * plant and seven Brain Trees carried the condition in their data rows and the loader answered it by
 * flagging them `predictionUnsupported` — listed, never predicted, excluded from every genus count.
 *
 * The match context now carries the system's other bodies, so the condition is evaluated. What is
 * pinned here is the three ways this kind of gate goes quietly wrong: comparing two spellings of the
 * same planet class as free text, reading "not found yet" as "not there", and letting the body under
 * the cursor satisfy its own requirement.
 */
import { describe, expect, it } from "vitest";
import {
  BRAIN_TREE_SYSTEM_REQUIREMENT,
  describeSystemBodyVerdict,
  evaluateSystemBodyGate,
} from "../src/shared/systemBodyGates.js";
import { demoteFailedSystemBodyGates } from "../src/server/matchSpecies.js";
import { buildSpeciesMatchContext } from "../src/server/speciesMatchContext.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { BodyExoState, JournalLine, SpeciesMatch, SpeciesMatchContext } from "../src/shared/types.js";

const AMPHORA = [
  "Earth-Like World",
  "Ammoniac World",
  "Gas Giant with water-based life",
  "Gas Giant with ammonia-based life",
  "Water Giant",
];

describe("the gate itself", () => {
  it("matches the codex spelling against the journal's", () => {
    /*
      The rows say "Earth-Like World" and "Ammoniac World"; the journal says "Earthlike body" and
      "Ammonia world". Comparing those as free text is the mistake §27 is about, and it would have
      failed every body in the galaxy silently.
    */
    expect(evaluateSystemBodyGate(AMPHORA, ["Earthlike body"], true)).toEqual({
      kind: "pass",
      matched: "Earth-Like World",
    });
    expect(evaluateSystemBodyGate(AMPHORA, ["Ammonia world"], true)?.kind).toBe("pass");
    expect(evaluateSystemBodyGate(AMPHORA, ["Gas giant with water based life"], true)?.kind).toBe("pass");
    expect(evaluateSystemBodyGate(AMPHORA, ["Water giant"], true)?.kind).toBe("pass");
  });

  it("fails a finished system that holds none of them", () => {
    const v = evaluateSystemBodyGate(AMPHORA, ["Icy body", "High metal content body"], true);
    expect(v?.kind).toBe("fail");
    expect(describeSystemBodyVerdict(v!)).toContain("none of");
  });

  it("abstains while the honk is unfinished", () => {
    // "No Earth-like world found yet" is not "no Earth-like world". A commander mid-honk is exactly
    // who would be misled.
    const v = evaluateSystemBodyGate(AMPHORA, ["Icy body"], false);
    expect(v).toEqual({ kind: "unresolved", why: "incomplete" });
  });

  it("abstains when nothing in the system is scanned", () => {
    expect(evaluateSystemBodyGate(AMPHORA, [], true)).toEqual({ kind: "unresolved", why: "no-scans" });
    expect(evaluateSystemBodyGate(AMPHORA, null, true)).toEqual({ kind: "unresolved", why: "no-scans" });
  });

  it("says nothing about a species with no such requirement", () => {
    expect(evaluateSystemBodyGate(undefined, ["Icy body"], true)).toBeNull();
    expect(evaluateSystemBodyGate([], ["Icy body"], true)).toBeNull();
  });

  it("knows the Brain Trees' list, which their own rows do not carry", () => {
    expect(BRAIN_TREE_SYSTEM_REQUIREMENT).toEqual([
      "Earth-Like World",
      "Gas Giant with water-based life",
    ]);
    expect(evaluateSystemBodyGate(BRAIN_TREE_SYSTEM_REQUIREMENT, ["Water giant"], true)?.kind).toBe("fail");
  });
});

/** A candidate row, reduced to what the demotion reads. */
function match(id: string, wanted?: string[]): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits"> {
  return {
    entry: {
      id,
      displayName: id,
      genus: "Amphora",
      genusDataDir: "amphora",
      criteria: wanted ? { systemBodyClassesAnyOf: wanted } : {},
    },
    reasons: [],
  } as unknown as Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
}

const ctx = (classes: string[], complete: boolean): SpeciesMatchContext => ({
  systemBodyClasses: classes,
  systemBodyListComplete: complete,
});

describe("the demotion", () => {
  it("moves a row whose system holds no companion body", () => {
    const strict = [match("amphora", AMPHORA), match("other")];
    const unlikely: typeof strict = [];
    demoteFailedSystemBodyGates(strict, unlikely, ctx(["Icy body"], true));
    expect(strict.map((m) => m.entry.id)).toEqual(["other"]);
    expect(unlikely).toHaveLength(1);
    expect(unlikely[0]!.unlikelyReasons?.[0]?.field).toBe("System bodies");
    expect(unlikely[0]!.unlikelyReasons?.[0]?.detail).toContain("Earth-Like World");
  });

  it("leaves a row whose system holds one", () => {
    const strict = [match("amphora", AMPHORA)];
    const unlikely: typeof strict = [];
    demoteFailedSystemBodyGates(strict, unlikely, ctx(["Earthlike body", "Icy body"], true));
    expect(strict).toHaveLength(1);
    expect(unlikely).toHaveLength(0);
  });

  it("marks rather than demotes while the system is unfinished", () => {
    const strict = [match("amphora", AMPHORA)];
    const unlikely: typeof strict = [];
    demoteFailedSystemBodyGates(strict, unlikely, ctx(["Icy body"], false));
    expect(strict).toHaveLength(1);
    expect(unlikely).toHaveLength(0);
    expect(strict[0]!.spatialGateUnresolved).toBe(true);
  });

  it("does not demote when there is no context at all", () => {
    /*
      The sabotage check for this gate. A matcher called without a context — every probe that forgot
      to build one, and the first version of the tela probe did exactly that — must not conclude that
      the system is empty. Demoting here would hide Amphora on every body a tool scored offline.
    */
    const strict = [match("amphora", AMPHORA)];
    const unlikely: typeof strict = [];
    demoteFailedSystemBodyGates(strict, unlikely, undefined);
    expect(strict).toHaveLength(1);
    expect(strict[0]!.spatialGateUnresolved).toBe(true);
  });

  it("ignores rows that carry no requirement", () => {
    const strict = [match("plain")];
    const unlikely: typeof strict = [];
    demoteFailedSystemBodyGates(strict, unlikely, ctx(["Icy body"], true));
    expect(strict).toHaveLength(1);
    expect(strict[0]!.spatialGateUnresolved).toBeUndefined();
  });
});

/**
 * End to end, because a gate that never receives its input is a gate that does nothing — and it
 * passes every unit test while doing it.
 */
describe("the wiring", () => {
  const SYS = 9_100_001;

  const scanLine = (over: Record<string, unknown>) =>
    ({
      timestamp: "2026-09-20T00:00:00Z",
      event: "Scan",
      ScanType: "Detailed",
      StarSystem: "Probe",
      SystemAddress: SYS,
      ...over,
    }) as unknown as JournalLine;

  function storeWith(complete: boolean): GameStateStore {
    const store = new GameStateStore();
    store.apply(scanLine({ BodyID: 1, BodyName: "Probe 1", StarType: "A", DistanceFromArrivalLS: 0 }));
    store.apply(scanLine({ BodyID: 4, BodyName: "Probe 4", PlanetClass: "Earthlike body" }));
    store.apply(
      scanLine({
        BodyID: 7,
        BodyName: "Probe 7",
        PlanetClass: "Metal rich body",
        Landable: true,
        SurfaceGravity: 2.4,
      }),
    );
    if (complete) {
      store.apply({
        timestamp: "2026-09-20T00:01:00Z",
        event: "FSSAllBodiesFound",
        SystemAddress: SYS,
        Count: 3,
      } as unknown as JournalLine);
    }
    return store;
  }

  const exoBody = () =>
    ({
      key: `${SYS}:7`,
      bodyName: "Probe 7",
      bodyId: 7,
      systemAddress: SYS,
      starSystem: "Probe",
      biologicalSignals: 1,
      genusHints: null,
      dssComplete: false,
      scan: null,
      organicGenusLocks: [],
      confirmedVariants: [],
      updatedAt: "2026-09-20T00:00:00Z",
    }) as unknown as BodyExoState;

  it("hands the matcher the system's other bodies", () => {
    const ctxBuilt = buildSpeciesMatchContext(exoBody(), storeWith(true));
    expect(ctxBuilt.systemBodyClasses).toContain("Earthlike body");
    expect(ctxBuilt.systemBodyListComplete).toBe(true);
  });

  it("leaves the body under the cursor out of its own requirement", () => {
    // A metal-rich world cannot vouch for itself, and in a one-body system it otherwise would.
    const ctxBuilt = buildSpeciesMatchContext(exoBody(), storeWith(true));
    expect(ctxBuilt.systemBodyClasses).not.toContain("Metal rich body");
  });

  it("reports the honk as unfinished when the journal never said it was", () => {
    expect(buildSpeciesMatchContext(exoBody(), storeWith(false)).systemBodyListComplete).toBe(false);
  });
});
