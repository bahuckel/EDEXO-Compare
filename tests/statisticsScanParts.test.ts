/**
 * The statistics scan caches one part per journal (UI review P7, 2026-09-29): a line written to the
 * current journal re-reads that file only, and the merged parts must equal a scan from nothing.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStatisticsCache, scanJournalsForStatistics } from "../src/server/statisticsScan.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  clearStatisticsCache();
});

const line = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";

function journals(): string[] {
  const d = mkdtempSync(join(tmpdir(), "edexo-stats-"));
  dirs.push(d);
  const a = join(d, "Journal.2026-09-01T100000.01.log");
  const b = join(d, "Journal.2026-09-02T100000.01.log");
  const c = join(d, "Journal.2026-09-02T180000.01.log");
  writeFileSync(
    a,
    line({ timestamp: "2026-09-01T10:00:00Z", event: "LoadGame", Credits: 1000 }) +
      line({ timestamp: "2026-09-01T10:05:00Z", event: "CarrierBuy", CarrierID: 7, Callsign: "ABC-123" }) +
      line({ timestamp: "2026-09-01T10:10:00Z", event: "FSDJump" }) +
      line({ timestamp: "2026-09-01T10:20:00Z", event: "SellOrganicData", BioData: [{ Value: 500, Bonus: 0 }] }),
  );
  writeFileSync(
    b,
    line({ timestamp: "2026-09-02T10:00:00Z", event: "CarrierFinance", CarrierID: 7, CarrierBalance: 5e9 }) +
      line({ timestamp: "2026-09-02T10:01:00Z", event: "FSDJump" }),
  );
  writeFileSync(c, line({ timestamp: "2026-09-02T18:00:00Z", event: "FSDJump" }));
  return [a, b, c];
}

describe("statistics scan, one cached part per journal", () => {
  it("merges parts into the same scan a cold pass gives, after the current journal grows", async () => {
    const files = journals();
    clearStatisticsCache();
    const first = await scanJournalsForStatistics(files);
    expect(first.activity["2026-09-02"]?.jumps).toBe(2);
    expect(first.filesRead).toBe(3);

    appendFileSync(files[2]!, line({ timestamp: "2026-09-02T18:30:00Z", event: "FSDJump" }));
    const warm = await scanJournalsForStatistics(files);
    clearStatisticsCache();
    const cold = await scanJournalsForStatistics(files);
    expect(warm).toEqual(cold);
    expect(warm.activity["2026-09-02"]?.jumps).toBe(3);
    expect(warm.sessions.at(-1)).toEqual({ from: "2026-09-02T18:00:00Z", to: "2026-09-02T18:30:00Z" });
  });

  it("keeps a carrier's callsign from an older journal when a newer one does not state it", async () => {
    const scan = await scanJournalsForStatistics(journals());
    expect(scan.carrierIdentities["7"]).toMatchObject({ carrierId: 7, callsign: "ABC-123" });
  });
});
