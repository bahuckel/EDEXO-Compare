/**
 * The body's at-a-glance line: genus tags and the landable badge. Split out of BodyPane.tsx (code review D, 2026-09-27).
 */
import { formatOrganicLockDisplay } from "./speciesMatchHelpers";
import {
  GENUS_PROGRESS_TITLE,
  GenusProgressRow,
  genusProgressTag,
  scannedGenusRowsByTime,
} from "@shared/genusProgress";
import type { PlanetScan } from "@shared/types";
import { useEffect, useState } from "react";

/** Habitat fit (cross-genus) + deck match + optional same-genus rank — equal-width columns for available metrics only. */
/**
 * The signal-count verdict.
 *
 * The game reports how many biological signals a body has before the commander goes anywhere, and it
 * places one genus per signal. When the candidate genera match that count, every one of them is
 * present — the answer is settled from orbit, which is the whole reason the app exists. When there
 * are fewer, one of our gates is wrong.
 */
/** Landable as one glance: a pad glyph and the word, in the cockpit's state colour. */
/**
 * `[CS]`, `[SEEN]`, `[2/3]` after a genus or a species (guild request, 2026-09-24). Nothing for a
 * genus the DSS named and nobody has scanned. See `shared/genusProgress.ts`.
 */
export function GenusTag({ row }: { row: Pick<GenusProgressRow, "status" | "samples"> }) {
  const tag = genusProgressTag(row);
  if (!tag) return null;
  return (
    <span className={`genus-tag genus-tag--${row.status}`} title={GENUS_PROGRESS_TITLE[row.status]}>
      {tag}
    </span>
  );
}

/** How many scanned genera the glance bar shows at once (owner, 2026-09-25). */
const GLANCE_GENUS_WINDOW = 3;

/**
 * The glance bar's genus chips: the last three things scanned here, newest on the right, with
 * arrows to step back through older ones (owner, 2026-09-25 — "max of 3, like the last 3 things you
 * scanned"). A new scan snaps back to the newest. Genera the DSS named and nothing has touched are
 * a count after the chips; the Exo-signals card lists them.
 */
export function GlanceGenera({ rows }: { rows: GenusProgressRow[] }) {
  const scanned = scannedGenusRowsByTime(rows);
  const untouched = rows.length - scanned.length;
  const [back, setBack] = useState(0);
  const newest = scanned.length
    ? `${scanned[scanned.length - 1]!.genus}|${genusProgressTag(scanned[scanned.length - 1]!)}`
    : "";
  useEffect(() => setBack(0), [newest]);

  const maxBack = Math.max(0, scanned.length - GLANCE_GENUS_WINDOW);
  const step = Math.min(back, maxBack);
  const end = scanned.length - step;
  const shown = scanned.slice(Math.max(0, end - GLANCE_GENUS_WINDOW), end);
  if (scanned.length === 0 && untouched === 0) return null;

  return (
    <span className="glance-item glance-genera" aria-label="Last genera scanned on this body">
      {scanned.length > GLANCE_GENUS_WINDOW ? (
        <button
          type="button"
          className="glance-genus-step"
          disabled={step >= maxBack}
          onClick={() => setBack((b) => Math.min(maxBack, b + 1))}
          title="Earlier scans"
          aria-label="Earlier scans"
        >
          ‹
        </button>
      ) : null}
      {shown.map((r) => (
        <span key={r.genus} className={`glance-genus glance-genus--${r.status}`}>
          {r.genus}
          <GenusTag row={r} />
        </span>
      ))}
      {scanned.length > GLANCE_GENUS_WINDOW ? (
        <button
          type="button"
          className="glance-genus-step"
          disabled={step <= 0}
          onClick={() => setBack((b) => Math.max(0, b - 1))}
          title="Later scans"
          aria-label="Later scans"
        >
          ›
        </button>
      ) : null}
      {untouched > 0 ? (
        <span className="glance-genus-left" title="Genera the DSS named that nothing has scanned yet">
          {scanned.length > 0 ? "+" : ""}
          {untouched} <small>to scan</small>
        </span>
      ) : null}
    </span>
  );
}

/** "Stratum Limaxus - Green" from a progress row, with the journal's repetitions folded away. */
export function genusRowSpecies(row: GenusProgressRow): string {
  if (!row.species && !row.variant) return "";
  return formatOrganicLockDisplay({
    genusLocalised: row.genus,
    genusSymbol: "",
    speciesLocalised: row.species ?? "",
    speciesSymbol: "",
    variantLocalised: row.variant ?? "",
  });
}

export function LandableBadge({ scan }: { scan: PlanetScan | null }) {
  const state = scan == null ? "unknown" : scan.Landable === true ? "yes" : "no";
  const word = state === "unknown" ? "Unscanned" : state === "yes" ? "Landable" : "Not landable";
  return (
    <span className={`land-badge land-badge--${state}`} title={scan == null ? "No detailed scan yet" : word}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        {state === "yes" ? (
          <path
            d="M8 2v7M4.6 6.4 8 9.8l3.4-3.4M2.5 13h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : state === "no" ? (
          <path
            d="M8 2v5M2.5 13h11M3.5 3.5l9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M5.5 5.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V10M8 12.5v.2M2.5 13h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {word}
    </span>
  );
}
