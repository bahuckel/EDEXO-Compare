/**
 * What the unsold data is worth, line by line. Split out of AppModals.tsx (code review D, 2026-09-27).
 */
import { CopySystemButton } from "./CopySystemButton";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { useModal } from "./ui/useModal";
import type { OrganicPendingLineItem } from "@shared/types";

export function DataValueBreakdownModal({
  lines,
  includeExplorationScanDataInDataValue,
  explorationFssScanCount,
  explorationFssValueCredits,
  explorationHonkValueCredits = 0,
  explorationDssScanCount,
  explorationDssValueCredits,
  exobioScanCount,
  exobioValueCredits,
  pranavAntalBonus = false,
  onTogglePranavAntal,
  sellAtFleetCarrier = false,
  onToggleFleetCarrier,
  onClose,
}: {
  lines: OrganicPendingLineItem[];
  includeExplorationScanDataInDataValue: boolean;
  explorationFssScanCount: number;
  explorationFssValueCredits: number;
  /** Part of the FSS value: the honk, paid with each system that has its arrival star unsold. */
  explorationHonkValueCredits?: number;
  explorationDssScanCount: number;
  explorationDssValueCredits: number;
  /** Completed samples waiting to sell, and their value — the header pill's own two numbers. */
  exobioScanCount: number;
  exobioValueCredits: number;
  /** The exobiology figures include the +30 % Pranav Antal sale bonus (owner, 2026-10-03). */
  pranavAntalBonus?: boolean;
  onTogglePranavAntal?: (on: boolean) => void;
  /** The exploration figures are after a fleet carrier's 25 % (owner, 2026-10-03). */
  sellAtFleetCarrier?: boolean;
  onToggleFleetCarrier?: (on: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel modal-panel--data-value"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Unsold data value</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--data-value">
          {/*
            The three things worth selling, on three lines, before the per-sample list.

            Exploration is counted in the header total only while the ⊕ toggle is on, so the two
            exploration rows say when they are not — the alternative is three rows that look like
            they add up to the pill and do not.
          */}
          <ul className="data-value-summary">
            <li
              className="data-value-summary-row"
              title="Stars and bodies scanned but not mapped: discovery scan, FSS, arrival auto-scan. Nav-beacon data and bodies already sold are not counted."
            >
              <span className="data-value-summary-count">{explorationFssScanCount}</span>
              <span className="data-value-summary-label">
                FSS scans
                {explorationHonkValueCredits > 0 ? (
                  <span className="dim tiny"> · incl. honk {explorationHonkValueCredits.toLocaleString()} CR</span>
                ) : null}
                {sellAtFleetCarrier ? <span className="dim tiny"> · at a carrier</span> : null}
                {!includeExplorationScanDataInDataValue ? (
                  <span className="dim tiny"> · not in total</span>
                ) : null}
              </span>
              <span className="data-value-summary-value">
                {explorationFssValueCredits.toLocaleString()} CR
              </span>
            </li>
            <li
              className="data-value-summary-row"
              title="Planets mapped with the surface scanner, at their mapped value (which includes the scan)."
            >
              <span className="data-value-summary-count">{explorationDssScanCount}</span>
              <span className="data-value-summary-label">
                DSS scans
                {sellAtFleetCarrier ? <span className="dim tiny"> · at a carrier</span> : null}
                {!includeExplorationScanDataInDataValue ? (
                  <span className="dim tiny"> · not in total</span>
                ) : null}
              </span>
              <span className="data-value-summary-value">
                {explorationDssValueCredits.toLocaleString()} CR
              </span>
            </li>
            <li
              className="data-value-summary-row"
              title="Completed samples (3x Analyse) not yet sold; first footfall pays 5x"
            >
              <span className="data-value-summary-count">{exobioScanCount}</span>
              <span className="data-value-summary-label">
                Exobio scans
                {pranavAntalBonus ? <span className="dim tiny"> · with +30 %</span> : null}
              </span>
              <span className="data-value-summary-value">{exobioValueCredits.toLocaleString()} CR</span>
            </li>
          </ul>
          {/*
            Pranav Antal (owner, 2026-10-03): a toggle, off by default. The bonus depends on where the
            commander sells, which is his to choose; the app does not follow Powerplay ranks or systems.
          */}
          {onTogglePranavAntal ? (
            <label
              className="data-value-bonus-toggle"
              title="Count Pranav Antal's +30 % on exobiology sales in Data value. Turn it on when you plan to sell where you get the bonus."
            >
              <input
                type="checkbox"
                checked={pranavAntalBonus}
                onChange={(ev) => onTogglePranavAntal(ev.target.checked)}
              />
              <span>+30% Pranav Antal bonus</span>
              {pranavAntalBonus ? <span className="dim tiny">· the samples below are before it</span> : null}
            </label>
          ) : null}
          {/*
            Fleet carrier (owner, 2026-10-03): exploration data sold at a carrier pays 75 %; his carrier
            sales came in exactly 25 % under the system map. Off by default, like Pranav Antal.
          */}
          {onToggleFleetCarrier ? (
            <label
              className="data-value-bonus-toggle"
              title="Count exploration data as sold at a fleet carrier, which keeps 25 %. The system map still shows the full values, as the game's does."
            >
              <input
                type="checkbox"
                checked={sellAtFleetCarrier}
                onChange={(ev) => onToggleFleetCarrier(ev.target.checked)}
              />
              <span>Selling at a fleet carrier (−25 %)</span>
            </label>
          ) : null}
          {lines.length === 0 ? (
            <p className="dim">
              {includeExplorationScanDataInDataValue
                ? "No completed exobiology samples waiting to sell in the merged journal replay."
                : "No completed samples waiting to sell in the merged journal replay."}
            </p>
          ) : (
            <ul className="data-value-breakdown-list">
              {lines.map((line, i) => (
                <li key={`${line.bodyKey}-${i}`} className="data-value-breakdown-row">
                  {/* The 320 px thumbnail, not the original (~600 KB each, 116 rows) — UI review P8. */}
                  <img
                    src={speciesPhotoVariant(line.photoUrl, "thumb")}
                    alt=""
                    decoding="async"
                    className="data-value-breakdown-thumb"
                  />
                  <div className="data-value-breakdown-main">
                    <div className="data-value-breakdown-planet">
                      <strong>{line.bodyName}</strong>
                      <span className="dim"> · {line.starSystem}</span>
                      <CopySystemButton system={line.starSystem} />
                    </div>
                    <div className="data-value-breakdown-species">{line.speciesLabel}</div>
                    <div className="data-value-breakdown-value-row">
                      {line.baseCredits != null ? (
                        <>
                          <span className="data-value-breakdown-credits">
                            {line.valueCredits.toLocaleString()} CR
                          </span>
                          {line.firstFootfall ? (
                            <span
                              className="data-value-footfall-badge"
                              title="First footfall: 1× list payout plus 4× bonus in-game (5× total)"
                            >
                              First footfall 5× total
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="dim">No price in price list — not counted in total</span>
                      )}
                    </div>
                    {line.baseCredits != null && line.firstFootfall ? (
                      <div className="data-value-footfall-detail dim">
                        {line.baseCredits.toLocaleString()} CR base +{" "}
                        {(line.baseCredits * 4).toLocaleString()} CR first-footfall bonus ={" "}
                        {line.valueCredits.toLocaleString()} CR
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
