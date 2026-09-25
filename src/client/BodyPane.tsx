/**
 * The body pane: glance bar, planetary facts, sell range, candidate species (7.3).
 */
import { useModal } from "./ui/useModal";
import { ArrivalTrip } from "@shared/systemTriage";
import { fmtCrRangeShort, fmtCrShort } from "./credits";
import { FootfallContext } from "./footfallContext";
import { RowContext, LiveRun } from "./rowContext";
import { SpeciesRow, orderRows } from "./SpeciesRows";
import { useRowContext } from "./rowContext";
import { settledMultiplier } from "@shared/footfallValue";
import { footfallCertainty, showsFootfallPrice, showsListPrice } from "@shared/footfallValue";
import {
  useCallback,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  MouseEvent as ReactMouseEvent,
} from "react";
import { ExoPayoutRangePanel, payoutHeadline } from "./ExoPayoutRangePanel";
import { FoldPanel } from "./ui/Fold";
import type { BodyComputed, EstimatedSurfaceTempBand, ExoPayoutRangeDTO, PlanetScan } from "@shared/types";
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
  PressDisplay,
  TempUnit,
} from "./planetDisplayUtils";
import {
  exomasteryDetailHasContent,
  formatOrganicLockDisplay,
  groupedSortedMatches,
  safeGenusHeadId,
} from "./speciesMatchHelpers";
import {
  bodyGenusProgress,
  GENUS_PROGRESS_TITLE,
  genusProgressTag,
  scannedGenusRowsByTime,
  type GenusProgressRow,
} from "@shared/genusProgress";
import { ExomasteryHabitatMatchModal } from "./SharedModals";
import { SpeciesCard } from "./SpeciesCard";
import { GenusSpeciesOdds } from "./SpeciesCardBits";
import { candidateSpeciesDenomFromFss, genusHintIsDssOrphan, tripRankLabel } from "./bodyHelpers";
import {
  EDEXO_COMPACT_CANDIDATE_VIEW_LS,
  readLsBool,
  readPressUnitFromLs,
  readTempUnitFromLs,
  writeLsBool,
  writePressUnitToLs,
  writeTempUnitToLs,
} from "./lsPrefs";

/** Habitat fit (cross-genus) + deck match + optional same-genus rank — equal-width columns for available metrics only. */
/**
 * The signal-count verdict.
 *
 * The game reports how many biological signals a body has before the commander goes anywhere, and it
 * places one genus per signal. When the candidate genera match that count, every one of them is
 * present — the answer is settled from orbit, which is the whole reason the app exists. When there
 * are fewer, one of our gates is wrong.
 */
/** Landable as one glance: a pad glyph and the word, in the cockpit's state colour. */
/**
 * `[CS]`, `[SEEN]`, `[2/3]` after a genus or a species (guild request, 2026-09-24). Nothing for a
 * genus the DSS named and nobody has scanned. See `shared/genusProgress.ts`.
 */
function GenusTag({ row }: { row: Pick<GenusProgressRow, "status" | "samples"> }) {
  const tag = genusProgressTag(row);
  if (!tag) return null;
  return (
    <span className={`genus-tag genus-tag--${row.status}`} title={GENUS_PROGRESS_TITLE[row.status]}>
      {tag}
    </span>
  );
}

/** How many scanned genera the glance bar shows at once (owner, 2026-09-25). */
const GLANCE_GENUS_WINDOW = 3;

/**
 * The glance bar's genus chips: the last three things scanned here, newest on the right, with
 * arrows to step back through older ones (owner, 2026-09-25 — "max of 3, like the last 3 things you
 * scanned"). A new scan snaps back to the newest. Genera the DSS named and nothing has touched are
 * a count after the chips; the Exo-signals card lists them.
 */
export function GlanceGenera({ rows }: { rows: GenusProgressRow[] }) {
  const scanned = scannedGenusRowsByTime(rows);
  const untouched = rows.length - scanned.length;
  const [back, setBack] = useState(0);
  const newest = scanned.length
    ? `${scanned[scanned.length - 1]!.genus}|${genusProgressTag(scanned[scanned.length - 1]!)}`
    : "";
  useEffect(() => setBack(0), [newest]);

  const maxBack = Math.max(0, scanned.length - GLANCE_GENUS_WINDOW);
  const step = Math.min(back, maxBack);
  const end = scanned.length - step;
  const shown = scanned.slice(Math.max(0, end - GLANCE_GENUS_WINDOW), end);
  if (scanned.length === 0 && untouched === 0) return null;

  return (
    <span className="glance-item glance-genera" aria-label="Last genera scanned on this body">
      {scanned.length > GLANCE_GENUS_WINDOW ? (
        <button
          type="button"
          className="glance-genus-step"
          disabled={step >= maxBack}
          onClick={() => setBack((b) => Math.min(maxBack, b + 1))}
          title="Earlier scans"
          aria-label="Earlier scans"
        >
          ‹
        </button>
      ) : null}
      {shown.map((r) => (
        <span key={r.genus} className={`glance-genus glance-genus--${r.status}`}>
          {r.genus}
          <GenusTag row={r} />
        </span>
      ))}
      {scanned.length > GLANCE_GENUS_WINDOW ? (
        <button
          type="button"
          className="glance-genus-step"
          disabled={step <= 0}
          onClick={() => setBack((b) => Math.max(0, b - 1))}
          title="Later scans"
          aria-label="Later scans"
        >
          ›
        </button>
      ) : null}
      {untouched > 0 ? (
        <span className="glance-genus-left" title="Genera the DSS named that nothing has scanned yet">
          {scanned.length > 0 ? "+" : ""}
          {untouched} <small>to scan</small>
        </span>
      ) : null}
    </span>
  );
}

