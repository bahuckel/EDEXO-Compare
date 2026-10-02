/**
 * The body pane: glance bar, planetary facts, sell range, candidate species (7.3).
 */
import { nextTempUnit, usePressUnit, useTempUnit } from "./useUnits";
import { codexFirstTitle, codexMarkTitle } from "./codexMark";
import { ArrivalTrip } from "@shared/systemTriage";
import { fmtCrRangeShort, fmtCrShort } from "./credits";
import { FootfallContext } from "./footfallContext";
import { RowContext, LiveRun } from "./rowContext";
import { settledMultiplier } from "@shared/footfallValue";
import { readableAtmosphereLead } from "@shared/atmosphereLabel";
import { footfallCertainty } from "@shared/footfallValue";
import { useCallback, memo, Suspense, useEffect, useMemo, useState } from "react";
import { ExoPayoutRangePanel, payoutHeadline } from "./ExoPayoutRangePanel";
import { FoldPanel } from "./ui/Fold";
import { SnapshotButton } from "./SnapshotButton";
import type { BodyComputed, PlanetScan, SpeciesMatch } from "@shared/types";
import {
  atmospherePillStyle,
  formatPressurePill,
  formatTemperaturePillLine,
  gravHeatStyle,
  gravityFromScan,
  journalPressureToAtm,
  planetClassPillStyle,
  pressHeatStyle,
  tempHeatStyle,
} from "./planetDisplayUtils";
import { TemperatureLabel } from "./TemperatureLabel";
import { exomasteryDetailHasContent, groupedSortedMatches } from "./speciesMatchHelpers";
import { bodyGenusProgress, genusProgressTag } from "@shared/genusProgress";
import { ExomasteryHabitatMatchModal } from "./SharedModals";
import { candidateSpeciesDenomFromFss, genusHintIsDssOrphan, tripRankLabel } from "./bodyHelpers";
import { EDEXO_CODEX_NEW_ONLY_LS, EDEXO_COMPACT_CANDIDATE_VIEW_LS, readLsBool, writeLsBool } from "./lsPrefs";
import { GenusTag, GlanceGenera, genusRowSpecies, LandableBadge } from "./BodyGlance";
import { ExoPayoutRangeDetailModal } from "./ExoPayoutRangeDetailModal";
import { GenusMatchGroup } from "./GenusMatchGroup";
export { GlanceGenera } from "./BodyGlance";

