/**
 * "Notify me" (src/server/notices.ts, src/shared/notices.ts): notable finds, personal records and
 * notable stellar phenomena, from live journal lines only (guild tester report, 2026-09-30).
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";
import {
  DEFAULT_NOTIFY_PREFS,
  formatRadius,
  mergeNotifyPrefs,
  notableKindFor,
  recordText,
  starTypeLabel,
} from "../src/shared/notices.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const SYS = "Blatrimpe";
const ADDR = 7505623126738;

function ctx(known: string[] = [], scans: Partial<ExplorationScanRecord>[] = []): NoticesContext & { seeded: () => number } {
  let seeded = 0;
  return {
    isKnownBody: (k) => known.includes(k),
    allScans: function* () {
      seeded++;
      yield* scans as ExplorationScanRecord[];
    },
    currentSystem: () => ({ name: SYS, address: ADDR }),
    seeded: () => seeded,
  };
}

function scan(bodyId: number, extra: Record<string, unknown>) {
  return {
    timestamp: "2026-09-30T12:00:00Z",
    event: "Scan",
    ScanType: "Detailed",
    StarSystem: SYS,
    SystemAddress: ADDR,
    BodyID: bodyId,
    BodyName: `${SYS} ${bodyId} a`,
    ...extra,
  };
}

describe("notable kinds", () => {
  it("the Notable card's types, and only the true Helium gas giant", () => {
    expect(notableKindFor("Earthlike body")).toBe("earthlike");
    expect(notableKindFor("Water world", "Terraformable")).toBe("water");
    expect(notableKindFor("Ammonia world")).toBe("ammonia");
    expect(notableKindFor("High metal content body", "Terraformable")).toBe("terraformable");
    expect(notableKindFor("High metal content body", "")).toBeNull();
    expect(notableKindFor("Helium gas giant")).toBe("helium");
    expect(notableKindFor("Helium rich gas giant")).toBeNull();
  });
});

describe("notices", () => {
  it("announces a new notable body once, naming system and body", () => {
    const n = createNoticesService({ filePath: null });
    const c = ctx();
    expect(n.observe(scan(3, { PlanetClass: "Water world", TerraformState: "Terraformable", Radius: 6e6 }), c)).toBe(true);
    // The detailed scan after the auto scan is the same body.
    expect(n.observe(scan(3, { PlanetClass: "Water world", TerraformState: "Terraformable", Radius: 6e6 }), c)).toBe(false);
    const [item] = n.list();
    expect(item).toMatchObject({ kind: "notable", title: "Water world (terraformable)", system: SYS, body: "3 a" });
    expect(item!.text).toContain(SYS);
  });

  it("ignores a body the store already had, nav-beacon data, and switched-off types", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ notable: { helium: false } });
    expect(n.observe(scan(4, { PlanetClass: "Earthlike body" }), ctx([`${ADDR}:4`]))).toBe(false);
    expect(n.observe(scan(5, { PlanetClass: "Earthlike body", ScanType: "NavBeaconDetail" }), ctx())).toBe(false);
    expect(n.observe(scan(6, { PlanetClass: "Helium gas giant" }), ctx())).toBe(false);
    expect(n.list()).toEqual([]);
  });

  it("records: seeded silently from the store, then a live scan that beats one is announced and marked", () => {
    const n = createNoticesService({ filePath: null });
    const c = ctx(
      [],
      [
        { planetClass: "Icy body", radius: 2_000_000 },
        { planetClass: "Icy body", radius: 500_000 },
        { planetClass: "Icy body", radius: 9_000_000, edsmHydrated: true }, // not his
        { starType: "K", radius: 500_000_000 },
      ],
    );
    expect(n.observe(scan(7, { PlanetClass: "Icy body", Radius: 1_000_000 }), c)).toBe(false);
    expect(c.seeded()).toBe(1);
    expect(n.observe(scan(8, { PlanetClass: "Icy body", Radius: 3_000_000 }), c)).toBe(true);
    expect(n.observe(scan(9, { StarType: "K", Radius: 400_000_000 }), c)).toBe(true);
    expect(c.seeded()).toBe(1);
    const titles = n.list().map((x) => x.title);
    expect(titles).toEqual(["Record: smallest K-type star", "Record: largest Icy body"]);
    const marks = n.snapshot(ADDR).recordMarks;
    expect(marks.map((m) => [m.body, m.which, m.previous])).toEqual([
      ["8 a", "largest", 2_000_000],
      ["9 a", "smallest", 500_000_000],
    ]);
    expect(n.snapshot(ADDR + 1).recordMarks).toEqual([]);
  });

  it("the first of a type is not a record", () => {
    const n = createNoticesService({ filePath: null });
    expect(n.observe(scan(1, { StarType: "DA", Radius: 7e6 }), ctx())).toBe(false);
    expect(n.observe(scan(2, { StarType: "DA", Radius: 8e6 }), ctx())).toBe(true);
  });

  it("a notable stellar phenomenon: the signal first, then its name from the codex after the drop", () => {
    const n = createNoticesService({ filePath: null });
    const c = ctx();
    const signal = {
      timestamp: "2026-09-30T12:00:00Z",
      event: "FSSSignalDiscovered",
      SystemAddress: ADDR,
      SignalName: "$Fixed_Event_Life_Cloud;",
      SignalType: "Codex",
    };
    expect(n.observe(signal, c)).toBe(true);
    expect(n.observe(signal, c)).toBe(false);
    expect(n.list()[0]).toMatchObject({ kind: "nsp", title: "Notable stellar phenomenon", system: SYS });
    n.observe({ timestamp: "2026-09-30T12:05:00Z", event: "SupercruiseDestinationDrop", Type: "$Fixed_Event_Life_Cloud;" }, c);
    // A codex entry long after the drop is something else.
    expect(
      n.observe(
        { timestamp: "2026-09-30T12:20:00Z", event: "CodexEntry", Name_Localised: "Late", System: SYS, SystemAddress: ADDR },
        c,
      ),
    ).toBe(false);
    n.observe({ timestamp: "2026-09-30T12:25:00Z", event: "SupercruiseDestinationDrop", Type: "$Fixed_Event_Life_Cloud;" }, c);
    expect(
      n.observe(
        {
          timestamp: "2026-09-30T12:25:02Z",
          event: "CodexEntry",
          EntryID: 1401300,
          Name_Localised: "Proto-Lagrange Cloud",
          System: SYS,
          SystemAddress: ADDR,
          IsNewEntry: true,
        },
        c,
      ),
    ).toBe(true);
    expect(n.list().map((x) => x.title)).toEqual(["Proto-Lagrange Cloud — new codex entry"]);
    expect(n.list()[0]!.codexNew).toBe(true);
  });

  it("read ones stay to be read again (owner, 2026-09-30); the same find does not come back; state survives a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "edexo-notices-")), "edexo-notices.json");
    const a = createNoticesService({ filePath: file });
    a.observe(scan(3, { PlanetClass: "Earthlike body" }), ctx());
    a.observe(scan(4, { PlanetClass: "Ammonia world" }), ctx());
    a.setPrefs({ chime: true });
    expect(a.markRead([a.list()[0]!.id])).toBe(1);
    expect(a.snapshot(null).unread).toBe(1);
    const b = createNoticesService({ filePath: file });
    expect(b.list().map((x) => [x.title, x.read ?? false])).toEqual([
      ["Ammonia world", true],
      ["Earth-like world", false],
    ]);
    expect(b.prefs().chime).toBe(true);
    expect(b.observe(scan(4, { PlanetClass: "Ammonia world" }), ctx())).toBe(false);
    expect(b.markRead("all")).toBe(1);
    expect(b.snapshot(null)).toMatchObject({ unread: 0 });
    expect(b.list()).toHaveLength(2);
    expect(b.markUnread([b.list()[1]!.id])).toBe(1);
    expect(b.snapshot(null).unread).toBe(1);
    expect(b.clearRead()).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8")).items.map((x: { title: string }) => x.title)).toEqual(["Earth-like world"]);
  });
});

describe("nearby: points of interest and carriers", () => {
  const jump = (x: number, dist = 50, extra: Record<string, unknown> = {}) => ({
    timestamp: "2026-09-30T12:00:00Z",
    event: "FSDJump",
    StarSystem: `Sys ${x}`,
    SystemAddress: x,
    StarPos: [x, 0, 0],
    JumpDist: dist,
    ...extra,
  });
  function nearCtx(pois: { key: string; d: number }[], carriers: { cs: string; d: number; services: string[] }[] = []) {
    const asked: number[] = [];
    const c: NoticesContext = {
      ...ctx(),
      loadoutJumpLy: () => 60,
      nearbyPois: (_o, r) => {
        asked.push(r);
        return pois.filter((p) => p.d <= r).map((p) => ({ key: p.key, name: `POI ${p.key}`, system: "There", typeLabel: "Nebula", distanceLy: p.d }));
      },
      nearbyCarriers: (_o, r) =>
        carriers
          .filter((k) => k.d <= r)
          .map((k) => ({ callsign: k.cs, name: "", system: "Park", systemAddress: 9, distanceLy: k.d, lastSeenDays: 12, services: k.services })),
    };
    return { c, asked };
  }

  it("radius is N full-range jumps: boosts and economical-route hops left out", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ nearby: { jumps: 2, poiGroups: { nebulae: true } } });
    const { c } = nearCtx([]);
    for (const d of [66, 67, 68]) n.observe(jump(d, d), c);
    n.observe(jump(400, 260, { BoostUsed: 4 }), c);
    for (let i = 0; i < 30; i++) n.observe(jump(500 + i, 4), c);
    expect(n.jumpLy(c)).toBe(68);
    // The journals' estimate, when the server passes it in, comes first.
    expect(n.jumpLy({ ...c, fullJumpLy: () => 67.3 })).toBe(67.3);
  });

  it("radius is N jumps: the loadout's range until three jumps are flown", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ nearby: { jumps: 5, poiGroups: { nebulae: true } } });
    const { c, asked } = nearCtx([]);
    n.observe(jump(1, 40), c);
    n.observe(jump(2, 40), c);
    n.observe(jump(3, 40), c);
    expect(asked).toEqual([300, 300, 200]);
    expect(n.jumpLy(c)).toBe(40);
  });

  it("announces each POI once, at most three a jump, nearest first; all groups off does nothing", () => {
    const n = createNoticesService({ filePath: null });
    const pois = [1, 2, 3, 4, 5].map((i) => ({ key: `gec:${i}`, d: i * 10 }));
    const { c } = nearCtx(pois);
    expect(n.observe(jump(1), c)).toBe(false); // opt-in: nothing chosen yet
    n.setPrefs({ nearby: { poiGroups: { nebulae: true } } });
    n.observe(jump(2), c);
    expect(n.list().map((x) => x.id).reverse()).toEqual(["poi:gec:1", "poi:gec:2", "poi:gec:3"]);
    n.observe(jump(3), c);
    n.observe(jump(4), c);
    expect(n.list()).toHaveLength(5);
    expect(n.list()[0]!.text).toBe("Nebula in There — 50 ly from Sys 3");
  });

  it("carriers only beyond 2,000 ly of Sol, filtered by service, with how old the sighting is", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ nearby: { carriers: "services", carrierServices: ["vistagenomics"] } });
    const { c } = nearCtx([], [
      { cs: "AAA-111", d: 20, services: ["refuel"] },
      { cs: "BBB-222", d: 30, services: ["vistagenomics", "refuel"] },
    ]);
    expect(n.observe(jump(1500), c)).toBe(false);
    expect(n.observe(jump(2500), c)).toBe(true);
    expect(n.list().map((x) => x.title)).toEqual(["Carrier nearby: BBB-222"]);
    expect(n.list()[0]!.text).toBe("In Park — 30 ly from Sys 2500 · Vista Genomics · last seen 12 days ago");
    n.setPrefs({ nearby: { carriers: "every" } });
    n.observe(jump(2600), c);
    expect(n.list().map((x) => x.title)).toContain("Carrier nearby: AAA-111");
  });
});

describe("nearby phenomena (EDAstro codex file)", () => {
  it("opt-in; one notice per system, not the one you are in", () => {
    const n = createNoticesService({ filePath: null });
    const c: NoticesContext = {
      ...ctx(),
      loadoutJumpLy: () => 50,
      nearbyNsps: () => [
        { system: "Sys 7", systemAddress: 7, distanceLy: 0, names: ["Here Cloud"] },
        { system: "Beyond", systemAddress: 99, distanceLy: 42.4, names: ["Proto-Lagrange Cloud", "Albens Bell Mollusc"] },
      ],
    };
    const jump = { timestamp: "2026-09-30T12:00:00Z", event: "FSDJump", StarSystem: "Sys 7", SystemAddress: 7, StarPos: [7, 0, 0], JumpDist: 50 };
    expect(n.observe(jump, c)).toBe(false);
    n.setPrefs({ nearby: { nsp: true } });
    expect(n.observe(jump, c)).toBe(true);
    expect(n.list().map((x) => [x.title, x.text])).toEqual([
      ["Nearby phenomenon: Proto-Lagrange Cloud, Albens Bell Mollusc", "In Beyond — 42 ly from Sys 7"],
    ]);
    expect(n.observe(jump, c)).toBe(false);
  });
});

describe("prefs and wording", () => {
  it("nearby: jumps clamped to 1–10, unknown services dropped", () => {
    const p = mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { nearby: { jumps: 40, carrierServices: ["refuel", "nope"], carriers: "sometimes" } });
    expect(p.nearby.jumps).toBe(10);
    expect(p.nearby.carrierServices).toEqual(["refuel"]);
    expect(p.nearby.carriers).toBe("off");
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { nearby: { jumps: 0 } }).nearby.jumps).toBe(1);
    expect(Object.values(DEFAULT_NOTIFY_PREFS.nearby.poiGroups).some(Boolean)).toBe(false);
  });

  it("merges only known booleans", () => {
    const p = mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { chime: "yes", nsp: false, notable: { water: false, bogus: true } });
    expect(p.chime).toBe(false);
    expect(p.nsp).toBe(false);
    expect(p.notable.water).toBe(false);
    expect(p.notable.earthlike).toBe(true);
    expect(Object.keys(p.notable)).not.toContain("bogus");
  });

  it("says star types and sizes in words", () => {
    expect(starTypeLabel("K")).toBe("K-type star");
    expect(starTypeLabel("DA")).toBe("white dwarf (DA)");
    expect(starTypeLabel("M_RedGiant")).toBe("M red giant");
    expect(starTypeLabel("N")).toBe("neutron star");
    expect(formatRadius(695_700_000 * 1.5, "star")).toBe("1.5 R☉");
    expect(formatRadius(12_000, "star")).toBe("12 km");
    expect(formatRadius(6_371_000, "planet")).toBe("6,371 km");
    expect(
      recordText({ subject: "planet", type: "Water world", which: "largest", radius: 7_234_000, previous: 6_900_000 }),
    ).toBe("Largest Water world you have found — 7,234 km (was 6,900 km)");
  });
});

describe("test notice (review F-5.10)", () => {
  it("adds one record-kind notice, a newer one replaces it, and marking read and clearing remove it", () => {
    const n = createNoticesService({ filePath: null });
    n.sendTest("2026-10-02T18:00:00.000Z");
    n.sendTest("2026-10-02T18:00:05.000Z");
    const tests = n.list().filter((x) => x.id.startsWith("test:"));
    expect(tests).toHaveLength(1);
    expect(tests[0]!.kind).toBe("record");
    expect(n.snapshot(null).unread).toBe(1);
    n.markRead("all");
    n.clearRead();
    expect(n.list()).toHaveLength(0);
  });
});
