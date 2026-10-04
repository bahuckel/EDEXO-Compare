/**
 * Pieces of the species card: the foot-scan match card, the star-colour badge, the exomastery similarity content. Split out of SpeciesCard.tsx (code review D, 2026-09-27).
 */
import {
  FootScanHitBlock,
  ThinSampleNote,
  hostHitsMorphSpectralChip,
  morphSpectralChipHeatClass,
  sortMorphSpectralKeys,
} from "./SpeciesCardBits";
import { EXO_PRESENCE_HELP } from "./speciesMatchHelpers";
import { formatGenusStarColorSoftOneLine } from "@shared/genusStarColorSoft";
import type { BodyComputed, FootScanMatchPayload } from "@shared/types";
import { CSSProperties, useState } from "react";

export function FootScanMatchCard({ payload }: { payload: FootScanMatchPayload }) {
  const [expanded, setExpanded] = useState(false);
  const [primary, ...more] = payload.hits;
  if (!primary) return null;

  return (
    <div className="foot-scan-match-card">
      <h4 className="foot-scan-match-title">Foot scan match</h4>
      <FootScanHitBlock hit={primary} />
      {more.length > 0 ? (
        <div className="foot-scan-match-more-wrap">
          <button
            type="button"
            className="foot-scan-match-more-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span
              className={`foot-scan-match-chevron${expanded ? " foot-scan-match-chevron--open" : ""}`}
              aria-hidden
            >
              ^
            </span>
            <span>
              {more.length} other catalog bod{more.length === 1 ? "y" : "ies"} (same planet class, atmosphere;
              T/P within ±10%)
            </span>
          </button>
          {expanded ? (
            <div className="foot-scan-match-more-list">
              {more.map((h) => (
                <FootScanHitBlock key={`${h.bodyName}-${h.recordedAt}-${h.starSystem}`} hit={h} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Genus `meta.color_variants` spectral keys vs host — compact “main-sequence rail” + host pin. */
export function SpeciesStarColourSoftBadge({
  entry,
  hostStarType,
  compactLayout,
}: {
  entry: BodyComputed["matches"][0]["entry"];
  hostStarType?: string;
  compactLayout?: boolean;
}) {
  const v = formatGenusStarColorSoftOneLine(entry, hostStarType);
  if (!v.show) return null;
  const chips = sortMorphSpectralKeys(v.supportedSpectralList);
  const host = v.hostSpectralSummary.trim() || "—";
  const title =
    "Codex morph colours cover these spectral classes for this genus. Host shows your resolved journal primary class (soft check — matcher can still hard-null some keys).";

  return (
    <div
      className={`species-spectral-fit species-spectral-fit--${v.tone}${compactLayout ? " species-spectral-fit--compact" : ""}`}
      title={title}
    >
      <span className="visually-hidden">{title}</span>
      <div className="species-spectral-fit-row">
        <div className="species-spectral-host-pin" aria-label="Primary host class">
          <span className="species-spectral-host-pin-ic" aria-hidden>
            ◉
          </span>
          <div className="species-spectral-host-pin-text">
            <span className="species-spectral-host-pin-k">Host</span>
            <span className="species-spectral-host-pin-v">{host}</span>
          </div>
        </div>
        <div className="species-spectral-rail-wrap">
          <div className="species-spectral-rail-glow" aria-hidden />
          <div className="species-spectral-rail" aria-label="Spectral classes with codex morph entries">
            {chips.map((k) => (
              <span
                key={k}
                className={`species-spectral-chip ${morphSpectralChipHeatClass(k)}${
                  hostHitsMorphSpectralChip(host, k) ? " species-spectral-chip--host-here" : ""
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One bar, and it is the one that has been checked.
 *
 * This used to show four: "Chance here" beside habitat fit, deck match and a within-genus rank.
 * The owner asked for the other three to go, and measuring them settled it — they feed **nothing**.
 * "Chance here" is `presenceProbabilityPercent`, written by `attachPresenceProbability` from
 * `rankSpeciesOnBody` -> `speciesLogScore`, which reads the exomastery profile, the scan, the
 * exploration record and the host star. The three that were beside it were computed separately in
 * this file and consumed by nobody: deleting them cannot move a prediction by a thousandth.
 *
 * What they cost was attention. They say how close this body is to the species' own average on
 * scales nothing has calibrated, and they sat at equal width next to the one number with a
 * reliability table behind it — measured on complete-label bodies, the 90-100 % bin comes in at
 * 97.8 % and the 0-10 % bin at 8.9 %. Three uncalibrated bars beside one calibrated one invites
 * exactly the wrong reading, which is why a "Chance here" under 5 % looked like a defect rather
 * than what it is: an honest split across a lot of candidates.
 */
export function SpeciesExomasterySimilarityContent({ m }: { m: BodyComputed["matches"][0] }) {
  type SimCol = {
    key: string;
    shortLabel: string;
    help: string;
    pct: number;
    barOpacity: number;
    barExtraStyle?: CSSProperties;
  };
  const cols: SimCol[] = [];
  /**
   * The one number here that has been checked against reality.
   *
   * Habitat fit, deck match and the genus rank all say how close this body is to the species' own
   * average, on scales nothing has calibrated. This says how often the species turns out to be here
   * — measured, on complete-label bodies: the 90-100 % bin comes in at 97.8 %, the 0-10 % bin at
   * 8.9 %. So it leads, and the rest keep their places behind it.
   */
  const presence = m.presenceProbabilityPercent;
  if (presence != null && Number.isFinite(presence))
    cols.push({
      key: "presence",
      shortLabel: "Chance here",
      help: EXO_PRESENCE_HELP,
      pct: Math.max(0, Math.min(100, presence)),
      barOpacity: 1,
    });
  if (cols.length === 0) {
    return (
      <div className="species-similarity-index-empty dim" style={{ fontSize: "0.72rem" }}>
        No indexed metrics for this match.
      </div>
    );
  }

  const unlikely = m.exomasteryHabitatUnlikely === true;
  const sampleN = m.exomasteryProfileSampleCount;

  return (
    <div className="species-similarity-index-wrap">
      {unlikely ? (
        <div
          className="species-habitat-unlikely"
          title={
            "This body resembles none of the " +
            (sampleN != null ? `${sampleN} ` : "") +
            "bodies where this species has been observed. It is still a possible find — a profile " +
            "records where a species has been seen, not where it cannot grow — but it is ranked last."
          }
        >
          Unlikely habitat{sampleN != null ? ` · 0 of ${sampleN} observed bodies resemble this one` : ""}
        </div>
      ) : null}
      <ThinSampleNote sampleN={sampleN} unlikely={unlikely} />
      <div className="species-similarity-index-cols">
        {cols.map((c) => (
          <div key={c.key} className="species-similarity-index-col" title={c.help}>
            <div className="species-similarity-index-label">
              {c.shortLabel}{" "}
              <span className="species-similarity-index-pct">
                <strong>{c.pct}%</strong>
              </span>
            </div>
            <div className="species-similarity-index-bar" aria-hidden>
              <div
                className="species-similarity-index-fill species-similarity-index-fill--graded"
                style={{
                  width: `${c.pct}%`,
                  opacity: c.barOpacity,
                  ...c.barExtraStyle,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
