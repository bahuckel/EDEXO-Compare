/**
 * My exobiology: the finds table and the discoveries views. Split out of AppModals.tsx (code review D, 2026-09-27).
 */
import { usePersistedState } from "./usePersistedState";
import { footConfirmationLabel } from "@shared/footConfirmationLabel";
import { CopySystemButton } from "./CopySystemButton";
import {
  Column,
  DiscoveriesLayout,
  DiscoveriesTab,
  DiscoveriesTables,
  PAGE,
  Table,
} from "./DiscoveriesTables";
import { fuzzyRankAny } from "./fuzzyMatch";
import { ScrollArea } from "./ui/ScrollArea";
import { InfoPopover } from "./ui/Tooltip";
import { useModal } from "./ui/useModal";
import type { DiscoveriesDTO, FootScannedEntry } from "@shared/types";
import { readableAtmosphereType } from "@shared/atmosphereLabel";
import { memo, useEffect, useMemo, useRef, useState } from "react";

/**
 * Everything the commander has actually confirmed on foot.
 *
 * **The search (A1).** This opened with a line explaining where the records come from — a mechanism
 * described to somebody who has already opened the panel and therefore already trusts it. The owner
 * has 373 entries in here and wanted the one thing he comes for: find the body, the system, or every
 * time he has seen a genus. So the line is behind the ⓘ and its space is the search.
 *
 * Filtering, not re-ranking. {@link fuzzyRankAny} returns a rank and it is tempting to sort by it,
 * but the list's spine is time — newest first — and a query that reshuffles the order costs more
 * than a slightly better first row wins. A match is kept where it was.
 */
type DiscoveriesView = "species" | DiscoveriesTab;

/*
  The last tab and view, remembered per viewer (owner, 2026-09-25). A view preference, so browser
  storage is the right home: it never has to reach another device. Guarded, because storage can be
  missing or refuse (private window, blocked site data) and the panel must open regardless.
*/
const DISCOVERIES_PREF_KEY = "edexo.myDiscoveries";
const DISCOVERIES_VIEWS: DiscoveriesView[] = ["species", "systems", "bodies", "stars"];

function readDiscoveriesPref(): { view: DiscoveriesView; layout: DiscoveriesLayout } {
  try {
    const j = JSON.parse(localStorage.getItem(DISCOVERIES_PREF_KEY) ?? "{}") as Record<string, unknown>;
    const view = DISCOVERIES_VIEWS.includes(j.view as DiscoveriesView)
      ? (j.view as DiscoveriesView)
      : "species";
    const layout: DiscoveriesLayout = j.layout === "cards" ? "cards" : "list";
    return { view, layout };
  } catch {
    return { view: "species", layout: "list" };
  }
}

function writeDiscoveriesPref(pref: { view: DiscoveriesView; layout: DiscoveriesLayout }): void {
  try {
    localStorage.setItem(DISCOVERIES_PREF_KEY, JSON.stringify(pref));
  } catch {
    /* no storage: the choice lasts until the panel closes */
  }
}

/** The Exobiology tab as a list — the same records as the cards, one row each. */
function exobiologyColumns(
  onNavigateEntry: ((e: FootScannedEntry) => void) | undefined,
  onClose: () => void,
): Column<FootScannedEntry>[] {
  const species = (e: FootScannedEntry) =>
    e.variantLocalised || [e.genusLocalised, e.speciesLocalised].filter(Boolean).join(" ") || "—";
  return [
    {
      key: "body",
      label: "Body",
      value: (e) => e.bodyName,
      render: (e) => (
        <>
          {onNavigateEntry ? (
            <button
              type="button"
              className="disc-link"
              title="Show this system in the app (journal view)"
              onClick={() => {
                onNavigateEntry(e);
                onClose();
              }}
            >
              {e.bodyName}
            </button>
          ) : (
            e.bodyName
          )}
          <CopySystemButton system={e.starSystem} />
        </>
      ),
    },
    {
      key: "system",
      label: "System",
      value: (e) => e.starSystem ?? null,
      render: (e) => (
        <>
          {e.starSystem || "—"}
          <CopySystemButton system={e.starSystem} />
        </>
      ),
    },
    { key: "species", label: "Species", value: species, render: species },
    {
      key: "from",
      label: "From",
      value: (e) => e.confirmationSource ?? null,
      render: (e) => footConfirmationLabel(e.confirmationSource),
    },
    { key: "planet", label: "Planet", value: (e) => e.planetClass, render: (e) => e.planetClass },
    {
      key: "atmo",
      label: "Atmosphere",
      value: (e) => readableAtmosphereType(e.atmosphereNorm) || null,
      render: (e) => readableAtmosphereType(e.atmosphereNorm) || "—",
    },
    {
      key: "temp",
      label: "Temperature (K)",
      numeric: true,
      value: (e) => e.tempBandMinK,
      render: (e) => `${e.tempBandMinK.toFixed(0)} · ${e.tempBandMaxK.toFixed(0)}`,
    },
    {
      key: "when",
      label: "Recorded",
      value: (e) => e.recordedAt,
      render: (e) => e.recordedAt.slice(0, 19).replace("T", " "),
    },
  ];
}

