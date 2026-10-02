/**
 * The Encyclopedia's exomastery planets table and the found-species popup. Split out of EncyclopediaModal.tsx (code review D, 2026-09-27).
 */
import { footConfirmationLabel } from "@shared/footConfirmationLabel";
import { readableAtmosphereType } from "@shared/atmosphereLabel";
import { CopySystemButton } from "./CopySystemButton";
import { ExomasteryDistributionPanel } from "./exomasteryDistributionPanel";
import { ExomasteryHabitatDetailInner } from "./exomasteryHabitatDetailInner";
import { formatPressurePill } from "./planetDisplayUtils";
import { TemperatureLabel } from "./TemperatureLabel";
import type { EncyclopediaExomasteryPlanetsResponseDTO, FootScannedEntry, SpeciesEntry } from "@shared/types";
import { useState } from "react";

export function ExomasteryPlanetsBody({ data }: { data: EncyclopediaExomasteryPlanetsResponseDTO }) {
  const isProfile = data.source === "profile";
  const fb = data.focusBody;
  const [distKey, setDistKey] = useState<string | null>(null);
  return (
    <>
      {fb ? (
        <section className="encyclopedia-focus-body-panel">
          <h4 className="encyclopedia-focus-body-title">
            Feeder profile vs BODY tab
            {fb.planetClass ? (
              <>
                {" "}
                (<span className="encyclopedia-focus-body-class">{fb.planetClass}</span>)
              </>
            ) : null}
          </h4>
          <p className="dim tiny encyclopedia-focus-body-line">
            <strong>{fb.bodyTabLabel}</strong>
            {fb.starSystem && fb.starSystem !== "—" ? (
              <>
                {" "}
                <span className="dim">· {fb.starSystem}</span>
                <CopySystemButton system={fb.starSystem} />
              </>
            ) : null}
          </p>
          <p className="dim tiny" style={{ margin: "0 0 0.5rem" }}>
            {fb.habitatMatchPercent != null && Number.isFinite(fb.habitatMatchPercent) ? (
              <>
                Habitat match (same weighting as <em>Similarity index</em>):{" "}
                <strong className="encyclopedia-habitat-pct">{Math.round(fb.habitatMatchPercent)}%</strong>
              </>
            ) : fb.unavailableReason ? (
              <span className="warn">{fb.unavailableReason}</span>
            ) : (
              "—"
            )}
            . Shown for every species with a feeder JSON, even when this species is not among candidates on
            that planet.
          </p>
          {fb.detail ? (
            <div className="encyclopedia-focus-body-duplex-wrap">
              <ExomasteryHabitatDetailInner
                detail={fb.detail}
                variant="profile"
                comparisonBodySummary={`${fb.bodyTabLabel} · ${fb.starSystem}`}
                showComparisonBodyLine={false}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      <p className="dim tiny" style={{ margin: "0 0 0.5rem" }}>
        {isProfile ? (
          <>
            Each card: field name, then <strong>Typical</strong> (μ), <strong>Mode</strong>, and{" "}
            <strong>Deviation</strong> (mode vs mean). Click <strong>Mode</strong> for chart: feeder min–max
            and mode only; dashed line = this BODY when in range. Hover card for sample counts.
          </>
        ) : (
          <>
            Each card: profile field vs feeder sample dispersion. Click <strong>Mode</strong> for cohort
            min–max chart when numeric. Full tooltip on hover.
          </>
        )}
      </p>
      <div className="encyclopedia-exomastery-scroll">
        {data.planets.map((p) => {
          const sections =
            p.sections && p.sections.length > 0
              ? p.sections
              : p.fields && p.fields.length > 0
                ? [{ title: "Traits", fields: p.fields }]
                : [];
          return (
            <section key={p.index} className="encyclopedia-exomastery-planet">
              <h4 className="encyclopedia-exomastery-planet-title">{p.title}</h4>
              {sections.map((sec) => (
                <div key={sec.title}>
                  <h5 className="exomastery-detail-section-title">{sec.title}</h5>
                  <div className="encyclopedia-exomastery-fields encyclopedia-exomastery-fields--quad">
                    {sec.fields.map((f) => {
                      const typicalRaw = (f.typicalDisplay ?? "").trim();
                      const typical = typicalRaw && typicalRaw !== "—" ? typicalRaw : "N/A";
                      const mode = f.modeDisplay ?? f.valueDisplay;
                      const dev = f.deviationDisplay ?? `${f.deviationPercent.toFixed(1)}%`;
                      const cellKey = `${p.index}:${f.id}`;
                      return (
                        <div
                          key={f.id}
                          className="exo-neon-duplex-stack encyclopedia-exomastery-stat-card-wrap"
                        >
                          <div
                            className={`exo-neon-duplex exo-neon-duplex--tier-${f.tier} encyclopedia-exomastery-stat-card`}
                            title={f.contextNote}
                          >
                            <span className="species-other-match-mini-title encyclopedia-exo-field-name">
                              {f.label}
                            </span>
                            <div className="species-other-match-mini-line">
                              <span className="species-other-match-mini-legend">Typical</span>
                              <span>{typical}</span>
                            </div>
                            <div className="species-other-match-mini-line">
                              <span className="species-other-match-mini-legend">Mode</span>
                              {f.distribution != null ? (
                                <button
                                  type="button"
                                  className="exo-duplex-typical-mode-hit"
                                  onClick={() => setDistKey((k) => (k === cellKey ? null : cellKey))}
                                  aria-expanded={distKey === cellKey}
                                  title="Feeder min–max from profile (mode peak); dashed = BODY if in range"
                                >
                                  {mode}
                                </button>
                              ) : (
                                <span>{mode}</span>
                              )}
                            </div>
                            <div className="species-other-match-mini-line">
                              <span className="species-other-match-mini-legend">Deviation</span>
                              <strong>{dev}</strong>
                            </div>
                          </div>
                          {distKey === cellKey && f.distribution ? (
                            <ExomasteryDistributionPanel label={f.label} distribution={f.distribution} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

export function FoundSpeciesPopup({
  entry,
  hits,
  onClose,
}: {
  entry: SpeciesEntry;
  hits: FootScannedEntry[];
  onClose: () => void;
}) {
  return (
    // Sits inside the Encyclopedia's backdrop: its closing click must not bubble on and close that too.
    <div
      className="modal-backdrop encyclopedia-found-backdrop"
      role="presentation"
      onClick={(ev) => {
        ev.stopPropagation();
        onClose();
      }}
    >
      <div
        className="modal-panel encyclopedia-found-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ency-found-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="ency-found-title">Found — {entry.displayName}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={(ev) => {
              ev.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            title="Close found list"
          >
            ×
          </button>
        </div>
        <div className="modal-body encyclopedia-found-body">
          {hits.length === 0 ? (
            <p className="dim">No matching rows in your foot catalog yet.</p>
          ) : (
            <ul className="encyclopedia-found-list">
              {hits.map((f) => (
                <li key={f.id} className="encyclopedia-found-card">
                  <time className="encyclopedia-found-date" dateTime={f.recordedAt}>
                    {f.recordedAt.slice(0, 19).replace("T", " ")}
                  </time>
                  <div className="encyclopedia-found-planet">
                    <strong>{f.bodyName}</strong>
                    <span className="dim"> · {f.starSystem}</span>
                    <CopySystemButton system={f.starSystem} />
                  </div>
                  <dl className="encyclopedia-found-facts">
                    <div>
                      <dt>Planet class</dt>
                      <dd>{f.planetClass}</dd>
                    </div>
                    <div>
                      <dt>Atmosphere</dt>
                      <dd>{readableAtmosphereType(f.atmosphereNorm) || "—"}</dd>
                    </div>
                    <div>
                      <dt>Temperature</dt>
                      <dd title="The journal's surface temperature when recorded, the catalogue's estimated band dimmed beside it. Same as the body tab (Kelvin here).">
                        <TemperatureLabel
                          journalK={f.surfaceTemperatureK != null ? f.surfaceTemperatureK : null}
                          est={{ minK: f.tempBandMinK, maxK: f.tempBandMaxK, midK: f.tempMidK }}
                          unit="K"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Pressure</dt>
                      <dd
                        title={
                          f.surfacePressure != null
                            ? "Journal SurfacePressure from foot catalog: large values treated as pascals when showing atm (same rule as main UI)."
                            : undefined
                        }
                      >
                        {f.surfacePressure != null ? formatPressurePill(f.surfacePressure, "atm") : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{footConfirmationLabel(f.confirmationSource)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
