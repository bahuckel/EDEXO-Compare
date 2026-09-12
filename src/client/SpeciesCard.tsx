/**
 * The full species card and its sub-blocks, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { InfoPopover } from "./ui/Tooltip";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { fmtCrExact, fmtCrShort } from "./credits";
import { useFootfallCertainty } from "./footfallContext";
import { settledMultiplier } from "@shared/footfallValue";
import { PhotoCredit, photoCreditTitle } from "./photoCredit";
import { PhotoGallery } from "./PhotoGallery";
import { memo, Suspense, useEffect, useMemo, useRef, useState, CSSProperties } from "react";
import type { AppSnapshot, BodyComputed, EstimatedSurfaceTempBand, FootScanMatchPayload, OtherMatchDetailCardDTO, PlanetScan } from "@shared/types";
import { formatGenusStarColorSoftOneLine } from "@shared/genusStarColorSoft";
import { candidateMorphColorShortLabel, candidateMorphColorShortLabelForHosts } from "@shared/candidateSpawnHints";
import { createPortal } from "react-dom";
import { pillLabelStyle, TempUnit } from "./planetDisplayUtils";
import { EXO_PRESENCE_HELP, EXO_CODEX_VS_EXO_PROFILE_HELP, exomasteryDetailHasContent, footCatalogBadgeText, labelForReasonField, primaryMatchQuad, speciesCaptionParts, speciesMatchExtraReasons, titleCaseSpeciesWords } from "./speciesMatchHelpers";
import { ExomasteryHabitatMatchModal } from "./SharedModals";
import { EMPTY_REASONS, FootScanHitBlock, OtherMatchDetailCardsGrid, SpeciesProvenanceBadge, ThinSampleNote, hostHitsMorphSpectralChip, morphSpectralChipHeatClass, sortMorphSpectralKeys } from "./SpeciesCardBits";
import { readTempUnitFromLs, writeTempUnitToLs } from "./lsPrefs";

function FootScanMatchCard({ payload }: { payload: FootScanMatchPayload }) {
  const [expanded, setExpanded] = useState(false);
  const hits = payload.hits;
  if (!hits.length) return null;
  const [primary, ...more] = hits;

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
function SpeciesStarColourSoftBadge({
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
function SpeciesExomasterySimilarityContent({ m }: { m: BodyComputed["matches"][0] }) {
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
      barExtraStyle: { filter: "hue-rotate(-35deg)" },
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

/**
 * The miss log, in the Options panel (B6).
 *
 * The accuracy probe can only re-measure the bodies already in the journal, and it will only ever
 * describe the past. This grows every time the app is wrong about a body the commander actually
 * landed on, wherever they are flying — the one feedback channel that does not go stale as the
 * harness is tuned against.
 *
 * A count rather than a list: the records carry body parameters and the whole candidate list, which
 * belongs in a file to diff, not in a modal. Silent at zero, because "no misses recorded" on a fresh
 * install reads as a claim about accuracy that nothing has earned.
 *
 * **Shape (A5).** This was a five-line paragraph for a number and a filename. The number is the
 * thing being reported and the file is the thing to do about it, so it is now a number, a button,
 * and an ⓘ holding the explanation — which is read once and then never again.
 */
export function ExoMissLogPanel({ outliers }: { outliers: AppSnapshot["exoOutliers"] }) {
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  if (!outliers || outliers.total <= 0) return null;
  const parts = [
    outliers.absent > 0 ? `${outliers.absent} not listed at all` : null,
    outliers.unlikelyOnly > 0 ? `${outliers.unlikelyOnly} only behind “show unlikely”` : null,
    outliers.rankedLow > 0 ? `${outliers.rankedLow} listed but ranked too low` : null,
  ].filter(Boolean);

  return (
    <section className="options-meta-block options-oneline">
      <span className="options-oneline-label">Misses recorded</span>
      <strong className="options-oneline-value">{outliers.total}</strong>
      <button
        type="button"
        className="btn secondary tiny"
        disabled={opening}
        onClick={() => {
          setOpening(true);
          void fetch("/api/settings/open-miss-log", { method: "POST" })
            .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
            .then((r) => {
              if (!r.ok) toast.error(r.error ?? "Could not open the miss log.");
            })
            .catch(() => toast.error("Could not open the miss log."))
            .finally(() => setOpening(false));
        }}
      >
        Open JSON
      </button>
      <InfoPopover title="Misses recorded" label="What the miss log holds">
        <p>
          {outliers.total} {outliers.total === 1 ? "species" : "species"} you found where this app did not
          point at {outliers.total === 1 ? "it" : "them"}
          {parts.length ? `: ${parts.join(", ")}` : ""}.
        </p>
        <p>
          Each one is written to <code>edexo-outliers.jsonl</code> beside your settings, with the
          body&apos;s parameters and the candidate list at the time — evidence for the next gate fix.
        </p>
        <p>It never leaves this machine.</p>
      </InfoPopover>
    </section>
  );
}

