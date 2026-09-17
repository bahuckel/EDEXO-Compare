import { fmtCrShort } from "./credits";
/**
 * My exobiology, data value breakdown and feeder modals, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import { InfoPopover } from "./ui/Tooltip";
import { fuzzyRankAny } from "./fuzzyMatch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FootScannedEntry, OrganicPendingLineItem, FeederStatusDTO, SessionLogDTO } from "@shared/types";
import { FeederStatusPanel } from "./FeederStatusPanel";
import type { SpanshRouteSummaryDTO } from "./bodyHelpers";

/**
 * Feed a Spansh exobiology route export.
 *
 * These are the corpus's most trustworthy input: every row is a species somebody actually found on a
 * named body, not a genus signal and not a prediction. So the button exists even though the app
 * cannot finish the job itself.
 *
 * **It queues rather than imports.** Writing to the corpus needs `sql.js`, which is a devDependency
 * and is in no packaged build, so the file is parsed here — enough to say exactly what is in it — and
 * written to the corpus inbox for `npm run feeder -- import` to drain. Saying so is better than a
 * button that appears to work and changes nothing.
 *
 * The JSON export is worth preferring and the summary says why: it carries system coordinates and
 * body ids that the CSV has no column for, and every body it identifies is one that needs no EDSM
 * lookup later.
 */
