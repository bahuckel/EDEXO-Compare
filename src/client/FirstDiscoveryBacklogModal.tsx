/**
 * Unfinished business — biology found and never collected.
 *
 * Every row is a landable body carrying biological signals this commander has never sampled or
 * walked on, which means the first-footfall 5x is still unclaimed. Both credit figures already
 * include it: this is not what the body is worth, it is what it is worth *to the commander who gets
 * there first*, which is the whole premise of the app.
 *
 * The floor is the number to plan on. It assumes every signal turns out to be the cheapest species
 * the predictor still allows, so the commander is never talked into a trip by an optimistic guess.
 * The ceiling is shown beside it because the gap is itself information — a body at 58 M floor and
 * 522 M ceiling is a gamble, and one at 57 M flat is not.
 *
 * Two qualities of evidence are distinguished rather than blended, because a row that promises a 5x
 * it cannot support is the one mistake that costs a real journey. **Verified** means the journal has
 * stated this body was unwalked. Everything else is a plausible target whose footfall nothing has
 * ever reported — `WasFootfalled` did not exist before 2025-09-29 — and is tagged as such.
 *
 * The list is computed on the server and takes ~45 s the first time (~53 ms of species matching per
 * body). It is memoised there until the store changes, so re-opening this is instant.
 */
import { useEffect, useMemo, useState } from "react";
import type { FirstDiscoveryBacklogDTO, FirstDiscoveryBacklogRowDTO } from "@shared/types";

const crFmt = new Intl.NumberFormat("en-US");
const cr = (n: number) => `${crFmt.format(Math.round(n))} CR`;

/** Short form for the summary line, where exact credits are noise. */
function compactCr(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} bn CR`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M CR`;
  return cr(n);
}

/**
 * Preset floors rather than a free number field.
 *
 * The commander's question is "what is worth a detour", and that is answered in orders of magnitude,
 * not in exact credits. Typing 20000000 to learn there are 74 of them is worse than pressing 20M.
 *
 * The steps come from the owner's own distribution rather than from round numbers: floors run 5 M to
 * 72 M with a median of 10 M, so the 5 M chip this started with matched all 293 rows and said
 * nothing. These cut the set to roughly 163 / 74 / 36 / 18.
 */
const FLOORS = [0, 10e6, 20e6, 30e6, 50e6] as const;
const floorLabel = (n: number) => (n === 0 ? "All" : `${Math.round(n / 1e6)}M+`);

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="fdb-copy"
      // The system name is what gets pasted into the galaxy map, so this is the one control on the
      // row that matters. Stops propagation so copying does not also count as picking the row.
      onClick={(ev) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        );
      }}
      aria-label={`Copy ${text}`}
      title={`Copy "${text}" for the galaxy map`}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

