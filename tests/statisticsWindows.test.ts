/**
 * Narrowing the scan to a window, and the arithmetic behind credits-per-hour.
 *
 * The rate is the part worth defending. Its denominator is play time, which the journal states only
 * as session spans, and a rate divided by almost no hours is a number that looks real and is not.
 */
import { describe, expect, it } from "vitest";
import { playedHoursInWindow, windowFor, windowStartMs } from "../src/shared/statisticsWindows.js";
import { summariseStatistics } from "../src/server/statistics.js";
import { applyScanLine, type JournalScan } from "../src/server/statisticsScan.js";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function scanOf(
  lines: Record<string, unknown>[],
  sessions: { from: string; to: string }[] = [],
): JournalScan {
  const scan: JournalScan = {
    income: [],
    activity: {},
    balances: [],
    sessions,
    carrierBreaks: [],
    filesRead: 1,
    linesRead: lines.length,
  };
  for (const l of lines) applyScanLine(scan, l);
  return scan;
}

describe("windows", () => {
  it("offers the six the owner asked for", () => {
    expect(["24h", "7d", "30d", "90d", "365d", "all"].map((k) => windowFor(k).key)).toEqual([
      "24h",
      "7d",
      "30d",
      "90d",
      "365d",
      "all",
    ]);
  });

  it("falls back to all for anything it does not know", () => {
    expect(windowFor("").key).toBe("all");
    expect(windowStartMs(windowFor("all"), NOW)).toBeNull();
  });

  it("keeps only what falls inside", () => {
    const scan = scanOf([
      { timestamp: ago(2), event: "MarketSell", TotalSale: 100 },
      { timestamp: ago(48), event: "MarketSell", TotalSale: 900 },
    ]);
    expect(summariseStatistics(scan, "24h", NOW).totalCredits).toBe(100);
    expect(summariseStatistics(scan, "7d", NOW).totalCredits).toBe(1000);
    expect(summariseStatistics(scan, "all", NOW).totalCredits).toBe(1000);
  });

  it("ignores an event dated in the future", () => {
    // A clock skew on one machine must not put credits in a window before they were earned.
    const scan = scanOf([
      { timestamp: new Date(NOW + 3_600_000).toISOString(), event: "MarketSell", TotalSale: 5 },
    ]);
    expect(summariseStatistics(scan, "all", NOW).totalCredits).toBe(0);
  });
});

describe("every category is on the chart, earned or not", () => {
  it("returns a row for each heading even when it is empty", () => {
    /*
      A quiet window must still list Combat bonds at zero. Dropping the row reads as the panel
      forgetting the category, and the log axis already draws a zero flat on the baseline for exactly
      this case.
    */
    const s = summariseStatistics(
      scanOf([{ timestamp: ago(1), event: "MarketSell", TotalSale: 10 }]),
      "24h",
      NOW,
    );
    const names = s.income.map((c) => c.category);
    for (const c of ["exobiology", "exploration", "trading", "missions", "combatBonds", "bounties"]) {
      expect(names).toContain(c);
    }
    expect(s.income.find((c) => c.category === "combatBonds")!.credits).toBe(0);
  });

  it("orders them largest first", () => {
    const s = summariseStatistics(
      scanOf([
        { timestamp: ago(1), event: "MissionCompleted", Reward: 50 },
        { timestamp: ago(1), event: "MarketSell", TotalSale: 500 },
      ]),
      "all",
      NOW,
    );
    expect(s.income[0]!.category).toBe("trading");
  });

  it("does not count a purchase as an earning event", () => {
    // Trading nets to 400 from one sale; the MarketBuy is a cost line, not a second transaction.
    const s = summariseStatistics(
      scanOf([
        { timestamp: ago(1), event: "MarketSell", TotalSale: 500 },
        { timestamp: ago(1), event: "MarketBuy", TotalCost: 100 },
      ]),
      "all",
      NOW,
    );
    const trading = s.income.find((c) => c.category === "trading")!;
    expect(trading.credits).toBe(400);
    expect(trading.events).toBe(1);
  });
});

describe("played hours, the denominator", () => {
  it("clips a session to the window instead of counting it whole", () => {
    /*
      A five-hour session that began thirty hours ago contributes only its last part to "24 hours".
      Counting it whole inflates the denominator and quietly deflates the rate.
    */
    const sessions = [{ from: ago(30), to: ago(25) }];
    expect(playedHoursInWindow(sessions, NOW - 24 * 3_600_000, NOW)).toBe(0);
    const straddling = [{ from: ago(26), to: ago(22) }];
    expect(playedHoursInWindow(straddling, NOW - 24 * 3_600_000, NOW)).toBeCloseTo(2, 6);
  });

  it("never counts past now", () => {
    expect(playedHoursInWindow([{ from: ago(1), to: ago(-5) }], null, NOW)).toBeCloseTo(1, 6);
  });

  it("ignores a span that runs backwards or will not parse", () => {
    expect(playedHoursInWindow([{ from: ago(1), to: ago(3) }], null, NOW)).toBe(0);
    expect(playedHoursInWindow([{ from: "nonsense", to: "also" }], null, NOW)).toBe(0);
  });
});