export const SpeciesCard = memo(function SpeciesCard({
  m,
  scan,
  estimatedSurfaceTempK,
  comparisonBodySummary,
  hostStarType,
  hostStarTypes,
  compactCandidateView,
}: {
  m: BodyComputed["matches"][0];
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  comparisonBodySummary: string;
  hostStarType?: string;
  /** Every star that could be the host, when the body orbits a barycentre rather than one star. */
  hostStarTypes?: string[];
  compactCandidateView?: boolean;
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
  /**
   * Card artwork comes from the generated 1024 px WebP (~51 KB) instead of the original
   * (~600 KB average, up to 2.8 MB); the lightbox below still opens the full-size file.
   */
  const src = speciesPhotoVariant(m.photoUrl, "card");
  const [tempUnit, setTempUnit] = useState<TempUnit>(() => readTempUnitFromLs());
  const quadCells = useMemo(() => {
    const base = primaryMatchQuad(m, scan, estimatedSurfaceTempK, tempUnit);
    const exo = m.exomasteryProfilePresent && exomasteryDetailHasContent(m.exomasteryDetail);
    return base.map((c) => (exo && c.key !== "SurfaceTemperature" ? { ...c, openExomasteryModal: true } : c));
  }, [m, scan, estimatedSurfaceTempK, tempUnit]);
  const extras = useMemo(() => speciesMatchExtraReasons(m), [m]);
  const otherDetailCards = useMemo((): OtherMatchDetailCardDTO[] => {
    const xs = m.otherMatchDetailCards ?? [];
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
  }, [m.otherMatchDetailCards, extras]);

  /*
   * The body's own materials decide the colour for material-driven species, and the card already
   * has the scan. Passing it is the whole fix for "Bacterium Vesicula (unknown)" on a body whose
   * only colour-driving material was yttrium.
   */
  const morphColorRaw = useMemo(
    () =>
      hostStarType
        ? candidateMorphColorShortLabel(e, hostStarType, scan?.materials)
        : candidateMorphColorShortLabelForHosts(e, hostStarTypes, scan?.materials),
    [e, hostStarType, hostStarTypes, scan?.materials],
  );
  const morphColorDisplay =
    morphColorRaw === "(unknown)" ? morphColorRaw : titleCaseSpeciesWords(morphColorRaw);

  /**
   * The photograph of the variant this body will actually grow, when somebody has taken it.
   *
   * Two things had to be true at once for this to be possible, and now both are: the app works out
   * the colour from the star or the body's materials, and the owner is photographing the variants
   * one at a time. Without it the card shows *a* Bacterium vesicula, which is a different plant from
   * the one waiting on the surface.
   *
   * Only for a colour that is decided. "Lime or Cyan" means the rule genuinely did not choose, and
   * picking a photograph would be the app choosing for it, silently, in a picture.
   */
  const variantPhotoUrl = useMemo(() => {
    if (morphColorRaw === "(unknown)" || morphColorRaw.includes(" or ")) return null;
    const want = morphColorRaw.trim().toLowerCase();
    return m.photoVariants?.find((v) => v.colour.trim().toLowerCase() === want)?.url ?? null;
  }, [m.photoVariants, morphColorRaw]);
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
  const heroSrc = speciesPhotoVariant(heroPhotoUrl, "card");
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const [exoDetailOpen, setExoDetailOpen] = useState(false);
  const [otherDetailsOpen, setOtherDetailsOpen] = useState(false);
  const [otherMatchModalOpen, setOtherMatchModalOpen] = useState(false);
  const otherDetailsFocusRef = useRef<HTMLDivElement>(null);

  const otherMatchBlock = otherDetailCards.length > 0;
  const compact = compactCandidateView === true;

  useEffect(() => {
    if (!compact) setOtherMatchModalOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!otherMatchModalOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOtherMatchModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [otherMatchModalOpen]);

  useEffect(() => {
    if (!otherDetailsOpen) return;
    const id = window.requestAnimationFrame(() => {
      otherDetailsFocusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [otherDetailsOpen]);

  useEffect(() => {
    if (!photoLightbox) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setPhotoLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photoLightbox]);

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
        {m.priceCredits != null ? <span className={`price-tag price-tag--${footfall}`}>{priceTag}</span> : null}
      </span>
      {m.priceCredits != null && footfall === "unknown" ? (
        <span className="species-compact-payout-alt">if first footfall: {fmtCrShort(m.priceCredits * 5)} CR</span>
      ) : null}
      {m.organicAnalysisComplete ? (
        <span
          className="species-compact-payout-done"
          title="Journal shows a completed exobiology line for this species on this body."
        >
          ✓ Analysed
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
              onClick={() =>
                setTempUnit((u) => {
                  const next = u === "K" ? "C" : u === "C" ? "F" : "K";
                  writeTempUnitToLs(next);
                  return next;
                })
              }
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
        {m.organicAnalysisComplete ? (
          <span
            className="species-scan-ok species-scan-ok--identity"
            title="Journal shows a completed exobiology line for this species on this body (two Sample + one Analyse, or an Analyse line alone)."
            aria-label="Analysis complete"
          >
            ✓{" "}
          </span>
        ) : null}
        {genusDisplay ? (
          <>
            <span className="species-identity-genus">{genusDisplay}</span>{" "}
          </>
        ) : null}
        <span className="species-identity-epithet">{epithetDisplay}</span>
        {m.notInCodex ? (
          <span
            className="species-codex-new"
            title="No codex entry for this species in your journals — you have never logged one. The first sample of a species is worth more than the ones after it, and this is the page that is still blank."
            aria-label="Not yet in your codex"
          >
            new to you
          </span>
        ) : null}
        <SpeciesProvenanceBadge p={m.provenance} />
        {m.entry.predictionUnsupported ? (
          <span
            className="species-not-predicted"
            title={`${m.entry.predictionUnsupported.reason}. A body scan cannot answer that, so this species is listed as possible rather than predicted — nothing here says it is likely to be present.`}
          >
            {" "}
            not predicted
          </span>
        ) : null}
        <span
          className={
            morphColorRaw === "(unknown)"
              ? "species-identity-morph-colour species-identity-morph-colour--unknown"
              : "species-identity-morph-colour"
          }
        >
          {" "}
          - {morphColorDisplay}
        </span>
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
              <span className={`species-identity-value-amount${footfall === "unwalked" ? " is-unwalked" : ""}`} title={priceTitle}>
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
        exomasteryDetailHasContent(m.exomasteryDetail) ? (
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
            {thumbBtn}
            {/*
              Directly under the photo it credits — the hero is a column, so anywhere further down
              reads as a footnote to the card rather than to the image. One row rather than two
              stacked blocks: the count and the credit were costing three lines of height between
              them, and on this layout every line below the photograph is height the photograph
              loses.
            */}
            <div className="photo-meta-row">
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
                <span
                  className="badge-foot-learned"
                  title="Suggested from data/foot_scanned.json. Label shows whether confirmations in the catalog used ScanOrganic Analyse and/or Sample (not the same as a completed codex line on this body)."
                >
                  {footCatalogBadgeText(m.footCatalogConfirmations)}
                </span>
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

      {exoDetailOpen && exomasteryDetailHasContent(m.exomasteryDetail) && m.exomasteryDetail ? (
        <Suspense fallback={null}>
          <ExomasteryHabitatMatchModal
            variant="profile"
            detail={m.exomasteryDetail}
            varietyHints={m.exomasteryVarietyHints}
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
