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

  it("read removes; the same find does not come back; state survives a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "edexo-notices-")), "edexo-notices.json");
    const a = createNoticesService({ filePath: file });
    a.observe(scan(3, { PlanetClass: "Earthlike body" }), ctx());
    a.observe(scan(4, { PlanetClass: "Ammonia world" }), ctx());
    a.setPrefs({ chime: true });
    expect(a.markRead([a.list()[0]!.id])).toBe(1);
    const b = createNoticesService({ filePath: file });
    expect(b.list().map((x) => x.title)).toEqual(["Earth-like world"]);
    expect(b.prefs().chime).toBe(true);
    expect(b.observe(scan(4, { PlanetClass: "Ammonia world" }), ctx())).toBe(false);
    expect(b.markRead("all")).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8")).items).toEqual([]);
  });
});

describe("prefs and wording", () => {
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