describe("credits per hour", () => {
  it("divides the window's income by the window's play time", () => {
    const s = summariseStatistics(
      scanOf(
        [{ timestamp: ago(1), event: "MarketSell", TotalSale: 1_000_000 }],
        [{ from: ago(2), to: ago(0) }],
      ),
      "24h",
      NOW,
    );
    expect(s.playedHours).toBeCloseTo(2, 6);
    expect(s.creditsPerHour).toBeCloseTo(500_000, 6);
  });

  it("is null rather than a huge number when almost nothing was played", () => {
    /*
      THE ONE THAT MATTERS HERE. Dividing by a minute of play produces a rate in the billions that
      looks like a real figure. "No answer" is the honest output, and the panel shows a dash.
    */
    const s = summariseStatistics(
      scanOf(
        [{ timestamp: ago(1), event: "MarketSell", TotalSale: 1_000_000 }],
        [{ from: ago(1), to: ago(0.99) }],
      ),
      "24h",
      NOW,
    );
    expect(s.creditsPerHour).toBeNull();
  });

  it("is null when there was no session at all", () => {
    const s = summariseStatistics(
      scanOf([{ timestamp: ago(1), event: "MarketSell", TotalSale: 10 }]),
      "24h",
      NOW,
    );
    expect(s.creditsPerHour).toBeNull();
  });
});

describe("activity, bucketed by day", () => {
  it("counts inside the window", () => {
    const scan = scanOf([
      { timestamp: ago(1), event: "Scan" },
      { timestamp: ago(1), event: "FSDJump" },
      { timestamp: ago(24 * 40), event: "Scan" },
    ]);
    expect(summariseStatistics(scan, "24h", NOW).activity.bodiesScanned).toBe(1);
    expect(summariseStatistics(scan, "all", NOW).activity.bodiesScanned).toBe(2);
    expect(summariseStatistics(scan, "24h", NOW).activity.jumps).toBe(1);
  });

  it("counts every organic scan, not every plant", () => {
    // One plant emits Log, Sample and Analyse. The panel says "scans", because dividing by three
    // would be worse: a run can be abandoned after the first.
    const scan = scanOf([
      { timestamp: ago(1), event: "ScanOrganic", ScanType: "Log" },
      { timestamp: ago(1), event: "ScanOrganic", ScanType: "Sample" },
      { timestamp: ago(1), event: "ScanOrganic", ScanType: "Analyse" },
    ]);
    expect(summariseStatistics(scan, "all", NOW).activity.organicSamples).toBe(3);
  });
});

describe("what the upkeep estimate needs the scan to record", () => {
  /*
    The estimator measures the weekly charge from the gap between two balance readings, which is only
    honest when nothing else touched the account in between. It is handed those moments by the scan,
    and nothing else in the suite exercises that wiring — remove either push and every unit test of
    `estimateCarrierUpkeep` still passes, because they supply the breaks themselves.
  */
  it("marks a bank transfer, because it moves the balance for a reason that is not upkeep", () => {
    const scan = scanOf([
      {
        timestamp: ago(1),
        event: "CarrierBankTransfer",
        CarrierBalance: 500,
        PlayerBalance: 900,
        Deposit: 100,
      },
    ]);
    expect(scan.carrierBreaks).toEqual([{ at: ago(1), kind: "transfer" }]);
  });

  it("marks a service change, because it changes what the weekly charge is", () => {
    const scan = scanOf([
      { timestamp: ago(2), event: "CarrierCrewServices", CrewRole: "Rearm", Operation: "Pause" },
    ]);
    expect(scan.carrierBreaks).toEqual([{ at: ago(2), kind: "service" }]);
  });

  it("does not mark an ordinary carrier reading", () => {
    // CarrierStats is the measurement, not a disturbance to it.
    const scan = scanOf([
      {
        timestamp: ago(3),
        event: "CarrierStats",
        Finance: { CarrierBalance: 1, ReserveBalance: 2, AvailableBalance: -1 },
      },
    ]);
    expect(scan.carrierBreaks).toEqual([]);
  });
});

describe("balances", () => {
  it("reads the carrier's three figures, and keeps the newest even outside the window", () => {
    /*
      CarrierStats only fires when the commander opens the carrier panel, so a 24-hour window often
      holds no sample at all. "What does my carrier hold" still has an answer then -- an old one,
      which the panel dates rather than hides.
    */
    const scan = scanOf([
      {
        timestamp: ago(24 * 120),
        event: "CarrierStats",
        Finance: { CarrierBalance: 516_270_136, ReserveBalance: 591_393_873, AvailableBalance: -75_123_737 },
      },
    ]);
    const s = summariseStatistics(scan, "24h", NOW);
    expect(s.carrierBalance).toHaveLength(0);
    expect(s.carrierLatest).toMatchObject({ balance: 516_270_136, available: -75_123_737 });
  });

  it("takes both sides from a bank transfer", () => {
    const scan = scanOf([
      {
        timestamp: ago(1),
        event: "CarrierBankTransfer",
        CarrierBalance: 500,
        PlayerBalance: 900,
        Deposit: 100,
      },
    ]);
    const s = summariseStatistics(scan, "24h", NOW);
    expect(s.carrierLatest!.balance).toBe(500);
    expect(s.commanderBalance[0]!.credits).toBe(900);
  });

  it("samples the commander's credits from LoadGame", () => {
    const scan = scanOf([{ timestamp: ago(1), event: "LoadGame", Credits: 9_135_472_305 }]);
    expect(summariseStatistics(scan, "24h", NOW).commanderBalance).toEqual([
      { at: ago(1), credits: 9_135_472_305 },
    ]);
  });
});
