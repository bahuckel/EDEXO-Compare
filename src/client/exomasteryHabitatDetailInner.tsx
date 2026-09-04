import type {
  EncyclopediaExomasteryFieldTier,
  ExomasteryCompositionGroupDTO,
  ExomasteryDetailDTO,
  ExomasteryStatDetailDTO,
} from "@shared/types";

import { useMemo, useState } from "react";

import { ExomasteryDistributionPanel } from "./exomasteryDistributionPanel";

function deviationToTier(pct: number): EncyclopediaExomasteryFieldTier {
  if (pct < 1) return "blue";
  if (pct <= 5) return "green";
  if (pct <= 7.5) return "yellow";
  if (pct <= 10) return "orange";
  return "red";
}

const STELLAR_STEP_TIER: EncyclopediaExomasteryFieldTier[] = ["blue", "green", "yellow", "orange", "red"];

function hostStarProximityRow(s: ExomasteryStatDetailDTO): boolean {
  if (s.kind !== "categorical") return false;
  if (
    s.stellarProximitySteps != null &&
    s.stellarProximityAxis != null &&
    Number.isFinite(s.stellarProximitySteps)
  )
    return true;
  const p = (s.chartPath ?? "").toLowerCase();
  return p.startsWith("host.compare.");
}

function stellarProximityTier(steps: number): EncyclopediaExomasteryFieldTier {
  const n = Math.min(4, Math.max(0, Math.floor(steps)));
  return STELLAR_STEP_TIER[n]!;
}

function hostMkAxisCaption(axis: NonNullable<ExomasteryStatDetailDTO["stellarProximityAxis"]>): string {
  if (axis === "spectral") return "Harvard spectral";
  if (axis === "subclass") return "Subclass 0–9";
  return "Yerkes luminosity";
}

function tierDriverPercent(s: ExomasteryStatDetailDTO): number {
  if (s.isMissing) return 0;
  if (s.diffHuge) return 100;
  if (s.kind === "categorical" && !s.isMissing) {
    if (s.categoricalCloseness === "match") return 2;
    if (s.categoricalCloseness === "close") return 6;
    return 18;
  }
  if (s.diffRelativePercent != null && Number.isFinite(s.diffRelativePercent)) {
    return Math.abs(s.diffRelativePercent);
  }
  const dp = s.diffPoints;
  if (dp != null && Number.isFinite(dp)) return Math.min(100, Math.abs(dp) * 12);
  return 4;
}

function tierForHabitatStat(s: ExomasteryStatDetailDTO): EncyclopediaExomasteryFieldTier {
  if (s.stellarProximitySteps != null && Number.isFinite(s.stellarProximitySteps)) {
    return stellarProximityTier(s.stellarProximitySteps);
  }
  return deviationToTier(tierDriverPercent(s));
}

function habitatContextNote(s: ExomasteryStatDetailDTO): string {
  const parts: string[] = [];
  if (hostStarProximityRow(s)) {
    parts.push(`${s.label}: cohort mode ${s.typicalDisplay}; journal host star ${s.currentDisplay}`);
    if (s.isMissing) parts.push("(missing cohort or journal parse on one axis)");
    return parts.join(" ");
  }
  parts.push(`${s.label}: typical ${s.typicalDisplay}; this body ${s.currentDisplay}`);
  if (s.isMissing) parts.push("(not merged from journal / DSS yet)");
  return parts.join(" ");
}

function habitatDeltaCaption(s: ExomasteryStatDetailDTO): string {
  if (s.isMissing) return "—";
  if (s.stellarProximitySteps != null && s.stellarProximityAxis && Number.isFinite(s.stellarProximitySteps)) {
    const ax = hostMkAxisCaption(s.stellarProximityAxis);
    return s.stellarProximitySteps === 0
      ? `Match · ${ax}`
      : `Δ ${s.stellarProximitySteps} step${s.stellarProximitySteps === 1 ? "" : "s"} · ${ax}`;
  }
  if (s.kind === "categorical") {
    if (!s.isMissing && s.categoricalCloseness) {
      const m =
        s.categoricalCloseness === "match"
          ? "Match"
          : s.categoricalCloseness === "close"
            ? "Close"
            : "Different";
      return m;
    }
    return "—";
  }
  if (s.diffHuge) return "Δ 100%+ vs typical";
  if (s.diffRelativePercent != null && Number.isFinite(s.diffRelativePercent))
    return `Δ ${Math.abs(s.diffRelativePercent).toFixed(2)}%`;
  if (s.diffPoints != null && Number.isFinite(s.diffPoints))
    return s.compact ? `Δ ${Math.abs(s.diffPoints).toFixed(1)} pp` : `Δ ${Math.abs(s.diffPoints).toFixed(0)}`;
  return "—";
}

