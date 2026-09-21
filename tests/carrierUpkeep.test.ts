/**
 * The carrier's weekly charge, measured rather than looked up.
 *
 * The per-service upkeep costs are game constants that move between updates, so a shipped table
 * would be right until Frontier changed it and quietly wrong afterwards. The charge is visible in
 * the commander's own balance history instead — the account falls for two reasons, upkeep and
 * spending, and the journal states every transfer.
 *
 * The owner's real figures are pinned at the bottom. They are the reason this exists and the only
 * end-to-end check that the arithmetic recovers a known answer.
 */
import { describe, expect, it } from "vitest";
import {
  estimateCarrierUpkeep,
  formatWeeks,
  type CarrierBalanceSample,
  type CarrierLedgerBreak,
} from "../src/shared/carrierUpkeep.js";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
const samples = (...rows: [number, number][]): CarrierBalanceSample[] =>
  rows.map(([d, balance]) => ({ at: day(d), balance }));

describe("measuring the weekly charge", () => {
  it("divides by whole charges, not by elapsed weeks", () => {
    /*
      Charges land weekly, so a three-day window holds exactly one of them. Dividing by elapsed time
      reports 16.2 M per week for the owner's real three-day pair; counting whole charges recovers
      7.25 M, which every other window of his agrees with.
    */
    const short = estimateCarrierUpkeep(samples([0, 100_000_000], [3, 92_750_000]), [], 92_750_000);
    expect(short.perWeek).toBeCloseTo(7_250_000, 0);
  });

  it("does not assume the charges line up with the readings", () => {
    /*
      THE DEFECT THIS FILE CAUGHT. The first version rounded `span / week` to get the charge count,
      which is right only when the readings sit at the same phase as the weekly tick. The owner's
      longest clean window is 136.8 days: rounding calls that 20 charges and reports 6.89 M a week,
      while the truth is 19 charges and 7.25 M. Every other window of his agrees with 7.25 M, so the
      rounded answer was wrong by 5 % and looked perfectly reasonable.

      Each pair now offers both readings of itself and the rate the most pairs can reach wins. Here
      the short pair can only mean 7.25 M, and the long one is asked whether it agrees.
    */
    const rows = samples([0, 200_000_000], [3, 192_750_000], [3 + 137, 192_750_000 - 137_750_038]);
    const e = estimateCarrierUpkeep(rows, [], 55_000_000);
    expect(e.perWeek).toBeCloseTo(7_250_002, -2);
    expect(e.samples).toBe(2);
    expect(e.disagreed).toBe(false);
  });

  it("reads four charges out of a twenty-eight day gap", () => {
    const e = estimateCarrierUpkeep(samples([0, 100_000_000], [28, 71_000_000]), [], 71_000_000);
    expect(e.perWeek).toBeCloseTo(7_250_000, 0);
  });

  it("says nothing rather than guessing from a single reading", () => {
    // Same rule creditsPerHour follows: no answer beats a number that looks real and is not.
    const e = estimateCarrierUpkeep(samples([0, 100_000_000]), [], 100_000_000);
    expect(e.perWeek).toBeNull();
    expect(e.weeksOfRunway).toBeNull();
    expect(e.samples).toBe(0);
  });
});

