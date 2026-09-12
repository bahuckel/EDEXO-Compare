import type { ExoPayoutRangeDTO } from "@shared/types";
import { footfallCertainty, footfallValueNote, type FootfallCertainty } from "@shared/footfallValue";
import { KvRow } from "./bodyDetailKv";
import { fmtCrRangeExact, fmtCrRangeShort } from "./credits";

function footfallMeta(pr: ExoPayoutRangeDTO): {
  text: string;
  tone: "yours" | "open" | "other";
  hint: string;
} {
  if (pr.commanderFirstFootfall) {
    return {
      text: "FOOTFALL — YOUR BONUS",
      tone: "yours",
      hint: "Your commander is flagged for first-footfall organic bonus here (disembark / journal).",
    };
  }
  if (pr.journalWasFootfalled === true) {
    return {
      text: "FOOTFALL — OTHER CMDR",
      tone: "other",
      hint: "Journal reports footfall; organics still pay ×1 until your run qualifies for the organic bonus where applicable.",
    };
  }
  return {
    text: "FOOTFALL — OPEN",
    tone: "open",
    hint:
      pr.journalWasFootfalled === false
        ? // A `false` is a claim about a moment, and it only ever gets staler. Saying when it was
          // observed is the difference between a useful pill and one that sends a commander 400 ly
          // to find boot prints.
          `Not footfalled as of the last detailed scan${pr.footfallSeenLabel ? ` (${pr.footfallSeenLabel})` : ""} — the bonus was intact then.`
        : "WasFootfalled not seen in merged journal yet; updates after DSS / surface lines.",
  };
}

/**
 * The target ladder of INCLUDE-BODY-IDS §2.7, as one line.
 *
 * `unknown` is deliberately not dressed up as an opportunity: it is the absence of evidence, and
 * the whole point of the tri-state is that it never masquerades as `unopened`.
 */
function rungLabel(pr: ExoPayoutRangeDTO): { text: string; hint: string } | null {
  const age = pr.rungSeenLabel ? `, seen ${pr.rungSeenLabel}` : "";
  switch (pr.targetRung) {
    case "unopened":
      return {
        text: "UNOPENED",
        hint: `Signals present, nobody had mapped or landed on it${age}. The first-footfall bonus was intact at that point.`,
      };
    case "mapped-not-walked":
      return {
        text: "MAPPED, NOT WALKED",
        hint: pr.mappedPredatesExobiology
          ? `Mapped${age} — before Odyssey, so it was mapped for the cartographic payout by somebody who could not collect plants. It says nothing about the biology.`
          : `Somebody mapped it${age} and did not land. They saw the genera and declined, so weigh that against the age of the map.`,
      };
    case "walked":
      return {
        text: "WALKED",
        hint: `Somebody has landed here${age}. Footfall is permanent — the ×5 is gone, though the base payout and the plants may well remain.`,
      };
    default:
      return null;
  }
}

/**
 * One price, the right one (WEBUI-REDESIGN 1.1).
 *
 * The panel used to draw the ×1 band and the ×5 band side by side on every body. The journal
 * usually knows which applies (`footfallCertainty`): when it does, only that figure is the price;
 * when it does not, the list price is the price and the ×5 is one small line underneath, worded as
 * the conditional it is. Nothing is lost — the detail modal keeps the full per-species table.
 */
export function payoutHeadline(pr: ExoPayoutRangeDTO): {
  certainty: FootfallCertainty;
  mult: 1 | 5;
  min: number;
  max: number;
  /** Tracked-uppercase tag beside the price. */
  tag: string;
  /** The conditional line under the price when the answer is unknown; null otherwise. */
  alt: { label: string; min: number; max: number } | null;
} {
  const certainty = footfallCertainty({
    journalWasFootfalled: pr.journalWasFootfalled,
    commanderFirstFootfall: pr.commanderFirstFootfall,
  });
  const minList = pr.minTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  const maxList = pr.maxTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  if (certainty === "unwalked") {
    return { certainty, mult: 5, min: minList * 5, max: maxList * 5, tag: "×5 first footfall", alt: null };
  }
  if (certainty === "walked") {
    return { certainty, mult: 1, min: minList, max: maxList, tag: "×1 footfalled", alt: null };
  }
  return {
    certainty,
    mult: 1,
    min: minList,
    max: maxList,
    tag: "×1 list · footfall unknown",
    alt: { label: "if first footfall ×5", min: minList * 5, max: maxList * 5 },
  };
}