function FeederRouteImport() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SpanshRouteSummaryDTO | null>(null);
  const [queuedAs, setQueuedAs] = useState<string | null>(null);

  const send = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const text = await file.text();
        const r = await fetch("/api/feeder/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, filename: file.name }),
        });
        const j = (await r.json().catch(() => null)) as
          | { error?: string; queuedAs?: string; summary?: SpanshRouteSummaryDTO }
          | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
        setSummary(j?.summary ?? null);
        setQueuedAs(j?.queuedAs ?? null);
        toast.success(`Queued ${file.name}`);
      } catch (e) {
        setSummary(null);
        setQueuedAs(null);
        toast.error(e instanceof Error ? e.message : "Could not read that file.");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [toast],
  );

  return (
    <section className="options-block">
      <h4 className="options-block-title">Feed a Spansh route export</h4>
      <p className="options-journal-line dim">
        A confirmed find on a named body is the best data the corpus takes. Prefer the{" "}
        <strong>JSON</strong> export: it carries system coordinates and body ids that the CSV does not.
      </p>
      <div className="options-row">
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          disabled={busy}
          aria-label="Spansh route export"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
          }}
        />
      </div>
      {summary ? (
        <div className="feeder-route-summary">
          <p className="options-journal-line">
            <strong>{summary.format.toUpperCase()}</strong> · {summary.rows} rows · {summary.bodies} bodies
            · {summary.systems} systems · {summary.species} species in {summary.genera} genera
            {summary.source && summary.destination ? (
              <span className="dim">
                {" "}
                · {summary.source} to {summary.destination}
              </span>
            ) : null}
          </p>
          <p className="options-journal-line dim">
            {summary.systemsWithCoords} system(s) placed · {summary.bodiesWithId} body id(s) — these need
            no EDSM lookup.
          </p>
          {summary.topSpecies.length > 0 ? (
            <p className="options-journal-line dim">
              Most rows: {summary.topSpecies.map((t) => `${t.label} (${t.rows})`).join(", ")}
            </p>
          ) : null}
          {summary.warnings.map((w) => (
            <p key={w} className="options-journal-line dim">
              Note: {w}
            </p>
          ))}
          {queuedAs ? (
            <p className="options-journal-line dim">
              Queued at <code>{queuedAs}</code>. Run <code>npm run feeder -- import</code> to ingest it —
              the app cannot write to the corpus itself.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function FeederModal({
  status,
  onRefresh,
  onClose,
}: {
  status: FeederStatusDTO | null;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // The status is read once at app start, so anything the feeder CLI did since then is invisible
  // until asked for again. Opening this panel is exactly when the answer needs to be current.
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feeder-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="feeder-modal-title">Data feeder</h3>
          <button type="button" className="feeder-refresh" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <FeederStatusPanel status={status} />
          <FeederRouteImport />
        </div>
      </div>
    </div>
  );
}

/**
 * Everything the commander has actually confirmed on foot.
 *
 * **The search (A1).** This opened with a line explaining where the records come from — a mechanism
 * described to somebody who has already opened the panel and therefore already trusts it. The owner
 * has 373 entries in here and wanted the one thing he comes for: find the body, the system, or every
 * time he has seen a genus. So the line is behind the ⓘ and its space is the search.
 *
 * Filtering, not re-ranking. {@link fuzzyRankAny} returns a rank and it is tempting to sort by it,
 * but the list's spine is time — newest first — and a query that reshuffles the order costs more
 * than a slightly better first row wins. A match is kept where it was.
 */
export function MyExobiologyModal({
  entries,
  onClose,
  onNavigateEntry,
}: {
  entries: FootScannedEntry[];
  onClose: () => void;
  onNavigateEntry?: (e: FootScannedEntry) => void;
}) {
  /*
    `useModal` focuses the first focusable in the dialog, which is the close button — right for
    every other dialog in the app, wrong for one whose whole purpose is now a search box. So it
    hands over initial focus and the input claims it. The focus trap and focus restore are
    untouched; a plain `autoFocus` attribute would not work here, because the hook's effect runs
    after React applies it and would take the focus straight back.
  */
  const dialogRef = useModal<HTMLDivElement>(true, onClose, { autoFocus: false });
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    (searchRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
  }, [dialogRef]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        fuzzyRankAny(
          [e.starSystem, e.bodyName, e.genusLocalised, e.speciesLocalised, e.variantLocalised],
          q,
        ) != null,
    );
  }, [entries, query]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel modal-panel--my-exo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-exo-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="my-exo-title">My exobiology</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--my-exo">
          <div className="my-exo-search">
            <input
              ref={searchRef}
              type="search"
              className="my-exo-search-input"
              value={query}
              placeholder="Search system, planet, genus or species…"
              aria-label="Search your foot scans"
              onChange={(ev) => setQuery(ev.target.value)}
            />
            <span className="my-exo-search-count dim tiny">
              {query.trim() ? `${shown.length} of ${entries.length}` : `${entries.length}`}
            </span>
            <InfoPopover title="My exobiology" label="Where these records come from">
              <p>
                From your merged journals: a <code>ScanOrganic</code> Sample or Analyse, paired with the
                detailed <code>Scan</code> of the body it happened on.
              </p>
              <p>
                Stored in <code>data/foot_scanned.json</code>, on this machine.
              </p>
            </InfoPopover>
          </div>
          {entries.length === 0 ? (
            <p className="dim">No foot-catalog entries yet.</p>
          ) : shown.length === 0 ? (
            <p className="dim">Nothing here matches “{query.trim()}”.</p>
          ) : (
            <ul className="my-exo-card-list">
              {shown.map((e) => (
                <li key={e.id} className="my-exo-card">
                  <div className="my-exo-card-top">
                    <div className="my-exo-card-loc">
                      {onNavigateEntry ? (
                        <button
                          type="button"
                          className="my-exo-nav-icon"
                          title="Show this system in the app (journal view)"
                          aria-label={`Focus journal view: ${e.starSystem ?? "system"} — ${e.bodyName}`}
                          onClick={() => {
                            onNavigateEntry(e);
                            onClose();
                          }}
                        >
                          <svg
                            className="my-exo-nav-icon-svg"
                            viewBox="0 0 16 16"
                            width="15"
                            height="15"
                            aria-hidden
                          >
                            <circle
                              cx="8"
                              cy="8"
                              r="6.25"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.35"
                            />
                            <path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1.15" />
                            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                          </svg>
                        </button>
                      ) : null}
                      <span className="my-exo-body">{e.bodyName}</span>
                    </div>
                    <time className="my-exo-card-time tab" dateTime={e.recordedAt}>
                      {e.recordedAt.slice(0, 19).replace("T", " ")}
                    </time>
                  </div>
                  <div
                    className={`my-exo-card-sub dim tiny${onNavigateEntry ? " my-exo-card-sub--indented" : ""}`}
                  >
                    {e.starSystem || "—"}
                  </div>
                  <dl className="my-exo-card-facts">
                    <div className="my-exo-card-fact">
                      <dt>Species</dt>
                      <dd>
                        {e.variantLocalised ||
                          [e.genusLocalised, e.speciesLocalised].filter(Boolean).join(" ") ||
                          "—"}
                        {e.dbProbableDisagreed ? (
                          <span className="dim tiny tab" title="Top strict DB guess at record time differed">
                            {" "}
                            (DB note)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>From</dt>
                      <dd>{e.confirmationSource === "sample" ? "Sample" : "Analyse"}</dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>Planet</dt>
                      <dd>{e.planetClass}</dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>Atmosphere</dt>
                      <dd>{e.atmosphereNorm || "—"}</dd>
                    </div>
                    <div className="my-exo-card-fact my-exo-card-fact--wide">
                      <dt>Temperature (K)</dt>
                      <dd className="tab">
                        {e.tempBandMinK.toFixed(0)} · {e.tempBandMaxK.toFixed(0)}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function DataValueBreakdownModal({
  lines,
  includeExplorationScanDataInDataValue,
  explorationFssScanCount,
  explorationFssValueCredits,
  explorationDssScanCount,
  explorationDssValueCredits,
  exobioScanCount,
  exobioValueCredits,
  onClose,
}: {
  lines: OrganicPendingLineItem[];
  includeExplorationScanDataInDataValue: boolean;
  explorationFssScanCount: number;
  explorationFssValueCredits: number;
  explorationDssScanCount: number;
  explorationDssValueCredits: number;
  /** Completed samples waiting to sell, and their value — the header pill's own two numbers. */
  exobioScanCount: number;
  exobioValueCredits: number;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel modal-panel--data-value"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Unsold data value</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--data-value">
          {/*
            The three things worth selling, on three lines, before the per-sample list.

            Exploration is counted in the header total only while the ⊕ toggle is on, so the two
            exploration rows say when they are not — the alternative is three rows that look like
            they add up to the pill and do not.
          */}
          <ul className="data-value-summary">
            <li
              className="data-value-summary-row"
              title="Journal event: FSSBodySignals — FSS-only estimate where a merged Scan exists"
            >
              <span className="data-value-summary-count">{explorationFssScanCount}</span>
              <span className="data-value-summary-label">
                FSS scans
                {!includeExplorationScanDataInDataValue ? (
                  <span className="dim tiny"> · not in total</span>
                ) : null}
              </span>
              <span className="data-value-summary-value">
                {explorationFssValueCredits.toLocaleString()} CR
              </span>
            </li>
            <li
              className="data-value-summary-row"
              title="Journal event: SAAScanComplete — full mapped estimate"
            >
              <span className="data-value-summary-count">{explorationDssScanCount}</span>
              <span className="data-value-summary-label">
                DSS scans
                {!includeExplorationScanDataInDataValue ? (
                  <span className="dim tiny"> · not in total</span>
                ) : null}
              </span>
              <span className="data-value-summary-value">
                {explorationDssValueCredits.toLocaleString()} CR
              </span>
            </li>
            <li
              className="data-value-summary-row"
              title="Completed samples (3x Analyse) not yet sold; first footfall pays 5x"
            >
              <span className="data-value-summary-count">{exobioScanCount}</span>
              <span className="data-value-summary-label">Exobio scans</span>
              <span className="data-value-summary-value">
                {exobioValueCredits.toLocaleString()} CR
              </span>
            </li>
          </ul>
          {lines.length === 0 ? (
            <p className="dim">
              {includeExplorationScanDataInDataValue
                ? "No completed exobiology samples waiting to sell in the merged journal replay."
                : "No completed samples waiting to sell in the merged journal replay."}
            </p>
          ) : (
            <ul className="data-value-breakdown-list">
              {lines.map((line, i) => (
                <li key={`${line.bodyKey}-${i}`} className="data-value-breakdown-row">
                  <img src={line.photoUrl} alt="" className="data-value-breakdown-thumb" />
                  <div className="data-value-breakdown-main">
                    <div className="data-value-breakdown-planet">
                      <strong>{line.bodyName}</strong>
                      <span className="dim"> · {line.starSystem}</span>
                    </div>
                    <div className="data-value-breakdown-species">{line.speciesLabel}</div>
                    <div className="data-value-breakdown-value-row">
                      {line.baseCredits != null ? (
                        <>
                          <span className="data-value-breakdown-credits">
                            {line.valueCredits.toLocaleString()} CR
                          </span>
                          {line.firstFootfall ? (
                            <span
                              className="data-value-footfall-badge"
                              title="First footfall: 1× list payout plus 4× bonus in-game (5× total)"
                            >
                              First footfall 5× total
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="dim">No price in price list — not counted in total</span>
                      )}
                    </div>
                    {line.baseCredits != null && line.firstFootfall ? (
                      <div className="data-value-footfall-detail dim">
                        {line.baseCredits.toLocaleString()} CR base +{" "}
                        {(line.baseCredits * 4).toLocaleString()} CR first-footfall bonus ={" "}
                        {line.valueCredits.toLocaleString()} CR
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the session log (NEXT-TASKS 11) */
function sessionLogMarkdown(log: SessionLogDTO): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 16) + " UTC";
  };
  const cr = (n: number | null) => (n == null ? "—" : `${n.toLocaleString()} CR`);
  const lines: string[] = [];
  lines.push(`# ED Exo Compare — session ${log.startedIso.slice(0, 10)}`);
  lines.push("");
  lines.push(
    `Systems ${log.systems.length} · landings ${log.landings.length} · first footfalls ${log.firstFootfalls} · species analysed ${log.samples.length} · analysed value ${cr(log.creditsAnalysed)} · sold ${cr(log.creditsSold)}`,
  );
  if (log.systems.length) {
    lines.push("", "## Systems", "");
    for (const s of log.systems) lines.push(`- ${t(s.at)} ${s.name}${s.jumpLy != null ? ` (${s.jumpLy.toFixed(1)} ly)` : ""}`);
  }
  if (log.landings.length) {
    lines.push("", "## Landings", "");
    for (const l of log.landings) lines.push(`- ${t(l.at)} ${l.body}${l.firstFootfall ? " — **first footfall**" : ""}`);
  }
  if (log.samples.length) {
    lines.push("", "## Species analysed", "");
    lines.push("| time | species | body | value |", "|---|---|---|---|");
    for (const s of log.samples) {
      lines.push(`| ${t(s.at)} | ${s.species} | ${s.body} | ${cr(s.credits)}${s.mult === 5 ? " (×5)" : ""} |`);
    }
  }
  if (log.sales.length) {
    lines.push("", "## Sales", "");
    for (const s of log.sales) lines.push(`- ${t(s.at)} ${s.items} item(s) — ${cr(s.credits)}`);
  }
  return lines.join("\n") + "\n";
}

export function SessionLogModal({ log, onClose }: { log: SessionLogDTO | null; onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const fmtT = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  const copy = async () => {
    if (!log) return;
    try {
      await navigator.clipboard.writeText(sessionLogMarkdown(log));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard blocked — select the text and copy it instead.");
    }
  };
  const empty = !log || (log.systems.length === 0 && log.landings.length === 0 && log.samples.length === 0 && log.sales.length === 0);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel modal-panel--session"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-log-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="session-log-title">Session log</h3>
          <button type="button" className="btn-top-neutral session-copy" onClick={() => void copy()} disabled={empty}>
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--session">
          {!log ? (
            <p className="dim">The log starts with the first live journal line after the app boots.</p>
          ) : (
            <>
              <div className="facts facts--session">
                <div className="fact"><span className="fact-k">Since</span><span className="fact-v">{fmtT(log.startedIso)}</span></div>
                <div className="fact"><span className="fact-k">Systems</span><span className="fact-v">{log.systems.length}</span></div>
                <div className="fact"><span className="fact-k">Landings</span><span className="fact-v">{log.landings.length}</span></div>
                <div className="fact fact--tone-open"><span className="fact-k">First footfalls</span><span className="fact-v">{log.firstFootfalls}</span></div>
                <div className="fact"><span className="fact-k">Species analysed</span><span className="fact-v">{log.samples.length}</span></div>
                <div className="fact"><span className="fact-k">Analysed value</span><span className="fact-v">{fmtCrShort(log.creditsAnalysed)} CR</span></div>
                <div className="fact"><span className="fact-k">Sold</span><span className="fact-v">{fmtCrShort(log.creditsSold)} CR</span></div>
              </div>
              {empty ? <p className="dim" style={{ marginTop: "0.8rem" }}>Nothing yet tonight — jump, land or scan and it lands here.</p> : null}
              {log.samples.length ? (
                <section className="session-block">
                  <h4 className="session-h">Species analysed</h4>
                  <ul className="session-list">
                    {log.samples.map((s, i) => (
                      <li key={`s-${i}`} className="session-row">
                        <span className="session-t">{fmtT(s.at)}</span>
                        <span className="session-main">
                          <strong>{s.species}</strong>
                          <span className="dim"> · {s.body || s.system}</span>
                        </span>
                        <span className={`session-cr${s.mult === 5 ? " session-cr--ff" : ""}`}>
                          {s.credits != null ? `${fmtCrShort(s.credits)} CR` : "—"}
                          {s.mult === 5 ? <span className="price-tag price-tag--unwalked">×5</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {log.landings.length ? (
                <section className="session-block">
                  <h4 className="session-h">Landings</h4>
                  <ul className="session-list">
                    {log.landings.map((l, i) => (
                      <li key={`l-${i}`} className="session-row">
                        <span className="session-t">{fmtT(l.at)}</span>
                        <span className="session-main">{l.body}</span>
                        {l.firstFootfall ? <span className="price-tag price-tag--unwalked">first footfall</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {log.systems.length ? (
                <section className="session-block">
                  <h4 className="session-h">Systems</h4>
                  <ul className="session-list">
                    {log.systems.map((s, i) => (
                      <li key={`y-${i}`} className="session-row">
                        <span className="session-t">{fmtT(s.at)}</span>
                        <span className="session-main">{s.name}</span>
                        <span className="dim tiny">{s.jumpLy != null ? `${s.jumpLy.toFixed(1)} ly` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {log.sales.length ? (
                <section className="session-block">
                  <h4 className="session-h">Sales</h4>
                  <ul className="session-list">
                    {log.sales.map((s, i) => (
                      <li key={`x-${i}`} className="session-row">
                        <span className="session-t">{fmtT(s.at)}</span>
                        <span className="session-main">{s.items} item{s.items === 1 ? "" : "s"}</span>
                        <span className="session-cr">{fmtCrShort(s.credits)} CR</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
