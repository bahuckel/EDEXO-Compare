/**
 * The payout range, explained species by species. Split out of BodyPane.tsx (code review D, 2026-09-27).
 */
import { useModal } from "./ui/useModal";
import { footfallCertainty, showsFootfallPrice, showsListPrice } from "@shared/footfallValue";
import type { ExoPayoutRangeDTO } from "@shared/types";

export function ExoPayoutRangeDetailModal({
  pr,
  bodyTabLabel,
  includeBacteriumInSearch,
  onClose,
}: {
  pr: ExoPayoutRangeDTO;
  bodyTabLabel: string;
  includeBacteriumInSearch: boolean;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);

  const slotSrcLabel =
    pr.slotSource === "bio_signals"
      ? "FSS / DSS biological signal count in the merged journal."
      : "DSS genus list length (fallback when signal count is not present yet).";

  /*
   * Which columns this body has any business showing.
   *
   * Both figures were drawn unconditionally, including on bodies the journal had already reported as
   * walked — so a ×5 total sat beside a bonus that was gone. Once the answer is known, only the
   * number the commander will actually be paid belongs on screen.
   */
  const certainty = footfallCertainty({
    journalWasFootfalled: pr.journalWasFootfalled,
    commanderFirstFootfall: pr.commanderFirstFootfall,
  });
  // 1.3: both columns stay in the table (it is the one place for the full picture); the column that
  // does not apply on this body is greyed rather than hidden.
  const listCls = showsListPrice(certainty) ? "" : " exo-payout-detail-col--na";
  const ffCls = showsFootfallPrice(certainty) ? "" : " exo-payout-detail-col--na";
  const showList = showsListPrice(certainty);
  const showFf = showsFootfallPrice(certainty);

  const minListTot = pr.minTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  const minFfTot = pr.minTotalSpecies.reduce((s, r) => s + r.listCredits * 5, 0);
  const maxListTot = pr.maxTotalSpecies.reduce((s, r) => s + r.listCredits, 0);
  const maxFfTot = pr.maxTotalSpecies.reduce((s, r) => s + r.listCredits * 5, 0);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel exo-payout-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-payout-detail-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="exo-payout-detail-title">Organic Sell Range: {bodyTabLabel}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body exo-payout-detail-body">
          <section className="exo-payout-detail-section">
            <h4>How this range is calculated</h4>
            <ul className="exo-payout-detail-list">
              <li>
                <strong>Slots ({pr.slotCount})</strong> — {slotSrcLabel}
              </li>
              <li>
                <strong>Candidates ({pr.pricedCandidateCount} priced)</strong> — species that pass the same
                matching rules as &quot;Candidate species&quot; below for this body (scan gates, DSS genus
                filter, on-foot locks, and <strong>Include Bacterium</strong>{" "}
                {includeBacteriumInSearch ? "ON" : "OFF"}).
              </li>
              <li>
                <strong>List price</strong> — each row uses <code>data/price-list.json</code> with a{" "}
                <em>strict</em> key match on species display name / id (no substring fallback), identical to
                the map exobiology heuristic.
              </li>
              <li>
                <strong>Columns</strong> — <strong>List / sell (×1)</strong> is the row from{" "}
                <code>data/price-list.json</code> (strict key match — same as standard organic payout without
                the first-footfall bonus). <strong>Footfall (×5)</strong> is five times that value: the total
                payout when your commander qualifies for first-footfall organics on this body.
              </li>
              <li>
                <strong>Multiplier ×{pr.mult}</strong> —{" "}
                {pr.commanderFirstFootfall
                  ? "Your commander is flagged for first-footfall organic bonus on this body in the merged journal; the headline range on the card uses this ×5 total."
                  : "Standard ×1 totals match the price list for this commander on this body; the Footfall column shows what each row pays if you later qualify for the bonus."}{" "}
                {pr.noFootfallSystemKind
                  ? "No first-footfall bonus in this system (populated or being colonised), whatever the scan says."
                  : pr.journalWasFootfalled === null
                    ? "Detailed scan footfall flag not seen yet."
                    : pr.journalWasFootfalled
                      ? "Latest detailed scan reports the surface has been visited."
                      : "Latest detailed scan reports the body was not yet footfalled."}
              </li>
              <li>
                <strong>k = min(slots, {pr.pricedCandidateCount})</strong>— we sum the{" "}
                <strong>k cheapest</strong> distinct priced species for the low total, and the{" "}
                <strong>k priciest</strong> for the high total.
                {pr.incomplete
                  ? " There are fewer priced matches than bio slots, so both totals only include the species shown."
                  : ""}
              </li>
            </ul>
          </section>

          <section className="exo-payout-detail-section">
            <h4>Worst-paying set (k cheapest)</h4>
            <p className="dim tiny" style={{ marginTop: "-0.25rem" }}>
              {[
                showList ? `List / standard sell (×1) total ${minListTot.toLocaleString()} CR` : null,
                showFf ? `Footfall (×5) total ${minFfTot.toLocaleString()} CR` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <table className="exo-payout-detail-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th className={`exo-payout-detail-num${listCls}`}>List / sell (×1)</th>
                  <th className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                    Footfall (×5)
                  </th>
                </tr>
              </thead>
              <tbody>
                {pr.minTotalSpecies.map((row) => (
                  <tr key={`min-${row.id}`}>
                    <td>{row.displayName}</td>
                    <td className={`exo-payout-detail-num${listCls}`}>{row.listCredits.toLocaleString()}</td>
                    <td className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                      {(row.listCredits * 5).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr className="exo-payout-detail-sum">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className={`exo-payout-detail-num${listCls}`}>
                    <strong>{minListTot.toLocaleString()}</strong>
                  </td>
                  <td className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                    <strong>{minFfTot.toLocaleString()}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="exo-payout-detail-section">
            <h4>Best-paying set (k priciest)</h4>
            <p className="dim tiny" style={{ marginTop: "-0.25rem" }}>
              {[
                showList ? `List / standard sell (×1) total ${maxListTot.toLocaleString()} CR` : null,
                showFf ? `Footfall (×5) total ${maxFfTot.toLocaleString()} CR` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <table className="exo-payout-detail-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th className={`exo-payout-detail-num${listCls}`}>List / sell (×1)</th>
                  <th className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                    Footfall (×5)
                  </th>
                </tr>
              </thead>
              <tbody>
                {pr.maxTotalSpecies.map((row) => (
                  <tr key={`max-${row.id}`}>
                    <td>{row.displayName}</td>
                    <td className={`exo-payout-detail-num${listCls}`}>{row.listCredits.toLocaleString()}</td>
                    <td className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                      {(row.listCredits * 5).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr className="exo-payout-detail-sum">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className={`exo-payout-detail-num${listCls}`}>
                    <strong>{maxListTot.toLocaleString()}</strong>
                  </td>
                  <td className={`exo-payout-detail-num exo-payout-detail-footfall-col${ffCls}`}>
                    <strong>{maxFfTot.toLocaleString()}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
