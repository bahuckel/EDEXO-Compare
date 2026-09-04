import type {
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaSpeciesRowDTO,
  EstimatedSurfaceTempBand,
  FootScannedEntry,
  PlanetScan,
  SpeciesEntry,
  SpeciesMatchContext,
} from "@shared/types";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { useModal } from "./ui/useModal";
import { SkeletonRows } from "./ui/Skeleton";
import { Tooltip } from "./ui/Tooltip";
import {
  buildEncyclopediaSpawnConditionCards,
  type EncyclopediaSpawnTier,
} from "@shared/speciesSpawnConditionCards";
import { formatPressurePill, formatTemperaturePillLine } from "./planetDisplayUtils";
import { ExomasteryDistributionPanel } from "./exomasteryDistributionPanel";
import { ExomasteryHabitatDetailInner } from "./exomasteryHabitatDetailInner";
import {
  buildEncyclopediaFacetOptions,
  activeEncyclopediaFilterChips,
  clearEncyclopediaFilter,
  defaultEncyclopediaFilters,
  ENC_FILTERS_ALL,
  rankEncyclopediaRows,
  type EncyclopediaFiltersState,
} from "./encyclopediaFilters";
import { EncyclopediaFilterBar } from "./EncyclopediaFilterBar";

const EXO_DRAWER_TRANSITION_MS = 380;

function spawnTierCssSuffix(tier: EncyclopediaSpawnTier): string {
  switch (tier) {
    case "blue":
      return "blue";
    case "red":
      return "red";
    case "yellow":
      return "yellow";
    default:
      return "neutral";
  }
}
function normLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type EncyclopediaSpawnCompare = {
  /** Matches `BodyExoState.key` — sent to encyclopedia exomastery API for “vs BODY tab” habitat match. */
  bodyKey: string | null;
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  speciesMatchContext: SpeciesMatchContext | null;
  /** BODY: tab designation for the encyclopedia caption line. */
  bodyTabLabel?: string;
};

