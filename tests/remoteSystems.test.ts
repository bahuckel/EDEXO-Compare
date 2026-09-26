/**
 * Looking up a system nobody on this machine has flown to (owner, 2026-09-25, Discord batch O-E1).
 *
 * A pasted name used to show "no data". Now the system comes from Spansh: bodies and bio counts from
 * the dump, genera somebody mapped, species somebody logged — and it stays out of everything that is
 * the commander's own record. Shapes below are trimmed from the live Tegnae HT-Z d13-1 responses.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchRemoteSystem,
  loggedSpeciesFromSystem,
  readRemoteSystemsCache,
  remoteBioFromDump,
  remoteSystemsCachePath,
  writeRemoteSystemToCache,
} from "../src/server/remoteSystems.js";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import { buildDiscoveries } from "../src/server/discoveries.js";
import { getProjectRoot } from "../src/server/paths.js";

const ADDR = 48611743739;
const NAME = "Tegnae HT-Z d13-1";

const planet = (bodyId: number, name: string, extra: Record<string, unknown> = {}) => ({
  bodyId,
  name,
  type: "Planet",
  subType: "Rocky body",
  atmosphereType: "Thin Carbon dioxide",
  volcanismType: "No volcanism",
  gravity: 0.06,
  surfaceTemperature: 180,
  surfacePressure: 0.02,
  isLandable: true,
  distanceToArrival: 2755,
  parents: [{ Star: 0 }],
  ...extra,
});

const DUMP = {
  system: {
    name: NAME,
    id64: ADDR,
    coords: { x: 17957.84375, y: -1153.0625, z: 37329 },
    bodies: [
      {
        bodyId: 0,
        name: NAME,
        type: "Star",
        subType: "F (White) Star",
        spectralClass: "F5",
        distanceToArrival: 0,
      },
      planet(20, `${NAME} 6 a`, {
        signals: {
          genuses: ["$Codex_Ent_Tussocks_Genus_Name;", "$Codex_Ent_Stratum_Genus_Name;"],
          signals: { "$SAA_SignalType_Biological;": 2 },
        },
      }),
      planet(21, `${NAME} 6 b`, { signals: { signals: { "$SAA_SignalType_Biological;": 1 } } }),
      planet(22, `${NAME} 7`, { signals: { signals: { "$SAA_SignalType_Geological;": 3 } } }),
    ],
  },
};

const SYSTEM = {
  record: {
    name: NAME,
    x: 17957.84375,
    y: -1153.0625,
    z: 37329,
    updated_at: "2026-03-25 20:53:48+00",
    bodies: [
      {
        name: `${NAME} 6 a`,
        landmarks: [
          { count: 1, subtype: "Tussock Propagito", type: "Tussock", value: 1000000 },
          { count: 1, subtype: "Silicate Vapour Fumarole", type: "Fumarole", value: 0 },
        ],
      },
    ],
  },
};

function fakeFetch(dump: unknown = DUMP, system: unknown = SYSTEM, dumpStatus = 200) {
  return (async (url: string) => {
    if (String(url).includes("/api/dump/")) {
      return new Response(JSON.stringify(dump), { status: dumpStatus });
    }
    return new Response(JSON.stringify(system));
  }) as unknown as typeof fetch;
}

afterEach(() => rmSync(remoteSystemsCachePath(), { force: true }));

describe("parsing Spansh", () => {
  it("reads bio counts, genera and signal types from the dump", () => {
    const m = remoteBioFromDump(DUMP);
    expect(m.get(20)).toMatchObject({
      biologicalSignals: 2,
      genuses: expect.arrayContaining(["$Codex_Ent_Tussocks_Genus_Name;"]),
    });
    expect(m.get(22)).toMatchObject({
      biologicalSignals: null,
      signalTypes: ["$SAA_SignalType_Geological;"],
    });
  });

  it("keeps logged biology and drops geology from the landmarks", () => {
    const l = loggedSpeciesFromSystem(SYSTEM);
    expect(l.byBodyName.get(`${NAME} 6 a`)).toEqual([{ genus: "Tussock", species: "Tussock Propagito" }]);
    expect(l.coords).toEqual({ x: 17957.84375, y: -1153.0625, z: 37329 });
  });
});

describe("fetchRemoteSystem", () => {
  it("returns the system with its bio bodies only", async () => {
    const r = await fetchRemoteSystem(ADDR, NAME, fakeFetch());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.system.bio.map((b) => b.bodyName)).toEqual([`${NAME} 6 a`, `${NAME} 6 b`]);
    expect(r.system.records.length).toBe(4);
    // Three bodies carry signal counts (7 only geological): Spansh has FSS data for this system.
    expect(r.system.signalBodyCount).toBe(3);
  });

  it("counts no signal data when nobody uploaded an FSS (his XJ-A d4)", async () => {
    const bare = {
      system: {
        ...DUMP.system,
        bodies: DUMP.system.bodies.map((b) => {
          const { signals: _drop, ...rest } = b as Record<string, unknown>;
          void _drop;
          return rest;
        }),
      },
    };
    const r = await fetchRemoteSystem(ADDR, NAME, fakeFetch(bare, null));
    expect(r.ok && r.system.bio).toEqual([]);
    expect(r.ok && r.system.signalBodyCount).toBe(0);
  });

  it("still works without the landmarks record, and says so plainly when Spansh has nothing", async () => {
    const noSystem = await fetchRemoteSystem(ADDR, NAME, fakeFetch(DUMP, null));
    expect(noSystem.ok && noSystem.system.bio[0]!.loggedSpecies).toEqual([]);
    const missing = await fetchRemoteSystem(ADDR, NAME, fakeFetch({}, null, 404));
    expect(missing).toEqual({ ok: false, error: "Spansh has no record of this system." });
  });
});

describe("the 30-day cache", () => {
  it("round-trips and forgets systems older than 30 days", async () => {
    const r = await fetchRemoteSystem(ADDR, NAME, fakeFetch(), () => new Date("2026-09-01T00:00:00Z"));
    if (!r.ok) throw new Error(r.error);
    writeRemoteSystemToCache(r.system, Date.parse("2026-09-02T00:00:00Z"));
    expect(readRemoteSystemsCache(Date.parse("2026-09-20T00:00:00Z")).map((s) => s.systemAddress)).toEqual([
      ADDR,
    ]);
    expect(readRemoteSystemsCache(Date.parse("2026-10-02T00:00:00Z"))).toEqual([]);
  });
});

describe("a looked-up system on the main screen", () => {
  it("shows Spansh's bodies with logged species marked, and keeps them out of his own record", async () => {
    const r = await fetchRemoteSystem(ADDR, NAME, fakeFetch());
    if (!r.ok) throw new Error(r.error);
    const store = new GameStateStore();
    store.remoteSystems.set(ADDR, r.system);
    store.setViewingSystemAddress(ADDR);

    expect(store.isShowingRemoteSystem(ADDR)).toBe(true);
    const bodies = store.listBioBodies();
    expect(bodies.map((b) => b.bodyName)).toEqual([`${NAME} 6 a`, `${NAME} 6 b`]);
    expect(bodies[0]!.remote?.source).toBe("spansh");
    expect(bodies[0]!.genusHints?.map((h) => h.Genus_Localised)).toEqual(["Tussock", "Stratum"]);

    loadSpeciesDatabase();
    const snap = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(snap.remoteView).toMatchObject({ state: "ready", starSystem: NAME, bioBodyCount: 2 });
    expect(snap.viewingSystemName).toBe(NAME);
    const sixA = snap.bodies.find((b) => b.state.bodyName === `${NAME} 6 a`)!;
    const logged = sixA.matches.find((m) => m.entry.displayName.toLowerCase() === "tussock propagito");
    expect(logged?.loggedBy).toBe("others");

    // Not his: no visited system, no discovery, no body in the journal store.
    expect(store.visitedSystems.has(ADDR)).toBe(false);
    expect(store.bodies.size).toBe(0);
    expect(buildDiscoveries(store, getProjectRoot()).systems).toEqual([]);
  });

  it("never replaces a system the journals already have bio bodies for", async () => {
    const r = await fetchRemoteSystem(ADDR, NAME, fakeFetch());
    if (!r.ok) throw new Error(r.error);
    const store = new GameStateStore();
    store.apply({
      timestamp: "2026-09-25T09:59:00Z",
      event: "FSDJump",
      StarSystem: NAME,
      SystemAddress: ADDR,
      StarPos: [17957.84375, -1153.0625, 37329],
      Population: 0,
    } as never);
    store.apply({
      timestamp: "2026-09-25T10:00:00Z",
      event: "FSSBodySignals",
      BodyName: `${NAME} 6 a`,
      BodyID: 20,
      SystemAddress: ADDR,
      Signals: [{ Type: "$SAA_SignalType_Biological;", Count: 2 }],
    } as never);
    store.remoteSystems.set(ADDR, r.system);
    store.setViewingSystemAddress(ADDR);
    expect(store.isShowingRemoteSystem(ADDR)).toBe(false);
    expect(store.listBioBodies().every((b) => !b.remote)).toBe(true);
  });
});