export function ExoPayoutRangePanel({
  pr,
  variant = "popup",
}: {
  pr: ExoPayoutRangeDTO;
  variant?: "popup" | "main";
}) {
  const multLabel = pr.mult === 5 ? "×5 (your first footfall on this body)" : "×1 list price";
  const rung = rungLabel(pr);
  const head = payoutHeadline(pr);
  const note = footfallValueNote(head.certainty, pr.footfallSeenLabel);

  const slotHint =
    pr.slotSource === "bio_signals"
      ? "Bio signal count from the journal's FSS / DSS."
      : "DSS genus count (no bio signal count in the journal yet).";
  const candidateHint = "Priced species passing the same gates as the candidate list.";
  const candidateShortfall = pr.pricedCandidateCount < pr.slotCount;
  const candidateShortfallHint = "Fewer candidates than signals — try Include Bacterium, or narrow with a DSS.";
  const candidatesPillTitle = candidateShortfall
    ? `${candidateHint} ${candidateShortfallHint}`
    : candidateHint;
  const bandHint = "Band: k cheapest vs k priciest list prices, k = min(signals, candidates). Click for the table.";

  const ff = footfallMeta(pr);

  const wrapClass =
    variant === "main" ? "exo-payout-range-main" : "body-detail-callout body-detail-callout--exo-range";

  const priceTitle = `${fmtCrRangeExact(head.min, head.max)} — ${note} ${bandHint}`;

  return (
    <div className={wrapClass}>
      {variant === "popup" ? (
        <>
          <span className="body-detail-callout-label">Organic sell (estimate)</span>
          <span className="body-detail-callout-value" title={priceTitle}>
            {fmtCrRangeShort(head.min, head.max)} CR{" "}
            <span className={`price-tag price-tag--${head.certainty}`}>{head.tag}</span>
          </span>
          {head.alt ? (
            <span className="body-detail-callout-value dim tiny price-alt" style={{ display: "block", marginTop: "0.35rem" }}>
              {head.alt.label}: {fmtCrRangeShort(head.alt.min, head.alt.max)} CR
            </span>
          ) : null}
        </>
      ) : (
        <div className="exo-payout-v2 payout">
          {/* The hero: one price, the right one, in the cockpit's frame; blue when it is the ×5 you would take. */}
          <div className={`payout-hero payout-hero--${head.certainty}`} title={priceTitle}>
            <span className="fact-k">
              {head.certainty === "unwalked"
                ? "First footfall value"
                : head.certainty === "walked"
                  ? "Sell value · body walked"
                  : "Sell value · footfall unknown"}
            </span>
            <span className="payout-cr">
              {fmtCrRangeShort(head.min, head.max)}
              <small>CR</small>
            </span>
            <span className={`price-tag price-tag--${head.certainty}`}>{head.tag}</span>
            {head.alt ? (
              <span className="payout-alt" title={fmtCrRangeExact(head.alt.min, head.alt.max)}>
                {head.alt.label}: {fmtCrRangeShort(head.alt.min, head.alt.max)} CR
              </span>
            ) : null}
          </div>
          <div className="facts facts--payout">
            <div className="fact" title={slotHint}>
              <span className="fact-k">Bio signals</span>
              <span className="fact-v">{pr.slotCount}</span>
            </div>
            <div className="fact" title={candidatesPillTitle}>
              <span className="fact-k">Candidates</span>
              <span className="fact-v">
                {pr.pricedCandidateCount}
                {candidateShortfall ? (
                  <span
                    className="exo-pill-warn"
                    title={candidateShortfallHint}
                    aria-label="Fewer candidates than bio signals"
                  >
                    {" "}
                    (!)
                  </span>
                ) : null}
              </span>
            </div>
            <div className={`fact fact--tone-${ff.tone}`} title={`${ff.hint} Payout rule: ${multLabel}`}>
              <span className="fact-k">Footfall</span>
              <span className="fact-v">{ff.text.replace("FOOTFALL — ", "")}</span>
            </div>
          </div>
        </div>
      )}
      {variant === "popup" ? (
        <div className="body-detail-kv-list body-detail-kv-list--tight">
          <KvRow
            label="Bio slots"
            value={`${pr.slotCount} signal${pr.slotCount === 1 ? "" : "s"}`}
            hint={slotHint}
          />
          <KvRow
            label="Priced candidates"
            value={
              <>
                {String(pr.pricedCandidateCount)}
                {candidateShortfall ? (
                  <span
                    className="exo-pill-warn"
                    title={candidateShortfallHint}
                    aria-label="Fewer candidates than bio signals"
                  >
                    {" "}
                    (!)
                  </span>
                ) : null}
              </>
            }
            hint={candidatesPillTitle}
          />
          <KvRow label="Payout rule" value={multLabel} />
          <KvRow
            label="Scan footfall"
            value={
              pr.journalWasFootfalled === null
                ? "Unknown (no detailed WasFootfalled yet)"
                : pr.journalWasFootfalled
                  ? "Surface visited (journal)"
                  : "Not footfalled at last detailed scan"
            }
            hint="From latest merged detailed Scan.WasFootfalled when present — distinct from codex first-footfall organic bonus flags."
          />
          {pr.wasMapped !== null ? (
            <KvRow
              label="Mapped"
              value={`${pr.wasMapped ? "Yes" : "No"}${pr.mappedSeenLabel ? ` (${pr.mappedSeenLabel})` : ""}`}
              hint="Whether anyone has DSS-mapped this body. A map's age is most of its meaning — one from before Odyssey predates collectable exobiology entirely."
            />
          ) : null}
          {rung ? <KvRow label="Target" value={rung.text} hint={rung.hint} /> : null}
        </div>
      ) : null}
      {variant === "popup" ? (
        <p className="dim tiny body-detail-callout-note">{note}</p>
      ) : null}
    </div>
  );
}
