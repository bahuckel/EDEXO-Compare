/**
 * The prediction-miss log panel (shown in Options). Split out of SpeciesCard.tsx (code review D, 2026-09-27).
 */
import { InfoPopover } from "./ui/Tooltip";
import { useToast } from "./ui/feedback";
import type { AppSnapshot } from "@shared/types";
import { useState } from "react";

/**
 * The miss log, in the Options panel (B6).
 *
 * The accuracy probe can only re-measure the bodies already in the journal, and it will only ever
 * describe the past. This grows every time the app is wrong about a body the commander actually
 * landed on, wherever they are flying — the one feedback channel that does not go stale as the
 * harness is tuned against.
 *
 * A count rather than a list: the records carry body parameters and the whole candidate list, which
 * belongs in a file to diff, not in a modal. Silent at zero, because "no misses recorded" on a fresh
 * install reads as a claim about accuracy that nothing has earned.
 *
 * **Shape (A5).** This was a five-line paragraph for a number and a filename. The number is the
 * thing being reported and the file is the thing to do about it, so it is now a number, a button,
 * and an ⓘ holding the explanation — which is read once and then never again.
 */
export function ExoMissLogPanel({ outliers }: { outliers: AppSnapshot["exoOutliers"] }) {
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  if (!outliers || outliers.total <= 0) return null;
  const parts = [
    outliers.absent > 0 ? `${outliers.absent} not listed at all` : null,
    outliers.unlikelyOnly > 0 ? `${outliers.unlikelyOnly} only behind “show unlikely”` : null,
    outliers.rankedLow > 0 ? `${outliers.rankedLow} listed but ranked too low` : null,
    outliers.colour > 0 ? `${outliers.colour} in a colour the app did not predict` : null,
  ].filter(Boolean);

  return (
    <section className="options-meta-block options-oneline">
      <span className="options-oneline-label">Misses recorded</span>
      <strong className="options-oneline-value">{outliers.total}</strong>
      <button
        type="button"
        className="btn secondary tiny"
        disabled={opening}
        onClick={() => {
          setOpening(true);
          void fetch("/api/settings/open-miss-log", { method: "POST" })
            .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
            .then((r) => {
              if (!r.ok) toast.error(r.error ?? "Could not open the miss log.");
            })
            .catch(() => toast.error("Could not open the miss log."))
            .finally(() => setOpening(false));
        }}
      >
        Open JSON
      </button>
      <InfoPopover title="Misses recorded" label="What the miss log holds">
        <p>
          {outliers.total} {outliers.total === 1 ? "species" : "species"} you found where this app did not
          point at {outliers.total === 1 ? "it" : "them"}
          {parts.length ? `: ${parts.join(", ")}` : ""}.
        </p>
        <p>
          Each one is written to <code>edexo-outliers.jsonl</code> beside your settings, with the body&apos;s
          parameters and the candidate list at the time — evidence for the next gate fix.
        </p>
        <p>It never leaves this machine.</p>
      </InfoPopover>
    </section>
  );
}
