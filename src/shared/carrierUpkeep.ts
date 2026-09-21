/**
 * What the fleet carrier costs to run each week, and how long the money lasts.
 *
 * ### Why this is measured and not looked up
 *
 * Upkeep is the carrier's core charge plus a weekly cost per installed service, and those costs are
 * game constants that have moved between updates. Shipping a table of them would put a number on the
 * card that is right until Frontier changes it and wrong silently afterwards. It does not need a
 * table: **the charge is visible in the commander's own balance history.** The carrier's account only
 * falls for two reasons — upkeep, and the commander spending it — and the journal states every
 * transfer, so the pairs of samples with nothing between them measure the charge directly.
 *
 * Read off the owner's journals on 2026-09-21, over a year and four clean windows:
 *
 * ```
 *   2025-11-28 -> 2026-04-14   136.8 d   -137,750,036   = 19 charges of 7,250,002
 *   2026-04-14 -> 2026-04-17     3.1 d   -  7,250,004   =  1 charge  of 7,250,004
 *   2026-04-17 -> 2026-05-15    27.9 d   - 29,200,004   =  4 charges of 7,300,001
 * ```
 *
 * Every window is a whole number of weekly charges of about 7.25 M, on a carrier running Refuel,
 * Commodities and Carrier Fuel with Rearm paused.
 *
 * ### What `ReserveBalance` is, and what it is not
 *
 * It is **not** a pot that upkeep drains. It is the allocation the `ReservePercent` slider sets,
 * frozen at whatever the balance was when it was last moved — the owner's has read 591,393,873 and
 * not moved since 2025-10-30 while the balance fell from 591 M to 395 M. So `AvailableBalance`,
 * which is simply `balance − reserve`, goes negative once the balance drops below the target, and a
 * panel that shows it alone reads like a carrier in trouble when the carrier has a year of runway.
 *
 * Weeks of runway is the number that answers the question. It divides the **balance**, not the
 * available figure, because the reserve is a savings target and the whole balance pays the upkeep.
 */

/** A balance reading, as `CarrierStats` or `CarrierFinance` stated it. */
export interface CarrierBalanceSample {
  at: string;
  balance: number;
}

/**
 * A moment the account changed for a reason that is not upkeep.
 *
 * `CarrierBankTransfer` moves money either way; `CarrierCrewServices` changes what the weekly charge
 * *is*. A pair of samples spanning either one cannot measure the charge and is dropped.
 */
