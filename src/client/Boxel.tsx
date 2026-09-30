/**
 * Boxel scanning (shared/boxel.ts; guild tester report, 2026-09-30): one boxel's systems -0 upwards,
 * which you have flown, which the galaxy index knows and what grows there, what the boxel tends to
 * grow, and the next one to fly. Any row looks the system up on Spansh and opens it, as the header's
 * search does.
 */
import { useCallback, useEffect, useState } from "react";
import type { BoxelDTO } from "@shared/boxel";
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

  const load = useCallback(() => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({ name: name.trim() });
    if (end.trim()) q.set("end", end.trim());
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
  }, [name, end]);

  // The current system's boxel opens straight away.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

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
            <div className="fdb-scroll">
              <table className="fdb-table">
                <thead>
                  <tr>
                    <th className="fdb-num">#</th>
                    <th>System</th>
                    <th>You</th>
                    <th title="EDSM and Spansh records in the galaxy index: species logged, biology signals, bodies catalogued">
                      Galaxy index
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows
                    .filter((r) => !onlyKnown || r.visited || r.known)
                    .map((r) => (
                      <tr key={r.n} className={r.visited ? "boxel-row boxel-row--done" : "boxel-row"}>
                        <td className="fdb-num dim">{r.n}</td>
                        <td className="fdb-sys">
                          {r.name}
                          <CopySystemButton system={r.name} />
                        </td>
                        <td>
                          {r.visited ? (
                            <span className="fdb-dss">flown</span>
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
                        <td>
                          <button type="button" className="fdb-chip" onClick={() => void lookUp(r.name)}>
                            Look up
                          </button>
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
