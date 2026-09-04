import type { ExoPayoutRangeDTO, SystemMapBodyDetailDTO } from "@shared/types";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DetailCard, KvList, KvRow } from "./bodyDetailKv";
import { ExoPayoutRangePanel } from "./ExoPayoutRangePanel";
import {
  formatPressurePill,
  formatTemperaturePillLine,
  gravityFromScan,
  type PressDisplay,
  type TempUnit,
} from "./planetDisplayUtils";

function roleLabel(role: SystemMapBodyDetailDTO["starRole"]): string {
  if (role === "fuel") return "Fuel-scoopable star";
  if (role === "neutron_boost") return "Neutron — strong FSD supercharge (jet cone)";
  if (role === "wd_boost") return "White dwarf — smaller FSD supercharge; very tight cone";
  return "Not used for fuel scooping or common supercharge routes";
}


function DetailHeaderChips({ detail }: { detail: SystemMapBodyDetailDTO }) {
  const chips: ReactNode[] = [];
  const starLike = detail.isStar === true || detail.journalStellar === true;
  if (detail.isMutualBarycentre) {
    chips.push(
      <span key="bary" className="body-detail-chip body-detail-chip--muted">
        Barycentre
      </span>,
    );
  } else if (starLike) {
    if (detail.fullSpectralNotation) {
      chips.push(
        <span key="mk" className="body-detail-chip body-detail-chip--star" title="Harvard/Yerkes style from Scan fields">
          {detail.fullSpectralNotation}
        </span>,
      );
    }
    if (detail.starType) {
      chips.push(
        <span key="type" className="body-detail-chip body-detail-chip--star">
          {detail.starType}
        </span>,
      );
    }
    if (detail.starRole === "fuel") {
      chips.push(
        <span key="fuel" className="body-detail-chip body-detail-chip--fuel">
          Scoop+
        </span>,
      );
    } else {
      chips.push(
        <span key="nscoop" className="body-detail-chip body-detail-chip--scoop-no" title="Not a main-sequence fuel-scoop target (KGBFOAM-style routing).">
          SCOOP−
        </span>,
      );
    }
  } else {
    if (detail.planetClass) {
      chips.push(
        <span key="cls" className="body-detail-chip body-detail-chip--world">
          {detail.planetClass}
        </span>,
      );
    }
    if (detail.landable === true) {
      chips.push(
        <span key="land" className="body-detail-chip body-detail-chip--land">
          Landable
        </span>,
      );
    }
    if (detail.terraformState && detail.terraformState.toLowerCase() !== "not terraformable") {
      chips.push(
        <span key="tf" className="body-detail-chip body-detail-chip--terraform">
          {detail.terraformState}
        </span>,
      );
    }
    if (detail.exoValueTier === 2) {
      chips.push(
        <span key="exo2" className="body-detail-chip body-detail-chip--exo">
          Exo ++
        </span>,
      );
    } else if (detail.exoValueTier === 1) {
      chips.push(
        <span key="exo1" className="body-detail-chip body-detail-chip--exo">
          Exo +
        </span>,
      );
    } else if (detail.hasExobiology) {
      chips.push(
        <span key="bio" className="body-detail-chip body-detail-chip--exo">
          Biology
        </span>,
      );
    }
  }
  if (chips.length === 0) return null;
  return <div className="body-detail-chip-row">{chips}</div>;
}


function BaryDetailCard({ detail }: { detail: SystemMapBodyDetailDTO }) {
  return (
    <DetailCard title="Mutual barycentre">
      <p className="body-detail-lead dim">
        Journal <code className="body-detail-code">ScanBaryCentre</code> — center of mass for bodies that co-orbit. Not
        landable; shown for orbital reference only.
      </p>
      <KvList>
        {detail.baryJournalNullId != null ? (
          <KvRow
            label="Journal BodyID"
            value={
              <>
                {detail.baryJournalNullId}{" "}
                <span className="dim tiny">(internal, not a ship body id)</span>
              </>
            }
          />
        ) : null}
        <KvRow label="Semi-major axis" value={detail.semiMajorAxis != null ? `${detail.semiMajorAxis.toExponential(5)} m` : null} />
        <KvRow label="Eccentricity" value={detail.baryEccentricity} />
        <KvRow label="Orbital inclination" value={detail.baryOrbitalInclination != null ? `${detail.baryOrbitalInclination}°` : null} />
        <KvRow label="Periapsis" value={detail.baryPeriapsis != null ? `${detail.baryPeriapsis}°` : null} />
        <KvRow
          label="Orbital period"
          value={detail.baryOrbitalPeriod != null ? `${detail.baryOrbitalPeriod.toExponential(4)} s` : null}
        />
        <KvRow label="Ascending node" value={detail.baryAscendingNode != null ? `${detail.baryAscendingNode}°` : null} />
        <KvRow label="Mean anomaly" value={detail.baryMeanAnomaly != null ? `${detail.baryMeanAnomaly}°` : null} />
      </KvList>
    </DetailCard>
  );
}

