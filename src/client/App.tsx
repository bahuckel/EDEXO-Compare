import { useLastStateAt, useLiveSnapshot } from "./useLiveSnapshot";
import { useConfirm, useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import { InfoPopover, Tooltip } from "./ui/Tooltip";
import { IconChevronDown, IconEncyclopedia, IconExobiology, IconOptions } from "./ui/icons";
import { useValueFlash } from "./ui/useValueFlash";
import { SkeletonPanel } from "./ui/Skeleton";
import { speciesPhotoVariant } from "./speciesPhotoVariant";

/**
 * Modal-only code, split out of the initial bundle.
 *
 * These four never render on first paint but were downloaded, parsed and executed before it:
 * the system map (plus its 40 KB geometry module, which nothing else imports), the encyclopedia
 * (plus its filter bar and exomastery panels), the habitat match modal, and the quick-facts popup.
 */
const SystemMapModal = lazy(() => import("./SystemMapModal").then((m) => ({ default: m.SystemMapModal })));
const EncyclopediaModal = lazy(() =>
  import("./EncyclopediaModal").then((m) => ({ default: m.EncyclopediaModal })),
);
const ExomasteryHabitatMatchModal = lazy(() =>
  import("./exomasteryHabitatMatchModal").then((m) => ({ default: m.ExomasteryHabitatMatchModal })),
);
const PlanetQuickFactsPopup = lazy(() =>
  import("./PlanetQuickFactsPopup").then((m) => ({ default: m.PlanetQuickFactsPopup })),
);
import { useFdevServerStatus } from "./useFdevServerStatus";
import { JournalBootScreen } from "./JournalBootScreen";
import { ExoPayoutRangePanel } from "./ExoPayoutRangePanel";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import { EliteTipRotator } from "./EliteTipRotator";
import type {
  AppSnapshot,
  BodyComputed,
  EstimatedSurfaceTempBand,
  ExoDataAlertDTO,
  ExoPayoutRangeDTO,
  FootScannedEntry,
  FootScanMatchPayload,
  GenusHint,
  JournalSystemInfo,
  NotableBodyInfo,
  OrganicPendingLineItem,
  OtherMatchDetailCardDTO,
  PlanetScan,
} from "@shared/types";
import {
  journalHistoryPresetLabel,
  journalHistoryWindowPresetChoices,
  type JournalHistoryPreset,
} from "@shared/journalHistoryPreset";
import { formatGenusStarColorSoftOneLine } from "@shared/genusStarColorSoft";
import { candidateMorphColorShortLabel } from "@shared/candidateSpawnHints";
import {
  Fragment,
  useCallback,
  lazy,
  memo,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  atmospherePillStyle,
  formatPressurePill,
  formatTemperaturePillLine,
  gravHeatStyle,
  gravityFromScan,
  journalPressureToAtm,
  pillLabelStyle,
  planetClassPillStyle,
  pressHeatStyle,
  tempHeatStyle,
  type PressDisplay,
  type TempUnit,
} from "./planetDisplayUtils";
import {
  EXO_SIMILARITY_INDEX_HELP,
  EXO_HABITAT_FIT_HELP,
  EXO_GENUS_RANK_HELP,
  EXO_CODEX_VS_EXO_PROFILE_HELP,
  exomasteryDetailHasContent,
  footCatalogBadgeText,
  groupedSortedMatches,
  labelForReasonField,
  primaryMatchQuad,
  primaryStarChipClass,
  primaryStarRoleTag,
  primaryStarRoleTooltip,
  safeGenusHeadId,
  speciesCaptionParts,
  speciesMatchExtraReasons,
  titleCaseSpeciesWords,
  uniqueOnFootScanLines,
} from "./speciesMatchHelpers";
import { buildBodyOrbitGroups, groupTabBodiesIntoHostCards } from "./bodyTabGroups";
import { useStableBioTabOrder } from "./useStableBioTabOrder";
import { BodyTabStrip, type TabSection } from "./BodyTabStrip";
import { BodyJumpPalette, bodyJumpItems } from "./BodyJumpPalette";

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

function FootScanHitBlock({ hit }: { hit: FootScanMatchPayload["hits"][number] }) {
  const src = hit.confirmationSource === "analyse" ? "FOOT CATALOG — Analyse" : "FOOT CATALOG — Sample";
  return (
    <div className="foot-scan-hit-block">
      <div className="foot-scan-hit-header">
        <span className="foot-scan-body-name">{hit.bodyName}</span>
        <span className="foot-scan-hit-meta dim tiny">
          {hit.starSystem || "—"} · {hit.recordedAt.slice(0, 19).replace("T", " ")}
        </span>
        <span className="foot-scan-hit-source">{src}</span>
      </div>
      <div className="foot-scan-field-grid">
        {hit.fieldRows.map((row) => {
          const optionalMismatch = !row.matches && !row.speciesCriteriaIncludes;
          const criteriaMismatch = !row.matches && row.speciesCriteriaIncludes;
          const sectionClass =
            "foot-scan-section" +
            (row.matches ? " foot-scan-section--ok" : "") +
            (optionalMismatch ? " foot-scan-section--optional-mismatch" : "") +
            (criteriaMismatch ? " foot-scan-section--criteria-mismatch" : "");
          return (
            <div key={row.key} className={sectionClass}>
              <div className="foot-scan-section-label">{row.label}</div>
              <div className="foot-scan-section-pair">
                <div className="foot-scan-section-col">
                  <span className="foot-scan-section-tag">This body</span>
                  <span className="foot-scan-section-val">{row.currentDisplay}</span>
                </div>
                <div className="foot-scan-section-col">
                  <span className="foot-scan-section-tag">Catalog</span>
                  <span className="foot-scan-section-val">{row.catalogDisplay}</span>
                </div>
              </div>
              {!row.matches && row.speciesCriteriaIncludes ? (
                <p className="foot-scan-section-note tiny foot-scan-section-note--warn">
                  Mismatch on a field listed in <code>data/species/…</code> criteria — verify manually.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Spectral classes for codex morph colours — O→M “main sequence” order for the mini rail. */
const MORPH_SPECTRAL_ORDER = ["O", "B", "A", "F", "G", "K", "M", "TTS", "L", "Y", "T"] as const;

function sortMorphSpectralKeys(listCsv: string): string[] {
  const keys = [
    ...new Set(
      listCsv
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const rank = (k: string) => {
    const i = MORPH_SPECTRAL_ORDER.indexOf(k as (typeof MORPH_SPECTRAL_ORDER)[number]);
    if (i >= 0) return i;
    const one = k.length
      ? MORPH_SPECTRAL_ORDER.indexOf(k.charAt(0) as (typeof MORPH_SPECTRAL_ORDER)[number])
      : -1;
    if (one >= 0) return one + 0.15;
    return 40 + (k.charCodeAt(0) % 40);
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

function hostHitsMorphSpectralChip(hostSummary: string, chip: string): boolean {
  const h = hostSummary.trim().toUpperCase();
  const c = chip.toUpperCase();
  if (!h || h === "—") return false;
  if (c === "TTS") return h.includes("TTS");
  if (h === c) return true;
  if (c.length === 1 && h.startsWith(c)) return true;
  return c.length > 1 && h.startsWith(c.slice(0, Math.min(c.length, h.length)));
}

function morphSpectralChipHeatClass(chip: string): string {
  const c = chip.toUpperCase();
  if (c === "O" || c === "B") return "species-spectral-chip--oob";
  if (c === "A" || c === "F") return "species-spectral-chip--af";
  if (c === "G" || c === "K") return "species-spectral-chip--gk";
  if (c === "M" || c === "L" || c === "T" || c === "Y") return "species-spectral-chip--cool";
  return "species-spectral-chip--x";
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

/** Habitat fit (cross-genus) + deck match + optional same-genus rank — equal-width columns for available metrics only. */
/**
 * The signal-count verdict.
 *
 * The game reports how many biological signals a body has before the commander goes anywhere, and it
 * places one genus per signal. When the candidate genera match that count, every one of them is
 * present — the answer is settled from orbit, which is the whole reason the app exists. When there
 * are fewer, one of our gates is wrong.
 */
function GenusCertaintyLine({ c }: { c: NonNullable<BodyComputed["genusCertainty"]> }) {
  if (c.status === "certain") {
    return (
      <p
        className="genus-certainty genus-certainty--certain"
        title="The game places one genus per biological signal and never repeats a genus on a body. The candidate genera match the signal count exactly, so every genus listed is present — no surface scan needed to know that."
      >
        All {c.signalCount} {c.signalCount === 1 ? "genus is" : "genera are"} identified:{" "}
        <strong>{c.genera.join(", ")}</strong> — confirmed from the signal count alone.
      </p>
    );
  }
  if (c.status === "underCovered") {
    const short = c.signalCount - c.candidateGenera;
    return (
      <p
        className="genus-certainty genus-certainty--short"
        title="Fewer candidate genera than the game reports signals. That cannot happen in-game, so a gate in our data is excluding a genus that is really here."
      >
        {c.signalCount} signals but only {c.candidateGenera} candidate{" "}
        {c.candidateGenera === 1 ? "genus" : "genera"} — at least {short} is missing from our data.
      </p>
    );
  }
  return (
    <p
      className="genus-certainty genus-certainty--ambiguous"
      title="More candidate genera than signals: the game placed this many genera, but we cannot yet say which of the candidates they are."
    >
      {c.signalCount} of these {c.candidateGenera} genera are present.
    </p>
  );
}

function SpeciesExomasterySimilarityContent({ m }: { m: BodyComputed["matches"][0] }) {
  const hq = m.exomasteryHabitatQuality;
  const deck = m.exomasterySimilarityPercent;
  const gr = m.exomasteryGenusRelativePercent;
  const hasHq = hq != null && Number.isFinite(hq);
  const hasDeck = deck != null && Number.isFinite(deck);
  const hasGr = gr != null && Number.isFinite(gr);
  const wh = hasHq ? Math.max(0, Math.min(100, hq)) : 0;
  const wd = hasDeck ? Math.max(0, Math.min(100, deck)) : 0;
  const wg = hasGr ? Math.max(0, Math.min(100, gr)) : 0;

  type SimCol = {
    key: string;
    shortLabel: string;
    help: string;
    pct: number;
    barOpacity: number;
    barExtraStyle?: CSSProperties;
  };
  const cols: SimCol[] = [];
  if (hasHq)
    cols.push({
      key: "hq",
      shortLabel: "Habitat fit",
      help: EXO_HABITAT_FIT_HELP,
      pct: wh,
      barOpacity: 0.55,
    });
  if (hasDeck)
    cols.push({
      key: "deck",
      shortLabel: "Deck match",
      help: EXO_SIMILARITY_INDEX_HELP,
      pct: wd,
      barOpacity: 1,
    });
  if (hasGr)
    cols.push({
      key: "gr",
      shortLabel: "vs same genus",
      help: EXO_GENUS_RANK_HELP,
      pct: wg,
      barOpacity: 1,
      barExtraStyle: { filter: "hue-rotate(25deg)" },
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

function OtherMatchDetailCardsGrid({ cards }: { cards: OtherMatchDetailCardDTO[] }) {
  return (
    <div className="species-other-match-cards-grid species-other-match-cards-grid--in-shell species-other-match-cards-grid--balanced">
      {cards.map((c) => {
        const tier = c.highlight ?? "neutral";
        return (
          <div
            key={c.id}
            className={`species-other-match-mini exo-neon-duplex--tier-${tier}`}
            title={c.tooltip}
          >
            <span className="species-other-match-mini-title">{c.shortTitle}</span>
            <div className="species-other-match-mini-line">
              <span className="species-other-match-mini-legend">{c.topLegend}</span>
              <span>{c.topValue || "—"}</span>
            </div>
            <div className="species-other-match-mini-line">
              <span className="species-other-match-mini-legend">{c.bottomLegend}</span>
              <span>{c.bottomValue || "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SpeciesCard = memo(function SpeciesCard({
  m,
  scan,
  estimatedSurfaceTempK,
  comparisonBodySummary,
  hostStarType,
  compactCandidateView,
}: {
  m: BodyComputed["matches"][0];
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  comparisonBodySummary: string;
  hostStarType?: string;
  compactCandidateView?: boolean;
}) {
  const e = m.entry;
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
  const morphColorRaw = useMemo(() => candidateMorphColorShortLabel(e, hostStarType), [e, hostStarType]);
  const morphColorDisplay =
    morphColorRaw === "(unknown)" ? morphColorRaw : titleCaseSpeciesWords(morphColorRaw);
  const dssPhysicalCautionTitle =
    "DSS-assisted candidate: may use 5% slack on temperature / pressure / gravity vs the journal, or nearest-by-temperature-only. Confirm species in-game.";
  const showDssPhysicalCaution = m.dssNearestTemperatureMatch === true || m.dssPhysicalSlackMatch === true;
  const identityNote = useMemo(() => {
    const notesPart = (e.notes ?? "").trim();
    const descPart = (e.description ?? "").trim();
    const minD = e.genusMinSampleDistanceM;
    const distPrefix = minD != null && minD > 0 ? `Distance between scans: ${minD.toLocaleString()} m` : "";
    const descBlock = distPrefix && descPart ? `${distPrefix} — ${descPart}` : distPrefix || descPart;
    return [notesPart, descBlock].filter(Boolean).join("\n\n");
  }, [e.notes, e.description, e.genusMinSampleDistanceM]);
  const showFootfallBadge = m.learnedFromFootScan === true || m.footScanMatch != null;

  const thumbBtn = (
    <button
      type="button"
      className={
        compact ? "species-thumb-btn species-thumb-btn--compact" : "species-thumb-btn species-thumb-btn--hero"
      }
      onClick={() => setPhotoLightbox(true)}
      aria-label="Enlarge species photo"
    >
      <img
        src={src}
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
    <div className="species-compact-payout">
      <span className="species-compact-payout-label">Value</span>
      <span className="species-compact-payout-amount">
        {m.priceCredits != null ? `${m.priceCredits.toLocaleString()} CR` : "—"}
      </span>
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
        {showDssPhysicalCaution ? (
          <span className="species-dss-temp-nearest-warn" title={dssPhysicalCautionTitle}>
            {" "}
            (!)
          </span>
        ) : null}
        {compact ? null : (
          <>
            <span className="species-identity-sep"> · </span>
            <span className="species-identity-value-label">Value:</span>{" "}
            {m.priceCredits != null ? (
              <span className="species-identity-value-amount">{m.priceCredits.toLocaleString()} CR</span>
            ) : (
              <span className="dim">—</span>
            )}
          </>
        )}
      </div>
      {identityNote ? (
        <div className="species-identity-sub species-identity-sub--note">{identityNote}</div>
      ) : null}

      {m.exomasteryProfilePresent ? (
        exomasteryDetailHasContent(m.exomasteryDetail) ? (
          <button
            type="button"
            className="species-similarity-index species-similarity-index--clickable"
            onClick={() => setExoDetailOpen(true)}
            title={`${EXO_HABITAT_FIT_HELP} · ${EXO_SIMILARITY_INDEX_HELP} · ${EXO_GENUS_RANK_HELP}`}
          >
            <SpeciesExomasterySimilarityContent m={m} />
          </button>
        ) : (
          <div
            className="species-similarity-index species-similarity-index--static"
            title={`${EXO_HABITAT_FIT_HELP} Profile loaded; field breakdown empty — bars still show when scores exist.`}
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
            <div
              className="photo-lightbox-backdrop"
              role="presentation"
              onClick={() => setPhotoLightbox(false)}
            >
              <button
                type="button"
                className="photo-lightbox-close"
                aria-label="Close"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPhotoLightbox(false);
                }}
              >
                ×
              </button>
              <img
                src={m.photoUrl}
                alt=""
                className="photo-lightbox-img"
                onClick={(ev) => ev.stopPropagation()}
              />
              {m.photoNote ? (
                <p className="photo-lightbox-cap" onClick={(ev) => ev.stopPropagation()}>
                  {m.photoNote}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </article>
  );
});

function ExoPayoutRangeDetailModal({
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
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const slotSrcLabel =
    pr.slotSource === "bio_signals"
      ? "FSS / DSS biological signal count in the merged journal."
      : "DSS genus list length (fallback when signal count is not present yet).";

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
                {pr.journalWasFootfalled === null
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
              List / standard sell (×1) total {minListTot.toLocaleString()} CR · Footfall (×5) total{" "}
              {minFfTot.toLocaleString()} CR
            </p>
            <table className="exo-payout-detail-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th className="exo-payout-detail-num">List / sell (×1)</th>
                  <th className="exo-payout-detail-num exo-payout-detail-footfall-col">Footfall (×5)</th>
                </tr>
              </thead>
              <tbody>
                {pr.minTotalSpecies.map((row) => (
                  <tr key={`min-${row.id}`}>
                    <td>{row.displayName}</td>
                    <td className="exo-payout-detail-num">{row.listCredits.toLocaleString()}</td>
                    <td className="exo-payout-detail-num exo-payout-detail-footfall-col">
                      {(row.listCredits * 5).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr className="exo-payout-detail-sum">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="exo-payout-detail-num">
                    <strong>{minListTot.toLocaleString()}</strong>
                  </td>
                  <td className="exo-payout-detail-num exo-payout-detail-footfall-col">
                    <strong>{minFfTot.toLocaleString()}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="exo-payout-detail-section">
            <h4>Best-paying set (k priciest)</h4>
            <p className="dim tiny" style={{ marginTop: "-0.25rem" }}>
              List / standard sell (×1) total {maxListTot.toLocaleString()} CR · Footfall (×5) total{" "}
              {maxFfTot.toLocaleString()} CR
            </p>
            <table className="exo-payout-detail-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th className="exo-payout-detail-num">List / sell (×1)</th>
                  <th className="exo-payout-detail-num exo-payout-detail-footfall-col">Footfall (×5)</th>
                </tr>
              </thead>
              <tbody>
                {pr.maxTotalSpecies.map((row) => (
                  <tr key={`max-${row.id}`}>
                    <td>{row.displayName}</td>
                    <td className="exo-payout-detail-num">{row.listCredits.toLocaleString()}</td>
                    <td className="exo-payout-detail-num exo-payout-detail-footfall-col">
                      {(row.listCredits * 5).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr className="exo-payout-detail-sum">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="exo-payout-detail-num">
                    <strong>{maxListTot.toLocaleString()}</strong>
                  </td>
                  <td className="exo-payout-detail-num exo-payout-detail-footfall-col">
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

const GenusMatchGroup = memo(function GenusMatchGroup({
  group,
  scan,
  estimatedSurfaceTempK,
  comparisonBodySummary,
  hostStarType,
  compactCandidateView,
}: {
  group: { groupKey: string; title: string; items: BodyComputed["matches"] };
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  comparisonBodySummary: string;
  hostStarType?: string;
  compactCandidateView?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState<string | null>(null);
  const [notesErr, setNotesErr] = useState<string | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const genusDataDir = group.items[0]?.entry.genusDataDir ?? "";
  const genusTitle = group.items[0]?.entry.genus?.trim() || group.title;
  const headId = `genus-head-${safeGenusHeadId(group.groupKey)}`;
  const shellRef = useRef<HTMLElement | null>(null);
  const prevOpenRef = useRef(true);

  useLayoutEffect(() => {
    const expanding = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!expanding || !shellRef.current) return;

    const el = shellRef.current;
    const adjustScroll = () => {
      const r = el.getBoundingClientRect();
      const pad = 14;
      const vh = window.innerHeight;
      if (r.height + 2 * pad <= vh) {
        if (r.top < pad) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (r.bottom > vh - pad) {
          el.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    const id = window.setTimeout(adjustScroll, 450);
    return () => window.clearTimeout(id);
  }, [open]);

  const openGenusNotes = (ev: ReactMouseEvent<HTMLButtonElement>) => {
    ev.stopPropagation();
    if (!genusDataDir) return;
    setNotesOpen(true);
    setNotesLoading(true);
    setNotesErr(null);
    setNotesText(null);
    void fetch(`/api/genus-notes/${encodeURIComponent(genusDataDir)}`)
      .then(async (r) => {
        const t = await r.text();
        if (!r.ok) throw new Error(t.trim() || r.statusText);
        setNotesText(t);
      })
      .catch((err) => setNotesErr(err instanceof Error ? err.message : String(err)))
      .finally(() => setNotesLoading(false));
  };

  return (
    <section ref={shellRef} className="genus-card-shell" aria-labelledby={headId}>
      <div className="genus-card-header-row">
        <button
          type="button"
          className="genus-card-collapse-hit"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${headId}-panel`}
          title="Collapse or expand species in this genus"
        >
          <span className={`genus-card-chevron${open ? " genus-card-chevron--open" : ""}`} aria-hidden>
            ^
          </span>
          <h2 className="genus-card-title" id={headId}>
            {group.title} ({group.items.length})
          </h2>
        </button>
        <button
          type="button"
          className="genus-notes-pill"
          onClick={openGenusNotes}
          title="Open notes file for this genus (data/species/…/*-notes.txt)"
        >
          Notes
        </button>
      </div>
      <div
        id={`${headId}-panel`}
        className={`genus-card-collapse-grid${open ? "" : " genus-card-collapse-grid--collapsed"}`}
      >
        <div className="genus-card-collapse-inner">
          <div className="genus-card-scroll genus-card-scroll--in-anim">
            {group.items.map((m) => (
              <SpeciesCard
                key={m.entry.id}
                m={m}
                scan={scan}
                estimatedSurfaceTempK={estimatedSurfaceTempK}
                comparisonBodySummary={comparisonBodySummary}
                hostStarType={hostStarType}
                compactCandidateView={compactCandidateView}
              />
            ))}
          </div>
        </div>
      </div>

      {notesOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setNotesOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-head">
              <h3>{genusTitle} — notes</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setNotesOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {notesLoading ? <p className="dim">Loading…</p> : null}
              {notesErr ? <p className="warn">{notesErr}</p> : null}
              {notesText != null && !notesLoading ? <pre className="notes-pre">{notesText}</pre> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
});

/** FSS biological signal count for this body (denominator for candidate species; never use DSS-only genus count). */
function candidateSpeciesDenomFromFss(state: BodyComputed["state"]): number {
  return state.biologicalSignals ?? 0;
}

function genusHintIsDssOrphan(g: GenusHint, orphans: GenusHint[]): boolean {
  return orphans.some((o) => o.Genus === g.Genus && o.Genus_Localised === g.Genus_Localised);
}

const BodyPane = memo(function BodyPane({
  body,
  includeBacteriumInSearch,
  onToggleIncludeBacterium,
}: {
  body: BodyComputed;
  includeBacteriumInSearch: boolean;
  onToggleIncludeBacterium: () => void;
}) {
  const [exoPayoutDetailOpen, setExoPayoutDetailOpen] = useState(false);
  const [exoRangeCollapsed, setExoRangeCollapsed] = useState(() =>
    readLsBool(EDEXO_EXO_RANGE_COLLAPSED_LS, false),
  );
  const [journalScanModalOpen, setJournalScanModalOpen] = useState(false);
  /**
   * Compact is the default now.
   *
   * On a body with 30 candidates the hero layout renders 11,481 DOM elements and 22,288 px of
   * cards; compact renders 2,185 and 8,544 — the same answers in a fifth of the nodes. The toggle
   * is still there, and anyone who has already set it keeps their choice.
   */
  const [compactCandidateView, setCompactCandidateView] = useState(() =>
    readLsBool(EDEXO_COMPACT_CANDIDATE_VIEW_LS, true),
  );
  const [tempUnit, setTempUnit] = useState<TempUnit>(() => readTempUnitFromLs());
  const [pressUnit, setPressUnit] = useState<PressDisplay>(() => readPressUnitFromLs());
  const [bodySummaryCopied, setBodySummaryCopied] = useState(false);
  const s = body.state;
  const sc = body.mergedScan?.PlanetClass?.trim()
    ? body.mergedScan
    : ((s.scan as PlanetScan | null | undefined) ?? null);
  const canOpenJournalScanModal =
    body.bodyScanDetail != null && exomasteryDetailHasContent(body.bodyScanDetail);

  const planetType = sc?.PlanetClass?.trim() || "—";
  const atmoRaw = (sc?.AtmosphereType || sc?.Atmosphere || "").trim();
  const atmosphereDisplay = !atmoRaw || atmoRaw.toLowerCase() === "none" ? "No Atmosphere" : atmoRaw;

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

  const onFootLines = uniqueOnFootScanLines(s.organicGenusLocks);
  const onFootFallback = s.confirmedVariants.filter(Boolean);
  const onFootPillBody =
    onFootLines.length > 0
      ? onFootLines.join(", ")
      : onFootFallback.length > 0
        ? onFootFallback.join(", ")
        : "No footfall species confirmation";
  const comparisonBodySummary =
    [body.tabLabel, s.starSystem].filter((x) => (x ?? "").trim().length > 0).join(" · ") || "—";

  useEffect(() => {
    writeLsBool(EDEXO_EXO_RANGE_COLLAPSED_LS, exoRangeCollapsed);
  }, [exoRangeCollapsed]);

  useEffect(() => {
    writeTempUnitToLs(tempUnit);
  }, [tempUnit]);

  useEffect(() => {
    writePressUnitToLs(pressUnit);
  }, [pressUnit]);

  useEffect(() => {
    writeLsBool(EDEXO_COMPACT_CANDIDATE_VIEW_LS, compactCandidateView);
  }, [compactCandidateView]);

  return (
    <div className={`body-pane${compactCandidateView ? " body-pane--compact-candidates" : ""}`}>
      <div className="panel planetary-info-card">
        <div className="planetary-info-title-row">
          <h3 className="planetary-info-title">Planetary Body Information:</h3>
          <button
            type="button"
            className="planetary-info-copy-summary"
            onClick={copyBodySummary}
            title={bodySummaryCopied ? "Copied" : "Copy one-line body summary"}
          >
            {bodySummaryCopied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="planetary-info-row">
          <div
            className="info-pill info-pill--static"
            style={planetType !== "—" ? planetClassPillStyle(planetType) : undefined}
          >
            <span className="info-pill-label" style={pillLabelStyle}>
              Type:
            </span>{" "}
            {planetType}
          </div>
          <div
            className="info-pill info-pill--static"
            style={atmospherePillStyle(atmoRaw || atmosphereDisplay)}
          >
            <span className="info-pill-label" style={pillLabelStyle}>
              Atmosphere:
            </span>{" "}
            {atmosphereDisplay}
          </div>
          <div
            className={`info-pill info-pill--static info-pill--land${
              sc == null
                ? " info-pill--land-unknown"
                : sc.Landable === true
                  ? " info-pill--land-yes"
                  : " info-pill--land-no"
            }`}
          >
            {sc == null ? "No detailed scan" : sc.Landable === true ? "Landable" : "Not landable"}
          </div>
        </div>

        <div className="planetary-info-row">
          <div
            className="info-pill info-pill--static"
            style={Number.isFinite(gEarth) ? gravHeatStyle(gEarth) : undefined}
          >
            <span className="info-pill-label" style={pillLabelStyle}>
              Gravity:
            </span>{" "}
            {gravLabel}
          </div>
          <button
            type="button"
            className="info-pill info-pill--click"
            style={Number.isFinite(tempStyleK) ? tempHeatStyle(tempStyleK) : undefined}
            onClick={() => setTempUnit((u) => (u === "K" ? "C" : u === "C" ? "F" : "K"))}
            title="Cycles Kelvin → Celsius → Fahrenheit (display only; matching still uses journal Kelvin)"
          >
            <span className="info-pill-label" style={pillLabelStyle}>
              Temperature:
            </span>{" "}
            {tempLine}
          </button>
          <button
            type="button"
            className="info-pill info-pill--click"
            style={Number.isFinite(pressAtmForStyle) ? pressHeatStyle(pressAtmForStyle) : undefined}
            onClick={() => setPressUnit((u) => (u === "atm" ? "pa" : "atm"))}
            title="Toggle display: standard atmospheres vs raw journal pascals (values below ~40 journal units are treated as atm already)"
          >
            <span className="info-pill-label" style={pillLabelStyle}>
              Pressure:
            </span>{" "}
            {pressLabel}
          </button>
        </div>

        <div className="planetary-info-row planetary-info-row--signals">
          <div className="planetary-info-signals-toolbar">
            <div
              className={`info-pill info-pill--static info-pill--signals info-pill--exo-genus-combo${s.genusHints?.length ? "" : " info-pill--exo-genus-combo--empty"}`}
              title={
                "FSS biological signal count (from journal). " +
                (s.genusHints?.length
                  ? `DSS genus hints: ${s.genusHints.map((g) => g.Genus_Localised).join(", ")}. ` +
                    "(!) after a genus means DSS reported it but no candidate species uses that genus with the current scan/filters."
                  : "Genus list is filled after DSS — until then only the FSS bio count is known.")
              }
            >
              <span className="exo-signals-label">Exo-signals:</span>{" "}
              <strong className="exo-signals-num">
                {s.biologicalSignals != null ? String(s.biologicalSignals) : "—"}
              </strong>
              <span className="info-pill-exo-genus-sep"> - </span>
              {s.genusHints?.length ? (
                <>
                  {s.genusHints.map((g, i) => (
                    <Fragment key={`${g.Genus}:${g.Genus_Localised}:${i}`}>
                      {i > 0 ? ", " : null}
                      {g.Genus_Localised}
                      {genusHintIsDssOrphan(g, body.dssGenusOrphanHints) ? (
                        <span
                          className="dss-genus-orphan-mark"
                          title="DSS lists this genus, but no candidate row matches it — check filters, bacterium toggle, or codex gates."
                        >
                          (!)
                        </span>
                      ) : null}
                    </Fragment>
                  ))}
                </>
              ) : (
                <span className="info-pill-long-hint">No DSS for genus</span>
              )}
            </div>
            <button
              type="button"
              className={`info-pill info-pill--click info-pill--dss info-pill--dss-planetary-compact${s.dssComplete ? " info-pill--dss-yes" : " info-pill--dss-no"}${canOpenJournalScanModal ? "" : " info-pill--dss-disabled"}`}
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
              DSS
            </button>
            <div
              className="info-pill info-pill--static info-pill--from-arrival"
              title={
                arrivalLs != null
                  ? "Journal Scan.DistanceFromArrivalLS — distance from the system entry / arrival point (light-seconds). 0 usually means the body you dropped in at."
                  : "Requires a detailed journal Scan that includes DistanceFromArrivalLS for this body."
              }
            >
              <span className="info-pill-label" style={pillLabelStyle}>
                From Arrival:
              </span>{" "}
              {fromArrivalDisplay}
            </div>
          </div>
          <div
            className="info-pill info-pill--static info-pill--onfoot"
            title={
              onFootLines.length > 0 || onFootFallback.length > 0
                ? "From journal ScanOrganic — genus, species, and variant colour when present."
                : "No ScanOrganic confirmation merged for this body yet."
            }
          >
            <span className="info-pill-label">On-Foot Scan:</span> {onFootPillBody}
          </div>
        </div>

        {body.genusCertainty ? <GenusCertaintyLine c={body.genusCertainty} /> : null}
        {body.ambiguityNote ? <p className="warn tiny">{body.ambiguityNote}</p> : null}
      </div>

      {body.exoPayoutRange ? (
        <>
          <div
            className={`exo-payout-collapsible panel card-neon${exoRangeCollapsed ? " exo-payout-collapsible--closed" : ""}`}
          >
            <button
              type="button"
              className="exo-payout-collapse-toggle"
              onClick={() => setExoRangeCollapsed((v) => !v)}
              aria-expanded={!exoRangeCollapsed}
            >
              <span className={`exo-payout-chevron${exoRangeCollapsed ? "" : " exo-payout-chevron--open"}`}>
                ^
              </span>
              <span>Organic Sell Range:</span>
            </button>
            <div
              className={`exo-payout-body-anim${exoRangeCollapsed ? " exo-payout-body-anim--closed" : ""}`}
            >
              <div className="exo-payout-body-anim-inner">
                <button
                  type="button"
                  className="exo-payout-range-panel exo-payout-range-panel--clickable exo-payout-inner-click"
                  onClick={() => setExoPayoutDetailOpen(true)}
                >
                  <ExoPayoutRangePanel pr={body.exoPayoutRange} variant="main" />
                </button>
              </div>
            </div>
          </div>
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

      <div className="panel panel--candidate-species">
        <div className="candidate-species-head candidate-species-head--bar">
          <h3 className="candidate-species-title">
            CANDIDATE SPECIES ({body.matches.length}/{candidateSpeciesDenomFromFss(s)})
          </h3>
          <div className="candidate-species-toggles">
            <button
              type="button"
              className={`candidate-species-compact-toggle btn-top-toggle${compactCandidateView ? " btn-top-toggle--on" : ""}`}
              onClick={() => setCompactCandidateView((v) => !v)}
              title="Compact cards (~⅓ size). Other matching details open in a popup instead of the inline drawer."
            >
              {compactCandidateView ? "Compact ✓" : "Compact ✗"}
            </button>
            <button
              type="button"
              className={`candidate-species-bacterium-toggle btn-top-toggle${includeBacteriumInSearch ? " btn-top-toggle--on" : ""}`}
              onClick={onToggleIncludeBacterium}
              title="Off by default: Bacterium is low value for many routes. Turn on to include bacterium rows in planet matching."
            >
              {includeBacteriumInSearch ? "Bacterium ✓" : "Bacterium ✗"}
            </button>
          </div>
        </div>
        {body.dssNearestTemperatureFallback ? (
          <p className="candidate-species-subhint dim tiny candidate-species-subhint--below-bar">
            DSS genus — nearest physics / 5% slack or temperature-only; marked (!) before value.
          </p>
        ) : body.approximateMatchingUsed ? (
          <p className="candidate-species-subhint dim tiny candidate-species-subhint--below-bar">
            Closest database rows by temp/pressure — strict gates failed.
          </p>
        ) : null}
        {body.matches.length === 0 ? (
          <p className="dim">
            No matches — adjust per-species rows in your genus JSON under data/species/, or get journal scan
            fields that satisfy those gates.
          </p>
        ) : (
          <div className="species-list">
            {groupedSortedMatches(body.matches).map((group) => (
              <GenusMatchGroup
                key={group.groupKey}
                group={group}
                scan={sc}
                estimatedSurfaceTempK={body.estimatedSurfaceTempK}
                comparisonBodySummary={comparisonBodySummary}
                hostStarType={body.speciesMatchContext?.parentStarType}
                compactCandidateView={compactCandidateView}
              />
            ))}
          </div>
        )}
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
  );
});

function StarSystemMapIcon({ className }: { className?: string }) {
  const gid = useId().replace(/:/g, "");
  const gradId = `starSysCore-${gid}`;
  return (
    <svg
      className={className}
      width={40}
      height={40}
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="#ffe6c9" />
          <stop offset="45%" stopColor="#ffb86a" />
          <stop offset="100%" stopColor="#cf5a24" />
        </radialGradient>
      </defs>
      <circle cx="36" cy="36" r="31" stroke="rgba(255,148,92,0.35)" strokeWidth={1.2} opacity={0.95} />
      <circle
        cx="36"
        cy="36"
        r="21"
        stroke="rgba(130,188,255,0.4)"
        strokeWidth={0.9}
        strokeDasharray="3 6"
        opacity={0.9}
      />
      <circle
        cx="36"
        cy="36"
        r="28"
        stroke="rgba(110,228,215,0.18)"
        strokeWidth={0.6}
        strokeDasharray="1 9"
        opacity={0.85}
      />
      <circle cx="24" cy="26" r={3.2} fill="rgba(200,226,255,0.9)" opacity={0.85} />
      <circle cx="48" cy="30" r={2.6} fill="rgba(163,238,218,0.85)" opacity={0.8} />
      <circle cx="44" cy="52" r={2.25} fill="rgba(205,216,238,0.75)" opacity={0.82} />
      <circle cx="28" cy="48" r={2.05} fill="rgba(247,237,228,0.55)" opacity={0.82} />
      <circle cx="36" cy="36" r={11} fill={`url(#${gradId})`} opacity={0.98} />
    </svg>
  );
}

function InlineSpinner({ className }: { className?: string }) {
  return <span className={`inline-spinner${className ? ` ${className}` : ""}`} aria-hidden />;
}

function JournalSystemSearch({ snap }: { snap: AppSnapshot }) {
  const toast = useToast();
  const systems: JournalSystemInfo[] = snap.journalSystems ?? [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [edsmHits, setEdsmHits] = useState<JournalSystemInfo[]>([]);
  const [edsmBusy, setEdsmBusy] = useState(false);
  const [edsmErr, setEdsmErr] = useState<string | null>(null);
  const [edsmSearchAttempted, setEdsmSearchAttempted] = useState(false);
  const [mapHydrateBusy, setMapHydrateBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const journalLoading = snap.journalBoot != null;

  useEffect(() => {
    if (!open || journalLoading) {
      setEdsmHits([]);
      setEdsmErr(null);
      setEdsmBusy(false);
      setEdsmSearchAttempted(false);
    }
  }, [open, journalLoading]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered =
    q === ""
      ? systems
      : systems.filter((s) => s.starSystem.toLowerCase().includes(q) || String(s.systemAddress).includes(q));

  const runEdsmGalaxySearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setEdsmBusy(true);
    setEdsmErr(null);
    setEdsmSearchAttempted(true);
    try {
      const r = await fetch(`/api/system/edsm-search?q=${encodeURIComponent(q)}`);
      const j = (await r.json().catch(() => null)) as {
        systems?: JournalSystemInfo[];
        error?: string;
      } | null;
      if (!r.ok) throw new Error(j?.error || r.statusText);
      setEdsmHits(j?.systems ?? []);
    } catch (e) {
      setEdsmErr(e instanceof Error ? e.message : "Galaxy search (EDSM) failed.");
      setEdsmHits([]);
    } finally {
      setEdsmBusy(false);
    }
  };

  const runHydrateFromEdsmForViewing = async () => {
    const addr = snap.viewingSystemAddress ?? snap.currentSystemAddress;
    if (addr == null || journalLoading) return;
    const name =
      (snap.viewingSystemAddress != null ? snap.viewingSystemName?.trim() : snap.currentSystem?.trim()) ||
      snap.primaryStarsHeader?.systemName?.trim() ||
      snap.currentSystem?.trim() ||
      systems.find((s) => s.systemAddress === addr)?.starSystem?.trim() ||
      "";
    if (!name) {
      toast.error(
        "Could not resolve system name for EDSM. Choose the system from search so a name is stored, then try again.",
      );
      return;
    }
    setMapHydrateBusy(true);
    try {
      const r = await fetch("/api/system/hydrate-from-edsm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemAddress: addr, systemName: name }),
      });
      const j = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!r.ok) {
        toast.error(j?.error || r.statusText);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load bodies from EDSM.");
    } finally {
      setMapHydrateBusy(false);
    }
  };

  const applyView = (systemAddress: number | null, meta?: { starSystem?: string }) => {
    void (async () => {
      try {
        const payload: { systemAddress: number | null; starSystem?: string } = {
          systemAddress,
        };
        if (
          systemAddress != null &&
          typeof meta?.starSystem === "string" &&
          meta.starSystem.trim().length > 0
        ) {
          payload.starSystem = meta.starSystem.trim();
        }
        const r = await fetch("/api/ui/view-system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not change system view.");
      }
    })();
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="journal-system-search" ref={wrapRef}>
      <input
        type="search"
        className="journal-system-search-input"
        autoComplete="off"
        placeholder={journalLoading ? "Loading journals…" : "Search journal or galaxy (EDSM)…"}
        value={query}
        disabled={journalLoading}
        onChange={(e) => {
          setQuery(e.target.value);
          setEdsmHits([]);
          setEdsmErr(null);
          setEdsmSearchAttempted(false);
          setOpen(true);
        }}
        onFocus={() => !journalLoading && setOpen(true)}
        aria-label="Search systems from journal or EDSM"
        aria-expanded={open}
        aria-controls="journal-system-search-results"
      />
      {(snap.viewingSystemAddress != null || snap.currentSystemAddress != null) && !journalLoading ? (
        <div className="journal-system-view-actions">
          {snap.viewingSystemAddress != null ? (
            <button
              type="button"
              className="journal-system-follow-btn"
              title="Leave journal lookup and return to the commander’s live system"
              onClick={() => applyView(null)}
            >
              Return to commander
            </button>
          ) : null}
          <button
            type="button"
            className="journal-system-edsm-load-btn"
            disabled={mapHydrateBusy}
            title="Fetch body list from EDSM for the focused system (commander or browsed system). Manual only."
            onClick={() => void runHydrateFromEdsmForViewing()}
          >
            {mapHydrateBusy ? (
              <>
                <InlineSpinner /> Loading…
              </>
            ) : (
              "Load bodies from EDSM"
            )}
          </button>
        </div>
      ) : null}
      {open && !journalLoading ? (
        <ul
          className="journal-system-search-results"
          id="journal-system-search-results"
          role="listbox"
          aria-label="Matching systems"
        >
          {filtered.length > 0
            ? filtered.slice(0, 50).map((s) => (
                <li key={s.systemAddress}>
                  <button
                    type="button"
                    className="journal-system-search-row"
                    role="option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
                  >
                    <span className="journal-system-search-name">{s.starSystem}</span>
                    <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
                  </button>
                </li>
              ))
            : null}
          {filtered.length === 0 && query.trim().length > 0 && q.length < 2 ? (
            <li className="journal-system-search-empty dim">
              No journal matches — type at least 2 letters, then search EDSM below.
            </li>
          ) : null}
          {filtered.length === 0 && q.length >= 2 ? (
            <>
              <li className="journal-system-search-edsm-action">
                <button
                  type="button"
                  className="journal-system-edsm-search-btn"
                  disabled={edsmBusy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runEdsmGalaxySearch()}
                >
                  {edsmBusy ? (
                    <>
                      <InlineSpinner />
                      Searching EDSM…
                    </>
                  ) : (
                    "Search galaxy (EDSM)"
                  )}
                </button>
              </li>
              {!edsmBusy && edsmErr ? <li className="journal-system-search-empty">{edsmErr}</li> : null}
              {!edsmBusy && !edsmErr && edsmSearchAttempted && edsmHits.length === 0 ? (
                <li className="journal-system-search-empty dim">No EDSM matches for “{query.trim()}”.</li>
              ) : null}
              {!edsmBusy &&
                edsmHits.map((s) => (
                  <li key={`edsm-${s.systemAddress}`}>
                    <button
                      type="button"
                      className="journal-system-search-row journal-system-search-row--edsm"
                      role="option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
                    >
                      <span className="journal-system-search-name">{s.starSystem}</span>
                      <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
                      <span className="journal-system-search-edsm-badge dim">EDSM</span>
                    </button>
                  </li>
                ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

const EXO_MAP_CR_MIN = 1_000_000;
const EXO_MAP_CR_MAX = 20_000_000;
const EXO_MAP_CR_STEP = 50_000;
/** Leave room so ++ can always be at least one step above + within the 20M cap. */
const EXO_MAP_PLUS_SLIDER_MAX = EXO_MAP_CR_MAX - EXO_MAP_CR_STEP;

function MapOptionsModal({
  snap,
  plusMinCr,
  plusPlusMinCr,
  onResetExobiology,
  onClose,
}: {
  snap: AppSnapshot;
  plusMinCr: number;
  plusPlusMinCr: number;
  onResetExobiology: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const [optPlus, setOptPlus] = useState(plusMinCr);
  const [optPlusPlus, setOptPlusPlus] = useState(plusPlusMinCr);
  const [dssSlackSectionOpen, setDssSlackSectionOpen] = useState(false);
  const [dssSlackTemp, setDssSlackTemp] = useState(0);
  const [dssSlackPress, setDssSlackPress] = useState(0);
  const [dssSlackGrav, setDssSlackGrav] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const dssSlackSaveTimerRef = useRef<number | null>(null);
  const pendingDssSlackRef = useRef<{ t: number; p: number; g: number } | null>(null);
  const pendingTiersRef = useRef<{ p: number; pp: number } | null>(null);
  const tail = snap.journalPath ? snap.journalPath.split(/[/\\]/).pop() : "none";

  const persistExoMapTiers = useCallback(
    (p: number, pp: number) => {
      void (async () => {
        try {
          const r = await fetch("/api/settings/exo-map-tiers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plusMinCr: p, plusPlusMinCr: pp }),
          });
          const j = (await r.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not save options.");
        }
      })();
    },
    [toast],
  );

  const persistDssPhysicalSlack = useCallback(
    (t: number, p: number, g: number) => {
      void (async () => {
        try {
          const r = await fetch("/api/settings/dss-physical-slack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              temperaturePercent: t,
              pressurePercent: p,
              gravityPercent: g,
            }),
          });
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not save DSS slack options.");
        }
      })();
    },
    [toast],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (dssSlackSaveTimerRef.current != null) {
        window.clearTimeout(dssSlackSaveTimerRef.current);
        dssSlackSaveTimerRef.current = null;
      }
      const pending = pendingTiersRef.current;
      if (pending) persistExoMapTiers(pending.p, pending.pp);
      const dss = pendingDssSlackRef.current;
      if (dss) persistDssPhysicalSlack(dss.t, dss.p, dss.g);
    };
  }, [persistExoMapTiers, persistDssPhysicalSlack]);

  useEffect(() => {
    setOptPlus(Math.min(plusMinCr, EXO_MAP_PLUS_SLIDER_MAX));
    setOptPlusPlus(plusPlusMinCr);
  }, [plusMinCr, plusPlusMinCr]);

  useEffect(() => {
    setDssSlackTemp(Math.max(0, Math.min(50, Math.round(snap.dssSlackTemperaturePercent ?? 0))));
    setDssSlackPress(Math.max(0, Math.min(50, Math.round(snap.dssSlackPressurePercent ?? 0))));
    setDssSlackGrav(Math.max(0, Math.min(50, Math.round(snap.dssSlackGravityPercent ?? 0))));
  }, [snap.dssSlackTemperaturePercent, snap.dssSlackPressurePercent, snap.dssSlackGravityPercent]);

  const serverJournalHistoryPreset: JournalHistoryPreset = snap.journalHistoryPreset ?? "all";
  const [limitJournalHistory, setLimitJournalHistory] = useState(serverJournalHistoryPreset !== "all");
  const [journalWindowPreset, setJournalWindowPreset] = useState<Exclude<JournalHistoryPreset, "all">>(
    serverJournalHistoryPreset !== "all" ? serverJournalHistoryPreset : "1m",
  );

  useEffect(() => {
    const p = snap.journalHistoryPreset ?? "all";
    setLimitJournalHistory(p !== "all");
    if (p !== "all") setJournalWindowPreset(p);
  }, [snap.journalHistoryPreset]);

  const persistJournalHistory = useCallback(
    async (preset: JournalHistoryPreset) => {
      try {
        const r = await fetch("/api/settings/journal-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save journal history option.");
      }
    },
    [toast],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const queueSave = (p: number, pp: number) => {
    pendingTiersRef.current = { p, pp };
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const cur = pendingTiersRef.current;
      if (cur) persistExoMapTiers(cur.p, cur.pp);
    }, 320);
  };

  const queueDssSlackSave = (t: number, p: number, g: number) => {
    pendingDssSlackRef.current = { t, p, g };
    if (dssSlackSaveTimerRef.current != null) window.clearTimeout(dssSlackSaveTimerRef.current);
    dssSlackSaveTimerRef.current = window.setTimeout(() => {
      dssSlackSaveTimerRef.current = null;
      const cur = pendingDssSlackRef.current;
      if (cur) persistDssPhysicalSlack(cur.t, cur.p, cur.g);
    }, 320);
  };

  const plusPlusSliderMin = Math.min(
    EXO_MAP_CR_MAX,
    Math.ceil((optPlus + 1) / EXO_MAP_CR_STEP) * EXO_MAP_CR_STEP,
  );

  const dssSlackMaxPct = Math.max(dssSlackTemp, dssSlackPress, dssSlackGrav);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="options-modal-title">Options</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="options-meta-block">
            {snap.lastJournalEventIso ? (
              <p className="options-last-event dim">
                <span className="options-last-event-label">Last event:</span> {snap.lastJournalEventIso}
              </p>
            ) : null}
            <p className="options-journal-line dim">
              Journal: <code>{tail}</code>
              {snap.journalFileCount > 0 ? (
                <span className="tab"> · merged {snap.journalFileCount} log file(s)</span>
              ) : null}
            </p>
            <p className="options-journal-line dim">Species DB: {snap.speciesCount}</p>
            {snap.mode === "server" && snap.lanUrls.length > 0 ? (
              <p className="options-journal-line dim">Phone: {snap.lanUrls.join(" · ")}</p>
            ) : (
              <p className="options-journal-line dim">LAN server: use npm run start:server</p>
            )}
          </section>

          <section className="options-journal-history options-meta-block">
            <p className="dim" style={{ marginBottom: "0.65rem", lineHeight: 1.45 }}>
              <strong>Journal history</strong> — by default the app merges <strong>every</strong>{" "}
              <code>Journal.*.log</code> in your Elite folder (all journal logs). Check the box below to use
              only a rolling time window (the cutoff uses real time and advances while the app runs; changing
              this triggers a full journal resync).
            </p>
            <label className="options-journal-history-row">
              <input
                type="checkbox"
                checked={limitJournalHistory}
                onChange={(ev) => {
                  const on = ev.target.checked;
                  setLimitJournalHistory(on);
                  void persistJournalHistory(on ? journalWindowPreset : "all");
                }}
              />
              <span>Limit merged logs to a rolling window…</span>
            </label>
            {limitJournalHistory ? (
              <div className="options-tier-field" style={{ marginTop: "0.55rem" }}>
                <label htmlFor="journal-history-window">Include logs from</label>
                <select
                  id="journal-history-window"
                  value={journalWindowPreset}
                  onChange={(ev) => {
                    const v = ev.target.value as Exclude<JournalHistoryPreset, "all">;
                    setJournalWindowPreset(v);
                    void persistJournalHistory(v);
                  }}
                >
                  {journalHistoryWindowPresetChoices().map((p) => (
                    <option key={p} value={p}>
                      {journalHistoryPresetLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>

          <p className="dim" style={{ marginBottom: "1rem", lineHeight: 1.45 }}>
            <strong>Minimum CR for single +</strong> is the lowest per-species sell value (CR) that must be
            met before the system map shows a <strong>+</strong> on that planet for exobiology.
          </p>
          <p className="dim" style={{ marginBottom: "1rem", lineHeight: 1.45 }}>
            <strong>Minimum CR for ++ (always above +)</strong> does the same but with a higher threshold:
            when it is met, the map shows <strong>++</strong> instead of <strong>+</strong>, so you can spot
            the more valuable exobiology finds quickly. The ++ threshold must stay above the + threshold.
          </p>
          <div className="options-tier-field">
            <label htmlFor="exo-tier-plus">Minimum CR for single +</label>
            <input
              id="exo-tier-plus"
              type="range"
              min={EXO_MAP_CR_MIN}
              max={EXO_MAP_PLUS_SLIDER_MAX}
              step={EXO_MAP_CR_STEP}
              value={Math.min(optPlus, EXO_MAP_PLUS_SLIDER_MAX)}
              onChange={(ev) => {
                const plus = Number(ev.target.value);
                let pp = optPlusPlus;
                if (pp <= plus) {
                  pp = Math.min(EXO_MAP_CR_MAX, plus + EXO_MAP_CR_STEP);
                  if (pp <= plus) pp = plus + 1;
                }
                setOptPlus(plus);
                setOptPlusPlus(pp);
                queueSave(plus, pp);
              }}
            />
            <div className="options-tier-value">
              {Math.min(optPlus, EXO_MAP_PLUS_SLIDER_MAX).toLocaleString()} CR
            </div>
          </div>
          <div className="options-tier-field">
            <label htmlFor="exo-tier-plusplus">Minimum CR for ++ (always above +)</label>
            <input
              id="exo-tier-plusplus"
              type="range"
              min={plusPlusSliderMin}
              max={EXO_MAP_CR_MAX}
              step={EXO_MAP_CR_STEP}
              value={Math.max(plusPlusSliderMin, optPlusPlus)}
              onChange={(ev) => {
                let pp = Number(ev.target.value);
                pp = Math.round(pp / EXO_MAP_CR_STEP) * EXO_MAP_CR_STEP;
                const minPP = plusPlusSliderMin;
                pp = Math.max(minPP, Math.min(EXO_MAP_CR_MAX, pp));
                setOptPlusPlus(pp);
                queueSave(optPlus, pp);
              }}
            />
            <div className="options-tier-value">
              {Math.max(plusPlusSliderMin, optPlusPlus).toLocaleString()} CR (min{" "}
              {plusPlusSliderMin.toLocaleString()} CR)
            </div>
          </div>

          <div className="options-slack-block">
            <button
              type="button"
              className="options-slack-expand-trigger"
              onClick={() => setDssSlackSectionOpen((v) => !v)}
              aria-expanded={dssSlackSectionOpen}
            >
              DSS physical gate slack (0–50%) {dssSlackSectionOpen ? "▲" : "▼"}
            </button>
            {dssSlackSectionOpen ? (
              <div className="options-slack-expand-panel">
                <p className="dim tiny options-slack-intro">
                  If a lot of landable worlds refuse normal codex matching (temperature bands from the
                  estimator, journal pressure, or gravity), raise these only as much as you need. Leave
                  everything at <strong>0%</strong> for standard matching—no extra relaxation on those
                  physical fallbacks.
                </p>
                {dssSlackMaxPct > 5 ? (
                  <p className="options-slack-strong-warn tiny" role="status">
                    Above <strong>5%</strong> the app will bend temperature, pressure, and gravity gates more
                    aggressively; you may get candidate species that are unlikely on that body. Treat extra
                    matches as leads to check in the codex or in-game, not as proof.
                  </p>
                ) : null}
                <div className="options-tier-field">
                  <label htmlFor="dss-slack-temp">Temperature slack (%)</label>
                  <input
                    id="dss-slack-temp"
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={dssSlackTemp}
                    onChange={(ev) => {
                      const t = Number(ev.target.value);
                      setDssSlackTemp(t);
                      queueDssSlackSave(t, dssSlackPress, dssSlackGrav);
                    }}
                  />
                  <div className="options-tier-value">{dssSlackTemp}%</div>
                </div>
                <div className="options-tier-field">
                  <label htmlFor="dss-slack-press">Pressure slack (%)</label>
                  <input
                    id="dss-slack-press"
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={dssSlackPress}
                    onChange={(ev) => {
                      const p = Number(ev.target.value);
                      setDssSlackPress(p);
                      queueDssSlackSave(dssSlackTemp, p, dssSlackGrav);
                    }}
                  />
                  <div className="options-tier-value">{dssSlackPress}%</div>
                </div>
                <div className="options-tier-field">
                  <label htmlFor="dss-slack-grav">Gravity slack (%)</label>
                  <input
                    id="dss-slack-grav"
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={dssSlackGrav}
                    onChange={(ev) => {
                      const g = Number(ev.target.value);
                      setDssSlackGrav(g);
                      queueDssSlackSave(dssSlackTemp, dssSlackPress, g);
                    }}
                  />
                  <div className="options-tier-value">{dssSlackGrav}%</div>
                </div>
              </div>
            ) : null}
          </div>

          <button type="button" className="btn-top-danger options-reset-exo" onClick={onResetExobiology}>
            Reset exobiology…
          </button>
        </div>
      </div>
    </div>
  );
}

const BRAND_AUTHOR = "FALrenica";

/** Tooltip for header route row — NavRoute.json, Status.json, journal FSD. */
function routeNavCardTitle(snap: AppSnapshot): string {
  const parts: string[] = [];
  const fr = snap.liveShipFuelRange;
  const nav = fr?.navRoute;

  if (nav) {
    if (nav.onPlot && nav.routeRemainingLy != null) {
      parts.push(
        `${nav.routeJumpsRemaining ?? 0} jump(s) left · ${nav.routeRemainingLy.toFixed(2)} ly remaining of ${nav.routeTotalLy.toFixed(2)} ly total (NavRoute.json).`,
      );
    } else {
      parts.push(
        `Plotted route ${nav.routeTotalLy.toFixed(2)} ly total (sum of 3D StarPos steps in live Elite Dangerous NavRoute.json).`,
      );
    }
    if (nav.onPlot) {
      if (nav.anyRemainingLegOverMaxRange && fr?.maxJumpRangeLy != null) {
        parts.push(
          `At least one upcoming leg is farther than your merged Loadout max jump range (${fr.maxJumpRangeLy.toFixed(1)} ly) — FSD boosting or a longer path may be required.`,
        );
      }
      if (fr?.hasLiveStatusFuel) {
        if (nav.fuelCanFinishPlottedRoute === true) {
          parts.push(
            `Fuel: estimated sufficient to finish the route (Status.json tank vs per-leg use ~∝ jump distance², calibrated from your last FSDJump FuelUsed and JumpDist).`,
          );
        } else if (nav.fuelCanFinishPlottedRoute === false && nav.fuelJumpsReachableOnPlottedRoute != null) {
          parts.push(
            `Fuel: may run short — about ${nav.fuelJumpsReachableOnPlottedRoute} of ${nav.routeJumpsRemaining ?? "?"} upcoming jump(s) before the tank is dry (same model; refuel to refresh).`,
          );
        } else if (nav.fuelCanFinishPlottedRoute === null) {
          parts.push(
            `Fuel: merge a recent FSDJump (FuelUsed + JumpDist) in the journal to estimate tonnage per leg.`,
          );
        }
      }
      if (nav.routeRefuelAlert === "red") {
        parts.push(
          `Refuel warning (pulsing red): treat as urgent — e.g. no main-sequence scoopable (KGBFOAM-style O–M) star in the next 10 NavRoute systems, only scoop in the near window is here, and/or final plotted hop (station fuel not guaranteed). Uses the same star-class rules as the system map (data/system-map/star-roles.json).`,
        );
      } else if (nav.routeRefuelAlert === "yellow") {
        parts.push(
          `Refuel caution (pulsing yellow): narrow margin — about two hyperspace jumps before the tank is empty on the estimate, and/or plan to scoop at the next waypoint on the plot.`,
        );
      }
    } else {
      parts.push(
        `Your commander is not at a system in this NavRoute list — distances are for the file only.`,
      );
    }
  }

  if (snap.remainingJumpsInRoute != null) {
    parts.push(`Journal FSDTarget: ${snap.remainingJumpsInRoute} jump(s) remaining in route (game tally).`);
  }

  if (fr?.hasLiveStatusFuel) {
    parts.push(
      `Live tank: ${fr.fuelMainT.toFixed(2)} t main + ${fr.fuelReserveT.toFixed(2)} t reserve (${fr.fuelTotalT.toFixed(2)} t, Status.json).`,
    );
  }

  if (fr && !nav?.onPlot && fr.estJumpsRemaining != null && fr.calibration === "fsd_sample") {
    parts.push(
      `Without NavRoute context: ~${fr.estJumpsRemaining} max-range jump(s) (linear scale from last jump to Loadout max range — less accurate than route legs).`,
    );
  }

  if (nav?.onPlot && nav.routeJumpsRemaining != null && nav.routeJumpsRemaining > 0) {
    if (nav.jumpsToLastScoopableOnRoute != null) {
      parts.push(
        `Furthest main-sequence scoop reachable on current tank (NavRoute leg distances, FSDJump fuel × (leg/sample)², max jump per leg): ${nav.jumpsToLastScoopableOnRoute} jump(s) ahead.`,
      );
    } else {
      parts.push(
        `No fuel-scoopable star ahead on the remaining plot is reachable on the current tank and max-jump limits (NavRoute + Status + last FSDJump), or NavRoute StarClass rules it out.`,
      );
    }
  }

  return parts.join(" ");
}

type RouteHeaderMetricMode = "distance" | "refuel";

function routeHeaderToggleTitleHint(mode: RouteHeaderMetricMode): string {
  return mode === "distance"
    ? "Click: show jumps to furthest scoop reachable on current fuel (bar = that fraction of remaining hops)."
    : "Click: show light-years left and tank reach (blue = jumps you can finish on current fuel).";
}

/** Remaining plotted jumps vs fuel-reachable jumps — bar is blue for reachable fraction, red for the rest. */
function routeJumpFuelBarModel(snap: AppSnapshot): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  const fr = snap.liveShipFuelRange;
  const nav = fr?.navRoute;
  if (!nav?.onPlot || nav.routeJumpsRemaining == null || nav.routeJumpsRemaining <= 0) {
    return { showBar: false, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const jRem = nav.routeJumpsRemaining;
  /** Need live tank + FSD calibration for red segment. */
  const canShapeBar =
    fr?.hasLiveStatusFuel === true &&
    nav.fuelCanFinishPlottedRoute !== null &&
    nav.fuelJumpsReachableOnPlottedRoute != null;
  if (!canShapeBar) {
    return { showBar: true, bluePct: 100, redPct: 0, indeterminate: true };
  }
  const jFuel = Math.max(0, nav.fuelJumpsReachableOnPlottedRoute ?? 0);
  if (nav.fuelCanFinishPlottedRoute === true || jFuel >= jRem) {
    return { showBar: true, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const bluePct = Math.max(0, Math.min(100, (jFuel / jRem) * 100));
  return {
    showBar: true,
    bluePct,
    redPct: 100 - bluePct,
    indeterminate: false,
  };
}

/** Refuel view: blue = hops until last scoopable on plot; red = hops after that (no scoop until destination). */
function routeLastScoopBarModel(snap: AppSnapshot): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!nav?.onPlot || nav.routeJumpsRemaining == null || nav.routeJumpsRemaining <= 0) {
    return { showBar: false, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const jRem = nav.routeJumpsRemaining;
  const jLast = nav.jumpsToLastScoopableOnRoute;
  if (jLast == null) {
    return { showBar: true, bluePct: 0, redPct: 100, indeterminate: false };
  }
  const bluePct = Math.max(0, Math.min(100, (jLast / jRem) * 100));
  return {
    showBar: true,
    bluePct,
    redPct: 100 - bluePct,
    indeterminate: false,
  };
}

function routeHeaderBarModel(
  snap: AppSnapshot,
  mode: RouteHeaderMetricMode,
): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  return mode === "distance" ? routeJumpFuelBarModel(snap) : routeLastScoopBarModel(snap);
}

function routeJumpFuelBarAria(snap: AppSnapshot, model: ReturnType<typeof routeJumpFuelBarModel>): string {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!model.showBar || !nav?.onPlot || nav.routeJumpsRemaining == null) {
    return "Route summary";
  }
  const jRem = nav.routeJumpsRemaining;
  if (model.indeterminate) {
    return `Plotted route: ${jRem} jumps ahead — tank estimate needs Status.json fuel and a recent FSDJump in the journal.`;
  }
  const jF = nav.fuelJumpsReachableOnPlottedRoute ?? 0;
  if (model.redPct <= 0.5) {
    return `Tank covers all ${jRem} remaining jumps on this plot (estimated).`;
  }
  return `About ${Math.round(jF)} of ${jRem} jumps ahead on current tank (estimated); the rest exceeds plotted fuel (hover bar for details).`;
}

function routeLastScoopBarAria(snap: AppSnapshot, model: ReturnType<typeof routeLastScoopBarModel>): string {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!model.showBar || !nav?.onPlot || nav.routeJumpsRemaining == null) {
    return "Route — refuel window on plot";
  }
  const jRem = nav.routeJumpsRemaining;
  const jLast = nav.jumpsToLastScoopableOnRoute;
  if (jLast == null) {
    return `No main-sequence scoop ahead is reachable on current fuel and max jump (NavRoute legs) — ${jRem} jump(s) to destination. Bar is all caution (red).`;
  }
  if (model.redPct <= 0.5) {
    return `Furthest reachable scoop on this tank is at the route destination — ${jRem} jump(s).`;
  }
  return `Furthest scoop reachable on current fuel in ${jLast} jump(s); ${jRem} total ahead — red is hops after that star with no scoop.`;
}

function routeHeaderBarAria(
  snap: AppSnapshot,
  mode: RouteHeaderMetricMode,
  model: ReturnType<typeof routeHeaderBarModel>,
): string {
  if (mode === "distance") return routeJumpFuelBarAria(snap, model);
  return routeLastScoopBarAria(snap, model);
}

const EDEXO_ROUTE_HEADER_METRIC_LS = "edexo.routeHeaderMetricMode";
const EDEXO_COMPACT_CANDIDATE_VIEW_LS = "edexo.compactCandidateView";

function readRouteHeaderMetricMode(): RouteHeaderMetricMode {
  try {
    const v = localStorage.getItem(EDEXO_ROUTE_HEADER_METRIC_LS);
    if (v === "refuel" || v === "distance") return v;
  } catch {
    /* ignore */
  }
  return "distance";
}

function writeRouteHeaderMetricMode(m: RouteHeaderMetricMode) {
  try {
    localStorage.setItem(EDEXO_ROUTE_HEADER_METRIC_LS, m);
  } catch {
    /* ignore */
  }
}

const EDEXO_TEMP_UNIT_LS = "edexo.bodyTempUnit";
const EDEXO_PRESS_UNIT_LS = "edexo.bodyPressUnit";
const EDEXO_EXO_RANGE_COLLAPSED_LS = "edexo.exoRangeCollapsed";

function readTempUnitFromLs(): TempUnit {
  try {
    const v = localStorage.getItem(EDEXO_TEMP_UNIT_LS);
    if (v === "K" || v === "C" || v === "F") return v;
  } catch {
    /* ignore */
  }
  return "K";
}

function writeTempUnitToLs(u: TempUnit) {
  try {
    localStorage.setItem(EDEXO_TEMP_UNIT_LS, u);
  } catch {
    /* ignore */
  }
}

function readPressUnitFromLs(): PressDisplay {
  try {
    const v = localStorage.getItem(EDEXO_PRESS_UNIT_LS);
    if (v === "atm" || v === "pa") return v;
  } catch {
    /* ignore */
  }
  return "atm";
}

function writePressUnitToLs(u: PressDisplay) {
  try {
    localStorage.setItem(EDEXO_PRESS_UNIT_LS, u);
  } catch {
    /* ignore */
  }
}

const EXO_DATA_ALERT_DISMISS_LS = "edexo.exoDataAlertDismissals";
const EXO_ALERT_DETECT_JOURNAL_LS = "edexo.exoDataAlertDetectJournal";
const EXO_ALERT_DETECT_FEEDER_LS = "edexo.exoDataAlertDetectExoFeeder";
const EXO_ALERT_ACK_IDS_LS = "edexo.exoDataAlertsAckIds";
/** Route / fuel / data-value cards matter while travelling, not while sampling — so they fold. */
const EDEXO_HEADER_TRAY_LS = "edexo.headerTrayOpen";

function readExoAlertDismissals(): Set<string> {
  try {
    const raw = localStorage.getItem(EXO_DATA_ALERT_DISMISS_LS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function readLsBool(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v !== "0" && v !== "false";
  } catch {
    return defaultVal;
  }
}

function writeLsBool(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readExoAlertAckIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXO_ALERT_ACK_IDS_LS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeExoAlertAckIds(ids: Set<string>) {
  try {
    localStorage.setItem(EXO_ALERT_ACK_IDS_LS, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Re-show alerts for selected sources (clears client dismissals + ack for those ids). */
function applyExoDataScanSourceClear(detectJournal: boolean, detectFeeder: boolean): void {
  if (!detectJournal && !detectFeeder) return;
  const dismiss = readExoAlertDismissals();
  const ack = readExoAlertAckIds();
  const shouldDrop = (id: string): boolean => {
    if (detectJournal && (id.startsWith("err-codex-") || id.startsWith("err-hidden-"))) return true;
    if (detectFeeder && id.startsWith("warn-feeder-")) return true;
    return false;
  };
  let nextD: Set<string>;
  let nextA: Set<string>;
  if (detectJournal && detectFeeder) {
    nextD = new Set();
    nextA = new Set();
  } else {
    nextD = new Set(dismiss);
    nextA = new Set(ack);
    for (const id of dismiss) {
      if (shouldDrop(id)) nextD.delete(id);
    }
    for (const id of ack) {
      if (shouldDrop(id)) nextA.delete(id);
    }
  }
  try {
    localStorage.setItem(EXO_DATA_ALERT_DISMISS_LS, JSON.stringify([...nextD]));
  } catch {
    /* ignore */
  }
  writeExoAlertAckIds(nextA);
}

type ExoDataAlertWithBody = ExoDataAlertDTO & {
  bodyTabLabel: string;
  bodyKey: string;
};

function collectExoDataAlertsFromSnapshot(snap: AppSnapshot): ExoDataAlertWithBody[] {
  const byId = new Map<string, ExoDataAlertWithBody>();
  const ingest = (bc: BodyComputed) => {
    const bodyTabLabel = bc.tabLabel || bc.state.bodyName || bc.state.key;
    for (const a of bc.exoDataAlerts) {
      if (!byId.has(a.id)) {
        byId.set(a.id, { ...a, bodyTabLabel, bodyKey: bc.state.key });
      }
    }
  };
  for (const b of snap.bodies) ingest(b);
  if (snap.exoOverlayFocusBody) ingest(snap.exoOverlayFocusBody);
  return [...byId.values()];
}

function ExoDataAlertsHeaderHub({ snap }: { snap: AppSnapshot }) {
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [detectJournal, setDetectJournal] = useState(() => readLsBool(EXO_ALERT_DETECT_JOURNAL_LS, true));
  const [detectFeeder, setDetectFeeder] = useState(() => readLsBool(EXO_ALERT_DETECT_FEEDER_LS, true));
  const [dismissed, setDismissed] = useState(() => readExoAlertDismissals());
  const [ackEpoch, setAckEpoch] = useState(0);
  const [scanBusy, setScanBusy] = useState(false);

  const ackIds = useMemo(() => readExoAlertAckIds(), [ackEpoch]);

  const collected = useMemo(() => {
    if (snap.journalBoot) return [];
    return collectExoDataAlertsFromSnapshot(snap);
  }, [snap]);

  const filteredBySource = useMemo(
    () => collected.filter((a) => (a.detectionSource === "exomastery" ? detectFeeder : detectJournal)),
    [collected, detectJournal, detectFeeder],
  );

  const visible = useMemo(
    () => filteredBySource.filter((a) => !dismissed.has(a.id)),
    [filteredBySource, dismissed],
  );

  const hasUnread = useMemo(
    () => visible.length > 0 && visible.some((a) => !ackIds.has(a.id)),
    [visible, ackIds],
  );

  const topSeverity = useMemo(() => {
    if (visible.some((a) => a.severity === "error")) return "error";
    if (visible.some((a) => a.severity === "warning")) return "warning";
    return null;
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(EXO_DATA_ALERT_DISMISS_LS, JSON.stringify([...next]));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    if (snap.journalBoot) return;
    if (!detectJournal && !detectFeeder) return;
    setScanBusy(true);
    try {
      applyExoDataScanSourceClear(detectJournal, detectFeeder);
      setDismissed(readExoAlertDismissals());
      setAckEpoch((e) => e + 1);
      if (detectFeeder) {
        const r = await fetch("/api/exomastery/reload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanBusy(false);
    }
  }, [detectJournal, detectFeeder, snap.journalBoot, toast]);

  const fix = useCallback(
    async (a: ExoDataAlertDTO) => {
      const fallbackClipboard = async () => {
        const text = (a.fixClipboard ?? `${a.title}\n${a.detail}`).trim();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy fix hints (clipboard unavailable):", text);
        }
      };
      if (a.speciesEntryId && a.genusDataDir) {
        try {
          const r = await fetch("/api/exo-data-alerts/fix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alert: a }),
          });
          const j = (await r.json().catch(() => null)) as {
            ok?: boolean;
            written?: { root: string; relativePath: string }[];
            error?: string;
            notifyTarget?: "native" | "browser";
          } | null;
          if (!r.ok || !j?.ok) throw new Error(j?.error || r.statusText);
          if (j.notifyTarget === "native") return;
          const lines = (j.written ?? []).map((w) => `${w.relativePath}\n  (${w.root})`).join("\n\n");
          toast.success(
            lines
              ? `Fix stub written next to ${(j.written ?? []).length} source file(s); originals are untouched.`
              : "Fix stub written.",
          );
          return;
        } catch (e) {
          toast.error(
            e instanceof Error
              ? `${e.message}\n\nCopying hints to clipboard instead.`
              : "Fix failed; copying hints.",
          );
        }
      }
      await fallbackClipboard();
    },
    [toast],
  );

  const triggerClass = `exo-data-alerts-trigger btn-top-neutral${
    topSeverity === "error"
      ? " exo-data-alerts-trigger--error"
      : topSeverity === "warning"
        ? " exo-data-alerts-trigger--warn"
        : " exo-data-alerts-trigger--idle"
  }${hasUnread ? " exo-data-alerts-trigger--unread" : ""}`;

  let panelBody: ReactNode;
  if (snap.journalBoot) {
    panelBody = <p className="dim tiny">Journal loading…</p>;
  } else if (!detectJournal && !detectFeeder) {
    panelBody = (
      <p className="dim tiny">
        Turn on <strong>Journal</strong> and/or <strong>Exo-Feeder</strong> to scan for mismatches.
      </p>
    );
  } else if (visible.length > 0) {
    panelBody = (
      <div className="exo-data-alerts exo-data-alerts--in-popover" role="list">
        {visible.map((a) => (
          <div key={a.id} className={`exo-data-alert exo-data-alert--${a.severity}`} role="listitem">
            <span className={`exo-data-alert__icon exo-data-alert__icon--${a.severity}`} aria-hidden>
              {a.severity === "error" ? "!" : "⚠"}
            </span>
            <div className="exo-data-alert__text">
              <div className="exo-data-alert__meta">{a.bodyTabLabel}</div>
              <div className="exo-data-alert__title">{a.title}</div>
              <div className="exo-data-alert__detail">{a.detail}</div>
            </div>
            <div className="exo-data-alert__actions">
              <button
                type="button"
                className="exo-data-alert__btn"
                title="Append a fixes_*.json stub next to the codex or exomastery file (never overwrites the original)."
                onClick={() => void fix(a)}
              >
                Fix
              </button>
              <button
                type="button"
                className="exo-data-alert__btn exo-data-alert__btn--secondary"
                onClick={() => dismiss(a.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (filteredBySource.length > 0) {
    panelBody = <p className="dim tiny">All alerts dismissed.</p>;
  } else if (collected.length > 0) {
    panelBody = (
      <p className="dim tiny">
        No alerts for enabled sources — turn on Journal or Exo-Feeder to see hidden items.
      </p>
    );
  } else {
    panelBody = <p className="dim tiny">No mismatches detected for loaded bodies.</p>;
  }

  return (
    <div className="exo-data-alerts-header-wrap" ref={wrapRef}>
      <button
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Codex consistency alerts: journal and exo-feeder checks"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              const merged = new Set(readExoAlertAckIds());
              for (const a of visible) merged.add(a.id);
              writeExoAlertAckIds(merged);
              setAckEpoch((e) => e + 1);
            }
            return next;
          });
        }}
        title="Codex consistency: journal vs genus_new.json, and exo-feeder profiles vs codex (toggle sources inside)."
      >
        <span className="exo-data-alerts-trigger__mail" aria-hidden>
          ✉
        </span>
        {topSeverity === "error" ? (
          <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--error" aria-hidden>
            !
          </span>
        ) : topSeverity === "warning" ? (
          <span className="exo-data-alerts-trigger__glyph exo-data-alerts-trigger__glyph--warn" aria-hidden>
            ⚠
          </span>
        ) : null}
        {visible.length > 0 ? <span className="exo-data-alerts-trigger__badge">{visible.length}</span> : null}
      </button>
      {open ? (
        <div className="exo-data-alerts-popover" role="dialog" aria-label="Codex consistency alerts">
          <div className="exo-data-alerts-popover__detect">
            <span className="exo-data-alerts-popover__detect-label">Detect from:</span>
            <button
              type="button"
              className={`btn-top-toggle exo-data-alerts-source-toggle${detectJournal ? " btn-top-toggle--on" : ""}`}
              aria-pressed={detectJournal}
              onClick={() => {
                const v = !detectJournal;
                setDetectJournal(v);
                writeLsBool(EXO_ALERT_DETECT_JOURNAL_LS, v);
              }}
            >
              Journal
            </button>
            <button
              type="button"
              className={`btn-top-toggle exo-data-alerts-source-toggle${detectFeeder ? " btn-top-toggle--on" : ""}`}
              aria-pressed={detectFeeder}
              onClick={() => {
                const v = !detectFeeder;
                setDetectFeeder(v);
                writeLsBool(EXO_ALERT_DETECT_FEEDER_LS, v);
              }}
            >
              Exo-Feeder
            </button>
            <button
              type="button"
              className="exo-data-alerts-scan-btn"
              disabled={scanBusy || (!detectJournal && !detectFeeder) || snap.journalBoot != null}
              title={
                "Re-check: clears dismissals for the selected sources so those alerts show again. " +
                "With Exo-Feeder on, reloads species/exomastery data from disk after journal-side refresh (journal first, then feeder reload)."
              }
              onClick={() => void runScan()}
            >
              {scanBusy ? "…" : "Scan"}
            </button>
          </div>
          {panelBody}
        </div>
      ) : null}
    </div>
  );
}

function LiveSnapshotFreshness({ connected }: { connected: boolean }) {
  /** Subscribed rather than passed down: this value changes on every push, and threading it
   * through <HeaderBar> would re-render the header each time. */
  const lastAt = useLastStateAt();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!connected || lastAt == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [connected, lastAt]);

  if (!connected || lastAt == null) return null;

  const sec = Math.floor((Date.now() - lastAt) / 1000);
  let label: string;
  if (sec < 2) label = "just now";
  else if (sec < 60) label = `${sec}s ago`;
  else if (sec < 3600) label = `${Math.floor(sec / 60)}m ago`;
  else label = `${Math.floor(sec / 3600)}h ago`;

  return (
    <span className="top-live-freshness" title="Last live snapshot from server">
      {" "}
      · {label}
    </span>
  );
}

function CopySystemNameButton({ systemName }: { systemName: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      void (async () => {
        try {
          await navigator.clipboard.writeText(systemName);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      })();
    },
    [systemName],
  );

  return (
    <button
      type="button"
      className="brand-sys-copy-name"
      onClick={onCopy}
      title={copied ? "Copied" : "Copy system name"}
      aria-label="Copy system name"
    >
      ⧉
    </button>
  );
}

const HeaderBar = memo(function HeaderBar({
  snap,
  connected,
  onFootCatalogNavigate,
  onGoToBioBody,
  encyclopediaSpawnCompare,
  onOpenSystemMap,
}: {
  snap: AppSnapshot;
  connected: boolean;
  onFootCatalogNavigate?: (e: FootScannedEntry) => void;
  onGoToBioBody?: (bodyKey: string) => void;
  encyclopediaSpawnCompare: EncyclopediaSpawnCompare | null;
  onOpenSystemMap: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const scanDataOn = snap.includeExplorationScanDataInDataValue === true;
  const explorationCr = snap.explorationScanDataValueCredits ?? 0;
  const totalDataCr = snap.organicDataValueCredits + (scanDataOn ? explorationCr : 0);
  /** A journal event that moves these numbers should be visible where the user is looking. */
  const dataValueFlash = useValueFlash(totalDataCr);
  const pendingSamplesFlash = useValueFlash(snap.organicPendingSampleCount);
  /**
   * This was a ~700-character `title` attribute — the longest and most useful explanation in the
   * app, and the least reachable: native tooltips truncate, never wrap, and never appear for
   * keyboard or touch. It now lives behind an ⓘ next to the value.
   */
  const dataValueHelp = (
    <>
      <p>
        Typical UC value for unsold exobiology in your journal: each completed species on a body (two{" "}
        <code>ScanOrganic</code> Sample lines plus one Analyse, or any Analyse that completes the set), priced
        from <code>price-list.json</code>.
      </p>
      <p>
        On a first-footfall body the game pays <strong>5×</strong> the listed value (1× normal plus a 4×
        first-footfall bonus, shown separately in-game). That qualifies when a detailed
        <code> Scan</code> listed <code>WasFootfalled: false</code> for the body and you later disembarked on
        it (OnPlanet, not OnStation), or the journal set <code>firstfootfall</code>
        on Disembark.
      </p>
      <p>Selling organic data — or dying — clears unsold samples in the journal replay.</p>
      {scanDataOn ? (
        <p>
          This total also includes an approximate UC value for merged FSS/DSS exploration scans from the
          journal, using <code>Scan</code> <code>WasDiscovered</code> / <code>WasMapped</code> where present.
        </p>
      ) : null}
      <p className="dim">Click the value itself for a per-sample breakdown.</p>
    </>
  );
  const [dataBreakdownOpen, setDataBreakdownOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [myExoOpen, setMyExoOpen] = useState(false);
  const [encyclopediaOpen, setEncyclopediaOpen] = useState(false);
  const [notableQuick, setNotableQuick] = useState<{
    notable: NotableBodyInfo;
    x: number;
    y: number;
  } | null>(null);
  const [routeHeaderMetricMode, setRouteHeaderMetricMode] = useState<RouteHeaderMetricMode>(() =>
    readRouteHeaderMetricMode(),
  );
  const [trayOpen, setTrayOpen] = useState(() => readLsBool(EDEXO_HEADER_TRAY_LS, true));

  useEffect(() => {
    writeRouteHeaderMetricMode(routeHeaderMetricMode);
  }, [routeHeaderMetricMode]);

  useEffect(() => {
    writeLsBool(EDEXO_HEADER_TRAY_LS, trayOpen);
  }, [trayOpen]);

  const routeCardRefuelClass = (() => {
    const nav = snap.liveShipFuelRange?.navRoute;
    if (!nav?.onPlot) return "";
    if (nav.routeRefuelAlert === "red") return " header-route--refuel-red";
    if (nav.routeRefuelAlert === "yellow") return " header-route--refuel-yellow";
    return "";
  })();

  useEffect(() => {
    if (!dataBreakdownOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDataBreakdownOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dataBreakdownOpen]);

  const toggleExplorationScanData = () => {
    void (async () => {
      try {
        const r = await fetch("/api/settings/include-exploration-scan-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: !scanDataOn }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  };

  const resetExobiology = () => {
    void (async () => {
      const ok = await confirm({
        title: "Reset exobiology tracking?",
        message:
          "This clears scan progress toward completed samples, the pending “Data value” total, and " +
          "first-footfall / WasFootfalled flags held in memory.\n\n" +
          "Your Elite journal files on disk are not modified — restarting the app and re-merging " +
          "journals rebuilds this state from the logs.",
        confirmLabel: "Reset tracking",
        tone: "danger",
      });
      if (!ok) return;
      try {
        const r = await fetch("/api/exobiology/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not reset.");
      }
    })();
  };

  const cmdr = snap.commanderName?.trim();
  const fdev = useFdevServerStatus();
  const fdevDotClass =
    fdev.statusText === "Checking…"
      ? "appbar-dot--pending"
      : fdev.healthy
        ? "appbar-dot--ok"
        : "appbar-dot--err";

  const hasStars = (snap.primaryStarsHeader?.stars.length ?? 0) > 0;
  const hasNotable = (snap.notableBodies?.length ?? 0) > 0;

  return (
    <header className="top">
      <div className="appbar">
        <img src="/edexo-icon-124.webp" alt="" className="appbar-mark" width={24} height={24} />
        <span className="appbar-wordmark logo">ED EXO COMPARE</span>

        {snap.primaryStarsHeader ? (
          <div className="appbar-system">
            <button
              type="button"
              className="appbar-system-btn"
              onClick={onOpenSystemMap}
              title="Open system map (orbital view from merged journal)"
            >
              <StarSystemMapIcon className="appbar-system-icon" />
              <span className="appbar-system-name">{snap.primaryStarsHeader.systemName}</span>
            </button>
            <CopySystemNameButton systemName={snap.primaryStarsHeader.systemName} />
          </div>
        ) : null}

        <div className="appbar-search">
          <JournalSystemSearch snap={snap} />
        </div>

        <span className="appbar-spacer" />

        <Tooltip
          className="appbar-status"
          text={
            connected
              ? "Connected to the journal service — live snapshots are arriving."
              : "No live connection to the journal service. Check that it is still running."
          }
        >
          <span className={`appbar-dot${connected ? " appbar-dot--ok" : " appbar-dot--err"}`}>
            <span className="top-live-dot" aria-hidden />
            <span className="appbar-dot-text">
              {connected ? "Live" : "Error"}
              <LiveSnapshotFreshness connected={connected} />
            </span>
          </span>
        </Tooltip>

        <Tooltip
          className="appbar-status"
          text={`Frontier server status: ${fdev.statusText}${fdev.fromEdsm ? " (via EDSM)" : ""}`}
        >
          <span className={`appbar-dot ${fdevDotClass}`}>
            <span className="top-live-dot" aria-hidden />
            <span className="appbar-dot-text appbar-dot-text--compact">FDev</span>
          </span>
        </Tooltip>

        {cmdr ? (
          <span className="appbar-cmdr">
            <span className="top-playing-as-muted">CMDR </span>
            <span className="top-playing-as-cmdr">{cmdr}</span>
          </span>
        ) : null}

        <div className="appbar-actions">
          <ExoDataAlertsHeaderHub snap={snap} />
          <Tooltip text="My exobiology — completed on-foot samples recorded from your journal.">
            <button
              type="button"
              className="appbar-icon-btn"
              onClick={() => setMyExoOpen(true)}
              aria-label="My exobiology"
            >
              <IconExobiology />
            </button>
          </Tooltip>
          <Tooltip text="Encyclopedia — every species, its requirements, and what you have found.">
            <button
              type="button"
              className="appbar-icon-btn"
              onClick={() => setEncyclopediaOpen(true)}
              aria-label="Encyclopedia"
            >
              <IconEncyclopedia />
            </button>
          </Tooltip>
          <Tooltip text="Options — journal service info, map tier thresholds, reset.">
            <button
              type="button"
              className="appbar-icon-btn"
              onClick={() => setOptionsOpen(true)}
              aria-label="Options"
            >
              <IconOptions />
            </button>
          </Tooltip>
          <Tooltip
            text={
              trayOpen
                ? "Hide the route, fuel and data value tray"
                : "Show the route, fuel and data value tray"
            }
          >
            <button
              type="button"
              className={`appbar-icon-btn appbar-tray-toggle${trayOpen ? " appbar-tray-toggle--open" : ""}`}
              onClick={() => setTrayOpen((v) => !v)}
              aria-expanded={trayOpen}
              aria-controls="header-tray"
              aria-label="Route, fuel and data value"
            >
              <IconChevronDown />
            </button>
          </Tooltip>
        </div>
      </div>

      {snap.edsmMapSupplementForViewingSystem ? (
        <p className="header-edsm-map-note dim">
          System map uses public EDSM data (no journal <code>Scan</code> for this system yet).
        </p>
      ) : null}

      {hasStars || hasNotable ? (
        <div className="context-strip" aria-label="System context">
          {hasStars ? (
            <div className="context-group">
              <span className="context-label">Stars</span>
              {snap.primaryStarsHeader!.stars.map((st, i) => (
                <span
                  key={`${st.shortLabel}-${st.starRole}-${i}`}
                  className={`brand-star-chip ${primaryStarChipClass(st.starRole)}`}
                  title={primaryStarRoleTooltip(st.starRole) + (st.shortLabel ? ` · ${st.shortLabel}` : "")}
                >
                  <span className="brand-star-chip-letter">{st.letter ?? "★"}</span>
                  <span className="brand-star-chip-role"> ({primaryStarRoleTag(st.starRole)})</span>
                  {st.fullSpectralNotation ? (
                    <span className="brand-star-chip-spectral"> {st.fullSpectralNotation}</span>
                  ) : null}
                  {st.shortLabel ? <span className="brand-star-chip-name"> · {st.shortLabel}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {hasNotable ? (
            <div className="context-group" role="list">
              <span className="context-label">Notable</span>
              {snap.notableBodies!.map((n, i) => (
                <button
                  type="button"
                  role="listitem"
                  key={`${n.systemAddress}-${n.bodyId}-${i}`}
                  className={`brand-notable-pill${n.dssMapped ? " brand-notable-pill--dss" : " brand-notable-pill--fss"}`}
                  title={
                    (n.dssMapped
                      ? "DSS complete in merged journal (SAAScanComplete)"
                      : "Matched scan only — no DSS complete in merged journal for this body") +
                    " — click for quick facts"
                  }
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setNotableQuick({ notable: n, x: ev.clientX, y: ev.clientY });
                  }}
                >
                  <span className="brand-notable-body">
                    {n.bodyLabelShort}
                    <span className="brand-notable-tag"> - {n.tag}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {trayOpen ? (
        <div className="header-data-value-row header-tray" id="header-tray">
          <button
            type="button"
            className={`header-scan-data-plus${scanDataOn ? " header-scan-data-plus--on" : ""}`}
            onClick={toggleExplorationScanData}
            title="Add planetary scans to data value"
            aria-pressed={scanDataOn}
          >
            ⊕
          </button>
          <button
            type="button"
            className="data-value-pill data-value-pill--clickable"
            title="Unsold exobiology value — click for a per-sample breakdown"
            onClick={() => setDataBreakdownOpen(true)}
          >
            <span className="data-value-label header-metric-card-label">Data value</span>
            <span className={`data-value-amount header-metric-card-value ${dataValueFlash}`.trim()}>
              {totalDataCr.toLocaleString()} CR
            </span>
            {snap.organicPendingSampleCount > 0 ? (
              <span
                className={`data-value-meta dim ${pendingSamplesFlash}`.trim()}
                title="Completed samples not yet sold"
              >
                ({snap.organicPendingSampleCount})
              </span>
            ) : null}
          </button>
          <InfoPopover title="How “Data value” is calculated" label="How data value is calculated">
            {dataValueHelp}
          </InfoPopover>
          <div className="header-dscan-cluster">
            <div className="header-dscan-pill">
              {snap.dScanBodies ? (
                <DScanBodiesBadge d={snap.dScanBodies} className="d-scan-card--header-row" headerMetrics />
              ) : (
                <button
                  type="button"
                  className="d-scan-card d-scan-card--placeholder d-scan-card--header-row"
                  title="No FSS honk line in merged journal for this system yet — if you already mapped everything, totals still come from Scan rows and the system map. Use “Load bodies from EDSM” next to the search when browsing a system, or widen journal history / re-honk in game if counts stay empty."
                >
                  <span className="d-scan-card__label header-metric-card-label">D-Scan</span>
                  <span className="d-scan-card__placeholder-text header-metric-card-value">
                    No body tally yet (honk, Scan data, or map)
                  </span>
                </button>
              )}
            </div>
            {snap.focusedSystemUndiscoveredFromLastFsdJump ? (
              <div
                className="d-scan-card d-scan-card--complete d-scan-card--header-row header-route-mini"
                title="Journal FSDJump/CarrierJump reported WasDiscovered: false — first discovery of this system."
              >
                <span className="d-scan-card__label header-metric-card-label">FIRST</span>
              </div>
            ) : null}
            {snap.remainingJumpsInRoute != null || snap.liveShipFuelRange != null
              ? (() => {
                  const fr = snap.liveShipFuelRange;
                  const nav = fr?.navRoute;
                  const jumpsShown =
                    nav?.onPlot && nav.routeJumpsRemaining != null
                      ? nav.routeJumpsRemaining
                      : snap.remainingJumpsInRoute;
                  const barModel = routeHeaderBarModel(snap, routeHeaderMetricMode);
                  const barTitle = `${routeNavCardTitle(snap)}\n\n${routeHeaderToggleTitleHint(routeHeaderMetricMode)}`;
                  const barAria = routeHeaderBarAria(snap, routeHeaderMetricMode, barModel);
                  const sep = <span className="dim"> · </span>;
                  const compactLine: ReactNode[] = [];
                  if (nav) {
                    if (jumpsShown != null) {
                      compactLine.push(
                        <span key="j" className="header-route-num">
                          {jumpsShown}
                        </span>,
                        sep,
                      );
                    }
                    if (routeHeaderMetricMode === "refuel" && nav.onPlot) {
                      const jl = nav.jumpsToLastScoopableOnRoute;
                      compactLine.push(
                        <span key="refuel" className="header-route-refuel-metric">
                          {jl != null ? `Refuel in ${jl}` : "No scoop ahead"}
                        </span>,
                      );
                    } else {
                      compactLine.push(
                        <span key="ly">
                          {nav.onPlot && nav.routeRemainingLy != null
                            ? `${nav.routeRemainingLy.toFixed(0)} ly left`
                            : `${nav.routeTotalLy.toFixed(0)} ly`}
                        </span>,
                      );
                    }
                  } else if (jumpsShown != null) {
                    compactLine.push(<span key="jonly">{jumpsShown}</span>);
                  }
                  if (fr && !nav?.onPlot && fr.estJumpsRemaining != null && fr.hasLiveStatusFuel) {
                    if (compactLine.length) compactLine.push(sep);
                    compactLine.push(
                      <span key="est" className="dim">
                        ~{fr.estJumpsRemaining} max
                      </span>,
                    );
                  }
                  if (nav && !nav.onPlot) {
                    if (compactLine.length) compactLine.push(sep);
                    compactLine.push(
                      <span key="off" className="dim">
                        off plot
                      </span>,
                    );
                  }
                  const lineContent = compactLine.length > 0 ? compactLine : <span className="dim">—</span>;
                  const barBg = barModel.indeterminate
                    ? undefined
                    : `linear-gradient(to right, rgba(90, 170, 255, 0.95) 0%, rgba(90, 170, 255, 0.95) ${barModel.bluePct}%, rgba(220, 70, 70, 0.92) ${barModel.bluePct}%, rgba(220, 70, 70, 0.92) 100%)`;
                  return (
                    <div
                      className={`d-scan-card d-scan-card--route d-scan-card--header-row header-route-mini header-route-mini--stacked${routeCardRefuelClass}`}
                    >
                      <button
                        type="button"
                        className="header-route-compact header-route-compact--toggle"
                        title={barTitle}
                        aria-label={barAria}
                        onClick={() =>
                          setRouteHeaderMetricMode((m) => (m === "distance" ? "refuel" : "distance"))
                        }
                      >
                        <span className="header-route-line header-route-line--compact">
                          <span className="header-metric-card-label">Route:</span>{" "}
                          <span className="header-metric-card-value">{lineContent}</span>
                        </span>
                        {barModel.showBar ? (
                          <div
                            className={`header-route-bar-track${barModel.indeterminate ? " header-route-bar-track--unknown" : ""}`}
                            style={barModel.indeterminate ? undefined : { background: barBg }}
                          />
                        ) : null}
                      </button>
                    </div>
                  );
                })()
              : null}
          </div>
        </div>
      ) : null}

      {snap.viewingSystemAddress != null &&
      snap.currentSystemAddress != null &&
      snap.viewingSystemAddress !== snap.currentSystemAddress ? (
        <p className="sub-live dim header-commander-away">Commander: {snap.currentSystem ?? "—"}</p>
      ) : null}

      {encyclopediaOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <EncyclopediaModal
            footScannedEntries={snap.footScannedEntries ?? []}
            spawnCompare={encyclopediaSpawnCompare}
            onClose={() => setEncyclopediaOpen(false)}
          />
        </Suspense>
      ) : null}
      {myExoOpen ? (
        <MyExobiologyModal
          entries={snap.footScannedEntries ?? []}
          onClose={() => setMyExoOpen(false)}
          onNavigateEntry={onFootCatalogNavigate}
        />
      ) : null}
      {dataBreakdownOpen ? (
        <DataValueBreakdownModal
          lines={snap.organicPendingLines ?? []}
          includeExplorationScanDataInDataValue={scanDataOn}
          explorationFssScanCount={snap.explorationFssScanCount ?? 0}
          explorationFssValueCredits={snap.explorationFssValueCredits ?? 0}
          explorationDssScanCount={snap.explorationDssScanCount ?? 0}
          explorationDssValueCredits={snap.explorationDssValueCredits ?? 0}
          onClose={() => setDataBreakdownOpen(false)}
        />
      ) : null}
      {optionsOpen ? (
        <MapOptionsModal
          snap={snap}
          plusMinCr={snap.exoMapTierPlusMinCr}
          plusPlusMinCr={snap.exoMapTierPlusPlusMinCr}
          onResetExobiology={resetExobiology}
          onClose={() => setOptionsOpen(false)}
        />
      ) : null}
      {notableQuick ? (
        <Suspense fallback={null}>
          <PlanetQuickFactsPopup
            detail={snap.systemMap?.detailsByBodyId[String(notableQuick.notable.bodyId)] ?? null}
            fallbackTitle={notableQuick.notable.bodyName}
            fallbackSubtitle={`${notableQuick.notable.tag}${notableQuick.notable.dssMapped ? " · DSS mapped" : " · FSS / scan only"}`}
            bodyId={notableQuick.notable.bodyId}
            onClose={() => setNotableQuick(null)}
            onGoToBioBody={
              onGoToBioBody
                ? (bk) => {
                    setNotableQuick(null);
                    onGoToBioBody(bk);
                  }
                : undefined
            }
            pos={{ left: notableQuick.x, top: notableQuick.y }}
          />
        </Suspense>
      ) : null}
    </header>
  );
});

function MyExobiologyModal({
  entries,
  onClose,
  onNavigateEntry,
}: {
  entries: FootScannedEntry[];
  onClose: () => void;
  onNavigateEntry?: (e: FootScannedEntry) => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel modal-panel--my-exo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-exo-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="my-exo-title">My exobiology</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--my-exo">
          <p className="my-exo-intro dim">
            From merged journals: <code>ScanOrganic</code> Sample or Analyse + detailed <code>Scan</code>.
            Stored in <code>data/foot_scanned.json</code>.
          </p>
          {entries.length === 0 ? (
            <p className="dim">No foot-catalog entries yet.</p>
          ) : (
            <ul className="my-exo-card-list">
              {entries.map((e) => (
                <li key={e.id} className="my-exo-card">
                  <div className="my-exo-card-top">
                    <div className="my-exo-card-loc">
                      {onNavigateEntry ? (
                        <button
                          type="button"
                          className="my-exo-nav-icon"
                          title="Show this system in the app (journal view)"
                          aria-label={`Focus journal view: ${e.starSystem ?? "system"} — ${e.bodyName}`}
                          onClick={() => {
                            onNavigateEntry(e);
                            onClose();
                          }}
                        >
                          <svg
                            className="my-exo-nav-icon-svg"
                            viewBox="0 0 16 16"
                            width="15"
                            height="15"
                            aria-hidden
                          >
                            <circle
                              cx="8"
                              cy="8"
                              r="6.25"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.35"
                            />
                            <path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1.15" />
                            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                          </svg>
                        </button>
                      ) : null}
                      <span className="my-exo-body">{e.bodyName}</span>
                    </div>
                    <time className="my-exo-card-time tab" dateTime={e.recordedAt}>
                      {e.recordedAt.slice(0, 19).replace("T", " ")}
                    </time>
                  </div>
                  <div
                    className={`my-exo-card-sub dim tiny${onNavigateEntry ? " my-exo-card-sub--indented" : ""}`}
                  >
                    {e.starSystem || "—"}
                  </div>
                  <dl className="my-exo-card-facts">
                    <div className="my-exo-card-fact">
                      <dt>Species</dt>
                      <dd>
                        {e.variantLocalised ||
                          [e.genusLocalised, e.speciesLocalised].filter(Boolean).join(" ") ||
                          "—"}
                        {e.dbProbableDisagreed ? (
                          <span className="dim tiny tab" title="Top strict DB guess at record time differed">
                            {" "}
                            (DB note)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>From</dt>
                      <dd>{e.confirmationSource === "sample" ? "Sample" : "Analyse"}</dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>Planet</dt>
                      <dd>{e.planetClass}</dd>
                    </div>
                    <div className="my-exo-card-fact">
                      <dt>Atmosphere</dt>
                      <dd>{e.atmosphereNorm || "—"}</dd>
                    </div>
                    <div className="my-exo-card-fact my-exo-card-fact--wide">
                      <dt>Temperature (K)</dt>
                      <dd className="tab">
                        {e.tempBandMinK.toFixed(0)} · {e.tempBandMaxK.toFixed(0)}
                      </dd>
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

function DataValueBreakdownModal({
  lines,
  includeExplorationScanDataInDataValue,
  explorationFssScanCount,
  explorationFssValueCredits,
  explorationDssScanCount,
  explorationDssValueCredits,
  onClose,
}: {
  lines: OrganicPendingLineItem[];
  includeExplorationScanDataInDataValue: boolean;
  explorationFssScanCount: number;
  explorationFssValueCredits: number;
  explorationDssScanCount: number;
  explorationDssValueCredits: number;
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
          {includeExplorationScanDataInDataValue ? (
            <div className="data-value-exploration-block card-neon" style={{ marginBottom: "1rem" }}>
              <p className="small-caps dim" style={{ marginTop: 0 }}>
                Exploration (journal events)
              </p>
              <p style={{ margin: "0.35rem 0" }}>
                <strong>FSS scans</strong> — journal <code>event: FSSBodySignals</code> —{" "}
                <strong>{explorationFssScanCount}</strong> bodies · Value:{" "}
                <strong>{explorationFssValueCredits.toLocaleString()} CR</strong>{" "}
                <span className="dim tiny">(FSS-only est. where merged Scan exists)</span>
              </p>
              <p style={{ margin: "0.35rem 0" }}>
                <strong>DSS scans</strong> — journal <code>event: SAAScanComplete</code> —{" "}
                <strong>{explorationDssScanCount}</strong> planetary bodies · Value:{" "}
                <strong>{explorationDssValueCredits.toLocaleString()} CR</strong>{" "}
                <span className="dim tiny">(full mapped est.)</span>
              </p>
            </div>
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
                  <img src={line.photoUrl} alt="" className="data-value-breakdown-thumb" />
                  <div className="data-value-breakdown-main">
                    <div className="data-value-breakdown-planet">
                      <strong>{line.bodyName}</strong>
                      <span className="dim"> · {line.starSystem}</span>
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

function marketingSiteOrigin(): string {
  return import.meta.env.DEV ? "http://127.0.0.1:8082" : "https://edexo.bahuckel.com";
}

/** Shown while a lazily-loaded modal chunk is fetched; the chunks are small and local. */
function ModalLoading() {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel--loading">
        <SkeletonPanel label="Loading panel" />
      </div>
    </div>
  );
}

/**
 * Idle state: nothing to sample yet.
 *
 * Both art panels used to carry their guidance only in `aria-label` — the one place a sighted user
 * never looks — so the app showed a picture and no instruction. The caption is real text now.
 *
 * This is also the only surface that still shows the brand lockup and the gameplay tip. They used
 * to sit in the header on every screen, costing ~84 px of viewport during play, when the moment
 * they are actually worth reading is the moment there is nothing else on screen.
 */
function BioEmptyState({ snap }: { snap: AppSnapshot }) {
  const dead = snap.fssAllBodiesFoundNoBio === true;
  return (
    <div className="bio-empty-wrap">
      <div
        key={`bio-empty-${snap.viewingSystemAddress ?? snap.currentSystemAddress ?? "na"}-${dead ? "dead" : "fss"}`}
        className={`panel empty${dead ? " panel-empty--dead-system" : " panel-empty--fss-required"}`}
      >
        <div className="bio-empty-caption">
          <p className="bio-empty-caption-hed">
            {dead ? "No exobiology in this system" : "No bio signals yet"}
          </p>
          <p className="bio-empty-caption-sub">
            {dead
              ? "Every body here has been scanned and none carry biological signals. Jump to another system, or search one above to browse it from your journal."
              : "FSS a world with biological signals, or DSS map one — bodies appear here on their own. You can also search a visited system above."}
          </p>
        </div>
      </div>
      <div className="brand-hero brand-hero--idle">
        <div className="brand-top-row">
          <img src="/edexo-icon-124.webp" alt="" className="brand-app-icon" width={62} height={62} />
          <div className="brand-title-bordered">
            <div className="logo brand-lockup-title">ED EXO COMPARE</div>
            <div className="brand-byline-muted brand-lockup-byline">by CMDR {BRAND_AUTHOR}</div>
          </div>
        </div>
        <div className="brand-tip-wrap">
          <EliteTipRotator />
        </div>
      </div>
    </div>
  );
}

function AppLegalFooter() {
  const origin = marketingSiteOrigin();
  return (
    <footer className="app-legal-footer">
      <p className="app-legal-footer-note dim">
        ED Exo Compare is owned and operated by Bahuckel™. Independent fan software using local Elite
        Dangerous journal data — not affiliated with Frontier Developments. <em>Elite Dangerous</em> and
        related marks belong to Frontier; all rights reserved by their owners.
      </p>
      <div className="app-legal-footer-links">
        <a href={`${origin}/privacy.html`} target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        <a href={`${origin}/terms.html`} target="_blank" rel="noopener noreferrer">
          Terms of Service
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        <a href="https://edexo.bahuckel.com" target="_blank" rel="noopener noreferrer">
          edexo.bahuckel.com
        </a>
      </div>
    </footer>
  );
}

export function App() {
  const toast = useToast();
  const { snapshot, connected } = useLiveSnapshot();
  const rawBodies = snapshot?.bodies ?? [];
  const systemFocusKey = snapshot?.viewingSystemAddress ?? snapshot?.currentSystemAddress ?? null;
  const orderedBodies = useStableBioTabOrder(rawBodies, systemFocusKey);
  const bodyGroups = useMemo(
    () => buildBodyOrbitGroups(orderedBodies, snapshot?.systemMap),
    [orderedBodies, snapshot?.systemMap],
  );
  const multiOrbit = bodyGroups.length > 1;
  const [selectedBodyKey, setSelectedBodyKey] = useState<string | null>(null);
  const [systemMapOpen, setSystemMapOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);

  /**
   * One section per orbit group, host cards inside it. The orbit label used to be a `<select>` that
   * *filtered* the strip; it is a sticky separator now, so every body stays reachable in one scroll.
   */
  const tabSections = useMemo<TabSection[]>(
    () =>
      bodyGroups.map((g) => ({
        key: g.key,
        label: multiOrbit ? g.label : null,
        hostCards: groupTabBodiesIntoHostCards(
          orderedBodies.filter((b) => g.bodyKeys.has(b.state.key)),
          snapshot?.systemMap,
        ),
      })),
    [bodyGroups, multiOrbit, orderedBodies, snapshot?.systemMap],
  );

  const jumpItems = useMemo(() => {
    const labels = new Map<string, string>();
    if (multiOrbit) {
      for (const g of bodyGroups) for (const k of g.bodyKeys) labels.set(k, g.label);
    }
    return bodyJumpItems(orderedBodies, multiOrbit ? labels : null);
  }, [orderedBodies, bodyGroups, multiOrbit]);

  /**
   * Keep the selection valid in one pass.
   *
   * This was two chained effects — one against `orderedBodies`, one against a filtered `tabBodies`
   * — each calling setState, so a single snapshot could cost three commits. The strip shows every
   * body now, so one list decides; never write the key that is already set.
   */
  useEffect(() => {
    if (!orderedBodies.length) {
      setSelectedBodyKey((k) => (k === null ? k : null));
      return;
    }
    setSelectedBodyKey((k) => {
      if (k && orderedBodies.some((b) => b.state.key === k)) return k;
      const next = orderedBodies[0]!.state.key;
      return next === k ? k : next;
    });
  }, [orderedBodies]);

  /** Ctrl+K anywhere opens the jump palette; the strip itself needs no measurement now. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "k" || ev.key === "K")) {
        ev.preventDefault();
        setJumpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const key = selectedBodyKey;
    const t = window.setTimeout(() => {
      void fetch("/api/ui/selected-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyKey: key }),
      }).catch(() => {});
    }, 160);
    return () => window.clearTimeout(t);
  }, [selectedBodyKey]);

  useEffect(() => {
    const key = snapshot?.uiAutoSelectBodyKey ?? null;
    if (!key) return;
    setSelectedBodyKey(key);
  }, [snapshot?.uiAutoSelectBodyKey]);

  const selected = orderedBodies.find((b) => b.state.key === selectedBodyKey) ?? orderedBodies[0] ?? null;

  /** Memoized: a fresh object literal here would defeat <HeaderBar>'s memo on every render. */
  const encyclopediaSpawnCompare: EncyclopediaSpawnCompare | null = useMemo(
    () =>
      orderedBodies.length === 0 || !selected
        ? null
        : {
            bodyKey: selected.state.key,
            scan: selected.mergedScan ?? selected.state.scan,
            estimatedSurfaceTempK: selected.estimatedSurfaceTempK,
            speciesMatchContext: selected.speciesMatchContext,
            bodyTabLabel: selected.tabLabel,
          },
    [orderedBodies.length, selected],
  );

  const toggleIncludeBacteriumInSearch = useCallback(() => {
    const snap = snapshot;
    if (!snap || snap.journalBoot) return;
    const bacteriumOn = snap.includeBacteriumInSearch === true;
    void (async () => {
      try {
        const r = await fetch("/api/settings/include-bacterium", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: !bacteriumOn }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  }, [snapshot, toast]);

  const focusBodyKey = useCallback((bk: string) => setSelectedBodyKey(bk), []);

  const openJump = useCallback(() => setJumpOpen(true), []);
  const closeJump = useCallback(() => setJumpOpen(false), []);

  const openSystemMap = useCallback(() => setSystemMapOpen(true), []);

  const closeSystemMap = useCallback(() => setSystemMapOpen(false), []);

  const goToBioBodyFromMap = useCallback(
    (bodyKey: string) => {
      focusBodyKey(bodyKey);
      setSystemMapOpen(false);
    },
    [focusBodyKey],
  );

  const footCatalogNavigate = useCallback(
    (e: FootScannedEntry) => {
      void (async () => {
        try {
          const r = await fetch("/api/ui/view-system", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemAddress: e.systemAddress }),
          });
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not switch system view.");
        }
      })();
      focusBodyKey(`${e.systemAddress}:${e.bodyId}`);
    },
    [focusBodyKey, toast],
  );

  if (!snapshot) {
    return (
      <div className="app-shell">
        <div className="panel load">Connecting to journal service…</div>
        <AppLegalFooter />
      </div>
    );
  }

  if (snapshot.journalBoot) {
    return (
      <div className="app-shell">
        <JournalBootScreen boot={snapshot.journalBoot} connected={connected} />
        <AppLegalFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <HeaderBar
        snap={snapshot}
        connected={connected}
        encyclopediaSpawnCompare={encyclopediaSpawnCompare}
        onOpenSystemMap={openSystemMap}
        onGoToBioBody={focusBodyKey}
        onFootCatalogNavigate={footCatalogNavigate}
      />
      {orderedBodies.length === 0 ? (
        <BioEmptyState snap={snapshot} />
      ) : (
        <>
          <BodyTabStrip
            sections={tabSections}
            selectedBodyKey={selectedBodyKey}
            onSelect={setSelectedBodyKey}
            onOpenJump={openJump}
            bodyCount={orderedBodies.length}
          />
          {selected ? (
            <BodyPane
              body={selected}
              includeBacteriumInSearch={snapshot.includeBacteriumInSearch === true}
              onToggleIncludeBacterium={toggleIncludeBacteriumInSearch}
            />
          ) : null}
        </>
      )}
      {jumpOpen ? (
        <BodyJumpPalette
          items={jumpItems}
          selectedKey={selectedBodyKey}
          onPick={focusBodyKey}
          onClose={closeJump}
        />
      ) : null}
      {systemMapOpen ? (
        <Suspense fallback={null}>
          <SystemMapModal snap={snapshot} onClose={closeSystemMap} onGoToBioBody={goToBioBodyFromMap} />
        </Suspense>
      ) : null}
      <AppLegalFooter />
    </div>
  );
}
