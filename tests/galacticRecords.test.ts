/**
 * EDAstro's galactic records (src/server/galacticRecords.ts) and the commander's own (notices.ts),
 * side by side in Statistics → Records (guild tester report, 2026-09-30). The page below is
 * synthetic: the shape of EDAstro's records table, not its data.
 */
import { describe, expect, it } from "vitest";
import { parseRecordsPage, recordKeyFor } from "../src/server/galacticRecords.js";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const row = (name: string, unit: string, hi: string, hiBody: string, lo: string, loBody: string) => `
<tr class="recordrow"><td class="recordname" rowspan=4><b>${name.replace(/ /g, "&nbsp;")}</b><br/>(${unit})</td>
	<td class="recorddata" align="right">Highest:</td><td>&nbsp;</td><td align="right">${hi}</td><td class="recordlink">&nbsp;:&nbsp;<a href="x">${hiBody}</a>
</td><td align="right"></td></tr>
	<tr class="recorddata"><td class="recorddata" align="right">Lowest:</td><td>&nbsp;</td><td align="right">${lo}</td><td class="recordlink">&nbsp;:&nbsp;<a href="y">${loBody}</a>
</td></tr>`;

describe("EDAstro's records pages", () => {
  it("reads each type's highest and lowest radius, in metres, skipping the moon/planet/landable variants", () => {
    const html =
      "<table>" +
      row("Water world", "Radius", "20,000.5", "Big 1", "2,000", "Small 2") +
      row("Water world (as moon)", "Radius", "9,000", "M 1", "1,000", "M 2") +
      row("High metal content world (landable)", "Radius", "7,000", "L 1", "100", "L 2") +
      row("Planets", "Radius", "90,000", "P 1", "10", "P 2") +
      "</table>";
    expect(parseRecordsPage(html, "planet", 1000)).toEqual([
      {
        key: "planet:Water world",
        label: "Water world",
        largest: { radius: 20_000_500, body: "Big 1" },
        smallest: { radius: 2_000_000, body: "Small 2" },
      },
    ]);
  });

  it("stars are in solar radii; names map onto the journal's StarType", () => {
    const html = "<table>" + row("K (Yellow-Orange) Star", "Solar Radius", "2", "K1", "0.5", "K2") + "</table>";
    expect(parseRecordsPage(html, "star", 695_700_000)[0]).toMatchObject({
      key: "star:K",
      largest: { radius: 1_391_400_000 },
    });
    expect(recordKeyFor("White Dwarf (DA) Star", "star")).toBe("star:DA");
    expect(recordKeyFor("M (Red giant) Star", "star")).toBe("star:M_RedGiant");
    expect(recordKeyFor("K (Yellow-Orange giant) Star", "star")).toBe("star:K_OrangeGiant");
    expect(recordKeyFor("Wolf-Rayet NC Star", "star")).toBe("star:WNC");
    expect(recordKeyFor("Class III gas giant", "planet")).toBe("planet:Sudarsky class III gas giant");
    expect(recordKeyFor("Earth-like world ProcGen", "planet")).toBeNull();
  });
});

describe("your records beside them", () => {
  it("lists every type you scanned with its largest and smallest body and the galactic record", () => {
    const n = createNoticesService({ filePath: null });
    const scans = [
      { planetClass: "Water world", radius: 6_000_000, bodyName: "A 1" },
      { planetClass: "Water world", radius: 7_000_000, bodyName: "B 2" },
      { starType: "K", radius: 500_000_000, bodyName: "C" },
    ] as ExplorationScanRecord[];
    const ctx: NoticesContext = {
      isKnownBody: () => false,
      allScans: () => scans,
      currentSystem: () => ({ name: "X", address: 1 }),
      galacticRecord: (k) =>
        k === "planet:Water world"
          ? { largest: { radius: 20_000_000, body: "Big 1" }, smallest: { radius: 2_000_000, body: "Small 2" } }
          : null,
    };
    const rows = n.records(ctx);
    expect(rows.map((r) => [r.key, r.count, r.largest.body, r.smallest.body])).toEqual([
      ["star:K", 1, "C", "C"],
      ["planet:Water world", 2, "B 2", "A 1"],
    ]);
    expect(rows[1]!.galactic?.largest.body).toBe("Big 1");
    // A live scan beyond EDAstro's record says so.
    const beyond = {
      event: "Scan",
      timestamp: "2026-09-30T12:00:00Z",
      StarSystem: "X",
      SystemAddress: 1,
      BodyID: 9,
      BodyName: "X 9",
      PlanetClass: "Water world",
      Radius: 21_000_000,
    };
    expect(n.observe(beyond, ctx)).toBe(true);
    expect(n.list()[0]!.title).toBe("Beyond EDAstro's galactic record: largest Water world");
    expect(n.list()[0]!.text).toContain("galactic 20,000 km");
  });
});
