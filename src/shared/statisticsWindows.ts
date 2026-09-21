/**
 * The windows the panel offers, and the arithmetic behind credits-per-hour.
 *
 * 24 h / 7 d / 30 d / 90 d / 365 d / all, as asked for.
 *
 * ### Two honesty problems, both handled here rather than in the view
 *
 * **Windows are wall-clock, not play time.** A 24-hour window on a day he did not fly is empty, and
 * an empty chart reads as a broken feature rather than as a quiet day. So every window reports the
 * hours actually *played* inside it, and the panel can say "3.2 h flown" beside "last 24 hours".
 *
 * **Credits per hour needs a denominator nothing records.** No journal line says "these forty
 * minutes were exobiology"; the gaps between activities belong to nothing, and a commander scanning
 * on the way to a market is doing two things at once. So the rate offered here is **one number per
 * window against session time**, never a rate per category. A per-source figure that quietly divides
 * by whole-session hours flatters whatever the commander did least of, and it is exactly the kind of
 * number that gets quoted back later.
 *
 * Session time comes from journal spans: 1,248.0 hours over 277 files on the owner's machine,
 * median session 195 minutes.
 */
import type { IncomeCategory } from "./incomeCategories.js";

export type StatsWindowKey = "24h" | "7d" | "30d" | "90d" | "365d" | "all";

export interface StatsWindow {
  readonly key: StatsWindowKey;
  readonly label: string;
  /** Milliseconds back from now. Null means everything the journals hold. */
  readonly ms: number | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const STATS_WINDOWS: readonly StatsWindow[] = [
  { key: "24h", label: "24 hours", ms: DAY },
  { key: "7d", label: "7 days", ms: 7 * DAY },
  { key: "30d", label: "30 days", ms: 30 * DAY },
  { key: "90d", label: "90 days", ms: 90 * DAY },
  { key: "365d", label: "365 days", ms: 365 * DAY },
  { key: "all", label: "All", ms: null },
];

export function windowFor(key: string): StatsWindow {
  return STATS_WINDOWS.find((w) => w.key === key) ?? STATS_WINDOWS[STATS_WINDOWS.length - 1]!;
}

/** Start of a window, or null for "all". */
export function windowStartMs(w: StatsWindow, nowMs: number): number | null {
  return w.ms == null ? null : nowMs - w.ms;
}

/**
 * How many hours of play fall inside the window.
 *
 * Sessions are clipped to the window rather than counted whole: a five-hour session that began
 * thirty hours ago contributes only the part inside "last 24 hours". Counting it whole would inflate
 * the denominator and quietly deflate every rate.
 */
export function playedHoursInWindow(
  sessions: readonly { from: string; to: string }[],
  startMs: number | null,
  nowMs: number,
): number {
  let ms = 0;
  for (const s of sessions) {
    const a = Date.parse(s.from);
    const b = Date.parse(s.to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const from = startMs == null ? a : Math.max(a, startMs);
    const to = Math.min(b, nowMs);
    if (to > from) ms += to - from;
  }
  return ms / HOUR;
}

export interface CategoryTotal {
  category: IncomeCategory;
  credits: number;
  /** How many journal events made it up, so a single big sale is distinguishable from a grind. */
  events: number;
}

import type { CarrierUpkeepEstimate } from "./carrierUpkeep.js";

/** One carrier's account, its identity, and what it costs to run. */
export interface CarrierAccountDTO {
  carrierId: number;
  /** As the commander named it; empty when no event has said. */
  name: string;
  callsign: string;
  /** Raw `CarrierType` from the journal, e.g. `FleetCarrier`. Rendered, never switched on. */
  type: string;
  /** Readings inside the window, for this carrier's chart. */
  balance: { at: string; balance: number; reserve: number | null; available: number | null }[];
  /** The newest reading of all time, even when it predates the window. */
  latest: { at: string; balance: number; reserve: number | null; available: number | null } | null;
  /**
   * What it costs each week and how long the balance lasts, measured from this carrier's own
   * readings over all of history — upkeep is a property of the carrier, not of the last 24 hours,
   * and the readings are sparse enough that a window would usually hold none.
   */
  upkeep: CarrierUpkeepEstimate;
}

export interface StatisticsDTO {
  window: StatsWindowKey;
  /** Totals by heading, largest first, zero rows kept so the chart can draw them flat. */
  income: CategoryTotal[];
  totalCredits: number;
  /** Play time inside the window, from journal spans. */
  playedHours: number;
  /**
   * `totalCredits / playedHours`, or null when nothing was played. One figure for the window — see
   * this file's header for why there is no per-category rate.
   */
  creditsPerHour: number | null;
  activity: {
    bodiesScanned: number;
    jumps: number;
    systemsHonked: number;
    bodiesMapped: number;
    organicSamples: number;
  };
  /** Commander credits over time, as stated by the journal. Steps, never interpolated. */
  commanderBalance: { at: string; credits: number }[];
  /**
   * One entry per carrier the journals have seen, newest reading first.
   *
   * A commander can own a fleet carrier and a squadron carrier at once, and each keeps its own
   * account, its own reserve target and its own weekly charge. They were pooled into one series
   * until 2026-09-21, which measured the upkeep across the gap between two accounts.
   */
  carriers: CarrierAccountDTO[];

  /** Journals the scan read, so the panel can say what it is speaking for. */
  filesRead: number;
}