/** Memo: open over the app, which re-renders on every push. */
export const MyExobiologyModal = memo(function MyExobiologyModal({
  entries,
  onClose,
  onNavigateEntry,
  onNavigateSystem,
}: {
  entries: FootScannedEntry[];
  onClose: () => void;
  onNavigateEntry?: (e: FootScannedEntry) => void;
  onNavigateSystem?: (systemAddress: number, bodyKey?: string) => void;
}) {
  /*
    The other three tabs are fetched, not pushed.

    ~14,000 scanned bodies would be on every websocket tick to serve a panel that is shut almost all
    of the time, so `/api/discoveries` builds them when a tab is first opened and they are kept for
    as long as the dialog is. Reopening asks again, which is what makes a freshly scanned system
    appear without a restart.
  */
  const [view, setViewState] = useState<DiscoveriesView>(() => readDiscoveriesPref().view);
  const [layout, setLayoutState] = useState<DiscoveriesLayout>(() => readDiscoveriesPref().layout);
  const setView = (v: DiscoveriesView) => {
    setViewState(v);
    writeDiscoveriesPref({ view: v, layout });
  };
  const setLayout = (l: DiscoveriesLayout) => {
    setLayoutState(l);
    writeDiscoveriesPref({ view, layout: l });
  };
  const [exoSort, setExoSort] = usePersistedState<{ key: string; dir: 1 | -1 }>(
    "discoveries.exoSort",
    { key: "when", dir: -1 },
    (v): v is { key: string; dir: 1 | -1 } =>
      !!v &&
      typeof v === "object" &&
      typeof (v as { key?: unknown }).key === "string" &&
      ((v as { dir?: unknown }).dir === 1 || (v as { dir?: unknown }).dir === -1),
  );
  const exoColumns = useMemo(() => exobiologyColumns(onNavigateEntry, onClose), [onNavigateEntry, onClose]);
  const [discoveries, setDiscoveries] = useState<DiscoveriesDTO | null>(null);
  const [discoveriesError, setDiscoveriesError] = useState<string | null>(null);
  useEffect(() => {
    if (view === "species" || discoveries || discoveriesError) return;
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/discoveries");
        if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
        const j = (await r.json()) as DiscoveriesDTO;
        if (live) setDiscoveries(j);
      } catch (e) {
        if (live) setDiscoveriesError(e instanceof Error ? e.message : "Could not read your journals.");
      }
    })();
    return () => {
      live = false;
    };
  }, [view, discoveries, discoveriesError]);
  /*
    `useModal` focuses the first focusable in the dialog, which is the close button — right for
    every other dialog in the app, wrong for one whose whole purpose is now a search box. So it
    hands over initial focus and the input claims it. The focus trap and focus restore are
    untouched; a plain `autoFocus` attribute would not work here, because the hook's effect runs
    after React applies it and would take the focus straight back.
  */
  const dialogRef = useModal<HTMLDivElement>(true, onClose, { autoFocus: false });
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    (searchRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
  }, [dialogRef]);

  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        fuzzyRankAny(
          [e.starSystem, e.bodyName, e.genusLocalised, e.speciesLocalised, e.variantLocalised],
          q,
        ) != null,
    );
  }, [entries, query]);

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
          <h3 id="my-exo-title">My discoveries</h3>
          <div className="disc-tabs" role="tablist" aria-label="What to show">
            {(
              [
                ["species", "Exobiology"],
                ["systems", "Systems"],
                ["bodies", "Bodies"],
                ["stars", "Stars"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={view === k}
                className={`disc-tab${view === k ? " disc-tab--on" : ""}`}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {/* List by default everywhere; cards on request (owner, 2026-09-25). */}
          <div className="disc-layout" role="group" aria-label="View">
            {(
              [
                ["list", "List"],
                ["cards", "Cards"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={layout === k}
                className={`disc-layout__btn${layout === k ? " disc-layout__btn--on" : ""}`}
                onClick={() => setLayout(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--my-exo">
          {view !== "species" ? (
            discoveriesError ? (
              <p className="dim disc-empty">{discoveriesError}</p>
            ) : !discoveries ? (
              <p className="dim disc-empty">Reading your journals…</p>
            ) : (
              <DiscoveriesTables
                data={discoveries}
                tab={view}
                layout={layout}
                onNavigateSystem={onNavigateSystem}
              />
            )
          ) : (
            <>
              <div className="my-exo-search">
                <input
                  ref={searchRef}
                  type="search"
                  className="my-exo-search-input"
                  value={query}
                  placeholder="Search system, planet, genus or species…"
                  aria-label="Search your foot scans"
                  onChange={(ev) => setQuery(ev.target.value)}
                />
                <span className="my-exo-search-count dim tiny">
                  {query.trim() ? `${shown.length} of ${entries.length}` : `${entries.length}`}
                </span>
                <InfoPopover title="My exobiology" label="Where these records come from">
                  <p>
                    From your merged journals: a <code>ScanOrganic</code> Sample or Analyse, paired with the
                    detailed <code>Scan</code> of the body it happened on.
                  </p>
                  <p>
                    Stored in <code>data/foot_scanned.json</code>, on this machine.
                  </p>
                </InfoPopover>
              </div>
              {entries.length === 0 ? (
                <p className="dim">No foot-catalog entries yet.</p>
              ) : shown.length === 0 ? (
                <p className="dim">Nothing here matches “{query.trim()}”.</p>
              ) : layout === "list" ? (
                <Table
                  rows={shown}
                  columns={exoColumns}
                  sort={exoSort}
                  onSort={(key) =>
                    setExoSort((s) =>
                      s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 },
                    )
                  }
                  rowKey={(e) => e.id}
                  csvName="exobiology scanned on foot"
                  empty="No foot-catalog entries yet."
                  resetKey={query}
                />
              ) : (
                <ScrollArea className="my-exo-card-scroll" resetKey={query}>
                  {/* Capped like the list (UI review P6): every card for a long history was thousands of elements. */}
                  <ul className="my-exo-card-list">
                    {shown.slice(0, PAGE).map((e) => (
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
                          <CopySystemButton system={e.starSystem} />
                        </div>
                        <dl className="my-exo-card-facts">
                          <div className="my-exo-card-fact">
                            <dt>Species</dt>
                            <dd>
                              {e.variantLocalised ||
                                [e.genusLocalised, e.speciesLocalised].filter(Boolean).join(" ") ||
                                "—"}
                              {e.dbProbableDisagreed ? (
                                <span
                                  className="dim tiny tab"
                                  title="Top strict DB guess at record time differed"
                                >
                                  {" "}
                                  (DB note)
                                </span>
                              ) : null}
                            </dd>
                          </div>
                          <div className="my-exo-card-fact">
                            <dt>From</dt>
                            <dd>{footConfirmationLabel(e.confirmationSource)}</dd>
                          </div>
                          <div className="my-exo-card-fact">
                            <dt>Planet</dt>
                            <dd>{e.planetClass}</dd>
                          </div>
                          <div className="my-exo-card-fact">
                            <dt>Atmosphere</dt>
                            <dd>{readableAtmosphereType(e.atmosphereNorm) || "—"}</dd>
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
                  {shown.length > PAGE ? (
                    <p className="dim tiny disc-more">
                      Showing the newest {PAGE.toLocaleString()} of {shown.length.toLocaleString()} — narrow
                      the search to bring the rest into view.
                    </p>
                  ) : null}
                </ScrollArea>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
