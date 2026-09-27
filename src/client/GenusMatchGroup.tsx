/**
 * One genus's candidate species, grouped, with its notes. Split out of BodyPane.tsx (code review D, 2026-09-27).
 */
import { SpeciesCard } from "./SpeciesCard";
import { GenusSpeciesOdds } from "./SpeciesCardBits";
import { SpeciesRow, orderRows } from "./SpeciesRows";
import { useRowContext } from "./rowContext";
import { safeGenusHeadId } from "./speciesMatchHelpers";
import type { BodyComputed, EstimatedSurfaceTempBand, PlanetScan } from "@shared/types";
import { memo, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

export const GenusMatchGroup = memo(function GenusMatchGroup({
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