function formatCrustHeaderSuffix(g: ExomasteryCompositionGroupDTO): string | null {
  const { summary } = g;
  const parts: string[] = [];
  if (summary.overallMatchPercent != null) parts.push(`Match vs profile ${summary.overallMatchPercent}%`);
  if (summary.best && summary.worst) {
    parts.push(`best ${summary.best.label} (${summary.best.matchPercent}%)`);
    parts.push(`worst ${summary.worst.label} (${summary.worst.matchPercent}%)`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function profileNumericSectionKey(s: ExomasteryStatDetailDTO): "body" | "orbit" | "misc" | "traits" {
  const path = (s.chartPath ?? "").toLowerCase();
  const lab = (s.label ?? "").toLowerCase();
  const hay = `${path} ${lab}`;
  if (/\bsystemaddress\b|(^|[^\w])id64|system address|(^|\s)body\s*id\b|\bbodyid\b/i.test(hay)) return "misc";
  if (
    /\bearth\s*mass|mass\s*em|\bmass\b.*\bem\b|\bearth\s*masses\b/.test(hay) ||
    (/gravity/.test(hay) && !/star/.test(hay)) ||
    /\blandable\b/.test(hay) ||
    /\bterraform\b/.test(hay) ||
    /\bvolcan/i.test(hay) ||
    /\bplanet\s*class\b|\bplanetclass\b/.test(hay) ||
    /\batmosphere\s*type\b|\batmospheretype\b/.test(path) ||
    (lab.trim() === "atmosphere" && !path.includes("composition")) ||
    /\bsubclass\b|\bsub\s*type\b|\bbodytype\b|\bbody type\b/.test(hay) ||
    (/\batmosphere\b/.test(lab) && /type/.test(lab))
  )
    return "body";
  if (
    /\bsemi\s*major\b|semimajor|orbital\s*period|\beccentric|inclination|periapsis|mean\s*anomaly|ascending\b.*node|rotation|axial\b|^\s*radius\b|distance.*arrival/.test(
      hay,
    )
  )
    return "orbit";
  return "traits";
}

function profileBodyTraitCategorical(s: ExomasteryStatDetailDTO): boolean {
  if (s.kind !== "categorical") return false;
  const lab = (s.label ?? "").trim();
  const path = (s.chartPath ?? "").toLowerCase();
  if (/exo\.host|host_star|spectral|star\s*type/.test(path)) return false;
  return /^(planet class|atmosphere(\s+type)?|terraform|volcanism|landable|body type|subtype|scan type)/i.test(
    lab,
  );
}

function journalPresetSectionKey(s: ExomasteryStatDetailDTO): "body" | "surface" | "orbit" | "misc" {
  const p = (s.chartPath ?? "").toLowerCase();
  if (p.startsWith("journal.misc.")) return "misc";
  if (p.startsWith("journal.orbit.")) return "orbit";
  if (p.startsWith("journal.surface.")) return "surface";
  if (p.startsWith("journal.body.")) return "body";
  return "misc";
}

export function NeonDuplexJournalRow({ s }: { s: ExomasteryStatDetailDTO }) {
  return (
    <div
      className="exo-neon-duplex exo-neon-duplex--tier-neutral"
      title={
        s.isMissing
          ? `${s.label}: not in merged journal scan for this body`
          : `${s.label}: ${s.currentDisplay}`
      }
    >
      <span className="species-other-match-mini-title">{s.label}</span>
      <div className="species-other-match-mini-line">
        <span className="species-other-match-mini-legend">DSS / journal</span>
        <strong>{s.isMissing ? "—" : s.currentDisplay}</strong>
      </div>
    </div>
  );
}

export function NeonDuplexHabitatRow({
  s,
  distExpanded = false,
  onToggleTypicalDist,
}: {
  s: ExomasteryStatDetailDTO;
  distExpanded?: boolean;
  onToggleTypicalDist?: () => void;
}) {
  const tier = tierForHabitatStat(s);
  const cap = habitatDeltaCaption(s);
  const hostMk = hostStarProximityRow(s);
  const legendLo = hostMk ? "Cohort mode" : "Typical (mode)";
  const legendHi = hostMk ? "Journal host" : "This body";
  const typicalRaw = (s.typicalDisplay ?? "").trim();
  const typicalCell = typicalRaw && typicalRaw !== "—" ? typicalRaw : "N/A (no feeder / cohort value)";
  const bodyCell = s.isMissing ? "N/A (not in merged scan)" : s.currentDisplay;
  const dist = s.distribution;
  const canOpen = !!dist && typeof onToggleTypicalDist === "function";
  return (
    <div className="exo-neon-duplex-stack">
      <div
        className={`exo-neon-duplex exo-neon-duplex--tier-${tier}`}
        title={`${habitatContextNote(s)}${cap !== "—" ? ` · ${cap}` : ""}`}
      >
        <span className="species-other-match-mini-title">{s.label}</span>
        <div className="species-other-match-mini-line">
          <span className="species-other-match-mini-legend">{legendLo}</span>
          {canOpen ? (
            <button
              type="button"
              className="exo-duplex-typical-mode-hit"
              onClick={onToggleTypicalDist}
              aria-expanded={distExpanded}
              title="Feeder min–max (mode peak); dashed = this body if in range"
            >
              {typicalCell}
            </button>
          ) : (
            <span>{typicalCell}</span>
          )}
        </div>
        <div className="species-other-match-mini-line">
          <span className="species-other-match-mini-legend">{legendHi}</span>
          <strong>{bodyCell}</strong>
        </div>
      </div>
      {distExpanded && dist ? <ExomasteryDistributionPanel label={s.label} distribution={dist} /> : null}
    </div>
  );
}

function CompositionSummaryLine({ g }: { g: ExomasteryCompositionGroupDTO }) {
  const { summary } = g;
  if (summary.overallMatchPercent != null || (summary.best && summary.worst)) {
    return (
      <p className="habitat-comp-summary-lede habitat-comp-summary-lede--atmo tiny dim">
        {summary.overallMatchPercent != null ? (
          <>
            Match vs profile: <strong>{summary.overallMatchPercent}%</strong>
          </>
        ) : null}
        {summary.best && summary.worst ? (
          <>
            {summary.overallMatchPercent != null ? <> · </> : null}
            best <strong>{summary.best.label}</strong> ({summary.best.matchPercent}%)
            <span className="exo-compact-sep" aria-hidden>
              {" "}
              ·{" "}
            </span>
            worst <strong>{summary.worst.label}</strong> ({summary.worst.matchPercent}%)
          </>
        ) : null}
      </p>
    );
  }
  return null;
}

/**
 * Scrollable exomastery duplex sections (climate, composition, traits, host star, categories).
 * Shared by the similarity modal and the encyclopedia “current BODY” panel.
 */
export function ExomasteryHabitatDetailInner({
  detail,
  variant,
  comparisonBodySummary,
  showComparisonBodyLine = true,
}: {
  detail: ExomasteryDetailDTO;
  variant: "profile" | "journal";
  comparisonBodySummary?: string;
  showComparisonBodyLine?: boolean;
}) {
  const [distOpenId, setDistOpenId] = useState<string | null>(null);
  const {
    atmosphereClimateStats,
    crustBlocks,
    atmoGasRows,
    atmoGasSummary,
    bodyTraitNumerics,
    bodyTraitCategorical,
    traitNumerics,
    orbitNumerics,
    miscNumerics,
    hostStarCompareDuplex,
    categoryCategorical,
  } = useMemo(() => {
    if (variant === "journal") {
      const atmo = [...(detail.atmosphereClimateStats ?? [])];
      const climateCore: typeof atmo = [];
      const gases: typeof atmo = [];
      for (const s of atmo) {
        if ((s.chartPath ?? "").includes(".gas.")) gases.push(s);
        else climateCore.push(s);
      }
      const stats = detail.stats ?? [];
      const jBody = stats.filter((s) => journalPresetSectionKey(s) === "body");
      const jSurf = stats.filter((s) => journalPresetSectionKey(s) === "surface");
      const jOrb = stats.filter((s) => journalPresetSectionKey(s) === "orbit");
      const jMisc = stats.filter((s) => journalPresetSectionKey(s) === "misc");
      const crustG = detail.compositionGroups?.find((g) => g.id === "crust");
      const crustBlocks = crustG && crustG.rows.length > 0 ? [crustG] : [];
      return {
        atmosphereClimateStats: climateCore,
        crustBlocks,
        atmoGasRows: gases,
        atmoGasSummary: null,
        bodyTraitNumerics: jBody,
        bodyTraitCategorical: [] as ExomasteryStatDetailDTO[],
        traitNumerics: jSurf,
        orbitNumerics: jOrb,
        miscNumerics: jMisc,
        hostStarCompareDuplex: [] as ExomasteryStatDetailDTO[],
        categoryCategorical: [] as ExomasteryStatDetailDTO[],
      };
    }
    const numericGeneral = detail.stats.filter((x) => x.kind === "numeric");
    const categorical = detail.stats.filter((x) => x.kind === "categorical");
    const bodyTraitNumericsInner: ExomasteryStatDetailDTO[] = [];
    const orbitNumericsInner: ExomasteryStatDetailDTO[] = [];
    const miscNumericsInner: ExomasteryStatDetailDTO[] = [];
    const traitNumericsInner: ExomasteryStatDetailDTO[] = [];
    for (const s of numericGeneral) {
      switch (profileNumericSectionKey(s)) {
        case "body":
          bodyTraitNumericsInner.push(s);
          break;
        case "orbit":
          orbitNumericsInner.push(s);
          break;
        case "misc":
          miscNumericsInner.push(s);
          break;
        default:
          traitNumericsInner.push(s);
      }
    }
    const bodyTraitCategoricalInner = categorical.filter(profileBodyTraitCategorical);
    const categoricalNonBodyTrait = categorical.filter((s) => !profileBodyTraitCategorical(s));
    const hostStarCompareDuplexInner = categoricalNonBodyTrait.filter(hostStarProximityRow).sort((a, b) => {
      const axRank = (x: ExomasteryStatDetailDTO["stellarProximityAxis"]): number =>
        x === "spectral" ? 0 : x === "subclass" ? 1 : x === "luminosity" ? 2 : 9;
      const da = axRank(a.stellarProximityAxis);
      const db = axRank(b.stellarProximityAxis);
      return da !== db
        ? da - db
        : (a.chartPath ?? "").localeCompare(b.chartPath ?? "") || a.label.localeCompare(b.label);
    });
    const categoryCategoricalInner = categoricalNonBodyTrait.filter((s) => !hostStarProximityRow(s));
    const compositionGroups = detail.compositionGroups ?? [];
    const crustG =
      compositionGroups.find((g) => g.id === "crust" && g.rows.length > 0) ??
      compositionGroups.find((g) => g.rows.length > 0 && /crust/i.test(g.title));
    const atmoG = compositionGroups.find((g) => g.id === "atmosphere");
    let crustBlocksOut: typeof compositionGroups = [];
    if (crustG?.rows?.length)
      crustBlocksOut = [
        {
          ...crustG,
          summary: crustG.summary ?? { overallMatchPercent: null, best: null, worst: null },
        },
      ];
    const rawCli = detail.atmosphereClimateStats ?? [];
    const gravLift: ExomasteryStatDetailDTO[] = [];
    const climateSansGrav: ExomasteryStatDetailDTO[] = [];
    for (const s of rawCli) {
      const hay = `${s.chartPath ?? ""} ${s.label}`.toLowerCase();
      if (hay.includes("gravity")) gravLift.push(s);
      else climateSansGrav.push(s);
    }
    return {
      atmosphereClimateStats: climateSansGrav,
      crustBlocks: crustBlocksOut,
      atmoGasRows: atmoG?.rows ?? [],
      atmoGasSummary: atmoG ?? null,
      bodyTraitNumerics: [...gravLift, ...bodyTraitNumericsInner],
      bodyTraitCategorical: bodyTraitCategoricalInner,
      traitNumerics: traitNumericsInner,
      orbitNumerics: orbitNumericsInner,
      miscNumerics: miscNumericsInner,
      hostStarCompareDuplex: hostStarCompareDuplexInner,
      categoryCategorical: categoryCategoricalInner,
    };
  }, [detail, variant]);

  const compositionGroupsFallback = detail.compositionGroups ?? [];
  const crustBlocksResolved =
    variant === "profile" && crustBlocks.length === 0
      ? compositionGroupsFallback.filter((g) => g.id === "crust" && g.rows.length > 0)
      : crustBlocks;

  const hasClimate =
    atmosphereClimateStats.length > 0 ||
    (variant === "profile" ? atmoGasRows.length > 0 : atmoGasRows.length > 0);

  const bodyTraitsCombined = [...bodyTraitNumerics, ...bodyTraitCategorical];

  const HabitatOrJournalRow = ({ s: row }: { s: ExomasteryStatDetailDTO }) =>
    variant === "journal" ? (
      <NeonDuplexJournalRow s={row} />
    ) : (
      <NeonDuplexHabitatRow
        s={row}
        distExpanded={distOpenId === row.id}
        onToggleTypicalDist={
          row.distribution != null ? () => setDistOpenId((id) => (id === row.id ? null : row.id)) : undefined
        }
      />
    );

  return (
    <>
      {showComparisonBodyLine && variant !== "journal" ? (
        <p className="exomastery-habitat-body-line dim tiny">
          Body: <strong className="exomastery-habitat-body-strong">{comparisonBodySummary || "—"}</strong>
        </p>
      ) : null}

      {variant === "journal" ? (
        <p className="exomastery-habitat-body-line dim tiny">
          Journal / DSS merged scan fields for this body (no feeder comparison).
        </p>
      ) : null}

      <div className="encyclopedia-exomastery-scroll">
        <section className="encyclopedia-exomastery-planet">
          {hasClimate ? (
            <>
              <h4 className="exomastery-detail-section-title">Climate &amp; gravity</h4>
              {atmosphereClimateStats.length ? (
                <div className="exo-neon-duplex-fields">
                  {atmosphereClimateStats.map((s) => (
                    <HabitatOrJournalRow key={s.id} s={s} />
                  ))}
                </div>
              ) : null}
              {(variant === "profile" ? atmoGasRows.length > 0 : atmoGasRows.length > 0) ? (
                <>
                  <h5 className="exomastery-subsection-title">Atmosphere composition (gases)</h5>
                  {variant === "profile" && atmoGasSummary ? (
                    <CompositionSummaryLine g={atmoGasSummary} />
                  ) : null}
                  <div className="exo-neon-duplex-fields">
                    {atmoGasRows.map((s) => (
                      <HabitatOrJournalRow key={s.id} s={s} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {crustBlocksResolved.map((g) => {
            const suf = variant === "profile" ? formatCrustHeaderSuffix(g) : null;
            return (
              <div key={g.id}>
                <h4 className="exomastery-detail-section-title exomastery-detail-section-title--crust">
                  {g.title}
                  {suf ? <span className="exomastery-crust-summary-inline tiny dim"> — {suf}</span> : null}
                </h4>
                <div className="exo-neon-duplex-fields">
                  {g.rows.map((s) => (
                    <HabitatOrJournalRow key={s.id} s={s} />
                  ))}
                </div>
              </div>
            );
          })}

          {bodyTraitsCombined.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Body traits</h4>
              <div className="exo-neon-duplex-fields">
                {bodyTraitsCombined.map((s) => (
                  <HabitatOrJournalRow key={s.id} s={s} />
                ))}
              </div>
            </>
          ) : null}

          {traitNumerics.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Surface traits</h4>
              <div className="exo-neon-duplex-fields">
                {traitNumerics.map((s) => (
                  <HabitatOrJournalRow key={s.id} s={s} />
                ))}
              </div>
            </>
          ) : null}

          {orbitNumerics.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Orbit &amp; rotation</h4>
              <div className="exo-neon-duplex-fields">
                {orbitNumerics.map((s) => (
                  <HabitatOrJournalRow key={s.id} s={s} />
                ))}
              </div>
            </>
          ) : null}

          {miscNumerics.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Misc</h4>
              <div className="exo-neon-duplex-fields">
                {miscNumerics.map((s) => (
                  <HabitatOrJournalRow key={s.id} s={s} />
                ))}
              </div>
            </>
          ) : null}

          {hostStarCompareDuplex.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Host star — EDSM cohort vs journal</h4>
              <p className="exomastery-habitat-body-line dim tiny habitat-host-mk-legend">
                Duplex tint: match = blue; +1 green; +2 yellow; +3 orange; +4 or more red (Harvard order,
                subclass digit, Yerkes class).
              </p>
              <div className="exo-neon-duplex-fields exo-neon-duplex-fields--host-mk">
                {hostStarCompareDuplex.map((s) => (
                  <NeonDuplexHabitatRow
                    key={s.id}
                    s={s}
                    distExpanded={distOpenId === s.id}
                    onToggleTypicalDist={
                      s.distribution != null
                        ? () => setDistOpenId((id) => (id === s.id ? null : s.id))
                        : undefined
                    }
                  />
                ))}
              </div>
            </>
          ) : null}

          {categoryCategorical.length > 0 ? (
            <>
              <h4 className="exomastery-detail-section-title">Categories</h4>
              <div className="exo-neon-duplex-fields">
                {categoryCategorical.map((s) => (
                  <NeonDuplexHabitatRow
                    key={s.id}
                    s={s}
                    distExpanded={distOpenId === s.id}
                    onToggleTypicalDist={
                      s.distribution != null
                        ? () => setDistOpenId((id) => (id === s.id ? null : s.id))
                        : undefined
                    }
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
