/**
 * The codex-consistency alerts hub in the app bar, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { AppSnapshot, ExoDataAlertDTO } from "@shared/types";
import { EXO_ALERT_DETECT_FEEDER_LS, EXO_ALERT_DETECT_JOURNAL_LS, EXO_DATA_ALERT_DISMISS_LS, applyExoDataScanSourceClear, collectExoDataAlertsFromSnapshot, readExoAlertAckIds, readExoAlertDismissals, writeExoAlertAckIds } from "./exoAlertsStore";
import { readLsBool, writeLsBool } from "./lsPrefs";

export function ExoDataAlertsHeaderHub({ snap }: { snap: AppSnapshot }) {
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [detectJournal, setDetectJournal] = useState(() => readLsBool(EXO_ALERT_DETECT_JOURNAL_LS, true));
  const [detectFeeder, setDetectFeeder] = useState(() => readLsBool(EXO_ALERT_DETECT_FEEDER_LS, true));
  const [dismissed, setDismissed] = useState(() => readExoAlertDismissals());
  const [ackEpoch, setAckEpoch] = useState(0);
  const [scanBusy, setScanBusy] = useState(false);

  const ackIds = useMemo(() => readExoAlertAckIds(), [ackEpoch]);

  const collected = useMemo(() => {
    if (snap.journalBoot) return [];
    return collectExoDataAlertsFromSnapshot(snap);
  }, [snap]);

  const filteredBySource = useMemo(
    () => collected.filter((a) => (a.detectionSource === "exomastery" ? detectFeeder : detectJournal)),
    [collected, detectJournal, detectFeeder],
  );

  const visible = useMemo(
    () => filteredBySource.filter((a) => !dismissed.has(a.id)),
    [filteredBySource, dismissed],
  );

  const hasUnread = useMemo(
    () => visible.length > 0 && visible.some((a) => !ackIds.has(a.id)),
    [visible, ackIds],
  );

  const topSeverity = useMemo(() => {
    if (visible.some((a) => a.severity === "error")) return "error";
    if (visible.some((a) => a.severity === "warning")) return "warning";
    return null;
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(EXO_DATA_ALERT_DISMISS_LS, JSON.stringify([...next]));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    if (snap.journalBoot) return;
    if (!detectJournal && !detectFeeder) return;
    setScanBusy(true);
    try {
      applyExoDataScanSourceClear(detectJournal, detectFeeder);
      setDismissed(readExoAlertDismissals());
      setAckEpoch((e) => e + 1);
      if (detectFeeder) {
        const r = await fetch("/api/exomastery/reload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanBusy(false);
    }
  }, [detectJournal, detectFeeder, snap.journalBoot, toast]);

  const fix = useCallback(
    async (a: ExoDataAlertDTO) => {
      const fallbackClipboard = async () => {
        const text = (a.fixClipboard ?? `${a.title}\n${a.detail}`).trim();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy fix hints (clipboard unavailable):", text);
        }
      };
      if (a.speciesEntryId && a.genusDataDir) {
        try {
          const r = await fetch("/api/exo-data-alerts/fix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alert: a }),
          });
          const j = (await r.json().catch(() => null)) as {
            ok?: boolean;
            written?: { root: string; relativePath: string }[];
            error?: string;
            notifyTarget?: "native" | "browser";
          } | null;
          if (!r.ok || !j?.ok) throw new Error(j?.error || r.statusText);
          if (j.notifyTarget === "native") return;
          const lines = (j.written ?? []).map((w) => `${w.relativePath}\n  (${w.root})`).join("\n\n");
          toast.success(
            lines
              ? `Fix stub written next to ${(j.written ?? []).length} source file(s); originals are untouched.`
              : "Fix stub written.",
          );
          return;
        } catch (e) {
          toast.error(
            e instanceof Error
              ? `${e.message}\n\nCopying hints to clipboard instead.`
              : "Fix failed; copying hints.",
          );
        }
      }
      await fallbackClipboard();
    },
    [toast],
  );

  const triggerClass = `exo-data-alerts-trigger btn-top-neutral${
    topSeverity === "error"
      ? " exo-data-alerts-trigger--error"
      : topSeverity === "warning"
        ? " exo-data-alerts-trigger--warn"
        : " exo-data-alerts-trigger--idle"
  }${hasUnread ? " exo-data-alerts-trigger--unread" : ""}`;

  let panelBody: ReactNode;
  if (snap.journalBoot) {
    panelBody = <p className="dim tiny">Journal loading…</p>;
  } else if (!detectJournal && !detectFeeder) {
    panelBody = (
      <p className="dim tiny">
        Turn on <strong>Journal</strong> and/or <strong>Exo-Feeder</strong> to scan for mismatches.
      </p>
    );
  } else if (visible.length > 0) {
    panelBody = (
      <div className="exo-data-alerts exo-data-alerts--in-popover" role="list">
        {visible.map((a) => (
          <div key={a.id} className={`exo-data-alert exo-data-alert--${a.severity}`} role="listitem">
            <span className={`exo-data-alert__icon exo-data-alert__icon--${a.severity}`} aria-hidden>
              {a.severity === "error" ? "!" : "⚠"}
            </span>
            <div className="exo-data-alert__text">
              <div className="exo-data-alert__meta">{a.bodyTabLabel}</div>
              <div className="exo-data-alert__title">{a.title}</div>
              <div className="exo-data-alert__detail">{a.detail}</div>
            </div>
            <div className="exo-data-alert__actions">
              <button
                type="button"
                className="exo-data-alert__btn"
                title="Append a fixes_*.json stub next to the codex or exomastery file (never overwrites the original)."
                onClick={() => void fix(a)}
              >
                Fix
              </button>
              <button
                type="button"
                className="exo-data-alert__btn exo-data-alert__btn--secondary"
                onClick={() => dismiss(a.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (filteredBySource.length > 0) {
    panelBody = <p className="dim tiny">All alerts dismissed.</p>;
  } else if (collected.length > 0) {
    panelBody = (
      <p className="dim tiny">
        No alerts for enabled sources — turn on Journal or Exo-Feeder to see hidden items.
      </p>
    );
  } else {
    panelBody = <p className="dim tiny">No mismatches detected for loaded bodies.</p>;
  }

  return (
    <div className="exo-data-alerts-header-wrap" ref={wrapRef}>
      <button
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Codex consistency alerts: journal and exo-feeder checks"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              const merged = new Set(readExoAlertAckIds());
              for (const a of visible) merged.add(a.id);
              writeExoAlertAckIds(merged);
              setAckEpoch((e) => e + 1);
            }
            return next;
          });
        }}
        title="Codex consistency: journal vs genus_new.json, and exo-feeder profiles vs codex (toggle sources inside)."
      >
        <svg
          className="exo-data-alerts-trigger__mail"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        {topSeverity === "error" ? (
          <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--error" aria-hidden>
            !
          </span>
        ) : topSeverity === "warning" ? (
          <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--warn" aria-hidden>
            ⚠
          </span>
        ) : null}
        {visible.length > 0 ? <span className="exo-data-alerts-trigger__badge">{visible.length}</span> : null}
      </button>
      {open ? (
        <div className="exo-data-alerts-popover" role="dialog" aria-label="Codex consistency alerts">
          <div className="exo-data-alerts-popover__detect">
            <span className="exo-data-alerts-popover__detect-label">Detect from:</span>
            <button
              type="button"
              className={`btn-top-toggle exo-data-alerts-source-toggle${detectJournal ? " btn-top-toggle--on" : ""}`}
              aria-pressed={detectJournal}
              onClick={() => {
                const v = !detectJournal;
                setDetectJournal(v);
                writeLsBool(EXO_ALERT_DETECT_JOURNAL_LS, v);
              }}
            >
              Journal
            </button>
            <button
              type="button"
              className={`btn-top-toggle exo-data-alerts-source-toggle${detectFeeder ? " btn-top-toggle--on" : ""}`}
              aria-pressed={detectFeeder}
              onClick={() => {
                const v = !detectFeeder;
                setDetectFeeder(v);
                writeLsBool(EXO_ALERT_DETECT_FEEDER_LS, v);
              }}
            >
              Exo-Feeder
            </button>
            <button
              type="button"
              className="exo-data-alerts-scan-btn"
              disabled={scanBusy || (!detectJournal && !detectFeeder) || snap.journalBoot != null}
              title={
                "Re-check: clears dismissals for the selected sources so those alerts show again. " +
                "With Exo-Feeder on, reloads species/exomastery data from disk after journal-side refresh (journal first, then feeder reload)."
              }
              onClick={() => void runScan()}
            >
              {scanBusy ? "…" : "Scan"}
            </button>
          </div>
          {panelBody}
        </div>
      ) : null}
    </div>
  );
}
