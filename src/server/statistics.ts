/**
 * The statistics panel's answer: a scan, narrowed to one window.
 *
 * The scan is the expensive half and is cached (`statisticsScan.ts`); this half is arithmetic over a
 * few thousand rows and runs per request.
 */
import type { IncomeCategory } from "../shared/incomeCategories.js";
import { INCOME_CATEGORY_LABEL } from "../shared/incomeCategories.js";
import {
  playedHoursInWindow,
  windowFor,
  windowStartMs,
  type CategoryTotal,
  type StatisticsDTO,
} from "../shared/statisticsWindows.js";
import type { JournalScan } from "./statisticsScan.js";

const ALL_CATEGORIES = Object.keys(INCOME_CATEGORY_LABEL) as IncomeCategory[];

export function summariseStatistics(
  scan: JournalScan,
  windowKey: string,
  nowMs: number = Date.now(),
): StatisticsDTO {
  const w = windowFor(windowKey);
  const startMs = windowStartMs(w, nowMs);
  const inWindow = (iso: string): boolean => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    if (t > nowMs) return false;
    return startMs == null || t >= startMs;
  };

  /*
    Every category is seeded at zero rather than only those with income.

    A window with no combat must still show a "Combat bonds" row, flat on the baseline. Omitting it
    would read as the panel having forgotten the category, and the log axis already draws a zero as
    a floor value for exactly this reason.
  */
  const byCategory = new Map<IncomeCategory, CategoryTotal>(
    ALL_CATEGORIES.map((c) => [c, { category: c, credits: 0, events: 0 }]),
  );
  for (const row of scan.income) {
    if (!inWindow(row.at)) continue;
    const entry = byCategory.get(row.category);
    if (!entry) continue;
    entry.credits += row.credits;
    // A MarketBuy is a cost line inside trading, not an earning event, so it is not counted as one.
    if (row.credits > 0) entry.events += 1;
  }

  const income = [...byCategory.values()].sort((a, b) => b.credits - a.credits);
  const totalCredits = income.reduce((sum, c) => sum + Math.max(0, c.credits), 0);
  const playedHours = playedHoursInWindow(scan.sessions, startMs, nowMs);

  const commanderBalance: StatisticsDTO["commanderBalance"] = [];
  const carrierBalance: StatisticsDTO["carrierBalance"] = [];
  let carrierLatest: StatisticsDTO["carrierLatest"] = null;
  for (const b of scan.balances) {
    /*
      The latest carrier reading is tracked across all of history, not just the window.

      `CarrierStats` only fires when the commander opens the carrier management panel, so the series
      is sparse and can easily have no point inside 24 hours. "What does my carrier hold" still has
      an answer then; it is just an old one, and the panel dates it rather than hiding it.
    */
    if (b.carrier != null) {
      const row = {
        at: b.at,
        balance: b.carrier,
        reserve: b.carrierReserve,
        available: b.carrierAvailable,
      };
      if (!carrierLatest || b.at > carrierLatest.at) carrierLatest = row;
      if (inWindow(b.at)) carrierBalance.push(row);
    }
    if (b.commander != null && inWindow(b.at)) {
      commanderBalance.push({ at: b.at, credits: b.commander });
    }
  }

  return {
    window: w.key,
    income,
    totalCredits,
    playedHours,
    // Null rather than Infinity or zero: no play time means the question has no answer, and a rate
    // divided by almost-zero hours is a number that looks real and is not.
    creditsPerHour: playedHours >= 0.05 ? totalCredits / playedHours : null,
    activity: countActivityInWindow(scan, startMs),
    commanderBalance,
    carrierBalance,
    carrierLatest,
    filesRead: scan.filesRead,
  };
}

/**
 * Activity inside the window, summed from the scan's per-day buckets.
 *
 * Days are the unit because the shortest window on offer is 24 hours, so a day bucket answers every
 * one of them while keeping 37,780 `Scan` events out of the cache as timestamps. The cost is the
 * edge: "last 24 hours" is really "today and yesterday's buckets, clipped by date". A body scanned
 * 25 hours ago lands in yesterday's bucket and is counted; one scanned 47 hours ago is not.
 *
 * That is a day's slack on the shortest window only, and the alternative — caching every event's
 * timestamp — writes a list of everywhere the commander has been to disk in order to draw a bar
 * chart. The panel says "by day" so the reading is not mistaken for something finer.
 */
function countActivityInWindow(scan: JournalScan, startMs: number | null): StatisticsDTO["activity"] {
  const out = { bodiesScanned: 0, jumps: 0, systemsHonked: 0, bodiesMapped: 0, organicSamples: 0 };
  const startDay = startMs == null ? null : new Date(startMs).toISOString().slice(0, 10);
  for (const [day, counts] of Object.entries(scan.activity)) {
    if (startDay != null && day < startDay) continue;
    out.bodiesScanned += counts.bodiesScanned;
    out.jumps += counts.jumps;
    out.systemsHonked += counts.systemsHonked;
    out.bodiesMapped += counts.bodiesMapped;
    out.organicSamples += counts.organicSamples;
  }
  return out;
}
