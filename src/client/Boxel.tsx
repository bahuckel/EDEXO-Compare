/**
 * Boxel scanning (shared/boxel.ts; guild tester report, 2026-09-30): one boxel's systems -0 upwards,
 * which you have flown, which the galaxy index knows and what grows there, what the boxel tends to
 * grow, and the next one to fly. Any row looks the system up on Spansh and opens it, as the header's
 * search does.
 *
 * Saved boxels (owner, 2026-09-30): type a boxel's last system and it is kept, listed -0 up to it,
 * and ticked off as he flies — the list and the open table re-read the journals after every jump.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoxelDTO, SavedBoxelDTO } from "@shared/boxel";
import { parseBoxel } from "@shared/boxel";
import { useModal } from "./ui/useModal";
import { CopySystemButton } from "./CopySystemButton";
import { useToast } from "./ui/feedback";
import { isBool, usePersistedState } from "./usePersistedState";

export function BoxelModal({
  onClose,
  currentSystem,
}: {
  onClose: () => void;
  currentSystem: string | null;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const [name, setName] = useState(() => (currentSystem && parseBoxel(currentSystem) ? currentSystem : ""));
  const [end, setEnd] = useState("");
  const [data, setData] = useState<BoxelDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A d-boxel runs to hundreds of systems: the rows with something to say, when asked.
  const [onlyKnown, setOnlyKnown] = usePersistedState("boxel.onlyKnown", false, isBool);

  // What the table shows, so a jump can re-read it (the ticks follow him).
  const shown = useRef<{ name: string; end: string } | null>(null);
  const load = useCallback(
    (nameArg?: string, endArg?: string) => {
      const n = (nameArg ?? name).trim();
      const e = (endArg ?? end).trim();
      if (!n) return;
      setBusy(true);
      setError(null);
      shown.current = { name: n, end: e };
      const q = new URLSearchParams({ name: n });
      if (e) q.set("end", e);
      void fetch(`/api/boxel?${q}`)
        .then(async (r) => {
          const j = (await r.json()) as BoxelDTO & { error?: string };
          if (!r.ok) throw new Error(j.error ?? r.statusText);
          setData(j);
        })
        .catch((e: unknown) => {
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setBusy(false));
    },
    [name, end],
  );

  // The current system's boxel opens straight away.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  const [saved, setSaved] = useState<SavedBoxelDTO[] | null>(null);
  const [lastInput, setLastInput] = useState("");
  const [savedError, setSavedError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = usePersistedState("boxel.showPrevious", false, isBool);
  const savedCall = useCallback(async (init?: RequestInit, path = "/api/boxels") => {
    try {
      const r = await fetch(path, init);
      const j = (await r.json()) as { items?: SavedBoxelDTO[]; error?: string };
      if (j.items) setSaved(j.items);
      setSavedError(r.ok ? null : (j.error ?? r.statusText));
      return r.ok;
    } catch {
      setSavedError("The app's server could not be reached.");
      return false;
    }
  }, []);

  // After every jump: the saved list and the open table tick off what was just flown.
  const firstJump = useRef(true);
  useEffect(() => {
    void savedCall();
    if (firstJump.current) {
      firstJump.current = false;
      return;
    }
    if (shown.current) load(shown.current.name, shown.current.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSystem, savedCall]);

  const showSaved = (b: SavedBoxelDTO) => {
    setName(b.lastSystem);
    setEnd(String(b.end));
    load(b.lastSystem, String(b.end));
  };

  // The saved boxel the table is showing, if any: its rows get Skip and a cut (owner, 2026-09-30).
  const savedHere =
    data && saved ? (saved.find((b) => b.prefix.toLowerCase() === data.prefix.toLowerCase()) ?? null) : null;
  const skipSet = new Set(savedHere?.skipped ?? []);
  const [cutAsk, setCutAsk] = useState<number | null>(null);
  const patchSaved = (b: SavedBoxelDTO, body: Record<string, unknown>) =>
    savedCall(
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      `/api/boxels/${encodeURIComponent(b.id)}`,
    );
  const cutFrom = (b: SavedBoxelDTO, n: number) => {
    setCutAsk(null);
    void patchSaved(b, { cutFrom: n }).then((ok) => {
      if (!ok) return;
      const last = `${b.prefix}${n - 1}`;
      setName(last);
      setEnd(String(n - 1));
      load(last, String(n - 1));
    });
  };
  const skip = (b: SavedBoxelDTO, n: number, on: boolean) => {
    setCutAsk(null);
    void patchSaved(b, { skip: n, on });
  };
  const extendTo = (b: SavedBoxelDTO, n: number) => {
    const last = `${b.prefix}${n}`;
    void savedCall({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastSystem: last }),
    }).then((ok) => {
      if (!ok) return;
      setName(last);
      setEnd(String(n));
      load(last, String(n));
    });
  };

  const savedItem = (b: SavedBoxelDTO) => {
    const done = b.next == null;
    return (
      <li key={b.id} className={`boxel-saved__item${done ? " boxel-saved__item--done" : ""}`}>
        <span className="boxel-saved__name">
          <strong>{b.boxel}</strong>{" "}
          <span className="dim">
            {b.sector} · -0 to -{b.end}
          </span>
        </span>
        <span
          className="boxel-saved__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={b.total}
          aria-valuenow={b.flown}
          aria-label={`${b.flown} of ${b.total} flown`}
        >
          <span style={{ width: `${(b.flown / b.total) * 100}%` }} />
        </span>
        <span className="boxel-saved__count">
          {b.flown} / {b.total} systems
          {b.skipped.length ? <span className="dim"> · {b.skipped.length} skipped</span> : null}
          <span className="dim">
            {" · "}
            {b.bodiesScanned.toLocaleString()}
            {b.bodiesTotal != null ? ` / ${b.bodiesTotal.toLocaleString()}` : ""} bodies
            {" · "}
          </span>
          <span className={b.notable ? "boxel-saved__notable" : "dim"}>{b.notable} notable</span>
        </span>
        <span className="boxel-saved__next">
          {done ? (
            <span className="fdb-dss">{b.skipped.length ? "done" : "all flown"}</span>
          ) : (
            <>
              <span className="dim">next </span>
              {b.next}
              <CopySystemButton system={b.next!} />
            </>
          )}
        </span>
        <span className="boxel-saved__actions">
          {b.flownBeyond.length ? (
            <button
              type="button"
              className="fdb-chip boxel-saved__extend"
              title={`You have flown -${b.flownBeyond.join(", -")} too: the boxel goes further than -${b.end}.`}
              onClick={() => extendTo(b, b.flownBeyond[b.flownBeyond.length - 1]!)}
            >
              Extend to -{b.flownBeyond[b.flownBeyond.length - 1]}
            </button>
          ) : null}
          <button type="button" className="fdb-chip" onClick={() => showSaved(b)}>
            Show
          </button>
          {confirmId === b.id ? (
            <>
              <button
                type="button"
                className="fdb-chip boxel-saved__del"
                onClick={() => {
                  setConfirmId(null);
                  void savedCall({ method: "DELETE" }, `/api/boxels/${encodeURIComponent(b.id)}`);
                }}
              >
                Delete
              </button>
              <button type="button" className="fdb-chip" onClick={() => setConfirmId(null)}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="fdb-chip boxel-saved__x"
              aria-label={`Delete ${b.boxel} from your boxels`}
              title="Delete from your boxels"
              onClick={() => setConfirmId(b.id)}
            >
              ×
            </button>
          )}
        </span>
      </li>
    );
  };

  const addSaved = () => {
    const typed = lastInput.trim();
    if (!typed) return;
    void savedCall({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastSystem: typed }),
    }).then((ok) => {
      if (!ok) return;
      setLastInput("");
      const b = parseBoxel(typed);
      if (b?.index != null) {
        setName(typed);
        setEnd(String(b.index));
        load(typed, String(b.index));
      }
    });
  };

  const lookUp = async (system: string) => {
    try {
      const r = await fetch(`/api/system/spansh-search?q=${encodeURIComponent(system)}`);
      const j = (await r.json()) as {
        systems?: { systemAddress: number; starSystem: string }[];
        error?: string;
      };
      const hit = (j.systems ?? []).find((s) => s.starSystem.toLowerCase() === system.toLowerCase());
      if (!hit) {
        toast.error(`${system}: nobody has logged it on Spansh yet — it may be undiscovered.`);
        return;
      }
      await fetch("/api/ui/view-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemAddress: hit.systemAddress, starSystem: hit.starSystem }),
      });
      onClose();
    } catch {
      toast.error("Spansh could not be reached.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Boxel"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Boxel</h2>
            <p className="dim fdb-sub">
              Every system of one boxel, from -0 up: the ones you have flown, the ones the galaxy index has
              records for and what grows there, and the next one to fly.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="boxel-saved" aria-label="Your boxels">
          <form
            className="boxel-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              addSaved();
            }}
          >
            <label>
              <span className="dim">Last system of a boxel — lists every system before it and keeps it</span>
              <input
                className="carriers-search__input"
                value={lastInput}
                placeholder="Eol Prou AB-C d1-57"
                onChange={(ev) => setLastInput(ev.target.value)}
              />
            </label>
            <button type="submit" className="fdb-chip fdb-chip--on" disabled={!lastInput.trim()}>
              Add
            </button>
          </form>
          {savedError ? <p className="fdb-empty">{savedError}</p> : null}
          {saved?.length
            ? (() => {
                // The boxel he is in now; else the newest. The others fold away behind an arrow.
                const current = saved.filter((b) => b.current);
                const head = current.length ? current : saved.slice(0, 1);
                const previous = saved.filter((b) => !head.includes(b));
                const list = (items: SavedBoxelDTO[]) => (
                  <ul className="boxel-saved__list">{items.map(savedItem)}</ul>
                );
                return (
                  <>
                    <p className="boxel-saved__label">{current.length ? "Current" : "Latest"}</p>
                    {list(head)}
                    {previous.length ? (
                      <>
                        <button
                          type="button"
                          className="boxel-saved__toggle"
                          aria-expanded={showPrevious}
                          onClick={() => setShowPrevious(!showPrevious)}
                        >
                          <span aria-hidden>{showPrevious ? "▾" : "▸"}</span> Previous ({previous.length})
                        </button>
                        {showPrevious ? list(previous) : null}
                      </>
                    ) : null}
                  </>
                );
              })()
            : null}
        </section>

        <form
          className="boxel-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            load();
          }}
        >
          <label>
            <span className="dim">Any system in the boxel</span>
            <input
              className="carriers-search__input"
              value={name}
              placeholder="Eol Prou AB-C d1-23"
              onChange={(ev) => setName(ev.target.value)}
            />
          </label>
          <label>
            <span className="dim">Last system number, if known</span>
            <input
              className="carriers-search__input boxel-end"
              inputMode="numeric"
              value={end}
              placeholder="auto"
              onChange={(ev) => setEnd(ev.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button type="submit" className="fdb-chip fdb-chip--on" disabled={busy || !name.trim()}>
            {busy ? "…" : "Show"}
          </button>
        </form>

        {error ? <p className="fdb-empty">{error}</p> : null}

        {data ? (
          <>
            <div className="fdb-summary">
              <span>
                <strong>{data.boxel}</strong> in {data.sector}
              </span>
              <span>
                <strong>{data.visitedCount}</strong> of {data.end + 1} flown
              </span>
              <span>
                <strong>{data.knownCount}</strong> with records
              </span>
              <span className="dim">
                mass code {data.massCode}: {data.cubeLy} ly cube, {data.massHint}
              </span>
            </div>
            {data.nextUnvisited ? (
              <div className="fdb-next">
                <span className="fdb-next__label">Next to fly</span>
                <strong className="fdb-next__sys">{data.nextUnvisited}</strong>
                <CopySystemButton system={data.nextUnvisited} />
              </div>
            ) : null}
            {data.common.length ? (
              <p className="boxel-common">
                <span className="dim">Recorded most in this boxel: </span>
                {data.common.map((c) => (
                  <span key={c.name} className="bm-tag">
                    {c.name} · {c.systems}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="fdb-filters">
              <button
                type="button"
                className={`fdb-chip${onlyKnown ? " fdb-chip--on" : ""}`}
                aria-pressed={onlyKnown}
                onClick={() => setOnlyKnown(!onlyKnown)}
              >
                Only flown or recorded
              </button>
            </div>
            {data.noIndex ? (
              <p className="dim tiny">No galaxy index on this machine: only your own journals were read.</p>
            ) : null}
            {savedHere && cutAsk != null
              ? (() => {
                  const n = cutAsk;
                  const after = savedHere.end - n;
                  const flownFrom =
                    data.rows.filter((r) => r.n >= n && r.visited).length + savedHere.flownBeyond.length;
                  return (
                    <div className="boxel-cut" role="alertdialog" aria-label="Delete from here">
                      <span>
                        Delete <strong>-{n}</strong>
                        {after > 0 ? ` and the ${after.toLocaleString()} after it` : ""} from this saved
                        boxel? It will end at -{n - 1}.
                        {flownFrom > 0 ? (
                          <>
                            {" "}
                            <strong className="warn">
                              {flownFrom} of the systems from -{n} on {flownFrom === 1 ? "is" : "are"} flown
                            </strong>{" "}
                            — the boxel goes on past it. To finish it without flying -{n}, skip it instead.
                          </>
                        ) : null}
                      </span>
                      <span className="boxel-cut__actions">
                        {flownFrom > 0 && !skipSet.has(n) ? (
                          <button
                            type="button"
                            className="fdb-chip fdb-chip--on"
                            onClick={() => skip(savedHere, n, true)}
                          >
                            Skip -{n} instead
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="fdb-chip boxel-saved__del"
                          onClick={() => cutFrom(savedHere, n)}
                        >
                          Delete from -{n}
                        </button>
                        <button type="button" className="fdb-chip" onClick={() => setCutAsk(null)}>
                          Keep
                        </button>
                      </span>
                    </div>
                  );
                })()
              : null}
            <div className="fdb-scroll">
              <table className="fdb-table">
                <thead>
                  <tr>
                    <th className="fdb-num">#</th>
                    <th>System</th>
                    <th>You</th>
                    <th className="fdb-num" title="Bodies you scanned there, of the count the FSS gave">
                      Bodies
                    </th>
                    <th className="fdb-num" title="Notable bodies there (as on the Notable card)">
                      Notable
                    </th>
                    <th title="EDSM and Spansh records in the galaxy index: species logged, biology signals, bodies catalogued">
                      Galaxy index
                    </th>
                    <th className="boxel-row__actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows
                    .filter((r) => !onlyKnown || r.visited || r.known)
                    .map((r) => (
                      <tr
                        key={r.n}
                        className={r.visited || skipSet.has(r.n) ? "boxel-row boxel-row--done" : "boxel-row"}
                      >
                        <td className="fdb-num dim">{r.n}</td>
                        <td className="fdb-sys">
                          {r.name}
                          <CopySystemButton system={r.name} />
                        </td>
                        <td>
                          {r.visited ? (
                            <span className="fdb-dss">flown</span>
                          ) : skipSet.has(r.n) ? (
                            <span className="boxel-skipped">skipped</span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="fdb-num">
                          {r.bodies ? (
                            <span
                              className={
                                r.bodies.total != null && r.bodies.scanned >= r.bodies.total
                                  ? "fdb-dss"
                                  : undefined
                              }
                            >
                              {r.bodies.scanned}
                              {r.bodies.total != null ? `/${r.bodies.total}` : ""}
                            </span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="fdb-num">
                          {r.notable ? (
                            <span className="boxel-saved__notable">{r.notable}</span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="boxel-known">
                          {r.known ? (
                            r.known.species.length ? (
                              r.known.species.join(", ")
                            ) : (
                              <span className="dim">
                                {[
                                  r.known.bodyCount ? `${r.known.bodyCount} bodies` : "",
                                  r.known.signals
                                    ? "biology signals, species not logged"
                                    : "no biology recorded",
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            )
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="boxel-row__actions">
                          <button
                            type="button"
                            className="fdb-chip boxel-lookup"
                            title="Look it up on Spansh and open it"
                            onClick={() => void lookUp(r.name)}
                          >
                            Look up
                          </button>
                          {savedHere && r.n <= savedHere.end && !r.visited ? (
                            <button
                              type="button"
                              className={`fdb-chip${skipSet.has(r.n) ? " fdb-chip--on" : ""}`}
                              aria-pressed={skipSet.has(r.n)}
                              title="Skipped: not flown, but it counts as done for this boxel"
                              onClick={() => skip(savedHere, r.n, !skipSet.has(r.n))}
                            >
                              {skipSet.has(r.n) ? "Unskip" : "Skip"}
                            </button>
                          ) : null}
                          {savedHere && r.n >= 1 && r.n <= savedHere.end ? (
                            <button
                              type="button"
                              className="fdb-chip boxel-saved__x"
                              aria-label={`Delete -${r.n} and every system after it`}
                              title="Delete this system and every one after it (a last number typed too high)"
                              onClick={() => setCutAsk(r.n)}
                            >
                              ×
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