/** "Stratum Limaxus - Green" from a progress row, with the journal's repetitions folded away. */
function genusRowSpecies(row: GenusProgressRow): string {
  if (!row.species && !row.variant) return "";
  return formatOrganicLockDisplay({
    genusLocalised: row.genus,
    genusSymbol: "",
    speciesLocalised: row.species ?? "",
    speciesSymbol: "",
    variantLocalised: row.variant ?? "",
  });
}

function LandableBadge({ scan }: { scan: PlanetScan | null }) {
  const state = scan == null ? "unknown" : scan.Landable === true ? "yes" : "no";
  const word = state === "unknown" ? "Unscanned" : state === "yes" ? "Landable" : "Not landable";
  return (
    <span className={`land-badge land-badge--${state}`} title={scan == null ? "No detailed scan yet" : word}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        {state === "yes" ? (
          <path
            d="M8 2v7M4.6 6.4 8 9.8l3.4-3.4M2.5 13h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : state === "no" ? (
          <path
            d="M8 2v5M2.5 13h11M3.5 3.5l9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M5.5 5.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V10M8 12.5v.2M2.5 13h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {word}
    </span>
  );
}

function GenusCertaintyLine({
  c,
  ordered,
}: {
  c: NonNullable<BodyComputed["genusCertainty"]>;
  ordered: boolean;
}) {
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
  if (c.status === "bestGuess") {
    const guessed = c.restoredGenera?.length ? c.restoredGenera : c.genera;
    return (
      <p
        className="genus-certainty genus-certainty--guess"
        title="Nothing in our data passed every check for this body, so the least-bad fit was put back to match the game's signal count. The game says something grows here; it may be a genus our data does not describe well."
      >
        Best guess for {c.signalCount === 1 ? "the signal" : `${c.signalCount} signals`}:{" "}
        <strong>{guessed.join(", ")}</strong> — {guessed.length === 1 ? "it fails" : "they fail"} a check, so
        this is not confirmed.
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
      title="More candidate genera than signals: the game placed this many genera, but we cannot yet say which of the candidates they are. The order is how often each genus turns up across 10,299 bodies carrying biology, not how well it fits this one."
    >
      {c.signalCount} of these {c.candidateGenera} genera are present
      {ordered ? ", listed likeliest first" : ""}.
    </p>
  );
}

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

const GenusMatchGroup = memo(function GenusMatchGroup({
  group,
  scan,
  estimatedSurfaceTempK,
  comparisonBodySummary,
  hostStarType,
  hostStarTypes,
  compactCandidateView,
  genusConfirmed,
}: {
  group: { groupKey: string; title: string; items: BodyComputed["matches"] };
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  comparisonBodySummary: string;
  hostStarType?: string;
  /** Every star that could be the host, when the body orbits a barycentre rather than one star. */
  hostStarTypes?: string[];
  compactCandidateView?: boolean;
  /** DSS has named this genus, so it is here and only the species is open (B3). */
  genusConfirmed?: boolean;
}) {
  const [open, setOpen] = useState(true);
  // Which rows are unfolded into their full card (3.1). Nothing by default: the row is the glance.
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (id: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const rowCtx = useRowContext();
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
    <section
      ref={shellRef}
      className={`genus-card-shell${compactCandidateView && group.items.length === 1 ? " genus-card-shell--single" : ""}${
        group.items.length > 1 ? " genus-card-shell--multi" : ""
      }${group.items.length > 2 ? " genus-card-shell--wide" : ""}`}
      aria-labelledby={headId}
    >
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
      {/* rows mode keeps the split in the header; the card wall shows it under each card's chance bar */}
      {compactCandidateView ? (
        <GenusSpeciesOdds items={group.items} confirmed={genusConfirmed === true} />
      ) : null}
      <div
        id={`${headId}-panel`}
        className={`genus-card-collapse-grid${open ? "" : " genus-card-collapse-grid--collapsed"}`}
      >
        <div className="genus-card-collapse-inner">
          {compactCandidateView ? (
            <div className="srows">
              {orderRows(group.items, rowCtx).map((m) => (
                <SpeciesRow
                  key={m.entry.id}
                  m={m}
                  open={openRows.has(m.entry.id)}
                  onToggle={() => toggleRow(m.entry.id)}
                  scan={scan}
                  hostStarType={hostStarType}
                  hostStarTypes={hostStarTypes}
                >
                  <SpeciesCard
                    m={m}
                    scan={scan}
                    estimatedSurfaceTempK={estimatedSurfaceTempK}
                    comparisonBodySummary={comparisonBodySummary}
                    hostStarType={hostStarType}
                    hostStarTypes={hostStarTypes}
                    compactCandidateView={false}
                  />
                </SpeciesRow>
              ))}
            </div>
          ) : (
            <div className="genus-card-scroll genus-card-scroll--in-anim">
              {group.items.map((m) => (
                <SpeciesCard
                  key={m.entry.id}
                  m={m}
                  scan={scan}
                  estimatedSurfaceTempK={estimatedSurfaceTempK}
                  comparisonBodySummary={comparisonBodySummary}
                  hostStarType={hostStarType}
                  hostStarTypes={hostStarTypes}
                  compactCandidateView={false}
                  genusOdds={
                    group.items.length > 1 ? { items: group.items, confirmed: genusConfirmed === true } : null
                  }
                />
              ))}
            </div>
          )}
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

  /*
    One row per genus with what has been done to it (guild request, 2026-09-24): the glance bar, the
    Exo-signals card and the on-foot list all read these, so the three can never disagree.
  */
  const genusRows = bodyGenusProgress(s.genusHints, s.organicGenusLocks, liveRun);
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
  const hasEvidence = useCallback(
    (m: BodyComputed["matches"][0]) =>
      m.provenance != null && (m.provenance.firstHand || m.provenance.corpusInSystem > 0),
    [],
  );
  const evidenceCount = useMemo(() => body.matches.filter(hasEvidence).length, [body.matches, hasEvidence]);
  const shownMatches = evidenceOnly ? body.matches.filter(hasEvidence) : body.matches;
  /*
    A species he has sampled here is listed with the candidates, banner and all.

    The owner, on Bacterium omentum: *"keep the [unlikely] banner after the name. But do not continue
    to hide it in the unlikely list if the user scans it."* The demotion is still true and still
    shown — `m.unlikely` is untouched, so the card keeps its banner and its reasons — but a row he
    has proved is on this body does not belong behind "show unlikely (N)".
  */
  const likelyMatches = shownMatches.filter((m) => !m.unlikely || m.sampledHere === true);
  const unlikelyMatches = shownMatches.filter((m) => m.unlikely && m.sampledHere !== true);
  // Genus order from the co-occurrence solver, most likely first. Ordering only — the probabilities
  // behind it are not calibrated, so nothing here renders a number.
  const genusOrder = body.genusLikelihoods?.map((l) => l.genus) ?? null;

  // The body's first-footfall answer, shared with every species card below (WEBUI-REDESIGN 1.2).
  const bodyFootfall = body.exoPayoutRange
    ? footfallCertainty({
        journalWasFootfalled: body.exoPayoutRange.journalWasFootfalled,
        commanderFirstFootfall: body.exoPayoutRange.commanderFirstFootfall,
      })
    : "unknown";

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
                  onClick={() => setTempUnit((u) => (u === "K" ? "C" : u === "C" ? "F" : "K"))}
                  title="Cycles Kelvin → Celsius → Fahrenheit (display only; matching still uses journal Kelvin)"
                >
                  <span className="fact-k">Temperature</span>
                  <span className="fact-v">{tempLine}</span>
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
                    likelihood.
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
                      {groupedSortedMatches(likelyMatches, genusOrder).map((group) => (
                        <GenusMatchGroup
                          key={group.groupKey}
                          group={group}
                          scan={sc}
                          estimatedSurfaceTempK={body.estimatedSurfaceTempK}
                          comparisonBodySummary={comparisonBodySummary}
                          hostStarType={body.speciesMatchContext?.parentStarType}
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
                            {groupedSortedMatches(unlikelyMatches, genusOrder).map((group) => (
                              <GenusMatchGroup
                                key={`unlikely-${group.groupKey}`}
                                group={group}
                                scan={sc}
                                estimatedSurfaceTempK={body.estimatedSurfaceTempK}
                                comparisonBodySummary={comparisonBodySummary}
                                hostStarType={body.speciesMatchContext?.parentStarType}
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
