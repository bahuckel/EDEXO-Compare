/**
 * Second screen — the system, triaged, on a device you are not typing on.
 *
 * B8, which the backlog left as the owner's call because it is "only worth anything after B1". B1
 * shipped, so this is that: the same arithmetic as {@link SystemTriageModal}, rendered for a phone
 * propped against the monitor or a tablet on the desk while both hands are on a HOTAS.
 *
 * Three properties do all the design work:
 *
 * 1. **Read-only, by construction.** There is not a single mutating call in this file. A second
 *    screen gets left unattended, carried around, handed to someone — and v1.0.0's LAN access key
 *    guards the origin, not what a logged-in page can do once it is open. The safest read-only
 *    surface is one with nothing to press.
 * 2. **Legible across a desk.** Bigger type than the main app, one row per body, the verdict first.
 *    Anything needing a squint belongs on the screen you are already looking at.
 * 3. **No interaction required.** It answers "is this system worth stopping at" on its own and keeps
 *    answering as you jump. The one control is the sort order, because which number a commander
 *    thinks in is a preference — and it is remembered per device, since the phone and the desk may
 *    well disagree.
 */
import { useMemo, useState } from "react";
import { useLiveSnapshot } from "./useLiveSnapshot";
import { triageInputsFromBodies } from "./SystemTriageModal";
import { triageSystem, type TriageRow, type TriageSort } from "@shared/systemTriage";

const SORT_STORAGE_KEY = "edexo.secondscreen.sort";

function storedSort(): TriageSort {
  try {
    const v = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (v === "value" || v === "perMinute" || v === "distance") return v;
  } catch {
    /* private window, or storage disabled */
  }
  return "value";
}

function credits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function distance(ls: number | null): string {
  if (ls == null || !Number.isFinite(ls)) return "—";
  if (ls >= 100_000) return `${Math.round(ls / 1000)}k`;
  if (ls >= 10_000) return `${(ls / 1000).toFixed(1)}k`;
  return String(Math.round(ls));
}

/**
 * The one line that justifies the screen.
 *
 * A commander glancing over wants a verdict, not a table to read. The table is underneath for when
 * the verdict is "yes, and here is which body".
 */
function verdictOf(rows: TriageRow[]): { text: string; tone: "none" | "low" | "good" } {
  if (rows.length === 0) return { text: "Nothing here", tone: "none" };
  const total = rows.reduce((a, r) => a + r.expectedCredits, 0);
  const best = rows[0]!;
  if (total < 1_000_000) return { text: `Thin — ${credits(total)} across ${rows.length}`, tone: "low" };
  return { text: `${credits(total)} · best ${best.bodyName}`, tone: "good" };
}

export function SecondScreen() {
  const { snapshot, connected } = useLiveSnapshot();
  const [sort, setSort] = useState<TriageSort>(storedSort);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return triageSystem(triageInputsFromBodies(snapshot.bodies), sort, snapshot.onSiteTiming);
  }, [snapshot, sort]);

  const verdict = verdictOf(rows);
  const system = snapshot?.currentSystem ?? "—";

  function chooseSort(next: TriageSort): void {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      /* preference only */
    }
  }

  return (
    <div className="second-screen">
      <header className="ss-head">
        <div className="ss-system" title={system}>
          {system}
        </div>
        <div className={`ss-verdict ss-verdict--${verdict.tone}`}>{verdict.text}</div>
        <div className={`ss-link ${connected ? "ss-link--on" : "ss-link--off"}`}>
          {connected ? "LIVE" : "OFFLINE"}
        </div>
      </header>

      <nav className="ss-sorts" aria-label="Sort order">
        {(
          [
            ["value", "Value"],
            ["perMinute", "Per min"],
            ["distance", "Distance"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`ss-sort${sort === key ? " ss-sort--on" : ""}`}
            aria-pressed={sort === key}
            onClick={() => chooseSort(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="ss-empty">
          {snapshot
            ? "No biological signals in this system yet — honk, or jump on."
            : "Waiting for the app…"}
        </p>
      ) : (
        <ol className="ss-rows">
          {rows.map((r) => (
            <li key={r.bodyKey} className={`ss-row${r.certain ? " ss-row--certain" : ""}`}>
              <div className="ss-row-main">
                <span className="ss-body">{r.bodyName}</span>
                <span className="ss-value">{credits(r.expectedCredits)}</span>
              </div>
              <div className="ss-row-sub">
                <span className="ss-sig">
                  {r.signalCount ?? "?"} sig{r.multiplier === 5 ? " · FF×5" : ""}
                </span>
                <span className="ss-dist">{distance(r.distanceLs)} Ls</span>
                <span className="ss-rate">{credits(Math.round(r.creditsPerMinute))}/min</span>
                <span className="ss-mins">{Math.round(r.onSiteMinutes)} min</span>
              </div>
              <div className="ss-row-best">
                {r.best ? r.best.displayName : "—"}
                {/*
                  Coverage is the caveat §32.3 attached to expected value: a row whose candidates are
                  mostly unscored is built from the few that were. Shown only when it is low enough to
                  change how the number should be read.
                */}
                {r.coverage < 0.75 ? (
                  <span className="ss-coverage"> · {Math.round(r.coverage * 100)}% scored</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
