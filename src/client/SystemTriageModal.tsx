/**
 * The system, triaged — "go to body 3, skip the rest".
 *
 * B1, and the destination of every accuracy item in the queue. The candidate list answers "what
 * might be on this body"; nobody wants that. They want to know which body to fly to, and that needs
 * one number per body that can be trusted — which arrived with the calibrated presence probability
 * (§32.3) and not before.
 *
 * Everything here is arithmetic over data already on the snapshot, so the screen adds no new model:
 * expected value is Σ P(present) × price × first-footfall multiplier, and the minutes are the two
 * legs the journal could actually measure.
 */
import { useEffect, useMemo, useState } from "react";
import { useModal } from "./ui/useModal";
import type { BodyComputed } from "@shared/types";
import {
  triageSystem,
  LANDING_MINUTES,
  SAMPLING_MINUTES_PER_GENUS,
  type TriageBodyInput,
  type TriageSort,
} from "@shared/systemTriage";

function creditsShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} K`;
  return String(Math.round(n));
}

function distanceShort(ls: number | null): string {
  if (ls == null || !Number.isFinite(ls)) return "—";
  if (ls >= 100_000) return `${Math.round(ls / 1000)}k Ls`;
  if (ls >= 10_000) return `${(ls / 1000).toFixed(1)}k Ls`;
  return `${Math.round(ls)} Ls`;
}

/** Snapshot bodies → the shape the triage maths takes. Shown candidates only, as the panel shows. */
export function triageInputsFromBodies(bodies: BodyComputed[]): TriageBodyInput[] {
  return bodies
    .filter((b) => (b.state.biologicalSignals ?? 0) > 0 || b.matches.length > 0)
    .map((b) => {
      const shown = b.matches.filter((m) => !m.unlikely);
      return {
        bodyKey: b.state.key,
        bodyName: b.tabLabel || b.state.bodyName || b.state.key,
        signalCount: b.state.biologicalSignals ?? null,
        distanceLs: b.mergedScan?.distanceFromArrivalLs ?? null,
        multiplier: (b.exoPayoutRange?.mult ?? 1) as 1 | 5,
        certain: b.genusCertainty?.status === "certain",
        candidates: shown.map((m) => ({
          speciesId: m.entry.id,
          displayName: m.entry.displayName,
          probability:
            typeof m.presenceProbabilityPercent === "number" && Number.isFinite(m.presenceProbabilityPercent)
              ? m.presenceProbabilityPercent / 100
              : null,
          priceCredits: m.priceCredits ?? null,
        })),
      };
    });
}

export function SystemTriageModal({
  bodies,
  systemName,
  onClose,
  onSelectBody,
}: {
  bodies: BodyComputed[];
  systemName: string | null;
  onClose: () => void;
  onSelectBody?: (bodyKey: string) => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [sort, setSort] = useState<TriageSort>("value");
  const rows = useMemo(() => triageSystem(triageInputsFromBodies(bodies), sort), [bodies, sort]);
  const total = rows.reduce((s, r) => s + r.expectedCredits, 0);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel system-triage-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-triage-title"
      >
        <div className="modal-head">
          <h3 id="system-triage-title">Worth the trip?</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="dim tiny system-triage-intro">
          {systemName ?? "This system"} — {rows.length} {rows.length === 1 ? "body" : "bodies"},{" "}
          {creditsShort(total)} CR expected in total if you sampled every one of them.
        </p>

        <div className="system-triage-sorts">
          {(
            [
              ["value", "Most credits"],
              ["perMinute", "Credits per minute"],
              ["distance", "Nearest first"],
            ] as [TriageSort, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`system-triage-sort${sort === key ? " on" : ""}`}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="dim">No body in this system carries a biological signal.</p>
        ) : (
          <table className="system-triage-table">
            <thead>
              <tr>
                <th>Body</th>
                <th className="num">Signals</th>
                <th className="num">Expected</th>
                <th className="num">Distance</th>
                <th className="num">On site</th>
                <th>Likeliest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.bodyKey}
                  className={onSelectBody ? "system-triage-row--clickable" : undefined}
                  onClick={onSelectBody ? () => onSelectBody(r.bodyKey) : undefined}
                >
                  <td>
                    {r.bodyName}
                    {r.certain ? <span className="system-triage-tag">certain</span> : null}
                    {r.multiplier === 5 ? <span className="system-triage-tag">first footfall</span> : null}
                  </td>
                  <td className="num">{r.signalCount ?? "—"}</td>
                  <td className="num">
                    {creditsShort(r.expectedCredits)}
                    {r.coverage < 1 ? (
                      <span
                        className="dim tiny"
                        title="Share of the candidates the ranking model could score"
                      >
                        {" "}
                        ({Math.round(r.coverage * 100)}%)
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{distanceShort(r.distanceLs)}</td>
                  <td className="num">{r.onSiteMinutes.toFixed(1)} min</td>
                  <td>
                    {r.best ? (
                      <>
                        {r.best.displayName}
                        {r.best.probability != null ? (
                          <span className="dim"> {Math.round(r.best.probability * 100)}%</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="dim tiny system-triage-note">
          Expected value sums each candidate&apos;s calibrated chance of being present times its list price,
          with the first-footfall multiplier where it applies. On-site minutes are measured from this
          commander&apos;s journals: {LANDING_MINUTES} minutes to land and {SAMPLING_MINUTES_PER_GENUS} per
          genus sampled. Supercruise is not included — timing it against distance in the journals measures the
          time spent honking and deciding as much as flying, so distance is shown raw instead of converted
          into minutes it cannot support.
        </p>
      </div>
    </div>
  );
}
