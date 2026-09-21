/**
 * Statistics — income by source, activity, and the two balances.
 *
 * ### The income chart is logarithmic, base five
 *
 * The owner's ask, and it fits his data: his sources span 9.2 M to 7.77 bn, a ratio of 845x. Linear,
 * bounties would be a bar 0.1 % the height of exobiology — one pixel, unreadable. Base five puts the
 * whole range in four or five rungs, each an equal step along the axis, so every row can be compared
 * by eye. Base ten would compress the same range into 2.9 decades and lose the distinction.
 *
 * **Zero draws flat on the baseline**, labelled, rather than vanishing — a window with no combat is
 * a fact about the window, and a missing row reads as a broken panel.
 *
 * ### The balances are linear, and are steps
 *
 * A balance is a level, not a rate; log five would flatten exactly the movement worth looking at.
 * They are drawn as steps between known points because the journal states a balance only at login:
 * a smooth line across the owner's 9,045-hour gap would invent a year of steady earning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { INCOME_CATEGORY_LABEL, type IncomeCategory } from "@shared/incomeCategories";
import { buildLogFiveAxis, formatCredits, logFiveFraction } from "@shared/logFiveAxis";
import { STATS_WINDOWS, type StatisticsDTO } from "@shared/statisticsWindows";
import { Tooltip } from "./ui/Tooltip";
import { useModal } from "./ui/useModal";
import { formatWeeks } from "@shared/carrierUpkeep";

type Measure = "credits" | "perHour";

const n = (v: number) => Math.round(v).toLocaleString("en-US");

function hours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 100) return `${h.toFixed(1)} h`;
  return `${n(h)} h`;
}

/** The income bars. One row per category, always, in the order the server ranked them. */
function IncomeChart({ data, measure }: { data: StatisticsDTO; measure: Measure }) {
  /*
    Per-hour divides each category by the window's whole play time.

    That is arithmetic the panel can do honestly only because it is the *same* denominator for every
    row — it says "of the hours you played, this source earned at this rate", not "this is what an
    hour of trading pays". No journal line says which minutes were trading, so the second reading is
    not available and the tooltip says so.
  */
  const perHour = measure === "perHour" && data.playedHours >= 0.05;
  const value = (credits: number) => (perHour ? credits / data.playedHours : credits);
  const axis = buildLogFiveAxis(
    data.income.map((c) => value(c.credits)),
    perHour ? 1_000 : 1_000_000,
  );

  return (
    <div className="stats-chart">
      <div className="stats-chart__grid" aria-hidden="true">
        {axis.ticks.map((t) => (
          <div
            key={t}
            className="stats-chart__gridline"
            style={{ left: `${logFiveFraction(t, axis) * 100}%` }}
          >
            <span>{formatCredits(t)}</span>
          </div>
        ))}
      </div>
      {data.income.map((row) => {
        const v = value(row.credits);
        const pct = logFiveFraction(v, axis) * 100;
        const empty = row.credits <= 0;
        return (
          <div key={row.category} className={`stats-row${empty ? " stats-row--empty" : ""}`}>
            <span className="stats-row__label">{INCOME_CATEGORY_LABEL[row.category as IncomeCategory]}</span>
            <span className="stats-row__track">
              <span className={`stats-row__bar stats-bar--${row.category}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="stats-row__value">
              {empty ? "none" : `${formatCredits(v)}${perHour ? "/h" : ""}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Commander credits over time: linear, stepped, never interpolated across a gap. */
function BalanceChart({ points }: { points: { at: string; credits: number }[] }) {
  if (points.length < 2) {
    return (
      <p className="dim stats-note">
        {points.length === 1
          ? `One reading in this window: ${n(points[0]!.credits)} CR. The balance is stated once per login, so a short window often holds a single point.`
          : "No balance reading in this window. The journal states it once per login."}
      </p>
    );
  }
  const lo = Math.min(...points.map((p) => p.credits));
  const hi = Math.max(...points.map((p) => p.credits));
  const t0 = Date.parse(points[0]!.at);
  const t1 = Date.parse(points[points.length - 1]!.at);
  const span = Math.max(1, t1 - t0);
  const range = Math.max(1, hi - lo);
  const x = (at: string) => ((Date.parse(at) - t0) / span) * 100;
  const y = (c: number) => 100 - ((c - lo) / range) * 100;

  /*
    Steps, not a line. `H` then `V` holds the previous balance until the next reading rather than
    sloping between them: between two logins the balance is unknown, and a slope is a claim about
    every moment in the gap.
  */
  let d = `M ${x(points[0]!.at)} ${y(points[0]!.credits)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` H ${x(points[i]!.at)} V ${y(points[i]!.credits)}`;
  }

  return (
    <div className="stats-balance">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Commander balance over time"
      >
        <path d={d} className="stats-balance__line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="stats-balance__ends dim">
        <span>
          {points[0]!.at.slice(0, 10)} · {formatCredits(points[0]!.credits)}
        </span>
        <span>
          {points[points.length - 1]!.at.slice(0, 10)} · {formatCredits(points[points.length - 1]!.credits)}
        </span>
      </div>
    </div>
  );
}

export function StatisticsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [data, setData] = useState<StatisticsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [window_, setWindow] = useState("all");
  const [measure, setMeasure] = useState<Measure>("credits");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = (seq.current += 1);
    setBusy(true);
    try {
      const res = await fetch(`/api/statistics?window=${encodeURIComponent(window_)}`);
      if (!res.ok) throw new Error(`Statistics failed (${res.status})`);
      const body = (await res.json()) as StatisticsDTO;
      if (mine !== seq.current) return;
      setData(body);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [window_]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = data?.activity;
  const carrier = data?.carrierLatest;
  const upkeep = data?.carrierUpkeep ?? {
    perWeek: null,
    samples: 0,
    daysObserved: 0,
    weeksOfRunway: null,
    disagreed: false,
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Statistics"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Statistics</h2>
            <p className="dim fdb-sub">
              Income by source, from your own journals. Each gridline is <strong>5×</strong> the one before
              it, so a source earning a thousandth of another is still a bar you can read.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="fdb-filters">
          {STATS_WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              className={`fdb-chip${window_ === w.key ? " fdb-chip--on" : ""}`}
              onClick={() => setWindow(w.key)}
              aria-pressed={window_ === w.key}
            >
              {w.label}
            </button>
          ))}
          <span className="fdb-filters__gap" />
          <Tooltip text="Total credits earned in the window.">
            <button
              type="button"
              className={`fdb-chip${measure === "credits" ? " fdb-chip--on" : ""}`}
              onClick={() => setMeasure("credits")}
              aria-pressed={measure === "credits"}
            >
              Credits
            </button>
          </Tooltip>
          <Tooltip text="Each source divided by the hours you played in this window — not by hours spent on that source, which no journal records.">
            <button
              type="button"
              className={`fdb-chip${measure === "perHour" ? " fdb-chip--on" : ""}`}
              onClick={() => setMeasure("perHour")}
              aria-pressed={measure === "perHour"}
              disabled={(data?.playedHours ?? 0) < 0.05}
            >
              Per hour
            </button>
          </Tooltip>
        </div>

        {error ? <p className="fdb-empty">{error}</p> : null}
        {busy && !data ? (
          <p className="fdb-empty">Reading your journals. The first time takes a few seconds.</p>
        ) : null}

        {data ? (
          <div className="fdb-scroll">
            <div className="fdb-summary">
              <span>
                <strong>{formatCredits(data.totalCredits)}</strong> earned
              </span>
              <span className="dim">{hours(data.playedHours)} flown</span>
              {data.creditsPerHour != null ? (
                <span className="dim">{formatCredits(data.creditsPerHour)}/h overall</span>
              ) : (
                <span className="dim">no play time in this window</span>
              )}
              <span className="dim">{data.filesRead} journals read</span>
            </div>

            <IncomeChart data={data} measure={measure} />

            <h3 className="stats-h3">Activity</h3>
            <div className="stats-tiles">
              <span>
                <strong>{n(a?.bodiesScanned ?? 0)}</strong> bodies scanned
              </span>
              <span>
                <strong>{n(a?.jumps ?? 0)}</strong> jumps
              </span>
              <span>
                <strong>{n(a?.systemsHonked ?? 0)}</strong> systems honked
              </span>
              <span>
                <strong>{n(a?.bodiesMapped ?? 0)}</strong> bodies mapped
              </span>
              <span>
                {/* Three events per plant — Log, Sample, Analyse — so this is scans, not plants. */}
                <strong>{n(a?.organicSamples ?? 0)}</strong> organic scans
              </span>
            </div>

            <h3 className="stats-h3">Commander balance</h3>
            <BalanceChart points={data.commanderBalance} />

            <h3 className="stats-h3">Carrier</h3>
            {carrier ? (
              <>
                <div className="stats-tiles">
                  <span>
                    <strong>{formatCredits(carrier.balance)}</strong> in the carrier
                  </span>
                  {carrier.reserve != null ? (
                    <span>
                      <strong>{formatCredits(carrier.reserve)}</strong> reserve target
                    </span>
                  ) : null}
                  {/*
                    Weekly upkeep and runway are the two numbers that answer "is my carrier all
                    right", and neither was on this panel. A dash rather than a figure when the
                    journals hold no clean pair of readings — the rule creditsPerHour follows.
                  */}
                  <span>
                    <strong>{upkeep.perWeek != null ? formatCredits(upkeep.perWeek) : "—"}</strong> per week
                    upkeep
                  </span>
                  <span
                    className={
                      upkeep.weeksOfRunway != null && upkeep.weeksOfRunway < 4 ? "stats-negative" : undefined
                    }
                  >
                    <strong>{upkeep.weeksOfRunway != null ? formatWeeks(upkeep.weeksOfRunway) : "—"}</strong>{" "}
                    of runway
                  </span>
                </div>
                {/*
                  The reading is dated because CarrierStats only fires when the carrier management
                  panel is opened. Presenting it as "now" would be wrong by months.
                */}
                <p className="dim stats-note">
                  As of <strong>{carrier.at.slice(0, 10)}</strong> — the game reports this only when you open
                  the carrier management panel.
                  {upkeep.perWeek != null ? (
                    <>
                      {" "}
                      Upkeep is measured from your own balance history — {upkeep.samples}{" "}
                      {upkeep.samples === 1 ? "reading pair" : "reading pairs"} over{" "}
                      {Math.round(upkeep.daysObserved)} days, with transfers and service changes excluded.
                      {upkeep.disagreed ? (
                        <>
                          {" "}
                          <strong>The pairs disagree</strong>, which usually means a service was activated or
                          paused — the newest reading is the one to trust.
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {" "}
                      Weekly upkeep needs two carrier readings with nothing spent between them. Open the
                      carrier management panel now and again and it will appear.
                    </>
                  )}
                  {carrier.reserve != null && carrier.balance < carrier.reserve ? (
                    <>
                      {" "}
                      Your <strong>reserve target</strong> is higher than the balance. That is a savings
                      target set by the reserve slider, frozen at whatever the balance was when it was last
                      moved — it is not money owed and it is not being spent. The runway above is what
                      matters.
                    </>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="dim stats-note">
                No carrier reading in your journals. It appears once you open the carrier management panel in
                game.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