function EncyclopediaSpeciesConditions({
  entry,
  spawnCompare,
}: {
  entry: SpeciesEntry;
  spawnCompare: EncyclopediaSpawnCompare | null;
}) {
  const cards = useMemo(
    () =>
      buildEncyclopediaSpawnConditionCards({
        entry,
        scan: spawnCompare?.scan ?? null,
        estimatedSurfaceTempK: spawnCompare?.estimatedSurfaceTempK ?? null,
        speciesMatchContext: spawnCompare?.speciesMatchContext ?? null,
      }),
    [
      entry,
      spawnCompare?.scan,
      spawnCompare?.estimatedSurfaceTempK,
      spawnCompare?.speciesMatchContext,
    ],
  );

  return (
    <div className="exo-neon-duplex-fields encyclopedia-spawn-fields">
      {cards.map((card) => (
        <div
          key={card.id}
          className={`exo-neon-duplex exo-neon-duplex--tier-${spawnTierCssSuffix(card.tier)}`}
          title={card.lines.join("\n")}
        >
          <span className="species-other-match-mini-title">{card.label}</span>
          <div className="species-other-match-mini-line">
            <span className="species-other-match-mini-legend">Species JSON</span>
            <span>{card.lines.filter(Boolean).join(" · ") || "—"}</span>
          </div>
          <div className="species-other-match-mini-line">
            <span className="species-other-match-mini-legend">vs BODY tab</span>
            <strong>{card.caption}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function encyclopediaExomasteryFetchPath(
  genusDir: string,
  speciesEntryId: string,
  opts?: { force?: boolean; focusBodyKey?: string | null },
): string {
  const p = new URLSearchParams();
  if (opts?.force) p.set("force", "1");
  if (opts?.focusBodyKey?.trim()) p.set("focusBodyKey", opts.focusBodyKey.trim());
  const qs = p.toString();
  return `/api/encyclopedia-exomastery/${encodeURIComponent(genusDir)}/${encodeURIComponent(speciesEntryId)}${qs ? `?${qs}` : ""}`;
}

const BUILTIN_PLACEHOLDER = "/photos/__builtin_placeholder.svg";

function footHitsForEntry(entry: SpeciesEntry, catalog: FootScannedEntry[]): FootScannedEntry[] {
  const nid = entry.id;
  const ns = normLabel(entry.displayName);
  return catalog.filter((f) => {
    if (f.speciesEntryId === nid || f.dbProbableSpeciesId === nid) return true;
    if (normLabel(f.variantLocalised || "") === ns && ns.length > 2) return true;
    if (
      f.genusLocalised &&
      entry.genus &&
      f.genusLocalised.trim().toLowerCase() === entry.genus.trim().toLowerCase()
    ) {
      const vl = normLabel(f.variantLocalised || f.speciesLocalised || "");
      if (vl && (ns.includes(vl) || vl.includes(ns))) return true;
    }
    return false;
  });
}

/**
 * Species thumbnail.
 *
 * Deliberately plain: every row requests its thumbnail immediately.
 *
 * The original 56 MB burst of full-size artwork is what made deferred loading necessary, and that
 * problem is gone — thumbnails are 320 px WebP at ~6 KB (the whole list is ~650 KB), and the photo
 * route is async with cached directory lookups. Both deferral mechanisms tried here failed in the
 * real window instead: `loading="lazy"` never evaluates inside this freshly-mounted scroll
 * container until the user physically scrolls, and an IntersectionObserver depends on the same
 * rendering lifecycle. At the Electron window's 548x768 that left 108 rows with one thumbnail in
 * the viewport and zero requests fired — every row looked broken.
 *
 * A failed load is retried once with a cache-busting query before falling back to the placeholder,
 * so a transient hiccup does not leave "no photo on disk" artwork behind.
 */
function EncyclopediaThumb({ photoUrl, displayName }: { photoUrl: string; displayName: string }) {
  const retriedRef = useRef(false);
  useEffect(() => {
    retriedRef.current = false;
  }, [photoUrl]);

  /** 320 px WebP (~6 KB) rather than the original (~600 KB average). */
  const thumbUrl = speciesPhotoVariant(photoUrl, "thumb");

  return (
    <img
      src={thumbUrl}
      alt=""
      width={104}
      height={88}
      decoding="async"
      className="encyclopedia-species-img encyclopedia-species-img--thumb"
      onError={(ev) => {
        const el = ev.target as HTMLImageElement;
        if (!retriedRef.current && !photoUrl.includes(BUILTIN_PLACEHOLDER)) {
          retriedRef.current = true;
          el.src = `${thumbUrl}${thumbUrl.includes("?") ? "&" : "?"}retry=1`;
          return;
        }
        el.src = BUILTIN_PLACEHOLDER;
      }}
      title={`Click for full-size illustration of ${displayName}`}
    />
  );
}

function ExomasteryPlanetsBody({ data }: { data: EncyclopediaExomasteryPlanetsResponseDTO }) {
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
            . Shown for every species with a feeder JSON, even when this species is not among candidates on that
            planet.
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
            <strong>Deviation</strong> (mode vs mean). Click <strong>Mode</strong> for chart: feeder min–max and mode
            only; dashed line = this BODY when in range. Hover card for sample counts.
          </>
        ) : (
          <>
            Each card: profile field vs feeder sample dispersion. Click <strong>Mode</strong> for cohort min–max chart
            when numeric. Full tooltip on hover.
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
                        <div key={f.id} className="exo-neon-duplex-stack encyclopedia-exomastery-stat-card-wrap">
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

function FoundSpeciesPopup({
  entry,
  hits,
  onClose,
}: {
  entry: SpeciesEntry;
  hits: FootScannedEntry[];
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop encyclopedia-found-backdrop"
      role="presentation"
      onClick={onClose}
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
            onClick={onClose}
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
                  </div>
                  <dl className="encyclopedia-found-facts">
                    <div>
                      <dt>Planet class</dt>
                      <dd>{f.planetClass}</dd>
                    </div>
                    <div>
                      <dt>Atmosphere</dt>
                      <dd>{f.atmosphereNorm || "—"}</dd>
                    </div>
                    <div>
                      <dt>Temperature</dt>
                      <dd
                        title="Band from catalog heuristics; J: journal Kelvin when recorded. Same formatting as the body tab (Kelvin display here)."
                      >
                        {formatTemperaturePillLine(
                          f.surfaceTemperatureK != null ? f.surfaceTemperatureK : null,
                          { minK: f.tempBandMinK, maxK: f.tempBandMaxK, midK: f.tempMidK },
                          "K",
                        )}
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
                      <dd>{f.confirmationSource === "sample" ? "Sample" : "Analyse"}</dd>
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

export function EncyclopediaModal({
  footScannedEntries,
  spawnCompare,
  onClose,
}: {
  footScannedEntries: FootScannedEntry[];
  spawnCompare: EncyclopediaSpawnCompare | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<EncyclopediaSpeciesRowDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<EncyclopediaFiltersState>(() => defaultEncyclopediaFilters(ENC_FILTERS_ALL));
  const [foundFor, setFoundFor] = useState<SpeciesEntry | null>(null);
  const [photoZoom, setPhotoZoom] = useState<{ url: string; note: string | null } | null>(null);
  /** Inline exomastery planetary cards inside the encyclopedia list (not a nested modal). */
  const [inlineExo, setInlineExo] = useState<{
    speciesEntryId: string;
    loading: boolean;
    err: string | null;
    data: EncyclopediaExomasteryPlanetsResponseDTO | null;
  } | null>(null);
  const [exoClosing, setExoClosing] = useState(false);
  const [exoDrawerReveal, setExoDrawerReveal] = useState(false);
  const exoCloseTimerRef = useRef<number | null>(null);

  const scheduleCloseExo = useCallback(() => {
    setExoClosing(true);
    if (exoCloseTimerRef.current != null) window.clearTimeout(exoCloseTimerRef.current);
    exoCloseTimerRef.current = window.setTimeout(() => {
      setInlineExo(null);
      setExoClosing(false);
      exoCloseTimerRef.current = null;
    }, EXO_DRAWER_TRANSITION_MS);
  }, []);

  const toggleInlineExomastery = useCallback(
    (entry: SpeciesEntry) => {
      if (exoCloseTimerRef.current != null) {
        window.clearTimeout(exoCloseTimerRef.current);
        exoCloseTimerRef.current = null;
      }
      if (inlineExo?.speciesEntryId === entry.id && !exoClosing) {
        scheduleCloseExo();
        return;
      }
      setExoClosing(false);
      setInlineExo({ speciesEntryId: entry.id, loading: true, err: null, data: null });
      const url = encyclopediaExomasteryFetchPath(entry.genusDataDir, entry.id, {
        focusBodyKey: spawnCompare?.bodyKey,
      });
      void fetch(url)
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as
            | EncyclopediaExomasteryPlanetsResponseDTO
            | { error?: string }
            | null;
          const entryId = entry.id;
          setInlineExo((prev) => {
            if (!prev || prev.speciesEntryId !== entryId) return prev;
            if (!r.ok) {
              const msg =
                j && typeof j === "object" && "error" in j && typeof j.error === "string"
                  ? j.error
                  : r.statusText;
              return { ...prev, loading: false, err: msg, data: null };
            }
            if (j && typeof j === "object" && "planets" in j && Array.isArray(j.planets)) {
              return { ...prev, loading: false, err: null, data: j as EncyclopediaExomasteryPlanetsResponseDTO };
            }
            return { ...prev, loading: false, err: "Invalid response", data: null };
          });
        })
        .catch((e) => {
          const entryId = entry.id;
          setInlineExo((prev) =>
            prev && prev.speciesEntryId === entryId
              ? {
                  ...prev,
                  loading: false,
                  err: e instanceof Error ? e.message : String(e),
                  data: null,
                }
              : prev,
          );
        });
    },
    [inlineExo?.speciesEntryId, exoClosing, scheduleCloseExo, spawnCompare?.bodyKey],
  );

  const refetchInlineExomastery = useCallback(() => {
    if (!inlineExo || exoClosing || !rows?.length) return;
    const entryId = inlineExo.speciesEntryId;
    const hit = rows.find((r) => r.entry.id === entryId);
    if (!hit) return;
    setInlineExo((p) => (p && p.speciesEntryId === entryId ? { ...p, loading: true, err: null } : p));
    const url = encyclopediaExomasteryFetchPath(hit.entry.genusDataDir, hit.entry.id, {
      force: true,
      focusBodyKey: spawnCompare?.bodyKey,
    });
    void fetch(url)
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | EncyclopediaExomasteryPlanetsResponseDTO
          | { error?: string }
          | null;
        setInlineExo((prev) => {
          if (!prev || prev.speciesEntryId !== entryId) return prev;
          if (!r.ok) {
            const msg =
              j && typeof j === "object" && "error" in j && typeof j.error === "string"
                ? j.error
                : r.statusText;
            return { ...prev, loading: false, err: msg, data: null };
          }
          if (j && typeof j === "object" && "planets" in j && Array.isArray(j.planets)) {
            return { ...prev, loading: false, err: null, data: j as EncyclopediaExomasteryPlanetsResponseDTO };
          }
          return { ...prev, loading: false, err: "Invalid response", data: null };
        });
      })
      .catch((e) => {
        setInlineExo((prev) =>
          prev && prev.speciesEntryId === entryId
            ? {
                ...prev,
                loading: false,
                err: e instanceof Error ? e.message : String(e),
                data: null,
              }
            : prev,
        );
      });
  }, [inlineExo, exoClosing, rows, spawnCompare?.bodyKey]);

  useLayoutEffect(() => {
    let cancelled = false;
    let innerRaf = 0;
    if (!inlineExo || exoClosing) {
      setExoDrawerReveal(false);
      return () => {
        cancelled = true;
      };
    }
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (!cancelled) setExoDrawerReveal(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [inlineExo, exoClosing]);

  useEffect(() => {
    if (!inlineExo || exoClosing || !exoDrawerReveal) return;
    const sid = inlineExo.speciesEntryId;
    const outer = window.setTimeout(() => {
      document.querySelector(`[data-exo-drawer="${CSS.escape(sid)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 60);
    return () => window.clearTimeout(outer);
  }, [
    inlineExo?.speciesEntryId,
    inlineExo?.loading,
    inlineExo?.data,
    inlineExo?.err,
    exoClosing,
    exoDrawerReveal,
  ]);

  useEffect(() => {
    return () => {
      if (exoCloseTimerRef.current != null) window.clearTimeout(exoCloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    void fetch("/api/species-encyclopedia")
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { species?: EncyclopediaSpeciesRowDTO[]; error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
        if (!j?.species) throw new Error("Invalid response");
        setRows(j.species);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * Escape peels one layer at a time; useModal adds the focus trap, focus restore and scroll lock
   * that the hand-rolled listener never had.
   */
  const closeTopLayer = useCallback(() => {
    if (photoZoom) setPhotoZoom(null);
    else if (inlineExo && !exoClosing) scheduleCloseExo();
    else if (foundFor) setFoundFor(null);
    else onClose();
  }, [onClose, foundFor, photoZoom, inlineExo, exoClosing, scheduleCloseExo]);

  const dialogRef = useModal<HTMLDivElement>(true, closeTopLayer);

  const facets = useMemo(
    () => (rows?.length ? buildEncyclopediaFacetOptions(rows) : null),
    [rows],
  );

  /**
   * Foot-catalog hit count per species, computed once per (rows, catalog) instead of scanning the
   * whole catalog for every row on every render — that was O(rows x catalog) over a 231 KB file.
   */
  const footHitCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!rows?.length) return m;
    for (const r of rows) m.set(r.entry.id, footHitsForEntry(r.entry, footScannedEntries).length);
    return m;
  }, [rows, footScannedEntries]);

  const genusLabels = useMemo(() => {
    if (!rows?.length) return [];
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.entry.genus?.trim() || r.entry.genusDataDir);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  const { rows: filtered, searching } = useMemo(
    () => (rows ? rankEncyclopediaRows(rows, filters) : { rows: [], searching: false }),
    [rows, filters],
  );

  /** Genus is how players think about exobiology, and it makes 108 rows navigable without
   *  virtualisation: ~25 headers instead of one undifferentiated column. */
  const genusSections = useMemo(() => {
    const byGenus = new Map<string, EncyclopediaSpeciesRowDTO[]>();
    for (const r of filtered) {
      const g = r.entry.genus?.trim() || r.entry.genusDataDir;
      const arr = byGenus.get(g);
      if (arr) arr.push(r);
      else byGenus.set(g, [r]);
    }
    return [...byGenus.entries()]
      .map(([genus, rs]) => ({ genus, rows: rs }))
      .sort((x, y) => x.genus.localeCompare(y.genus, undefined, { sensitivity: "base" }));
  }, [filtered]);

  const chips = useMemo(() => activeEncyclopediaFilterChips(filters), [filters]);

  const [railOpen, setRailOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Opening the encyclopedia is nearly always "find this species", so the caret starts there.
  useEffect(() => {
    if (!rows) return;
    const id = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(id);
  }, [rows]);


  /**
   * One species row. Extracted so the browse list (grouped by genus) and the search list (ranked,
   * flat) render exactly the same card instead of two copies drifting apart.
   */
  const renderSpeciesRow = ({
    entry,
    photoUrl,
    photoNote,
    exomasteryFeederBodyCount = 0,
    exomasteryProfileFilePresent = false,
    exomasteryEncyclopediaAvailable = false,
    exomasteryDataInsufficient = false,
  }: EncyclopediaSpeciesRowDTO) => {
  const exoEnabled = exomasteryEncyclopediaAvailable;
  const foundN = footHitCounts.get(entry.id) ?? 0;
  const exoExpanded = inlineExo?.speciesEntryId === entry.id && !exoClosing;
  const hasExoDrawer = inlineExo?.speciesEntryId === entry.id;
  return (
    <article key={entry.id} className="encyclopedia-species-card encyclopedia-species-card--row">
      {exoEnabled && exomasteryDataInsufficient ? (
        <Tooltip className="ency-low-sample-anchor" text="Low sample — exomastery has only one recorded body for this species, so its habitat figures are indicative, not typical.">
          <span className="encyclopedia-exomastery-insufficient">
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              aria-hidden
              focusable="false"
              className="ency-low-sample-icon"
            >
              <path
                d="M8 1.8 15 14.2H1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.7" r="0.85" fill="currentColor" />
            </svg>
            Low sample
          </span>
        </Tooltip>
      ) : null}
      <div className="encyclopedia-species-card-main">
      <button
        type="button"
        className="encyclopedia-thumb-btn"
        onClick={() => setPhotoZoom({ url: photoUrl, note: photoNote })}
        aria-label={`Enlarge photo for ${entry.displayName}`}
        title="Click for full-size illustration"
      >
        <EncyclopediaThumb photoUrl={photoUrl} displayName={entry.displayName} />
      </button>
      <div className="encyclopedia-species-col">
        <div className="encyclopedia-species-head">
          <h4 className="encyclopedia-species-title">{entry.displayName}</h4>
          <span className="encyclopedia-species-genus dim tiny">{entry.genus || entry.genusDataDir}</span>
        </div>
        {photoNote ? <p className="encyclopedia-photo-note dim tiny">{photoNote}</p> : null}
        {entry.description ? <p className="encyclopedia-desc">{entry.description}</p> : null}
        <div className="encyclopedia-criteria">
          <span className="encyclopedia-criteria-label">Conditions</span>
          <EncyclopediaSpeciesConditions entry={entry} spawnCompare={spawnCompare} />
        </div>
        <div className="encyclopedia-species-actions">
          <button
            type="button"
            className="btn-ency-found"
            title="Show matching rows from your foot catalog for this species"
            onClick={() => setFoundFor(entry)}
          >
            Found ({foundN})
          </button>
          {exoEnabled ? (
            <button
              type="button"
              className="btn-ency-exomastery"
              title={
                exoExpanded
                  ? "Hide exomastery data for this species"
                  : exomasteryProfileFilePresent
                    ? "Show Exomastery profile (mode vs mean) from feeder JSON"
                    : "Show EDSM / per-body exomastery rows for this species"
              }
              onClick={() => toggleInlineExomastery(entry)}
            >
              {exoExpanded
                ? `Hide exomastery (${exomasteryFeederBodyCount})`
                : `Exomastery (${exomasteryFeederBodyCount})`}
            </button>
          ) : null}
        </div>
      </div>
      </div>
      {hasExoDrawer ? (
        <div
          data-exo-drawer={entry.id}
          className={`encyclopedia-exomastery-drawer ${exoDrawerReveal && !exoClosing ? "encyclopedia-exomastery-drawer--open" : ""}`}
        >
          <div className="encyclopedia-exomastery-drawer-inner">
            <div className="encyclopedia-exomastery-inline-head">
              <div className="encyclopedia-exomastery-inline-head-text">
                <strong className="encyclopedia-exomastery-inline-title">
                  {inlineExo?.data?.source === "profile"
                    ? "Exomastery profile"
                    : "Exomastery sample bodies"}
                </strong>
                {inlineExo?.data ? (
                  <span className="dim tiny encyclopedia-exomastery-inline-sub">
                    {inlineExo.data.source === "profile"
                      ? inlineExo.data.sampleCount > 0
                        ? `n ≤ ${inlineExo.data.sampleCount} (feeder counts)`
                        : "feeder rollups"
                      : `n = ${inlineExo.data.sampleCount}`}
                  </span>
                ) : null}
              </div>
              {inlineExo?.speciesEntryId === entry.id && !exoClosing ? (
                <button
                  type="button"
                  className="encyclopedia-exomastery-refetch"
                  disabled={!!inlineExo.loading}
                  title="Clear cached feeder JSON for this species and reload from disk."
                  onClick={() => refetchInlineExomastery()}
                >
                  Force re-fetch
                </button>
              ) : null}
            </div>
            {inlineExo?.loading ? <p className="dim">Loading planetary data…</p> : null}
            {inlineExo?.err ? <p className="warn">{inlineExo.err}</p> : null}
            {inlineExo?.data && !inlineExo.loading ? (
              <ExomasteryPlanetsBody data={inlineExo.data} />
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
    );
  };

  return (
    <div className="modal-backdrop encyclopedia-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel encyclopedia-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="encyclopedia-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="encyclopedia-title">Encyclopedia</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close encyclopedia"
          >
            ×
          </button>
        </div>
        <div className="modal-body encyclopedia-body">
          <div className="ency-layout">
            <aside
              id="ency-rail"
              className={`ency-rail${railOpen ? " ency-rail--open" : ""}`}
              aria-label="Filters"
            >
              {facets && rows ? (
                <EncyclopediaFilterBar
                  filters={filters}
                  onFiltersChange={setFilters}
                  facets={facets}
                  genusLabels={genusLabels}
                  bodyPlanetClass={spawnCompare?.scan?.PlanetClass?.trim() || null}
                />
              ) : null}
            </aside>
            <div className="ency-main">
              <div className="ency-toolbar">
                <button
                  type="button"
                  className={`ency-rail-toggle${railOpen ? " ency-rail-toggle--on" : ""}`}
                  aria-expanded={railOpen}
                  aria-controls="ency-rail"
                  onClick={() => setRailOpen((v) => !v)}
                >
                  Filters{chips.length ? ` (${chips.length})` : ""}
                </button>
                <input
                  ref={searchRef}
                  type="search"
                  className="ency-search"
                  placeholder="Search species or genus…"
                  aria-label="Search species or genus"
                  autoComplete="off"
                  spellCheck={false}
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                />
                <span className="ency-count">
                  <strong>{filtered.length}</strong>
                  {rows ? <> of {rows.length}</> : null} species
                </span>
                {chips.length ? (
                  <>
                    <span className="ency-chips">
                      {chips.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="ency-chip"
                          title={`Remove the ${c.label.toLowerCase()} filter`}
                          onClick={() => setFilters((f) => clearEncyclopediaFilter(f, c.key))}
                        >
                          <span className="ency-chip-label">{c.label}:</span>{" "}
                          <span className="ency-chip-value">{c.value}</span>
                          <span className="ency-chip-x" aria-hidden>
                            ×
                          </span>
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      className="ency-clear-all"
                      onClick={() => setFilters(defaultEncyclopediaFilters(ENC_FILTERS_ALL))}
                    >
                      Clear all
                    </button>
                  </>
                ) : null}
              </div>
          {spawnCompare ? (
            <p className="encyclopedia-spawn-compare-line dim tiny">
              Spawn card colors mirror strict matcher vs <strong>BODY: {spawnCompare.bodyTabLabel ?? "—"}</strong>
              {spawnCompare.scan?.PlanetClass ? (
                <>
                  {" "}
                  (<span className="ency-spawn-scan-class">{spawnCompare.scan.PlanetClass}</span>)
                </>
              ) : spawnCompare.scan ? (
                <> (detailed scan — some fields incomplete)</>
              ) : (
                <> — no merged journal Scan on this bio tab row yet</>
              )}
              . Blue = criterion satisfied for that planet; yellow = uncertain/missing telemetry; red = gate fail; pale =
              informational.
            </p>
          ) : (
            <p className="encyclopedia-spawn-compare-line dim tiny">
              Open Encyclopedia while a BODY: bio tab exists to compare codex gates vs selected planet. Without that
              context cards stay neutral/warning-only where scan data is absent.
            </p>
          )}
          {loadErr ? <p className="warn">{loadErr}</p> : null}
          {!rows && !loadErr ? (
            <div className="encyclopedia-scroll">
              <SkeletonRows rows={6} />
            </div>
          ) : null}
          {rows ? (
            <div className="encyclopedia-scroll">
              {filtered.length === 0 ? (
                <p className="encyclopedia-empty-filtered">
                  No species match these filters. Use <strong>Clear all</strong> or relax planet class,
                  atmosphere, or other criteria.
                </p>
              ) : searching ? (
                filtered.map(renderSpeciesRow)
              ) : (
                genusSections.map((sec) => (
                  <section key={sec.genus} className="ency-genus-section">
                    <h4 className="ency-genus-head">
                      <span className="ency-genus-name">{sec.genus}</span>
                      <span className="ency-genus-count">{sec.rows.length}</span>
                    </h4>
                    {sec.rows.map(renderSpeciesRow)}
                  </section>
                ))
              )}
            </div>
          ) : null}
            </div>
          </div>
        </div>
      </div>
      {photoZoom ? (
        <div
          className="photo-lightbox-backdrop"
          role="presentation"
          onClick={() => setPhotoZoom(null)}
        >
          <button
            type="button"
            className="photo-lightbox-close"
            aria-label="Close"
            onClick={(ev) => {
              ev.stopPropagation();
              setPhotoZoom(null);
            }}
          >
            ×
          </button>
          <img
            src={photoZoom.url}
            alt=""
            className="photo-lightbox-img"
            onClick={(ev) => ev.stopPropagation()}
          />
          {photoZoom.note ? (
            <p className="photo-lightbox-cap" onClick={(ev) => ev.stopPropagation()}>
              {photoZoom.note}
            </p>
          ) : null}
        </div>
      ) : null}
      {foundFor ? (
        <FoundSpeciesPopup
          entry={foundFor}
          hits={footHitsForEntry(foundFor, footScannedEntries)}
          onClose={() => setFoundFor(null)}
        />
      ) : null}
    </div>
  );
}