function WorldDetailBody({
  detail,
  onGoToBioBody,
}: {
  detail: SystemMapBodyDetailDTO;
  onGoToBioBody?: (bodyKey: string) => void;
}) {
  const [tempUnit, setTempUnit] = useState<TempUnit>("K");
  const [pressUnit, setPressUnit] = useState<PressDisplay>("atm");

  const hasOverviewBits =
    detail.isStar ||
    detail.journalStellar === true ||
    detail.planetClass ||
    detail.terraformState ||
    detail.landable != null;
  const hasClimate = detail.surfaceTemperature != null || detail.estimatedSurfaceTempK != null;
  const hasPhysical =
    detail.massEM != null ||
    detail.stellarMass != null ||
    detail.surfaceGravity != null ||
    detail.surfacePressure != null ||
    detail.atmosphereType ||
    detail.atmosphere ||
    detail.volcanism ||
    detail.tidalLock === true ||
    detail.compositionSummary ||
    detail.atmosphereCompositionSummary;
  const hasCredits =
    detail.fssCredits != null ||
    detail.dssCredits != null ||
    detail.dssProjectedCredits != null ||
    detail.dssVersusFssUpliftCredits != null;

  const gravLine =
    detail.surfaceGravity != null && Number.isFinite(detail.surfaceGravity)
      ? gravityFromScan({ SurfaceGravity: detail.surfaceGravity }).label
      : null;

  return (
    <>
      {detail.isInferredPlaceholder ? (
        <DetailCard title="Placeholder">
          <p className="body-detail-lead body-detail-inferred-note">
            Inferred from Elite designation (sibling / moon letter). Not in merged journal yet — will fill in after you
            discover this body.
          </p>
        </DetailCard>
      ) : null}

      {hasOverviewBits ? (
        <DetailCard title={detail.isStar || detail.journalStellar === true ? "Star" : "Overview"}>
          <KvList>
            {detail.isStar || detail.journalStellar === true ? (
              <>
                <KvRow
                  label="Spectral (MK)"
                  value={detail.fullSpectralNotation ?? null}
                  hint="From journal Scan: StarType + Subclass + Luminosity when merged."
                />
                <KvRow
                  label="Role"
                  value={roleLabel(detail.starRole)}
                  hint="Derived from journal star type: fuel scoop, neutron boost, white-dwarf boost, or neither."
                />
              </>
            ) : null}
            {detail.journalStellar === true && detail.planetClass ? (
              <KvRow
                label="Scan planet class"
                value={detail.planetClass}
                hint="Journal PlanetClass — pre-main-sequence / stellar object labels often appear on companion/YSO rows."
              />
            ) : null}
            {!detail.isStar && detail.journalStellar !== true && detail.planetClass ? (
              <KvRow label="Body type" value={detail.planetClass} hint="Journal PlanetClass from merged Scan row." />
            ) : null}
            {!detail.isStar && detail.journalStellar !== true && detail.terraformState ? (
              <KvRow label="Terraform" value={detail.terraformState} hint="Journal TerraformState when present." />
            ) : null}
            {!detail.isStar && detail.journalStellar !== true && detail.landable != null ? (
              <KvRow label="Landable" value={detail.landable ? "Yes" : "No"} hint="Journal Landable flag from detailed scan." />
            ) : null}
          </KvList>
        </DetailCard>
      ) : null}

      {hasClimate ? (
        <DetailCard title="Climate">
          <KvList>
            <div className="body-detail-kv-row">
              <span className="body-detail-kv-label">Temperature</span>
              <button
                type="button"
                className="body-detail-kv-value body-detail-kv-interactive"
                title="Tap to cycle Kelvin → °C → °F (display only; matching uses journal Kelvin)."
                onClick={() => setTempUnit((u) => (u === "K" ? "C" : u === "C" ? "F" : "K"))}
              >
                {formatTemperaturePillLine(
                  detail.surfaceTemperature != null && Number.isFinite(detail.surfaceTemperature)
                    ? detail.surfaceTemperature
                    : null,
                  detail.estimatedSurfaceTempK ?? null,
                  tempUnit,
                )}
              </button>
            </div>
          </KvList>
        </DetailCard>
      ) : null}

      {hasPhysical ? (
        <DetailCard title="Physical">
          <KvList>
            <KvRow label="Mass" value={detail.massEM != null ? `${detail.massEM.toFixed(4)} M⊕` : null} hint="Journal mass in Earth masses when present." />
            <KvRow label="Stellar mass" value={detail.stellarMass != null ? `${detail.stellarMass.toFixed(4)} M☉` : null} />
            <KvRow
              label="Surface gravity"
              value={gravLine}
              hint="Journal SurfaceGravity field: shown as g_Earth and raw m/s² (Elite scale), same helper as the body tab."
            />
            {detail.surfacePressure != null && Number.isFinite(detail.surfacePressure) ? (
              <div className="body-detail-kv-row">
                <span className="body-detail-kv-label">Surface pressure</span>
                <button
                  type="button"
                  className="body-detail-kv-value body-detail-kv-interactive"
                  title="Tap: atmospheres ↔ pascals. Large raw values are treated as Pa when converting to atm (same as body tab)."
                  onClick={() => setPressUnit((p) => (p === "atm" ? "pa" : "atm"))}
                >
                  {formatPressurePill(detail.surfacePressure, pressUnit)}
                </button>
              </div>
            ) : null}
            <KvRow label="Atmosphere type" value={detail.atmosphereType} hint="Journal AtmosphereType when set." />
            <KvRow label="Atmosphere" value={detail.atmosphere} hint="Journal Atmosphere summary string." />
            <KvRow label="Volcanism" value={detail.volcanism} />
            <KvRow label="Tidal lock" value={detail.tidalLock === true ? "Yes" : null} />
            <KvRow label="Composition" value={detail.compositionSummary} />
            <KvRow label="Atmosphere composition" value={detail.atmosphereCompositionSummary} />
          </KvList>
        </DetailCard>
      ) : null}

      {detail.exoPayoutRange ? (
        <ExoPayoutRangePanel pr={detail.exoPayoutRange} />
      ) : detail.maxExoHeuristicCredits > 0 ? (
        <div
          className="body-detail-callout"
          title="Single best price-list match × footfall multiplier — not the full slot-sum band (needs bio signals and priced candidates)."
        >
          <span className="body-detail-callout-label">Top single-species heuristic</span>
          <span className="body-detail-callout-value">{detail.maxExoHeuristicCredits.toLocaleString()} CR</span>
          <p className="body-detail-callout-note dim tiny">Map tier hint — full range needs bio signals + list prices on candidates.</p>
        </div>
      ) : null}

      {hasCredits ? (
        <DetailCard title="Exploration value">
          <div className="body-detail-credits-grid">
            <div
              className="body-detail-mini-card"
              title="FSS discovery value from journal scan state (first discover bonus on second line when applicable)."
            >
              <div className="body-detail-mini-card-label">FSS · discovery</div>
              <div className="body-detail-mini-card-value">{detail.fssCredits != null ? `${detail.fssCredits.toLocaleString()} CR` : "—"}</div>
              {detail.fssFirstDiscoverBonus != null && detail.fssFirstDiscoverBonus > 0 ? (
                <p className="dim tiny body-detail-mini-card-meta">
                  + first discovery {detail.fssFirstDiscoverBonus.toLocaleString()} CR → total{" "}
                  {detail.fssFirstDiscoverCredits != null ? `${detail.fssFirstDiscoverCredits.toLocaleString()} CR` : "—"}
                </p>
              ) : null}
            </div>
            <div
              className="body-detail-mini-card"
              title="DSS mapped payout when complete; uplift and projections use the same heuristics as the system map totals."
            >
              <div className="body-detail-mini-card-label">DSS · mapped</div>
              <div className="body-detail-mini-card-value">{detail.dssCredits != null ? `${detail.dssCredits.toLocaleString()} CR` : "—"}</div>
              {detail.dssVersusFssUpliftCredits != null && detail.dssVersusFssUpliftCredits > 0 ? (
                <p className="dim tiny body-detail-mini-card-meta">
                  Uplift vs FSS: +{detail.dssVersusFssUpliftCredits.toLocaleString()} CR
                </p>
              ) : null}
              {detail.dssProjectedCredits != null ? (
                <p className="dim tiny body-detail-mini-card-meta">
                  If DSS completed (est.): ~{detail.dssProjectedCredits.toLocaleString()} CR
                </p>
              ) : null}
              {detail.dssProbeEfficientApplied === true ? (
                <p className="dim tiny body-detail-mini-card-meta">Efficient probes: ×1.25 tail on mapped est.</p>
              ) : null}
              {detail.dssFirstDiscoverBonus != null && detail.dssFirstDiscoverBonus > 0 ? (
                <p className="dim tiny body-detail-mini-card-meta">
                  + first disc. &amp; map {detail.dssFirstDiscoverBonus.toLocaleString()} CR → total{" "}
                  {detail.dssFirstDiscoverCredits != null ? `${detail.dssFirstDiscoverCredits.toLocaleString()} CR` : "—"}
                </p>
              ) : null}
            </div>
          </div>
        </DetailCard>
      ) : null}

      {detail.exoMatchSummaries.length > 0 ? (
        <DetailCard title="Exobiology">
          <p className="dim tiny body-detail-lead">Same matching rules as the main body tab.</p>
          <ul className="body-detail-species-list">
            {detail.exoMatchSummaries.map((m) => (
              <li key={m.id}>{m.displayName}</li>
            ))}
          </ul>
        </DetailCard>
      ) : detail.hasExobiology ? (
        <DetailCard title="Exobiology">
          <p className="dim body-detail-lead">Flagged from scans — add DSS for species matching.</p>
        </DetailCard>
      ) : null}

      {detail.bioBodyKey && onGoToBioBody ? (
        <div className="body-detail-actions">
          <button
            type="button"
            className="system-map-goto body-detail-goto-full"
            title="Switch to this body’s exobiology tab when it appears in the current system’s bio list."
            onClick={() => {
              const bk = detail.bioBodyKey;
              if (bk) onGoToBioBody(bk);
            }}
          >
            Open body tab
          </button>
        </div>
      ) : null}
    </>
  );
}

