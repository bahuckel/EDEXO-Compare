/**
 * Which journal event is income, and for how much.
 *
 * Three rules here are wrong in a way that looks entirely plausible on screen, and all three were
 * found by totalling the owner's 277 journals before the panel existed. Each has its own case below,
 * because each would ship a number that is confidently incorrect.
 */
import { describe, expect, it } from "vitest";
import { incomeFromJournalLine } from "../src/shared/incomeCategories.js";

const AT = "2026-09-20T10:00:00Z";
const line = (o: Record<string, unknown>) => ({ timestamp: AT, ...o });
const sum = (rows: { credits: number }[]) => rows.reduce((n, r) => n + r.credits, 0);

describe("the award is not the income", () => {
  it("counts a redeemed combat bond", () => {
    const rows = incomeFromJournalLine(
      line({ event: "RedeemVoucher", Type: "CombatBond", Amount: 139_172_574 }),
    );
    expect(rows).toEqual([{ at: AT, category: "combatBonds", credits: 139_172_574 }]);
  });

  it("ignores FactionKillBond and Bounty entirely", () => {
    /*
      THE ONE THAT MATTERS. A bond is awarded by FactionKillBond and cashed by RedeemVoucher, and
      they are the same money: across the owner's journals, 138,451,082 awarded against 139,172,574
      redeemed. Counting both reports 277 M for 139 M earned -- almost exactly double, and nothing
      on the chart would look wrong.
    */
    expect(incomeFromJournalLine(line({ event: "FactionKillBond", Reward: 138_451_082 }))).toEqual([]);
    expect(incomeFromJournalLine(line({ event: "Bounty", TotalReward: 15_123_212 }))).toEqual([]);
  });

  it("separates a bounty voucher from a bond voucher", () => {
    // Without reading Type, the owner's two smallest categories merge into one.
    const bond = incomeFromJournalLine(line({ event: "RedeemVoucher", Type: "CombatBond", Amount: 10 }));
    const bounty = incomeFromJournalLine(line({ event: "RedeemVoucher", Type: "bounty", Amount: 10 }));
    expect(bond[0]!.category).toBe("combatBonds");
    expect(bounty[0]!.category).toBe("bounties");
  });

  it("files a codex or scan voucher under exploration", () => {
    expect(
      incomeFromJournalLine(line({ event: "RedeemVoucher", Type: "codex", Amount: 1 }))[0]!.category,
    ).toBe("exploration");
    expect(
      incomeFromJournalLine(line({ event: "RedeemVoucher", Type: "scannable", Amount: 1 }))[0]!.category,
    ).toBe("exploration");
  });

  it("puts an unknown voucher type somewhere rather than dropping it", () => {
    // Frontier adds voucher types. A new one must land in Other, not vanish from the totals.
    const rows = incomeFromJournalLine(line({ event: "RedeemVoucher", Type: "somethingNew", Amount: 500 }));
    expect(rows[0]).toMatchObject({ category: "other", credits: 500 });
  });
});

describe("SellOrganicData states no total", () => {
  it("sums Value and Bonus per row", () => {
    /*
      The event has no top-level credit field at all. Reading one gives zero -- which is what a first
      pass returned for the owner's largest single source, 7.77 bn across 267 samples.
    */
    const rows = incomeFromJournalLine(
      line({
        event: "SellOrganicData",
        MarketID: 1,
        BioData: [
          { Species_Localised: "Bacterium Tela", Value: 1_000_000, Bonus: 4_000_000 },
          { Species_Localised: "Osseus Discus", Value: 2_000_000, Bonus: 0 },
        ],
      }),
    );
    expect(rows).toEqual([{ at: AT, category: "exobiology", credits: 7_000_000 }]);
  });

  it("survives a sale with no BioData at all", () => {
    expect(incomeFromJournalLine(line({ event: "SellOrganicData", MarketID: 1 }))).toEqual([]);
  });
});

describe("trading is netted", () => {
  it("counts a sale as income and a purchase as its cost", () => {
    /*
      MarketSell is revenue, not income: 4,728,831,381 gross against 1,853,077,159 spent. Showing the
      gross figure inflates trading by 64 % and moves it up the chart against categories that are
      already net -- nobody buys a bounty.
    */
    const sell = incomeFromJournalLine(line({ event: "MarketSell", TotalSale: 4_728_831_381 }));
    const buy = incomeFromJournalLine(line({ event: "MarketBuy", TotalCost: 1_853_077_159 }));
    expect(sell[0]).toMatchObject({ category: "trading", credits: 4_728_831_381 });
    expect(buy[0]).toMatchObject({ category: "trading", credits: -1_853_077_159 });
    expect(sum([...sell, ...buy])).toBe(2_875_754_222);
  });
});

describe("the rest", () => {
  it("reads both shapes of exploration sale", () => {
    expect(
      incomeFromJournalLine(line({ event: "MultiSellExplorationData", TotalEarnings: 792_294_650 }))[0],
    ).toMatchObject({ category: "exploration", credits: 792_294_650 });
    // The older single-system event states a base and a bonus instead of a total.
    expect(
      incomeFromJournalLine(line({ event: "SellExplorationData", BaseValue: 100, Bonus: 25 }))[0],
    ).toMatchObject({ category: "exploration", credits: 125 });
  });

  it("reads a mission reward", () => {
    expect(incomeFromJournalLine(line({ event: "MissionCompleted", Reward: 226_302_537 }))[0]).toMatchObject({
      category: "missions",
      credits: 226_302_537,
    });
  });

  it("ignores everything else, including the events the panel counts as activity", () => {
    for (const event of ["Scan", "FSDJump", "SAAScanComplete", "ScanOrganic", "Docked", "LoadGame"]) {
      expect(incomeFromJournalLine(line({ event, Credits: 9_135_472_305 }))).toEqual([]);
    }
  });

  it("drops a row with no timestamp rather than dating it now", () => {
    // Undated income cannot be put in a window, and guessing "now" would move old money into today.
    expect(incomeFromJournalLine({ event: "MarketSell", TotalSale: 100 })).toEqual([]);
  });

  it("drops a zero, which is not an earning", () => {
    expect(incomeFromJournalLine(line({ event: "MissionCompleted", Reward: 0 }))).toEqual([]);
  });
});
