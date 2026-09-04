import type { ExoPayoutRangeDTO } from "@shared/types";
import { KvRow } from "./bodyDetailKv";

function footfallMeta(pr: ExoPayoutRangeDTO): { text: string; tone: "yours" | "open" | "other"; hint: string } {
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
        ? "Last detailed scan: not footfalled — bonus may still be available to the right landing."
        : "WasFootfalled not seen in merged journal yet; updates after DSS / surface lines.",
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
  const minListSum = pr.minTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  const maxListSum = pr.maxTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  const minFfSum = pr.minTotalSpecies.reduce((s, r) => s + r.listCredits * 5, 0);
  const maxFfSum = pr.maxTotalSpecies.reduce((s, r) => s + r.listCredits * 5, 0);

  const primaryIsFootfall = pr.commanderFirstFootfall === true;
  const primaryMin = primaryIsFootfall ? pr.minCr : minListSum;
  const primaryMax = primaryIsFootfall ? pr.maxCr : maxListSum;
  const secondaryMin = primaryIsFootfall ? minListSum : minFfSum;
  const secondaryMax = primaryIsFootfall ? maxListSum : maxFfSum;
  const primaryTitle = primaryIsFootfall
    ? "Organic payout (first footfall ×5)"
    : "Standard sell (price list ×1)";
  const secondaryTitle = primaryIsFootfall ? "List value (×1)" : "First-footfall payout (×5)";

  const slotHint =
    pr.slotSource === "bio_signals"
      ? "From FSS / DSS biological signal count in the merged journal (when present)."
      : "Fallback: DSS genus list length when the journal has not published a bio signal count yet.";
  const candidateHint =
    "Species count after the same gates as Candidate species (scan, DSS genus filter, on-foot locks, Include Bacterium). Only rows with a strict price-list match are priced.";
  const candidateShortfall = pr.pricedCandidateCount < pr.slotCount;
  const candidateShortfallHint =
    "Candidates are fewer than bio signals for this body — try turning on Include Bacterium (Candidate species header), or narrow with DSS / on-foot confirmation.";
  const candidatesPillTitle = candidateShortfall ? `${candidateHint} ${candidateShortfallHint}` : candidateHint;
  const listBandHint =
    "Low / high band uses k = min(bio slots, priced candidates): sum the k cheapest vs k priciest distinct list prices (strict keys).";
  const ffBandHint =
    "Same k species, each row ×5 — what you earn if the commander qualifies for first-footfall organics on this body.";

  const ff = footfallMeta(pr);

  const wrapClass =
    variant === "main"
      ? "exo-payout-range-main"
      : "body-detail-callout body-detail-callout--exo-range";

  const listPriceBody =
    minListSum === maxListSum
      ? `${minListSum.toLocaleString()} CR`
      : `${minListSum.toLocaleString()}–${maxListSum.toLocaleString()} CR`;
  const ffPriceBody =
    minFfSum === maxFfSum
      ? `${minFfSum.toLocaleString()} CR`
      : `${minFfSum.toLocaleString()}–${maxFfSum.toLocaleString()} CR`;

  const popupPrimaryCr =
    primaryMin === primaryMax
      ? `${primaryMin.toLocaleString()} CR`
      : `${primaryMin.toLocaleString()} – ${primaryMax.toLocaleString()} CR`;
  const popupSecondaryCr =
    secondaryMin === secondaryMax
      ? `${secondaryMin.toLocaleString()} CR`
      : `${secondaryMin.toLocaleString()} – ${secondaryMax.toLocaleString()} CR`;

  return (
    <div className={wrapClass}>
      {variant === "popup" ? (
        <>
          <span className="body-detail-callout-label">Organic Sell Range (estimate)</span>
          <span className="body-detail-callout-value">{popupPrimaryCr}</span>
          <span className="body-detail-callout-value dim tiny" style={{ display: "block", marginTop: "0.35rem" }}>
            {secondaryTitle}: {popupSecondaryCr}
          </span>
        </>
      ) : (
        <div className="exo-payout-v2">
          <div className="exo-payout-hero-pills">
            <span className="exo-pill exo-pill--grid exo-pill--hero exo-pill--hero-pay">
              <span className="exo-pill-tag">{primaryTitle}</span>
              <span className="exo-pill-body exo-pill-body--hero-cr">
                {primaryMin === primaryMax ? (
                  <>
                    {primaryMin.toLocaleString()} <span className="exo-payout-range-cr">CR</span>
                  </>
                ) : (
                  <>
                    {primaryMin.toLocaleString()} <span className="exo-payout-range-sep">–</span> {primaryMax.toLocaleString()}{" "}
                    <span className="exo-payout-range-cr">CR</span>
                  </>
                )}
              </span>
            </span>
            <span className="exo-pill exo-pill--grid exo-pill--hero exo-pill--hero-secondary">
              <span className="exo-pill-tag">{secondaryTitle}</span>
              <span className="exo-pill-body exo-pill-body--hero-cr">
                {secondaryMin === secondaryMax ? (
                  <>
                    {secondaryMin.toLocaleString()} <span className="exo-payout-range-cr">CR</span>
                  </>
                ) : (
                  <>
                    {secondaryMin.toLocaleString()} <span className="exo-payout-range-sep">–</span> {secondaryMax.toLocaleString()}{" "}
                    <span className="exo-payout-range-cr">CR</span>
                  </>
                )}
              </span>
            </span>
          </div>
          <div className="exo-payout-pills-grid">
            <span className="exo-pill exo-pill--grid exo-pill--price" title={`${listBandHint} ${candidateHint}`}>
              <span className="exo-pill-tag">CANDIDATES PRICE</span>
              <span className="exo-pill-body">Price: {listPriceBody}</span>
            </span>
            <span className="exo-pill exo-pill--grid exo-pill--footfall-price" title={ffBandHint}>
              <span className="exo-pill-tag">FOOTFALL PRICE</span>
              <span className="exo-pill-body">{ffPriceBody}</span>
            </span>
            <span className="exo-pill exo-pill--grid exo-pill--meta" title={slotHint}>
              <span className="exo-pill-tag">BIO SIGNALS</span>
              <span className="exo-pill-body">{pr.slotCount}</span>
            </span>
            <span className="exo-pill exo-pill--grid exo-pill--meta" title={candidatesPillTitle}>
              <span className="exo-pill-tag">CANDIDATES</span>
              <span className="exo-pill-body">
                {pr.pricedCandidateCount}
                {candidateShortfall ? (
                  <span className="exo-pill-warn" title={candidateShortfallHint} aria-label="Fewer candidates than bio signals">
                    {" "}
                    (!)
                  </span>
                ) : null}
              </span>
            </span>
          </div>
          <div className="exo-payout-footfall-row">
            <span
              className={`exo-pill exo-pill--footfall exo-pill--footfall-full exo-pill--footfall-${ff.tone}`}
              title={`${ff.hint} Payout rule: ${multLabel}`}
            >
              {ff.text}
            </span>
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
                  <span className="exo-pill-warn" title={candidateShortfallHint} aria-label="Fewer candidates than bio signals">
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
        </div>
      ) : null}
      {variant === "popup" ? (
        <p className="dim tiny body-detail-callout-note">
          Band = k cheapest vs k priciest distinct price-list matches (strict keys). Detail view lists list/sell (×1) and
          footfall (×5) per species. Narrows after DSS / on-foot confirmation; respects <strong>Include Bacterium</strong>.
        </p>
      ) : null}
    </div>
  );
}
