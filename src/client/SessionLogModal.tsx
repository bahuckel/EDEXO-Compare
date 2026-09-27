/**
 * The session log and its Markdown copy. Split out of AppModals.tsx (code review D, 2026-09-27).
 */
import { CopySystemButton } from "./CopySystemButton";
import { fmtCrShort } from "./credits";
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import type { SessionLogDTO } from "@shared/types";
import { useState } from "react";

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
    for (const s of log.systems)
      lines.push(`- ${t(s.at)} ${s.name}${s.jumpLy != null ? ` (${s.jumpLy.toFixed(1)} ly)` : ""}`);
  }
  if (log.landings.length) {
    lines.push("", "## Landings", "");
    for (const l of log.landings)
      lines.push(`- ${t(l.at)} ${l.body}${l.firstFootfall ? " — **first footfall**" : ""}`);
  }
  if (log.samples.length) {
    lines.push("", "## Species analysed", "");
    lines.push("| time | species | body | value |", "|---|---|---|---|");
    for (const s of log.samples) {
      lines.push(
        `| ${t(s.at)} | ${s.species} | ${s.body} | ${cr(s.credits)}${s.mult === 5 ? " (×5)" : ""} |`,
      );
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
  const empty =
    !log ||
    (log.systems.length === 0 &&
      log.landings.length === 0 &&
      log.samples.length === 0 &&
      log.sales.length === 0);
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
          <button
            type="button"
            className="btn-top-neutral session-copy"
            onClick={() => void copy()}
            disabled={empty}
          >
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
                <div className="fact">
                  <span className="fact-k">Since</span>
                  <span className="fact-v">{fmtT(log.startedIso)}</span>
                </div>
                <div className="fact">
                  <span className="fact-k">Systems</span>
                  <span className="fact-v">{log.systems.length}</span>
                </div>
                <div className="fact">
                  <span className="fact-k">Landings</span>
                  <span className="fact-v">{log.landings.length}</span>
                </div>
                <div className="fact fact--tone-open">
                  <span className="fact-k">First footfalls</span>
                  <span className="fact-v">{log.firstFootfalls}</span>
                </div>
                <div className="fact">
                  <span className="fact-k">Species analysed</span>
                  <span className="fact-v">{log.samples.length}</span>
                </div>
                <div className="fact">
                  <span className="fact-k">Analysed value</span>
                  <span className="fact-v">{fmtCrShort(log.creditsAnalysed)} CR</span>
                </div>
                <div className="fact">
                  <span className="fact-k">Sold</span>
                  <span className="fact-v">{fmtCrShort(log.creditsSold)} CR</span>
                </div>
              </div>
              {empty ? (
                <p className="dim" style={{ marginTop: "0.8rem" }}>
                  Nothing yet tonight — jump, land or scan and it lands here.
                </p>
              ) : null}
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
                          <CopySystemButton system={s.system} />
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
                        <span className="session-main">
                          {l.body}
                          <CopySystemButton system={l.system} />
                        </span>
                        {l.firstFootfall ? (
                          <span className="price-tag price-tag--unwalked">first footfall</span>
                        ) : null}
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
                        <span className="session-main">
                          {s.name}
                          <CopySystemButton system={s.name} />
                        </span>
                        <span className="dim tiny">
                          {s.jumpLy != null ? `${s.jumpLy.toFixed(1)} ly` : ""}
                        </span>
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
                        <span className="session-main">
                          {s.items} item{s.items === 1 ? "" : "s"}
                        </span>
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
