/**
 * The feeder corpus dialog and its route-file import. Split out of AppModals.tsx (code review D, 2026-09-27).
 */
import { FeederStatusPanel } from "./FeederStatusPanel";
import type { SpanshRouteSummaryDTO } from "./bodyHelpers";
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import type { FeederStatusDTO } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

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
        const j = (await r.json().catch(() => null)) as {
          error?: string;
          queuedAs?: string;
          summary?: SpanshRouteSummaryDTO;
        } | null;
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
        A confirmed find on a named body is the best data the corpus takes. Prefer the <strong>JSON</strong>{" "}
        export: it carries system coordinates and body ids that the CSV does not.
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
            <strong>{summary.format.toUpperCase()}</strong> · {summary.rows} rows · {summary.bodies} bodies ·{" "}
            {summary.systems} systems · {summary.species} species in {summary.genera} genera
            {summary.source && summary.destination ? (
              <span className="dim">
                {" "}
                · {summary.source} to {summary.destination}
              </span>
            ) : null}
          </p>
          <p className="options-journal-line dim">
            {summary.systemsWithCoords} system(s) placed · {summary.bodiesWithId} body id(s) — these need no
            EDSM lookup.
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
              Queued at <code>{queuedAs}</code>. Run <code>npm run feeder -- import</code> to ingest it — the
              app cannot write to the corpus itself.
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
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  // The status is read once at app start, so anything the feeder CLI did since then is invisible
  // until asked for again. Opening this panel is exactly when the answer needs to be current.
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

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
