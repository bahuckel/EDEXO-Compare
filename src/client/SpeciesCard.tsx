/**
 * The full species card and its sub-blocks, split out of App.tsx (7.3).
 */
import { achievementMarkTitle, codexFirstTitle, codexMarkTitle } from "./codexMark";
import { STREAMER_MODE } from "./streamerMode";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { fmtCrExact, fmtCrShort } from "@shared/format";
import { useModal } from "./ui/useModal";
import { useFootfallCertainty } from "./footfallContext";
import { settledMultiplier } from "@shared/footfallValue";
import { PhotoCredit, isPlaceholderPhoto, photoCreditTitle } from "./photoCredit";
import { PhotoGallery } from "./PhotoGallery";
import { matchHasDetail, matchOtherCardCount, useMatchDetail } from "./useMatchDetail";
import { WhyChanceStrip } from "./WhyChanceStrip";
import { useToast } from "./ui/feedback";
import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  BodyComputed,
  EstimatedSurfaceTempBand,
  OtherMatchDetailCardDTO,
  PlanetScan,
} from "@shared/types";
import {
  candidateMorphColorShortLabel,
  candidateMorphColorShortLabelForHosts,
} from "@shared/candidateSpawnHints";
import { createPortal } from "react-dom";
import { pillLabelStyle } from "./planetDisplayUtils";
import {
  EXO_PRESENCE_HELP,
  EXO_CODEX_VS_EXO_PROFILE_HELP,
  footCatalogBadgeText,
  labelForReasonField,
  primaryMatchQuad,
  predictedColourCause,
  speciesCaptionParts,
  speciesMatchExtraReasons,
  titleCaseSpeciesWords,
  variantPhotoUrlFor,
} from "./speciesMatchHelpers";
import { ExomasteryHabitatMatchModal, ModalLoading } from "./SharedModals";
import {
  EMPTY_REASONS,
  GenusSpeciesOdds,
  OtherMatchDetailCardsGrid,
  SpeciesProvenanceBadge,
} from "./SpeciesCardBits";
import { nextTempUnit, useTempUnit } from "./useUnits";
import { RarityGem } from "./RarityGem";
import { Tooltip } from "./ui/Tooltip";
import {
  FootScanMatchCard,
  SpeciesStarColourSoftBadge,
  SpeciesExomasterySimilarityContent,
} from "./SpeciesCardParts";
export { ExoMissLogPanel } from "./ExoMissLogPanel";