export function FirstDiscoveryBacklogModal({
  onClose,
  onSelectSystem,
}: {
  onClose: () => void;
  /** Focus the system in the main view, when the host can. */
  onSelectSystem?: (systemAddress: number, starSystem: string) => void;
}) {
  const [data, setData] = useState<FirstDiscoveryBacklogDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minCr, setMinCr] = useState<number>(0);
  const [dssOnly, setDssOnly] = useState(false);
  const [firstOnly, setFirstOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/first-discovery-backlog");
        if (!res.ok) {
          if (!cancelled) setError("This build has no journal store behind it.");
          return;
        }
        const j = (await res.json()) as FirstDiscoveryBacklogDTO;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: FirstDiscoveryBacklogRowDTO[] = useMemo(() => {
    const all = data?.rows ?? [];
    return all.filter(
      (r) =>
        r.minCr >= minCr &&
        (!dssOnly || r.genusKnown) &&
        (!firstOnly || r.firstDiscovery) &&
        (!verifiedOnly || r.footfallObserved),
    );
  }, [data, minCr, dssOnly, firstOnly, verifiedOnly]);

  const shownFloor = rows.reduce((a, r) => a + r.minCr, 0);
  const systems = new Set(rows.map((r) => r.systemAddress)).size;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Unfinished business"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Unfinished business</h2>
            <p className="dim fdb-sub">
              Biology you found first and never collected. Every figure already includes the 5×
              first-footfall bonus, because nobody has walked these yet.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {error ? <p className="fdb-empty">{error}</p> : null}

        {!data && !error ? (
          <p className="fdb-empty">
            {/*
              Says "up to a minute" because it is ~33 s over this commander's history and grows with
              it. "A few seconds" was true of the first-discovery subset and is now a small lie that
              makes a working panel look hung.
            */}
            Predicting species for every body you have scanned. This takes up to a minute the first
            time; afterwards it is instant until you fly somewhere new.
          </p>
        ) : null}

        {data ? (
          <>
            <div className="fdb-summary">
              <span>
                <strong>{rows.length}</strong> bodies
              </span>
              <span>
                <strong>{systems}</strong> systems
              </span>
              <span>
                floor <strong>{compactCr(shownFloor)}</strong>
              </span>
              {rows.length !== data.rows.length ? (
                <span className="dim">of {data.rows.length} total</span>
              ) : null}
            </div>

            <div className="fdb-filters">
              <span className="dim">Worth at least</span>
              {FLOORS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`fdb-chip${minCr === f ? " fdb-chip--on" : ""}`}
                  onClick={() => setMinCr(f)}
                >
                  {floorLabel(f)}
                </button>
              ))}
              <button
                type="button"
                className={`fdb-chip${dssOnly ? " fdb-chip--on" : ""}`}
                onClick={() => setDssOnly((v) => !v)}
                title="Only bodies you have already mapped, where the genus is known and the prediction is much narrower."
              >
                DSS done
              </button>
              <button
                type="button"
                className={`fdb-chip${firstOnly ? " fdb-chip--on" : ""}`}
                onClick={() => setFirstOnly((v) => !v)}
                title="Only systems whose main star you scanned before anyone else — the strongest sign nobody has been here."
              >
                My discoveries
              </button>
              <button
                type="button"
                className={`fdb-chip${verifiedOnly ? " fdb-chip--on" : ""}`}
                onClick={() => setVerifiedOnly((v) => !v)}
                title="Only bodies the journal has actually reported as unwalked. The rest are plausible, not confirmed."
              >
                Verified 5×
              </button>
            </div>

            <div className="fdb-scroll">
              <table className="fdb-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Body</th>
                    <th className="fdb-num">Sig</th>
                    <th className="fdb-num">Floor</th>
                    <th className="fdb-num">Ceiling</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.bodyKey}
                      className={onSelectSystem ? "fdb-row fdb-row--clickable" : "fdb-row"}
                      onClick={() => onSelectSystem?.(r.systemAddress, r.starSystem)}
                    >
                      <td className="fdb-sys">
                        {r.starSystem}
                        {r.genusKnown ? (
                          <span className="fdb-dss" title="Genus known from your DSS">
                            DSS
                          </span>
                        ) : null}
                        {/*
                          Marks the row whose 5x is an assumption rather than a reading. Drawn on the
                          unverified rows rather than the verified ones: the majority are verified, so
                          badging those would decorate the whole table and say nothing.
                        */}
                        {!r.footfallObserved ? (
                          <span
                            className="fdb-unverified"
                            title="Nothing has ever reported this body's footfall — the game did not record it before 2025-09-29. Probably untouched, but not confirmed."
                          >
                            unverified
                          </span>
                        ) : null}
                      </td>
                      {/* The body name repeats the system; trimming it keeps the column readable. */}
                      <td className="fdb-body">
                        {r.bodyName.startsWith(r.starSystem)
                          ? r.bodyName.slice(r.starSystem.length).trim() || r.bodyName
                          : r.bodyName}
                      </td>
                      <td className="fdb-num">{r.biologicalSignals}</td>
                      <td className="fdb-num fdb-floor">{cr(r.minCr)}</td>
                      <td className="fdb-num dim">{cr(r.maxCr)}</td>
                      <td>
                        <CopyButton text={r.starSystem} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length === 0 ? (
                <p className="fdb-empty">
                  Nothing at this threshold. Lower it, or you have genuinely finished them.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
