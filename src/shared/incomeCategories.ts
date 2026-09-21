/**
 * Which journal event counts as income, under which heading, and for how much.
 *
 * The owner's categories (2026-09-20): Combat bonds, Exploration, Exobiology, Trading, Missions.
 * Income only — no fines, rebuys, upkeep or module sales. Several of those are negative and the
 * chart's axis is logarithmic, which cannot draw a negative at all.
 *
 * Three rules here are not obvious, and each was found by totalling the owner's own 277 journals
 * before any of this was designed. Each is wrong in a way that looks perfectly plausible on screen.
 *
 * ### 1. Count the redemption, not the award
 *
 * A bond is awarded by `FactionKillBond` and *cashed* by `RedeemVoucher`. They are the same money:
 *
 * ```
 * FactionKillBond (awarded)   56 events  138,451,082 CR
 * RedeemVoucher CombatBond     6 events  139,172,574 CR
 * ```
 *
 * Summing both reports 277 M for 139 M earned. The redemption is when credits actually enter the
 * balance, so that is the one that counts and `FactionKillBond` and `Bounty` are ignored outright.
 *
 * The bounty pair does not even agree — 15,123,212 awarded against 9,190,166 redeemed — because
 * some are unclaimed and some were cashed inside the journals lost to a Windows reinstall. The
 * redemption side cannot overstate, which is the second reason to prefer it.
 *
 * ### 2. `SellOrganicData` states no total
 *
 * The value is per row inside `BioData[]`, as `Value` plus `Bonus`. Reading a top-level number gives
 * **zero** — which is what a first pass returned for the owner's largest single source, 7.77 bn.
 *
 * ### 3. Trading is netted
 *
 * `MarketSell` is revenue, not income: 4,728,831,381 gross against 1,853,077,159 spent in
 * `MarketBuy`. Showing the gross figure inflates trading by 64 %. Every other category here is
 * already net — nobody buys a bounty — so `MarketBuy` is carried as a negative row under the same
 * heading and the category totals to 2,875,754,222.
 */

/** The headings the panel shows, in the order it shows them. */
export type IncomeCategory =
  "exobiology" | "exploration" | "trading" | "missions" | "combatBonds" | "bounties" | "other";

export const INCOME_CATEGORY_LABEL: Readonly<Record<IncomeCategory, string>> = {
  exobiology: "Exobiology",
  exploration: "Exploration",
  trading: "Trading",
  missions: "Missions",
  combatBonds: "Combat bonds",
  bounties: "Bounties",
  other: "Other",
};

/** One credit movement pulled out of the journal. */
export interface IncomeEvent {
  /** ISO timestamp, as the journal wrote it. */
  at: string;
  category: IncomeCategory;
  /** Signed. Negative only for `MarketBuy`, which nets trading — see the file header. */
  credits: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * `RedeemVoucher.Type` -> heading. The type is what separates a combat bond from a bounty; without
 * it every voucher would land in one bucket and the owner's two smallest categories would merge.
 */
const VOUCHER_CATEGORY: Readonly<Record<string, IncomeCategory>> = {
  CombatBond: "combatBonds",
  bounty: "bounties",
  // A codex or scan voucher is exploration money by any reading.
  codex: "exploration",
  scannable: "exploration",
  /*
    Trade and settlement vouchers stay under Other rather than folding into Trading and Missions.

    The owner's call after seeing the shipped panel, 2026-09-21: "Other stays, works fine from what
    I can tell." They are 6.9 M of his 12 bn, and keeping them separate means the Trading row is
    market buying and selling only, which is the thing its cost line nets against. Do not tidy this
    away.
  */
  trade: "other",
  settlement: "other",
};

/**
 * Turn one journal line into its income rows, or none.
 *
 * Returns an array because `SellOrganicData` carries several samples and their values are only
 * stated per row.
 */
export function incomeFromJournalLine(line: Record<string, unknown>): IncomeEvent[] {
  const event = str(line.event);
  const at = str(line.timestamp);
  if (!at) return [];
  const one = (category: IncomeCategory, credits: number): IncomeEvent[] =>
    credits === 0 ? [] : [{ at, category, credits }];

  switch (event) {
    case "SellOrganicData": {
      // No top-level total exists. Value + Bonus, per row.
      const rows = Array.isArray(line.BioData) ? line.BioData : [];
      let total = 0;
      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const b = r as Record<string, unknown>;
        total += num(b.Value) + num(b.Bonus);
      }
      return one("exobiology", total);
    }
    case "MultiSellExplorationData":
      return one("exploration", num(line.TotalEarnings));
    case "SellExplorationData":
      // The single-system form, older and rarer. Same money, different event.
      return one("exploration", num(line.BaseValue) + num(line.Bonus));
    case "MarketSell":
      return one("trading", num(line.TotalSale));
    case "MarketBuy":
      // Negative on purpose: it nets the trading row against its own cost line.
      return one("trading", -num(line.TotalCost));
    case "MissionCompleted":
      return one("missions", num(line.Reward));
    case "RedeemVoucher": {
      const category = VOUCHER_CATEGORY[str(line.Type)] ?? "other";
      return one(category, num(line.Amount));
    }
    /*
      Deliberately not counted: `Bounty` and `FactionKillBond` are awards, and their RedeemVoucher is
      the same money reaching the balance. Counting both nearly doubles combat income.
    */
    default:
      return [];
  }
}

/** Events worth even parsing. A cheap string test against a raw line before `JSON.parse`. */
export const INCOME_EVENT_NAMES: readonly string[] = [
  "SellOrganicData",
  "MultiSellExplorationData",
  "SellExplorationData",
  "MarketSell",
  "MarketBuy",
  "MissionCompleted",
  "RedeemVoucher",
];