export const SpeciesCard = memo(function SpeciesCard({
  m,
  scan,
  estimatedSurfaceTempK,
  comparisonBodySummary,
  hostStarType,
  hostStarTypes,
  compactCandidateView,
  genusOdds = null,
}: {
  m: BodyComputed["matches"][0];
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  comparisonBodySummary: string;
  hostStarType?: string;
  /** Every star that could be the host, when the body orbits a barycentre rather than one star. */
  hostStarTypes?: string[];
  compactCandidateView?: boolean;
  /** The genus's species split, shown under the chance bar when the genus has several candidates. */
  genusOdds?: { items: BodyComputed["matches"]; confirmed: boolean } | null;
}) {
  const e = m.entry;
  /*
    The value a card shows is the value this plant pays *here* (WEBUI-REDESIGN 1.2): ×5 when the
    body's first footfall is still open, ×1 when somebody has walked it, ×1 with the ×5 one hover
    away when the journal has not said. The body pane provides the answer.
  */
  const footfall = useFootfallCertainty();
  const priceMult: 1 | 5 = settledMultiplier(footfall) ?? 1;
  const priceTag = footfall === "unwalked" ? "×5" : footfall === "walked" ? "×1" : "×1 ?";
  const priceTitle =
    m.priceCredits == null
      ? ""
      : footfall === "unwalked"
        ? `${fmtCrExact(m.priceCredits * 5)} — first footfall ×5 (list ${fmtCrExact(m.priceCredits)})`
        : footfall === "walked"
          ? `${fmtCrExact(m.priceCredits)} — list price; this body has been walked, the ×5 is gone`
          : `${fmtCrExact(m.priceCredits)} list; ${fmtCrExact(m.priceCredits * 5)} if you take first footfall here (unknown yet)`;
  const [tempUnit, setTempUnit] = useTempUnit();
  const quadCells = useMemo(() => {
    const base = primaryMatchQuad(m, scan, estimatedSurfaceTempK, tempUnit);
    const exo = m.exomasteryProfilePresent && matchHasDetail(m);
    return base.map((c) => (exo && c.key !== "SurfaceTemperature" ? { ...c, openExomasteryModal: true } : c));
  }, [m, scan, estimatedSurfaceTempK, tempUnit]);
  const extras = useMemo(() => speciesMatchExtraReasons(m), [m]);
  const [exoDetailOpen, setExoDetailOpen] = useState(false);
  // Open from the start in streamer mode, where nobody can click it open (owner, 2026-10-03).
  const [otherDetailsOpen, setOtherDetailsOpen] = useState(STREAMER_MODE);
  const [otherMatchModalOpen, setOtherMatchModalOpen] = useState(false);
  // Fetched on first open of the modal or the drawer (UI review P1b); see useMatchDetail.
  /* "Why this chance" (owner, 2026-10-04): the strip under the chance, fetched when opened. */
  const [whyOpen, setWhyOpen] = useState(false);
  const lazyDetail = useMatchDetail(m, exoDetailOpen || otherDetailsOpen || otherMatchModalOpen || whyOpen);
  const lazyCards = lazyDetail.data?.otherCards;
  const otherDetailCards = useMemo((): OtherMatchDetailCardDTO[] => {
    const xs = lazyCards ?? [];
    const fromReasons: OtherMatchDetailCardDTO[] = extras.map((r, i) => ({
      id: `reas-${r.field}-${i}`,
      priority: 920 + i,
      shortTitle: labelForReasonField(r.field),
      topLegend: "Context",
      topValue: r.field === "Source" ? "Import" : "Gate",
      bottomLegend: r.field === "Source" ? "Path or note" : "Reading",
      bottomValue: r.detail?.trim() ? r.detail.trim() : "—",
      tooltip:
        r.field === "Source"
          ? `Source metadata: ${r.detail?.trim() ?? "—"}`
          : `${labelForReasonField(r.field)} — ${r.detail?.trim() ?? "—"}`,
      highlight: "neutral",
    }));
    return [...xs, ...fromReasons].sort(
      (a, b) => a.priority - b.priority || a.shortTitle.localeCompare(b.shortTitle),
    );
  }, [lazyCards, extras]);

  /*
   * The body's own materials decide the colour for material-driven species, and the card already
   * has the scan. Passing it is the whole fix for "Bacterium Vesicula (unknown)" on a body whose
   * only colour-driving material was yttrium.
   */
  const morphColorRaw = useMemo(
    () =>
      // What was actually logged here beats any prediction (bug report 2026-09-26).
      m.confirmedColour ??
      m.predictedColour ??
      (hostStarType
        ? candidateMorphColorShortLabel(e, hostStarType, scan?.materials)
        : candidateMorphColorShortLabelForHosts(e, hostStarTypes, scan?.materials)),
    [m.confirmedColour, m.predictedColour, e, hostStarType, hostStarTypes, scan?.materials],
  );
  const morphColorDisplay =
    morphColorRaw === "(unknown)" ? morphColorRaw : titleCaseSpeciesWords(morphColorRaw);
  const colourCause = useMemo(
    () => predictedColourCause(m, hostStarType, hostStarTypes, scan?.materials),
    [m, hostStarType, hostStarTypes, scan?.materials],
  );

  /**
   * The photograph of the variant this body will actually grow, when somebody has taken it.
   *
   * The rule itself lives in `speciesMatchHelpers` so the rows view can apply the same one — it was
   * inline here, which is how a row came to print "Cactoida Peperatis - Amethyst" beside a
   * photograph of the Teal one.
   */
  const variantPhotoUrl = useMemo(() => variantPhotoUrlFor(m, morphColorRaw), [m, morphColorRaw]);
  const heroPhotoUrl = variantPhotoUrl ?? m.photoUrl;
  /**
   * Every photo of this species, the one you are going to see first.
   *
   * `photoUrls` is optional on the wire so a payload written before galleries existed still parses;
   * a single-photo species is then `[photoUrl]`, which every consumer here can treat identically.
   */
  const galleryUrls = useMemo(() => {
    const all = m.photoUrls?.length ? m.photoUrls : [m.photoUrl];
    if (!variantPhotoUrl) return all;
    // The variant leads, and the rest keep their order behind it.
    return [variantPhotoUrl, ...all.filter((u) => u !== variantPhotoUrl)];
  }, [m.photoUrls, m.photoUrl, variantPhotoUrl]);
  /**
   * What each photograph is of, for the label over the open image.
   *
   * Built from `photoVariants`, which is the only thing that knows a file's colour — the URL is a
   * filename and reading a colour out of it here would duplicate a rule that already lives on the
   * server. A photograph with no variant row gets no label rather than a guessed one.
   */
  const galleryVariantLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of m.photoVariants ?? []) {
      if (v.url && v.colour) out[v.url] = `${m.entry.displayName} — ${v.colour}`;
    }
    return out;
  }, [m.photoVariants, m.entry.displayName]);
  /**
   * Card artwork comes from the generated 1024 px WebP (~51 KB) rather than the original (~600 KB
   * average, up to 2.8 MB); the lightbox still opens the full-size file.
   */
  const heroSrc = speciesPhotoVariant(heroPhotoUrl, "card");
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!lazyDetail.error) return;
    toast.error(lazyDetail.error);
    setExoDetailOpen(false);
    setOtherDetailsOpen(false);
    setOtherMatchModalOpen(false);
  }, [lazyDetail.error, toast]);
  const otherDetailsFocusRef = useRef<HTMLDivElement>(null);

  const otherMatchBlock = matchOtherCardCount(m) > 0 || otherDetailCards.length > 0;
  const compact = compactCandidateView === true;

  useEffect(() => {
    if (!compact) setOtherMatchModalOpen(false);
  }, [compact]);

  const otherMatchDialogRef = useModal<HTMLDivElement>(otherMatchModalOpen && compact, () =>
    setOtherMatchModalOpen(false),
  );

  useEffect(() => {
    if (!otherDetailsOpen) return;
    const id = window.requestAnimationFrame(() => {
      otherDetailsFocusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [otherDetailsOpen]);


  const { genusShow, epithet } = speciesCaptionParts(e.genus, e.displayName);
  const genusDisplay = genusShow ? titleCaseSpeciesWords(genusShow) : "";
  const epithetDisplay = titleCaseSpeciesWords(epithet);
  const identityNote = useMemo(() => {
    const notesPart = (e.notes ?? "").trim();
    const descPart = (e.description ?? "").trim();
    const minD = e.genusMinSampleDistanceM;
    const distPrefix = minD != null && minD > 0 ? `Distance between scans: ${minD.toLocaleString()} m` : "";
    const descBlock = distPrefix && descPart ? `${distPrefix} — ${descPart}` : distPrefix || descPart;
    return [notesPart, descBlock].filter(Boolean).join("\n\n");
  }, [e.notes, e.description, e.genusMinSampleDistanceM]);
  const showFootfallBadge = m.learnedFromFootScan === true || m.footScanMatch != null;
  /**
   * A demoted candidate has to say what demoted it. A low-probability row with no reason attached is
   * just noise the reader has to take on trust; with the term named, they can judge it themselves —
   * "codex lists Rocky body, this is High metal content" is a claim about our data, not about the
   * planet.
   */
  const demotedBy = m.unlikelyReasons ?? EMPTY_REASONS;
  const demotedFields = [...new Set(demotedBy.map((r) => labelForReasonField(r.field)))];

  const thumbBtn = (
    <button
      type="button"
      className={
        compact ? "species-thumb-btn species-thumb-btn--compact" : "species-thumb-btn species-thumb-btn--hero"
      }
      onClick={() => setPhotoLightbox(true)}
      aria-label="Enlarge species photo"
      // The compact card has no room for a caption, so the credit rides on the hover here and is
      // shown in full once the photo is opened.
      title={[
        galleryUrls.length > 1 ? `${galleryUrls.length} photos — click to browse` : null,
        photoCreditTitle(heroPhotoUrl, m.photoCreditByUrl?.[heroPhotoUrl]),
      ]
        .filter(Boolean)
        .join(" — ")}
    >
      <img
        src={heroSrc}
        alt=""
        className={compact ? "species-img species-img--compact" : "species-img species-img--hero"}
        onError={(ev) => {
          const el = ev.target as HTMLImageElement;
          el.style.display = "none";
          const ph = el.nextElementSibling;
          if (ph && ph.classList.contains("species-img-ph-fallback"))
            (ph as HTMLElement).style.display = "flex";
        }}
      />
      <div className="species-img-ph species-img-ph-fallback" style={{ display: "none" }}>
        Image failed to load
      </div>
    </button>
  );

  /**
   * Payout, given its own block under the compact thumbnail.
   *
   * Fixing the thumbnail to the source 16:9 ratio left ~186 px of empty column beside every card.
   * The single number that answers "is this worth landing for?" was a run of inline text at the
   * end of the identity line; here it is the second thing on the card.
   */
  const compactPayout = (
    <div className={`species-compact-payout species-compact-payout--${footfall}`}>
      <span className="species-compact-payout-label">Value here</span>
      <span className="species-compact-payout-amount" title={priceTitle}>
        {m.priceCredits != null ? `${fmtCrShort(m.priceCredits * priceMult)} CR` : "—"}
        {m.priceCredits != null ? (
          <span className={`price-tag price-tag--${footfall}`}>{priceTag}</span>
        ) : null}
      </span>
      {m.priceCredits != null && footfall === "unknown" ? (
        <span className="species-compact-payout-alt">
          if first footfall: {fmtCrShort(m.priceCredits * 5)} CR
        </span>
      ) : null}
      {m.organicAnalysisComplete ? (
        <span
          className="species-compact-payout-done"
          title="Journal shows a completed exobiology line for this species on this body."
        >
          ✓ Analysed
        </span>
      ) : null}
      {/* Named by the composition scanner, never sampled on foot — so the value here is unclaimed. */}
      {/* Who logged it here (owner, 2026-09-25): you, from your journal, or other commanders via Spansh. */}
      {m.loggedBy === "others" ? (
        <span
          className="species-compact-payout-done species-compact-payout-done--others"
          title="Logged on this body by other commanders (Spansh). Not from your journal."
        >
          Logged by other commanders
        </span>
      ) : m.loggedBy === "you" ? (
        <span
          className="species-compact-payout-done species-compact-payout-done--you"
          title="Logged on this body in your own journal: a foot scan or the composition scanner."
        >
          Logged by you
        </span>
      ) : null}
      {m.confirmedByCompositionScan ? (
        <span
          className="species-compact-payout-done species-compact-payout-done--compscan"
          title="Confirmed here by the composition scanner. It grows on this body; you have not sampled it."
        >
          [Comp Scan]
        </span>
      ) : null}
    </div>
  );

  const quadGrid = (
    <div
      className={`species-quad-grid${compact ? " species-quad-grid--compact" : ""}`}
      aria-label="Planet attributes that matched this species"
    >
      {quadCells.map((cell) => {
        const inner = (
          <>
            <span className="species-quad-label" style={pillLabelStyle}>
              {cell.label}:
            </span>
            <span className="species-quad-value">{cell.value}</span>
          </>
        );
        if (cell.key === "SurfaceTemperature") {
          return (
            <button
              key={cell.key}
              type="button"
              className="species-quad-cell species-quad-cell--click"
              style={cell.pillStyle}
              title={cell.pillTitle}
              onClick={() => setTempUnit(nextTempUnit)}
            >
              {inner}
            </button>
          );
        }
        if (cell.openExomasteryModal) {
          return (
            <button
              key={cell.key}
              type="button"
              className="species-quad-cell species-quad-cell--click"
              style={cell.pillStyle}
              title="Open exomastery habitat match (feeder sample vs this planet)"
              onClick={() => setExoDetailOpen(true)}
            >
              {inner}
            </button>
          );
        }
        return (
          <div key={cell.key} className="species-quad-cell" style={cell.pillStyle}>
            {inner}
          </div>
        );
      })}
      {compact && otherMatchBlock ? (
        <button
          type="button"
          className="species-quad-cell species-quad-cell--click species-quad-cell--other-match"
          onClick={() => setOtherMatchModalOpen(true)}
          title="Open feeder vs body comparison chips"
        >
          <span className="species-quad-label" style={pillLabelStyle}>
            Other matching details
          </span>
          <span className="species-quad-value">
            {showFootfallBadge ? (
              <>
                <span className="species-quad-footfall-tag">FOOTFALL</span>
                <span className="species-quad-footfall-sep"> · </span>
              </>
            ) : null}
            Open
          </span>
        </button>
      ) : null}
      <SpeciesStarColourSoftBadge entry={e} hostStarType={hostStarType} compactLayout={compact} />
    </div>
  );

  const identityNeon = (
    <div
      className={`species-identity-neon${m.organicAnalysisComplete ? " species-identity-neon--complete" : ""}`}
      aria-label="Genus, species, and typical value"
    >
      <div className="species-identity-neon-inner">
        {/* The rarity gem sits where the "analysed" tick was (owner, 2026-09-27); the green frame still says analysed. */}
        <RarityGem rarity={e.rarity} regional={m.regionRarity} className="rarity-gem--card" />
        {genusDisplay ? (
          <>
            <span className="species-identity-genus">{genusDisplay}</span>{" "}
          </>
        ) : null}
        <span className="species-identity-epithet">{epithetDisplay}</span>
        {m.collectionFocus ? (
          <span
            className="species-focus-mark"
            title={
              `Worth sampling. The corpus has ${m.collectionFocusNote?.corpusBodies ?? 0} bodies for this species ` +
              `and you have confirmed it on ${m.collectionFocusNote?.ownScans ?? 0}, so one more here teaches the ` +
              `predictor more than its payout suggests. The mark clears once there are enough.`
            }
            aria-label="Worth sampling: thin data for this species"
          >
            ⌖
          </span>
        ) : null}
        {m.codexNew && m.codexFirst ? (
          <span
            className="species-codex-mark species-codex-mark--first"
            title={codexFirstTitle(m)}
            aria-label="Nobody has logged it in this region yet"
          >
            [CODEX FIRST]
          </span>
        ) : m.codexNew ? (
          <Tooltip text={codexMarkTitle(m)}>
            <span
              className="species-codex-mark"
              aria-label="New codex entry for this region"
            >
              [CODEX]
            </span>
          </Tooltip>
        ) : m.notInCodex ? (
          <Tooltip text="No codex entry for this species in your journals — you have never logged one. The first sample of a species is worth more than the ones after it, and this is the page that is still blank.">
            <span
              className="species-codex-new"
              aria-label="Not yet in your codex"
            >
              new to you
            </span>
          </Tooltip>
        ) : null}
        {m.achievementAdvance ? (
          <Tooltip text={achievementMarkTitle(m.achievementAdvance)}>
            <span
              className="species-ach-mark"
              aria-label="Advances the tracked achievement"
            >
              ★
            </span>
          </Tooltip>
        ) : null}
        <SpeciesProvenanceBadge p={m.provenance} />
        {m.entry.predictionUnsupported ? (
          <Tooltip text={`${m.entry.predictionUnsupported.reason}. A body scan cannot answer that, so this species is listed as possible rather than predicted — nothing here says it is likely to be present.`}>
            <span className="species-not-predicted">
              {" "}
              not predicted
            </span>
          </Tooltip>
        ) : null}
        {morphColorRaw ? (
          <span
            className={
              morphColorRaw === "(unknown)"
                ? "species-identity-morph-colour species-identity-morph-colour--unknown"
                : "species-identity-morph-colour"
            }
          >
            {" "}
            - {morphColorDisplay}
            {colourCause ? (
              <span className="colour-cause" title={`Decided by ${colourCause} on this body`}>
                {" "}
                [{colourCause}]
              </span>
            ) : null}
          </span>
        ) : null}
        {m.colourMismatchPredicted ? (
          <span
            className="species-colour-miss"
            title={`Logged ${m.confirmedColour}, predicted ${m.colourMismatchPredicted} — recorded in the miss log (edexo-outliers.jsonl).`}
          >
            {" "}
            ⚑
          </span>
        ) : null}
        {m.unlikely ? (
          <span className="species-demoted-badge" title={demotedBy.map((r) => r.detail).join("\n\n")}>
            {" "}
            unlikely · {demotedFields.join(", ")}
          </span>
        ) : null}
        {compact ? null : (
          <>
            <span className="species-identity-sep"> · </span>
            <span className="species-identity-value-label">Value here:</span>{" "}
            {m.priceCredits != null ? (
              <span
                className={`species-identity-value-amount${footfall === "unwalked" ? " is-unwalked" : ""}`}
                title={priceTitle}
              >
                {fmtCrShort(m.priceCredits * priceMult)} CR
                <span className={`price-tag price-tag--${footfall}`}>{priceTag}</span>
              </span>
            ) : (
              <span className="dim">—</span>
            )}
          </>
        )}
      </div>
      {identityNote ? (
        <div className="species-identity-sub species-identity-sub--note">{identityNote}</div>
      ) : null}
      {m.unlikely && demotedBy.length > 0 ? (
        <div className="species-identity-sub species-identity-sub--demoted">
          {demotedBy.map((r) => r.detail).join(" ")}
        </div>
      ) : null}

      {m.exomasteryProfilePresent ? (
        matchHasDetail(m) ? (
          <button
            type="button"
            className="species-similarity-index species-similarity-index--clickable"
            onClick={() => setExoDetailOpen(true)}
            title={EXO_PRESENCE_HELP}
          >
            <SpeciesExomasterySimilarityContent m={m} />
          </button>
        ) : (
          <div
            className="species-similarity-index species-similarity-index--static"
            title={`${EXO_PRESENCE_HELP} Profile loaded; field breakdown empty.`}
          >
            <SpeciesExomasterySimilarityContent m={m} />
          </div>
        )
      ) : (
        <div
          className="species-similarity-index species-similarity-index--codex-hint"
          title={EXO_CODEX_VS_EXO_PROFILE_HELP}
        >
          <p className="species-similarity-index-codex-hint-text">{EXO_CODEX_VS_EXO_PROFILE_HELP}</p>
        </div>
      )}
      {m.exomasteryProfilePresent && matchHasDetail(m) ? (
        <button
          type="button"
          className="why-chance__toggle"
          aria-expanded={whyOpen}
          onClick={() => setWhyOpen((v) => !v)}
          title="Where this species has been found for temperature, gravity and pressure, and where this body sits"
        >
          {whyOpen ? "▾" : "▸"} Why this chance
        </button>
      ) : null}
      {whyOpen ? <WhyChanceStrip detail={lazyDetail.data?.detail ?? null} loading={!lazyDetail.error} /> : null}
      {genusOdds ? <GenusSpeciesOdds items={genusOdds.items} confirmed={genusOdds.confirmed} inCard /> : null}
    </div>
  );

  return (
    <article className={`species-card${compact ? " species-card--compact" : ""}`}>
      <div
        className={`species-card-inner${compact ? " species-card-inner--compact" : " species-card-inner--stacked"}`}
      >
        {compact ? (
          <>
            <div className="species-card-compact-media">
              {thumbBtn}
              {compactPayout}
              {m.photoNote ? (
                <p className="species-photo-note species-photo-note--compact-thumb">{m.photoNote}</p>
              ) : null}
            </div>
            <div className="species-card-compact-detail">
              {identityNeon}
              {quadGrid}
            </div>
          </>
        ) : (
          <div className="species-card-hero">
            {/*
              On the photograph, not under it.

              The credit belongs to the image and has to stay with it, but a full-width row below the
              picture is height the picture loses — the owner's words: a black bar hiding a good part
              of them. Laid over the bottom-right corner in its own translucent plate it costs the
              photograph nothing but the corner it sits in, which is the emptiest part of a plant
              photographed from the front.

              The plate is a sibling of the button, not a child, so clicking the credit or the photo
              count cannot open the lightbox by accident. And it is skipped entirely when it would be
              empty: a house-drawn placeholder carries no credit and a lone photograph has no count,
              so both children can render nothing at once, and an empty translucent box laid on the
              picture would be worse than the bar this replaced.
            */}
            <div className="species-hero-photo">
              {thumbBtn}
              {galleryUrls.length > 1 || !isPlaceholderPhoto(heroPhotoUrl) ? (
                <div className="photo-meta-row photo-meta-row--overlay">
                  {galleryUrls.length > 1 ? (
                    <button
                      type="button"
                      className="photo-count-hint"
                      onClick={() => setPhotoLightbox(true)}
                      title={`${galleryUrls.length} photographs of this species — click to browse`}
                    >
                      {galleryUrls.length} photos
                    </button>
                  ) : null}
                  <PhotoCredit photoUrl={heroPhotoUrl} contributor={m.photoCreditByUrl?.[heroPhotoUrl]} />
                </div>
              ) : null}
            </div>
            {identityNeon}
            {quadGrid}
            {m.photoNote ? (
              <p className="species-photo-note species-photo-note--hero">{m.photoNote}</p>
            ) : null}
          </div>
        )}

        <div className="species-body">
          {m.approximateMatch || m.learnedFromFootScan ? (
            <p className="species-title-line">
              {m.approximateMatch ? (
                <span
                  className="badge-approx"
                  title="Strict temperature/pressure gates did not match; this is a closest-distance suggestion"
                >
                  approximate
                </span>
              ) : null}
              {m.learnedFromFootScan ? (
                <Tooltip text="Suggested from data/foot_scanned.json. Label shows whether confirmations in the catalog used ScanOrganic Analyse and/or Sample (not the same as a completed codex line on this body).">
                  <span className="badge-foot-learned">
                    {footCatalogBadgeText(m.footCatalogConfirmations)}
                  </span>
                </Tooltip>
              ) : null}
            </p>
          ) : null}

          {m.learnedFromFootScan && m.footScanMatch ? <FootScanMatchCard payload={m.footScanMatch} /> : null}

          {otherMatchBlock && !compact ? (
            <div className="species-other-match-shell species-other-match-shell--drawer">
              <div className="species-other-match-drawer-toolbar">
                <button
                  type="button"
                  className="species-other-match-drawer-toggle"
                  aria-expanded={otherDetailsOpen}
                  onClick={() => setOtherDetailsOpen((v) => !v)}
                >
                  <span
                    className={`species-other-match-drawer-chevron${otherDetailsOpen ? " species-other-match-drawer-chevron--open" : ""}`}
                    aria-hidden
                  >
                    ›
                  </span>
                  <span className="species-other-match-shell-title">Other matching details</span>
                </button>
                {showFootfallBadge ? (
                  <span
                    className="species-other-match-footfall-pill"
                    title="Includes foot-catalog confirmation context"
                  >
                    FOOTFALL
                  </span>
                ) : null}
              </div>
              <div
                ref={otherDetailsFocusRef}
                tabIndex={-1}
                className={`species-other-match-drawer-panel${otherDetailsOpen ? " species-other-match-drawer-panel--open" : ""}`}
              >
                <div className="species-other-match-shell-collapse-inner">
                  <OtherMatchDetailCardsGrid cards={otherDetailCards} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Clicked, its breakdown still on its way from the server: the click shows, the panel follows. */}
      {exoDetailOpen && !lazyDetail.data && !lazyDetail.error ? <ModalLoading /> : null}
      {exoDetailOpen && lazyDetail.data?.detail ? (
        <Suspense fallback={null}>
          <ExomasteryHabitatMatchModal
            variant="profile"
            detail={lazyDetail.data.detail}
            varietyHints={lazyDetail.data.varietyHints}
            exportBasename={m.exomasteryExportBasename}
            genusDataDir={m.entry.genusDataDir}
            comparisonBodySummary={comparisonBodySummary}
            onClose={() => setExoDetailOpen(false)}
            title={`${e.displayName} · exomastery habitat match`}
          />
        </Suspense>
      ) : null}

      {otherMatchModalOpen && compact && otherMatchBlock
        ? createPortal(
            <div className="modal-backdrop" role="presentation" onClick={() => setOtherMatchModalOpen(false)}>
              <div
                ref={otherMatchDialogRef}
                className="modal-panel other-matching-details-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`other-match-${e.id}`}
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="modal-head">
                  <h3 id={`other-match-${e.id}`} className="other-matching-details-modal-title">
                    Other matching details — {e.displayName}
                  </h3>
                  <button
                    type="button"
                    className="modal-close"
                    onClick={() => setOtherMatchModalOpen(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body other-matching-details-modal-body">
                  <OtherMatchDetailCardsGrid cards={otherDetailCards} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {photoLightbox
        ? createPortal(
            <PhotoGallery
              urls={galleryUrls}
              note={m.photoNote}
              creditByUrl={m.photoCreditByUrl}
              variantByUrl={galleryVariantLabels}
              onClose={() => setPhotoLightbox(false)}
            />,
            document.body,
          )
        : null}
    </article>
  );
});