export interface CarrierLedgerBreak {
  at: string;
  /** `transfer` invalidates the pair; `service` also makes every earlier pair stale. */
  kind: "transfer" | "service";
  /** Which carrier it happened to. A break on one carrier says nothing about the other. */
  carrierId: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far two estimates may differ and still be called the same charge.
 *
 * Five per cent. The charge is a fixed figure, so honest pairs agree to the credit; the slack is for
 * a window whose ends are a few hours either side of a charge and so divides by a week too many or
 * too few. Wider than this means a service changed and the older pairs describe a carrier that no
 * longer exists.
 */
export const UPKEEP_AGREEMENT = 0.05;

/** Pairs shorter than this cannot place a weekly charge and are not worth the arithmetic. */
const MIN_SPAN_DAYS = 2;

export interface CarrierUpkeepEstimate {
  /** Credits per week, or null when no clean pair of samples exists. */
  perWeek: number | null;
  /** How many sample pairs agreed on it. One is an answer; it is simply a thinner one. */
  samples: number;
  /** The span the estimate rests on, in days. */
  daysObserved: number;
  /** Weeks the current balance buys at that rate, or null when the rate is unknown. */
  weeksOfRunway: number | null;
  /** Set when pairs disagreed beyond {@link UPKEEP_AGREEMENT} — a service probably changed. */
  disagreed: boolean;
}

const EMPTY: CarrierUpkeepEstimate = {
  perWeek: null,
  samples: 0,
  daysObserved: 0,
  weeksOfRunway: null,
  disagreed: false,
};

/**
 * Estimate the weekly charge from consecutive balance samples.
 *
 * Returns nulls rather than a guess when the journals cannot say — the same rule `creditsPerHour`
 * follows. A commander who has opened the carrier panel twice a month apart gets an answer; one who
 * has opened it once does not, and the panel tells them so instead of inventing a figure.
 */
export function estimateCarrierUpkeep(
  samples: readonly CarrierBalanceSample[],
  breaks: readonly CarrierLedgerBreak[],
  currentBalance: number | null,
): CarrierUpkeepEstimate {
  const ordered = [...samples]
    .filter((s) => Number.isFinite(s.balance) && !Number.isNaN(Date.parse(s.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ordered.length < 2) return EMPTY;

  const breakTimes = breaks
    .map((b) => ({ t: Date.parse(b.at), kind: b.kind }))
    .filter((b) => !Number.isNaN(b.t))
    .sort((a, b) => a.t - b.t);
  /*
    A service change does not merely spoil the pair that spans it — every pair before it measured a
    different carrier. Only pairs after the last one are used.
  */
  const lastServiceChange = breakTimes.filter((b) => b.kind === "service").at(-1)?.t ?? -Infinity;

  /*
    How many charges fall between two readings, and why it cannot simply be rounded.

    Upkeep is taken on a fixed weekly tick, not on the anniversary of a reading, so a span of 136.8
    days holds either 19 charges or 20 depending on where the readings sit relative to that tick.
    Rounding gives 20 and a rate of 6.89 M; the truth is 19 and 7.25 M. Knowing the tick would settle
    it, but the tick is a game constant of exactly the kind this file exists to avoid.

    Instead every pair offers both readings of itself — floor and ceiling — and the rate that the
    most pairs can agree on wins. On the owner's five pairs the answer 7.25 M is reachable by all
    five; no other value is reachable by more than two.
  */
  interface Candidate {
    perWeek: number;
    pair: number;
    days: number;
  }
  const candidates: Candidate[] = [];
  const pairDays: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    const t0 = Date.parse(a.at);
    const t1 = Date.parse(b.at);
    if (t0 < lastServiceChange) continue;
    const spanMs = t1 - t0;
    if (spanMs < MIN_SPAN_DAYS * 24 * 60 * 60 * 1000) continue;
    if (breakTimes.some((x) => x.t > t0 && x.t < t1)) continue;
    const spent = a.balance - b.balance;
    // Upkeep only ever takes money out. A rise with no transfer recorded means the journals are
    // incomplete across that gap, which is common — his were lost in a Windows reinstall.
    if (spent <= 0) continue;
    const pair = pairDays.length;
    pairDays.push(spanMs / (24 * 60 * 60 * 1000));
    const weeks = spanMs / WEEK_MS;
    for (const n of new Set([Math.max(1, Math.floor(weeks)), Math.max(1, Math.ceil(weeks))])) {
      candidates.push({ perWeek: spent / n, pair, days: spanMs / (24 * 60 * 60 * 1000) });
    }
  }
  if (candidates.length === 0) return EMPTY;

  /*
    The consensus: for each candidate rate, how many distinct pairs have a reading within tolerance.
    Ties go to the rate with the tighter spread, so a value two pairs agree on loosely loses to one
    they agree on exactly.
  */
  let best: { perWeek: number; support: Set<number>; error: number } | null = null;
  for (const c of candidates) {
    const support = new Set<number>();
    let error = 0;
    for (const other of candidates) {
      if (Math.abs(other.perWeek - c.perWeek) <= c.perWeek * UPKEEP_AGREEMENT) {
        if (!support.has(other.pair)) {
          support.add(other.pair);
          error += Math.abs(other.perWeek - c.perWeek);
        }
      }
    }
    if (
      !best ||
      support.size > best.support.size ||
      (support.size === best.support.size && error < best.error)
    ) {
      best = { perWeek: c.perWeek, support, error };
    }
  }
  const perWeek = best!.perWeek;
  const supported = best!.support.size;
  const totalPairs = pairDays.length;

  return {
    perWeek,
    samples: supported,
    daysObserved: [...best!.support].reduce((n, i) => n + (pairDays[i] ?? 0), 0),
    weeksOfRunway:
      currentBalance != null && Number.isFinite(currentBalance) && perWeek > 0
        ? Math.max(0, currentBalance) / perWeek
        : null,
    // Pairs that could not reach the consensus rate under either reading. One of those is a service
    // change the journals did not record, or a spend the commander made outside the bank transfer.
    disagreed: supported < totalPairs,
  };
}

/** `54 weeks`, or `3.2 weeks` when it is close enough that the fraction matters. */
export function formatWeeks(weeks: number): string {
  if (weeks < 10) return `${weeks.toFixed(1)} weeks`;
  return `${Math.round(weeks)} weeks`;
}