export const BodyPane = memo(function BodyPane({
  body,
  liveRun,
  trip,
  includeBacteriumInSearch,
  onToggleIncludeBacterium,
}: {
  body: BodyComputed;
  /** The sampling run in progress on this body, for the rows' n/3 progress; null otherwise. */
  liveRun: LiveRun | null;
  /** This body's flight from the arrival star, against the system's other biological bodies (A2). */
  trip?: ArrivalTrip | null;
  includeBacteriumInSearch: boolean;
  onToggleIncludeBacterium: () => void;
}) {
  const [exoPayoutDetailOpen, setExoPayoutDetailOpen] = useState(false);
  const [journalScanModalOpen, setJournalScanModalOpen] = useState(false);
  /**
   * The unlikely tier stays closed until asked for. Nothing is deleted from the candidate list any
   * more — planet class and atmosphere are weighted terms, not walls — so the default view is kept
   * short by hiding the demoted rows rather than by refusing to compute them.
   */
  const [showUnlikely, setShowUnlikely] = useState(false);
  /**
   * Compact is the default now.
   *
   * On a body with 30 candidates the hero layout renders 11,481 DOM elements and 22,288 px of
   * cards; compact renders 2,185 and 8,544 — the same answers in a fifth of the nodes. The toggle
   * is still there, and anyone who has already set it keeps their choice.
   */
  const [compactCandidateView, setCompactCandidateView] = useState(() =>
    readLsBool(EDEXO_COMPACT_CANDIDATE_VIEW_LS, false),
  );
  const [tempUnit, setTempUnit] = useTempUnit();
  const [pressUnit, setPressUnit] = usePressUnit();
  const [bodySummaryCopied, setBodySummaryCopied] = useState(false);
  const s = body.state;
  const sc = body.mergedScan?.PlanetClass?.trim()
    ? body.mergedScan
    : ((s.scan as PlanetScan | null | undefined) ?? null);
  const canOpenJournalScanModal =
    body.bodyScanDetail != null && exomasteryDetailHasContent(body.bodyScanDetail);

  const planetType = sc?.PlanetClass?.trim() || "—";
  const atmoRaw = (sc?.AtmosphereType || sc?.Atmosphere || "").trim();
  const atmosphereDisplay =
    !atmoRaw || atmoRaw.toLowerCase() === "none" ? "No Atmosphere" : readableAtmosphereLead(atmoRaw);

  const { gEarth, label: gravLabel } = gravityFromScan(sc ?? {});

  const tempK =
    sc?.SurfaceTemperature != null && !Number.isNaN(sc.SurfaceTemperature) ? sc.SurfaceTemperature : NaN;
  const est = body.estimatedSurfaceTempK;
  const tempLine = formatTemperaturePillLine(Number.isFinite(tempK) ? tempK : null, est, tempUnit);
  const tempStyleK = Number.isFinite(tempK) ? tempK : (est?.midK ?? NaN);

  const surfPressRaw =
    sc?.SurfacePressure != null && !Number.isNaN(sc.SurfacePressure) ? sc.SurfacePressure : null;
  const pressLabel = formatPressurePill(surfPressRaw, pressUnit);
  const pressAtmForStyle = surfPressRaw != null ? journalPressureToAtm(surfPressRaw) : NaN;

  const arrivalLs =
    sc?.distanceFromArrivalLs != null && Number.isFinite(sc.distanceFromArrivalLs)
      ? sc.distanceFromArrivalLs
      : null;
  const fromArrivalDisplay =
    arrivalLs != null
      ? `${arrivalLs === 0 ? "0" : arrivalLs.toLocaleString(undefined, { maximumFractionDigits: 2 })} Ls`
      : "—";

  const landShort = sc == null ? "No detailed scan" : sc.Landable === true ? "Landable" : "Not landable";

  const bodySummaryOneLine = useMemo(() => {
    const parts = [body.tabLabel, planetType, atmosphereDisplay, landShort, gravLabel, tempLine, pressLabel];
    if (fromArrivalDisplay !== "—") parts.push(`${fromArrivalDisplay} from arrival`);
    return parts.join(" · ");
  }, [
    body.tabLabel,
    planetType,
    atmosphereDisplay,
    landShort,
    gravLabel,
    tempLine,
    pressLabel,
    fromArrivalDisplay,
  ]);

  const copyBodySummary = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(bodySummaryOneLine);
        setBodySummaryCopied(true);
        window.setTimeout(() => setBodySummaryCopied(false), 1500);
      } catch {
        /* ignore */
      }
    })();
  }, [bodySummaryOneLine]);

  /*
    One row per genus with what has been done to it (guild request, 2026-09-24): the glance bar, the
    Exo-signals card and the on-foot list all read these, so the three can never disagree.
  */
  const genusRows = bodyGenusProgress(s.genusHints, s.organicGenusLocks, liveRun);
  // [CODEX] on a genus: one of its candidates here would be a new codex entry for this region.
  const codexGenera = new Map<string, SpeciesMatch>();
  for (const m of body.matches) {
    // A first beats a plain [CODEX] for the genus row.
    if (!m.unlikely && m.codexNew) {
      const k = m.entry.genus.trim().toLowerCase();
      if (!codexGenera.get(k)?.codexFirst) codexGenera.set(k, m);
    }
  }
  const signalCount = s.biologicalSignals;
  const unnamedSignals = signalCount != null ? Math.max(0, signalCount - genusRows.length) : 0;
  const comparisonBodySummary =
    [body.tabLabel, s.starSystem].filter((x) => (x ?? "").trim().length > 0).join(" · ") || "—";

  // Demoted candidates are computed like any other; they are only hidden from the default view.
  /**
   * Show only rows something has actually observed.
   *
   * Off by default, because the candidate list's job is to say what *could* be here — a species with
   * no evidence yet is the normal case across most of the galaxy, not a defect. Turning it on
   * answers a different and equally real question: "what has anyone actually confirmed around here?"
   * Useful when deciding whether a body is worth landing on rather than what to look for once down.
   *
   * It filters on evidence, never on likelihood, so it cannot be confused with the unlikely split
   * below — a demoted row that you personally scanned still passes.
   */
  const [evidenceOnly, setEvidenceOnly] = useState(false);
  /*
    Only what would be a new codex entry (guild tester report, 2026-09-30: "for people who money isn't
    a factor and just want to complete the Codex"). Remembered, like Compact. Filters on the same
    `codexNew` mark the [CODEX] tags come from, and on nothing else.
  */
  const [codexNewOnly, setCodexNewOnlyState] = useState(() => readLsBool(EDEXO_CODEX_NEW_ONLY_LS, false));
  const setCodexNewOnly = (v: boolean) => {
    setCodexNewOnlyState(v);
    writeLsBool(EDEXO_CODEX_NEW_ONLY_LS, v);
  };
  const codexNewCount = useMemo(() => body.matches.filter((m) => m.codexNew === true).length, [body.matches]);
  const hasEvidence = useCallback(
    (m: BodyComputed["matches"][0]) =>
      m.provenance != null && (m.provenance.firstHand || m.provenance.corpusInSystem > 0),
    [],
  );
  const evidenceCount = useMemo(() => body.matches.filter(hasEvidence).length, [body.matches, hasEvidence]);
  const shownMatches = useMemo(
    () =>
      body.matches.filter((m) => (!evidenceOnly || hasEvidence(m)) && (!codexNewOnly || m.codexNew === true)),
    [evidenceOnly, codexNewOnly, body.matches, hasEvidence],
  );
  /*
    A species he has sampled here is listed with the candidates, banner and all.

    The owner, on Bacterium omentum: *"keep the [unlikely] banner after the name. But do not continue
    to hide it in the unlikely list if the user scans it."* The demotion is still true and still
    shown — `m.unlikely` is untouched, so the card keeps its banner and its reasons — but a row he
    has proved is on this body does not belong behind "show unlikely (N)".
  */
  const likelyMatches = useMemo(() => shownMatches.filter((m) => !m.unlikely || m.sampledHere === true), [shownMatches]);
  const unlikelyMatches = useMemo(() => shownMatches.filter((m) => m.unlikely && m.sampledHere !== true), [shownMatches]);
  // Genus order from the co-occurrence solver, most likely first. Ordering only — the probabilities
  // behind it are not calibrated, so nothing here renders a number.
  const genusOrder = useMemo(() => body.genusLikelihoods?.map((l) => l.genus) ?? null, [body.genusLikelihoods]);
  // Grouped once per change, not in the JSX on every render (UI review P3) — the groups are new objects
  // each time, which also made memo(GenusMatchGroup) never skip.
  const likelyGroups = useMemo(() => groupedSortedMatches(likelyMatches, genusOrder), [likelyMatches, genusOrder]);
  const unlikelyGroups = useMemo(() => groupedSortedMatches(unlikelyMatches, genusOrder), [unlikelyMatches, genusOrder]);

  // The body's first-footfall answer, shared with every species card below (WEBUI-REDESIGN 1.2).
  const bodyFootfall = body.exoPayoutRange
    ? footfallCertainty({
        journalWasFootfalled: body.exoPayoutRange.journalWasFootfalled,
        commanderFirstFootfall: body.exoPayoutRange.commanderFirstFootfall,
      })
    : "unknown";

  useEffect(() => {
    writeLsBool(EDEXO_COMPACT_CANDIDATE_VIEW_LS, compactCandidateView);
  }, [compactCandidateView]);

  return (
    <FootfallContext.Provider value={bodyFootfall}>
      <RowContext.Provider value={{ locks: body.state.organicGenusLocks ?? [], live: liveRun }}>
        <div className={`body-pane${compactCandidateView ? " body-pane--rows" : ""}`}>
          {/* The glance bar (WEBUI-REDESIGN 5.1 / 5.2): what you look at on approach, and it stays put while
          the rest scrolls — body, price, candidates vs signals, DSS, distance, footfall. */}
          <div className="glance" role="status">
            <span className="glance-body">{body.tabLabel}</span>
            <span className="glance-sep" aria-hidden="true" />
            {body.exoPayoutRange
              ? (() => {
                  const h = payoutHeadline(body.exoPayoutRange);
                  return (
                    <span className={`glance-price glance-price--${h.certainty}`} title={`${h.tag}`}>
                      {fmtCrRangeShort(h.min, h.max)} <small>CR</small>
                      <span className={`price-tag price-tag--${h.certainty}`}>
                        {h.mult === 5 ? "×5" : h.certainty === "walked" ? "×1" : "×1 ?"}
                      </span>
                    </span>
                  );
                })()
              : null}
            <span className="glance-item">
              {likelyMatches.length} <small>cand</small> / {body.state.biologicalSignals ?? "?"}{" "}
              <small>bio</small>
            </span>
            <span className="glance-item">
              <small>DSS</small> {body.state.dssComplete ? "yes" : "no"}
            </span>
            <GlanceGenera rows={genusRows} />
            {arrivalLs != null ? (
              <span className="glance-item">
                {arrivalLs === 0 ? "0" : arrivalLs.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                <small>ls</small>
              </span>
            ) : null}
          </div>
          <div className="body-pane-left">
            <FoldPanel
              foldKey="body-info"
              className="planetary-info-card"
              title="Planetary body"
              help={
                <>
                  <p>
                    <strong>Facts</strong> come from the journal's detailed scan of this body. Temperature and
                    pressure tiles cycle their units when clicked; matching always uses the journal's Kelvin
                    and pascals.
                  </p>
                  <p>
                    <strong>From arrival</strong> is the journal's DistanceFromArrivalLS, light-seconds from
                    the system's entry point. The rank compares it with the other bodies here that carry
                    biology and a measured distance. Supercruise minutes are not shown: timing that leg in the
                    journals measures honking and deciding as much as flying.
                  </p>
                </>
              }
              defaultOpen
              summary={[planetType, atmosphereDisplay, `${body.state.biologicalSignals ?? "?"} bio`]
                .filter((x) => x && x !== "—")
                .join(" · ")}
              aside={
                <>
                  <LandableBadge scan={sc} />
                  <button
                    type="button"
                    className="planetary-info-copy-summary"
                    onClick={copyBodySummary}
                    title={bodySummaryCopied ? "Copied" : "Copy one-line body summary"}
                  >
                    {bodySummaryCopied ? "Copied" : "Copy"}
                  </button>
                </>
              }
            >
              <div className="facts">
                <div
                  className="fact"
                  style={planetType !== "—" ? planetClassPillStyle(planetType) : undefined}
                >
                  <span className="fact-k">Type</span>
                  <span className="fact-v">{planetType}</span>
                </div>
                <div className="fact" style={atmospherePillStyle(atmoRaw || atmosphereDisplay)}>
                  <span className="fact-k">Atmosphere</span>
                  <span className="fact-v" title={atmosphereDisplay}>
                    {atmosphereDisplay}
                  </span>
                </div>
                <div className="fact" style={Number.isFinite(gEarth) ? gravHeatStyle(gEarth) : undefined}>
                  <span className="fact-k">Gravity</span>
                  <span className="fact-v">{gravLabel}</span>
                </div>
                <button
                  type="button"
                  className="fact fact--click"
                  style={Number.isFinite(tempStyleK) ? tempHeatStyle(tempStyleK) : undefined}
                  onClick={() => setTempUnit(nextTempUnit)}
                  title="Cycles Kelvin → Celsius → Fahrenheit (display only; matching still uses journal Kelvin)"
                >
                  <span className="fact-k">Temperature</span>
                  <span className="fact-v">
                    <TemperatureLabel journalK={Number.isFinite(tempK) ? tempK : null} est={est} unit={tempUnit} />
                  </span>
                </button>
                <button
                  type="button"
                  className="fact fact--click"
                  style={Number.isFinite(pressAtmForStyle) ? pressHeatStyle(pressAtmForStyle) : undefined}
                  onClick={() => setPressUnit((u) => (u === "atm" ? "pa" : "atm"))}
                  title="Toggle display: standard atmospheres vs raw journal pascals (values below ~40 journal units are treated as atm already)"
                >
                  <span className="fact-k">Pressure</span>
                  <span className="fact-v">{pressLabel}</span>
                </button>
                {/*
            A2 — what replaced "Worth the trip?". That panel ranked bodies by expected credits per
            on-site minute; the owner's verdict was that it was not implemented as intended, and
            the flight is what actually decides whether to go. The journals cannot time a
            supercruise leg (see ON_SITE_ONLY), so the honest form is the distance the game states
            plus where this body sits among the others in the system worth landing on.
          */}
                <div
                  className="fact"
                  title={
                    arrivalLs == null
                      ? "Needs a detailed scan of this body."
                      : trip && trip.rank != null && trip.ranked > 1
                        ? `Light-seconds from the arrival point; ${tripRankLabel(trip.rank)} of ${trip.ranked} bio bodies here.`
                        : "Light-seconds from the arrival point."
                  }
                >
                  <span className="fact-k">From arrival</span>
                  <span className="fact-v">
                    {fromArrivalDisplay}
                    {trip && trip.rank != null && trip.ranked > 1 ? (
                      <small>
                        {" "}
                        · {tripRankLabel(trip.rank)} of {trip.ranked}
                      </small>
                    ) : null}
                  </span>
                </div>
              </div>

              {body.ambiguityNote ? <p className="warn tiny">{body.ambiguityNote}</p> : null}
              {/*
          The weak case, said out loud.

          An auto scan describes a body completely and reports no organics at all: the game shows a
          signal count on screen, the journal never writes one, and only an FSS or a DSS puts it in a
          file. So this list is what the conditions suit, not what is known to be there — and without
          the notice a commander cannot tell it apart from a list backed by a real count.
        */}
              {body.exoMarkerBasis === "conditions" ? (
                <p className="warn tiny exo-conditions-only">
                  Auto scan only — the journal has no organic count for this body. These are the species its
                  conditions suit; run an FSS or a DSS to learn whether anything is actually here.
                </p>
              ) : null}
            </FoldPanel>

            {/*
              Sell range and Exo-signals stack in one column beside the planet card, and the two
              columns end on the same line whatever is in them (owner, 2026-09-25: "cards same
              length, dynamically changing based on contents"). See bridge.css.
            */}
            <div className="dossier-side">
              {body.exoPayoutRange ? (
                <>
                  <FoldPanel
                    foldKey="sell-range"
                    className="exo-payout-collapsible card-neon"
                    title="Organic sell range"
                    help={
                      <>
                        <p>
                          <strong>One price, the right one.</strong> First footfall on a body pays five times
                          the list price for every species there. When your journal shows the footfall is
                          still open you see the ×5 figures; when the body has been walked, ×1; when it is
                          unknown, ×1 with the ×5 as a second line.
                        </p>
                        <p>
                          <strong>The band</strong> takes k = min(bio signals, priced candidates) and shows
                          the k cheapest against the k priciest distinct list prices. The detail view (click
                          the price) has the per-species table.
                        </p>
                        <p>
                          <strong>Bio signals</strong> is the FSS or DSS count from the journal, falling back
                          to the DSS genus list length. <strong>Candidates</strong> counts species after the
                          same gates as the candidate list; only rows with a strict price-list match are
                          priced. Fewer candidates than signals means a gate is too narrow: try Include
                          Bacterium or narrow with a DSS or an on-foot confirmation.
                        </p>
                      </>
                    }
                    summary={(() => {
                      const h = payoutHeadline(body.exoPayoutRange);
                      return `${fmtCrRangeShort(h.min, h.max)} CR · ${h.tag}`;
                    })()}
                  >
                    <button
                      type="button"
                      className="exo-payout-range-panel exo-payout-range-panel--clickable exo-payout-inner-click"
                      onClick={() => setExoPayoutDetailOpen(true)}
                    >
                      <ExoPayoutRangePanel pr={body.exoPayoutRange} variant="main" />
                    </button>
                  </FoldPanel>
                  {exoPayoutDetailOpen ? (
                    <ExoPayoutRangeDetailModal
                      pr={body.exoPayoutRange}
                      bodyTabLabel={body.tabLabel}
                      includeBacteriumInSearch={includeBacteriumInSearch}
                      onClose={() => setExoPayoutDetailOpen(false)}
                    />
                  ) : null}
                </>
              ) : null}

              {/*
              Exo-signals, on its own (guild request, 2026-09-24): one row per genus with what has been
              done to it, so "what is left to scan here" is a glance, not a read through the candidate
              cards. Replaces the one-line strip that used to sit in the planetary card.
            */}
              {genusRows.length > 0 || (signalCount ?? 0) > 0 ? (
                <FoldPanel
                  foldKey="exo-signals"
                  className="exo-signals-card"
                  title="Exo-signals"
                  help={
                    <>
                      <p>
                        <strong>One row per genus.</strong> The count is the FSS signal count; the game places
                        one genus per signal and never repeats a genus on a body. The genus names arrive with
                        a DSS.
                      </p>
                      <p>
                        <strong>Tags</strong> — none: the DSS named it and nothing is scanned yet.{" "}
                        <em>[CS]</em>: the ship's composition scanner named the species. <em>[SEEN]</em>:
                        sampled on foot but never analysed, and not the plant you are sampling now.{" "}
                        <em>[1/3]</em>–<em>[3/3]</em>: the samples taken, live while you sample and kept once
                        analysed.
                      </p>
                      <p>
                        A <em>(!)</em> after a genus means the DSS reported it but no candidate species uses
                        that genus under the current scan and filters.
                      </p>
                    </>
                  }
                  defaultOpen
                  summary={
                    <>
                      {signalCount != null ? `${signalCount} bio` : "? bio"}
                      {genusRows.length > 0
                        ? ` · ${genusRows.map((r) => `${r.genus}${genusProgressTag(r) ? ` ${genusProgressTag(r)}` : ""}`).join(", ")}`
                        : ""}
                    </>
                  }
                  tools={<SnapshotButton what="exo-signals" />}
                  aside={
                    <button
                      type="button"
                      className={`facts-dss${s.dssComplete ? " facts-dss--yes" : " facts-dss--no"}`}
                      disabled={!canOpenJournalScanModal}
                      title={
                        canOpenJournalScanModal
                          ? "Open merged journal / DSS breakdown for this body (same layout as similarity index)"
                          : "Need merged detailed scan rows in loaded journals for breakdown"
                      }
                      onClick={() => {
                        if (canOpenJournalScanModal) setJournalScanModalOpen(true);
                      }}
                    >
                      DSS {s.dssComplete ? "✓" : "✗"}
                    </button>
                  }
                >
                  <div className="genus-progress" role="table" aria-label="Genera on this body">
                    {genusRows.map((r) => (
                      <div
                        key={r.genus}
                        className={`genus-progress-row genus-progress-row--${r.status}`}
                        role="row"
                      >
                        <span className="genus-progress-genus" role="cell">
                          {r.genus}
                          {r.hint && genusHintIsDssOrphan(r.hint, body.dssGenusOrphanHints) ? (
                            <span
                              className="dss-genus-orphan-mark"
                              title="DSS lists this genus, but no candidate row matches it — check filters, bacterium toggle, or codex gates."
                            >
                              (!)
                            </span>
                          ) : null}
                        </span>
                        <span className="genus-progress-species" role="cell">
                          {genusRowSpecies(r) || <span className="genus-progress-none">not scanned</span>}
                        </span>
                        <span className="genus-progress-tag" role="cell">
                          <GenusTag row={r} />
                          {codexGenera.has(r.genus.trim().toLowerCase()) ? (
                            codexGenera.get(r.genus.trim().toLowerCase())!.codexFirst ? (
                              <span
                                className="genus-tag genus-tag--codex genus-tag--codex-first"
                                title={codexFirstTitle(codexGenera.get(r.genus.trim().toLowerCase())!)}
                              >
                                [CODEX FIRST]
                              </span>
                            ) : (
                              <span
                                className="genus-tag genus-tag--codex"
                                title={codexMarkTitle(codexGenera.get(r.genus.trim().toLowerCase())!)}
                              >
                                [CODEX]
                              </span>
                            )
                          ) : null}
                        </span>
                      </div>
                    ))}
                    {unnamedSignals > 0 ? (
                      <div className="genus-progress-row genus-progress-row--unnamed" role="row">
                        <span className="genus-progress-genus" role="cell">
                          {unnamedSignals === 1 ? "1 more signal" : `${unnamedSignals} more signals`}
                        </span>
                        <span className="genus-progress-species" role="cell">
                          <span className="genus-progress-none">genus named after a DSS</span>
                        </span>
                        <span className="genus-progress-tag" role="cell" />
                      </div>
                    ) : null}
                  </div>
                </FoldPanel>
              ) : null}
            </div>
          </div>
          <div className="body-pane-right">
            <FoldPanel
              foldKey="candidates"
              className="panel--candidate-species"
              help={
                <>
                  <p>
                    <strong>Chance here</strong> is the one calibrated probability on a row: how likely this
                    species is one of the ones actually on this body. <strong>Fit</strong> is a similarity
                    score against the bodies the species was found on in the feeder corpus; it is not a
                    probability. <strong>Gap</strong> is the minimum distance between the three samples of
                    that genus.
                  </p>
                  <p>
                    <strong>Compact</strong> shows one row per species; click a row for its full card.{" "}
                    <strong>Bacterium</strong> is off by default because it is low value on most routes; off
                    means off, even for a bacterium the catalog remembers from a similar body.{" "}
                    <strong>Evidence</strong> keeps only rows something has actually observed: scanned by you
                    on this body, or confirmed in this system by Spansh. It filters on evidence, not on
                    likelihood. <strong>Codex new</strong> keeps only species that would be a new entry in
                    your codex (the ones tagged [CODEX]).
                  </p>
                  <p>
                    <strong>Unlikely</strong> rows disagree with this body on one criterion: planet class,
                    atmosphere, or a value just outside its band. Codex lists are not walls; the planet-class
                    list alone rejects 4.1 % of the bodies where a species was really found.
                  </p>
                  {/* Behind the [?] rather than above the list (owner, 2026-09-25). */}
                  {body.approximateMatchingUsed ? (
                    <p>
                      <strong>On this body:</strong> the list includes a species confirmed on foot that the
                      codex gates would have excluded.
                    </p>
                  ) : null}
                </>
              }
              title={`Candidate species (${likelyMatches.length}/${candidateSpeciesDenomFromFss(s)})`}
              summary={(() => {
                const mult = settledMultiplier(bodyFootfall) ?? 1;
                const best = likelyMatches.reduce((b, m) => Math.max(b, m.priceCredits ?? 0), 0) * mult;
                return `${likelyMatches.length} candidate${likelyMatches.length === 1 ? "" : "s"}${best > 0 ? ` · best ${fmtCrShort(best)} CR${mult === 5 ? " ×5" : ""}` : ""}`;
              })()}
              aside={
                <div className="candidate-species-toggles">
                  <SnapshotButton what="candidates" />
                  <button
                    type="button"
                    className={`candidate-species-compact-toggle btn-top-toggle${compactCandidateView ? " btn-top-toggle--on" : ""}`}
                    onClick={() => setCompactCandidateView((v) => !v)}
                    title="Compact rows; click a row for its full card."
                  >
                    {compactCandidateView ? "Compact ✓" : "Compact ✗"}
                  </button>
                  <button
                    type="button"
                    className={`candidate-species-bacterium-toggle btn-top-toggle${includeBacteriumInSearch ? " btn-top-toggle--on" : ""}`}
                    onClick={onToggleIncludeBacterium}
                    title="Include bacterium species (off by default: low value)."
                  >
                    {includeBacteriumInSearch ? "Bacterium ✓" : "Bacterium ✗"}
                  </button>
                  <button
                    type="button"
                    className={`candidate-species-evidence-toggle btn-top-toggle${evidenceOnly ? " btn-top-toggle--on" : ""}`}
                    onClick={() => setEvidenceOnly((v) => !v)}
                    disabled={evidenceCount === 0 && !evidenceOnly}
                    title={
                      evidenceCount === 0
                        ? "Nothing confirmed here yet — every row is a prediction."
                        : `Only the ${evidenceCount} row${evidenceCount === 1 ? "" : "s"} confirmed by you or by Spansh.`
                    }
                  >
                    {evidenceOnly ? `Evidence ✓ (${evidenceCount})` : "Evidence ✗"}
                  </button>
                  <button
                    type="button"
                    className={`candidate-species-codex-toggle btn-top-toggle${codexNewOnly ? " btn-top-toggle--on" : ""}`}
                    onClick={() => setCodexNewOnly(!codexNewOnly)}
                    disabled={codexNewCount === 0 && !codexNewOnly}
                    title={
                      codexNewCount === 0
                        ? "No candidate here would be a new codex entry for you (or your codex log is not known yet)."
                        : `Only the ${codexNewCount} species that would be new in your codex here.`
                    }
                  >
                    {codexNewOnly ? `Codex new ✓ (${codexNewCount})` : "Codex new ✗"}
                  </button>
                </div>
              }
            >
              {body.matches.length === 0 ? (
                <p className="dim">
                  No matches — adjust per-species rows in your genus JSON under data/species/, or get journal
                  scan fields that satisfy those gates.
                </p>
              ) : (
                <>
                  {likelyMatches.length === 0 ? (
                    <p className="dim tiny">
                      Nothing clears every criterion on this body — the {unlikelyMatches.length} candidate(s)
                      below each disagree on one term.
                    </p>
                  ) : (
                    <div className="species-list">
                      {likelyGroups.map((group) => (
                        <GenusMatchGroup
                          key={group.groupKey}
                          group={group}
                          scan={sc}
                          estimatedSurfaceTempK={body.estimatedSurfaceTempK}
                          comparisonBodySummary={comparisonBodySummary}
                          hostStarType={
                            body.speciesMatchContext?.colourStarType ??
                            body.speciesMatchContext?.parentStarType
                          }
                          hostStarTypes={body.speciesMatchContext?.hostStarClasses}
                          compactCandidateView={compactCandidateView}
                          genusConfirmed={body.genusFilterActive}
                        />
                      ))}
                    </div>
                  )}
                  {unlikelyMatches.length > 0 ? (
                    <div className="candidate-species-unlikely">
                      <button
                        type="button"
                        className={`candidate-species-unlikely-toggle${showUnlikely ? " candidate-species-unlikely-toggle--on" : ""}`}
                        onClick={() => setShowUnlikely((v) => !v)}
                        title="One criterion off — unlikely, not impossible."
                      >
                        {showUnlikely ? "▾" : "▸"} {showUnlikely ? "Hide" : "Show"} unlikely (
                        {unlikelyMatches.length})
                      </button>
                      {showUnlikely ? (
                        <>
                          <p className="candidate-species-unlikely-note dim tiny">
                            Each of these disagrees on one criterion, shown on the card. Codex lists are not
                            walls: the planet-class list alone rejects 4.1% of the bodies where a species was
                            really found.
                          </p>
                          <div className="species-list species-list--unlikely">
                            {unlikelyGroups.map((group) => (
                              <GenusMatchGroup
                                key={`unlikely-${group.groupKey}`}
                                group={group}
                                scan={sc}
                                estimatedSurfaceTempK={body.estimatedSurfaceTempK}
                                comparisonBodySummary={comparisonBodySummary}
                                hostStarType={
                                  body.speciesMatchContext?.colourStarType ??
                                  body.speciesMatchContext?.parentStarType
                                }
                                hostStarTypes={body.speciesMatchContext?.hostStarClasses}
                                compactCandidateView={compactCandidateView}
                              />
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </FoldPanel>
          </div>

          {journalScanModalOpen &&
          body.bodyScanDetail != null &&
          exomasteryDetailHasContent(body.bodyScanDetail) ? (
            <Suspense fallback={null}>
              <ExomasteryHabitatMatchModal
                variant="journal"
                detail={body.bodyScanDetail}
                varietyHints={null}
                exportBasename={null}
                genusDataDir=""
                comparisonBodySummary={comparisonBodySummary}
                onClose={() => setJournalScanModalOpen(false)}
                title={`Scan detail · ${body.tabLabel}`}
              />
            </Suspense>
          ) : null}
        </div>
      </RowContext.Provider>
    </FootfallContext.Provider>
  );
});
