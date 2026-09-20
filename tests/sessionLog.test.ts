import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { SessionLog } from "../src/server/sessionLog.js";
import type { JournalLine } from "../src/shared/types.js";
import type { PriceIndex } from "../src/server/priceList.js";

const T0 = Date.parse("2026-09-14T20:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const line = (event: string, s: number, extra: Record<string, unknown>): JournalLine =>
  ({ timestamp: iso(s), event, ...extra }) as unknown as JournalLine;

describe("the session log", () => {
  it("collects tonight's jumps, landings, analysed species and sales, and prices the ×5", () => {
    const st = new GameStateStore();
    const prices: PriceIndex = new Map([["tubus compagibus", 2_000_000]]);
    const log = new SessionLog();
    const rec = (l: JournalLine) => {
      st.apply(l);
      return log.record(l, st, prices);
    };
    expect(
      rec(line("FSDJump", 1, { StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0], JumpDist: 12.3 })),
    ).toBe(true);
    expect(rec(line("FSDJump", 2, { StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0] }))).toBe(false); // same system twice
    rec(
      line("Scan", 3, {
        ScanType: "Detailed",
        BodyName: "A 1",
        BodyID: 1,
        StarSystem: "A",
        SystemAddress: 1,
        PlanetClass: "Rocky body",
        Landable: true,
        WasFootfalled: false,
      }),
    );
    expect(
      rec(
        line("Touchdown", 4, {
          PlayerControlled: true,
          Body: "A 1",
          BodyID: 1,
          StarSystem: "A",
          SystemAddress: 1,
        }),
      ),
    ).toBe(true);
    // the first footfall is settled on disembarking; the landing row picks it up
    rec(line("Disembark", 5, { OnPlanet: true, Body: "A 1", BodyID: 1, StarSystem: "A", SystemAddress: 1 }));
    expect(
      rec(
        line("ScanOrganic", 6, {
          ScanType: "Sample",
          Genus_Localised: "Tubus",
          Species_Localised: "Tubus Compagibus",
          SystemAddress: 1,
          Body: 1,
        }),
      ),
    ).toBe(false);
    expect(
      rec(
        line("ScanOrganic", 7, {
          ScanType: "Analyse",
          Genus_Localised: "Tubus",
          Species_Localised: "Tubus Compagibus",
          SystemAddress: 1,
          Body: 1,
        }),
      ),
    ).toBe(true);
    expect(
      rec(
        line("ScanOrganic", 8, {
          ScanType: "Analyse",
          Genus_Localised: "Tubus",
          Species_Localised: "Tubus Compagibus",
          SystemAddress: 1,
          Body: 1,
        }),
      ),
    ).toBe(false); // once
    expect(
      rec(
        line("SellOrganicData", 9, {
          BioData: [{ Species_Localised: "Tubus Compagibus", Value: 2_000_000, Bonus: 8_000_000 }],
        }),
      ),
    ).toBe(true);

    const d = log.toDto();
    expect(d.systems).toHaveLength(1);
    expect(d.systems[0]).toMatchObject({ name: "A", jumpLy: 12.3 });
    expect(d.landings).toHaveLength(1);
    expect(d.landings[0]?.body).toBe("A 1");
    expect(d.firstFootfalls).toBe(d.landings.filter((l) => l.firstFootfall).length);
    expect(d.samples).toHaveLength(1);
    expect(d.samples[0]?.species.toLowerCase()).toContain("tubus");
    expect(d.samples[0]?.listCredits).toBe(2_000_000);
    expect(d.samples[0]?.mult).toBe(d.landings[0]?.firstFootfall ? 5 : 1);
    expect(d.creditsAnalysed).toBe(2_000_000 * d.samples[0]!.mult);
    expect(d.sales).toEqual([{ at: iso(9), items: 1, credits: 10_000_000 }]);
    expect(d.creditsSold).toBe(10_000_000);
  });

  it("ignores lines that are not tonight's events", () => {
    const st = new GameStateStore();
    const log = new SessionLog();
    expect(log.record(line("Music", 1, { MusicTrack: "NoTrack" }), st, new Map())).toBe(false);
    expect(log.record(line("Touchdown", 2, { PlayerControlled: false, Body: "X 1" }), st, new Map())).toBe(
      false,
    );
    expect(log.toDto().landings).toEqual([]);
  });
});