function DetailBody({
  detail,
  onGoToBioBody,
}: {
  detail: SystemMapBodyDetailDTO;
  onGoToBioBody?: (bodyKey: string) => void;
}) {
  return (
    <div className="body-detail-stack">
      <header className="body-detail-header">
        <div className="body-detail-header-text">
          <h4 className="body-detail-title">
            {detail.bodyName}
            {(detail.isStar || detail.journalStellar === true) && detail.starRole === "fuel" ? (
              <span className="system-map-name-plus">+</span>
            ) : null}
          </h4>
          <DetailHeaderChips detail={detail} />
        </div>
      </header>

      {detail.isMutualBarycentre ? <BaryDetailCard detail={detail} /> : <WorldDetailBody detail={detail} onGoToBioBody={onGoToBioBody} />}
    </div>
  );
}

/**
 * Floating body facts (climate, class, terraform, exo species, etc.). Uses a portal so it is not clipped by
 * `overflow: hidden` on the system map panel.
 */
export function PlanetQuickFactsPopup({
  detail,
  fallbackTitle,
  fallbackSubtitle,
  bodyId,
  onClose,
  onGoToBioBody,
  pos,
}: {
  detail: SystemMapBodyDetailDTO | null;
  fallbackTitle: string;
  /** e.g. notable strip tag line */
  fallbackSubtitle?: string | null;
  bodyId: number;
  onClose: () => void;
  onGoToBioBody?: (bodyKey: string) => void;
  pos: { left: number; top: number };
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const r = el.getBoundingClientRect();
    let left = pos.left + 12;
    let top = pos.top + 12;
    if (left + r.width > window.innerWidth - pad) left = window.innerWidth - r.width - pad;
    if (top + r.height > window.innerHeight - pad) top = window.innerHeight - r.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [pos, bodyId, detail?.bodyId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDoc = (ev: MouseEvent) => {
      if (ev.target instanceof Node && el.contains(ev.target)) return;
      onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 80);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, bodyId]);

  const aria = detail?.bodyName ?? fallbackTitle;

  return createPortal(
    <div
      ref={ref}
      className="system-map-popup card-neon planet-quick-popup"
      role="dialog"
      aria-label={`Quick facts: ${aria}`}
      onClick={(ev) => ev.stopPropagation()}
    >
      <button
        type="button"
        className="system-map-popup-close"
        onClick={onClose}
        aria-label="Close detail"
        title="Close quick facts"
      >
        ×
      </button>
      {detail ? (
        <DetailBody detail={detail} onGoToBioBody={onGoToBioBody} />
      ) : (
        <div className="body-detail-stack">
          <header className="body-detail-header">
            <h4 className="body-detail-title">{fallbackTitle}</h4>
            {fallbackSubtitle ? <p className="dim tiny planet-quick-fallback-sub">{fallbackSubtitle}</p> : null}
          </header>
          <DetailCard title="No journal detail yet">
            <p className="body-detail-lead dim">
              After you FSS/DSS this body, reopen the map (or open it from the exo list) — class, atmosphere, climate
              estimates, terraform flags, and biology matches will line up with the main tab.
            </p>
            <KvList>
              <KvRow label="Map body id" value={String(bodyId)} />
            </KvList>
          </DetailCard>
        </div>
      )}
    </div>,
    document.body,
  );
}