describe("what spoils a pair", () => {
  it("drops a pair with a bank transfer between the readings", () => {
    /*
      A deposit makes the balance rise and a withdrawal makes it fall faster than upkeep; either way
      the pair is measuring the commander, not the carrier.
    */
    const breaks: CarrierLedgerBreak[] = [{ at: day(14), kind: "transfer" }];
    const e = estimateCarrierUpkeep(samples([0, 100_000_000], [28, 20_000_000]), breaks, 20_000_000);
    expect(e.perWeek).toBeNull();
  });

  it("ignores every pair before a service change, not just the one spanning it", () => {
    /*
      Activating or pausing a service changes what the charge *is*, so the older pairs describe a
      carrier that no longer exists. Here the old rate is 14 M and the new one 7 M; only the new one
      may be reported.
    */
    const rows = samples([0, 200_000_000], [7, 186_000_000], [21, 179_000_000], [28, 172_000_000]);
    const breaks: CarrierLedgerBreak[] = [{ at: day(10), kind: "service" }];
    const e = estimateCarrierUpkeep(rows, breaks, 172_000_000);
    expect(e.perWeek).toBeCloseTo(7_000_000, 0);
  });

  it("ignores a rise with no transfer recorded, rather than reporting negative upkeep", () => {
    // Journals go missing — the owner's were lost in a Windows reinstall — and a gap can hide a
    // deposit. Upkeep only ever takes money out.
    const e = estimateCarrierUpkeep(samples([0, 50_000_000], [7, 90_000_000]), [], 90_000_000);
    expect(e.perWeek).toBeNull();
  });

  it("ignores a pair that cannot reach the same rate as the others", () => {
    /*
      Three pairs at 7.25 M and one at 45.5 M — a spend the journals did not record as a transfer.
      Consensus takes the rate the most pairs reach, and flags that one could not.
    */
    const rows = samples([0, 100_000_000], [7, 92_750_000], [14, 85_500_000], [21, 40_000_000]);
    const e = estimateCarrierUpkeep(rows, [], 40_000_000);
    expect(e.perWeek).toBeCloseTo(7_250_000, 0);
    expect(e.samples).toBe(2);
    expect(e.disagreed).toBe(true);
  });
});

describe("runway", () => {
  it("divides the balance, not the available figure", () => {
    /*
      `AvailableBalance` is `balance − reserve`, and the reserve is a savings target the slider set —
      the owner's has been frozen at 591 M since 2025-10-30 while the balance fell to 395 M, making
      available -196 M. The whole balance pays the upkeep; dividing the negative figure would report
      a carrier with no runway when it has a year of it.
    */
    const e = estimateCarrierUpkeep(samples([0, 100_000_000], [28, 71_000_000]), [], 395_470_099);
    expect(e.weeksOfRunway).toBeCloseTo(395_470_099 / 7_250_000, 1);
  });

  it("is null when the rate is unknown", () => {
    expect(estimateCarrierUpkeep(samples([0, 100_000_000]), [], 395_470_099).weeksOfRunway).toBeNull();
  });

  it("never reports negative runway", () => {
    const e = estimateCarrierUpkeep(samples([0, 100_000_000], [28, 71_000_000]), [], -5_000_000);
    expect(e.weeksOfRunway).toBe(0);
  });
});

describe("the owner's own carrier, 2026-09-21", () => {
  it("recovers 7.25 M a week and about a year of runway from his real readings", () => {
    /*
      Read out of his journals: `CarrierStats` balances with the `CarrierBankTransfer` on 2026-05-17
      and the `CarrierCrewServices` pause on 2025-10-30 marked. Every clean window is a whole number
      of charges of roughly 7.25 M, and the balance was 395,470,099 on 2026-09-20.
    */
    const real: CarrierBalanceSample[] = [
      { at: "2025-11-28T13:07:32Z", balance: 554_420_180 },
      { at: "2026-04-14T07:48:30Z", balance: 416_670_144 },
      { at: "2026-04-17T10:54:11Z", balance: 409_420_140 },
      { at: "2026-05-15T08:21:49Z", balance: 380_220_136 },
      { at: "2026-05-17T22:31:32Z", balance: 516_270_136 },
      { at: "2026-09-20T15:23:20Z", balance: 395_470_099 },
    ];
    const breaks: CarrierLedgerBreak[] = [
      { at: "2025-10-30T01:36:19Z", kind: "service" },
      { at: "2026-05-17T22:06:39Z", kind: "transfer" },
    ];
    const e = estimateCarrierUpkeep(real, breaks, 395_470_099);
    expect(e.perWeek).not.toBeNull();
    expect(e.perWeek!).toBeGreaterThan(7_000_000);
    expect(e.perWeek!).toBeLessThan(7_600_000);
    expect(e.weeksOfRunway!).toBeGreaterThan(50);
    expect(e.weeksOfRunway!).toBeLessThan(58);
    // The 2026-05-17 rise is behind a recorded transfer, so that pair never enters the consensus.
    expect(e.samples).toBeGreaterThanOrEqual(3);
  });
});

describe("formatWeeks", () => {
  it("keeps a fraction while the number is small enough to act on", () => {
    expect(formatWeeks(3.2)).toBe("3.2 weeks");
    expect(formatWeeks(54.2)).toBe("54 weeks");
  });
});
