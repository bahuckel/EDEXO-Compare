import { usePersistedState } from "./usePersistedState";
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
import { BUILTIN_PLACEHOLDER_URL } from "@shared/photoPlaceholder";
import { photoCreditTitle } from "./photoCredit";
import { PhotoGallery } from "./PhotoGallery";
import { useModal } from "./ui/useModal";
import { SkeletonRows } from "./ui/Skeleton";
import { Tooltip } from "./ui/Tooltip";
import {
  buildEncyclopediaSpawnConditionCards,
  type EncyclopediaSpawnTier,
} from "@shared/speciesSpawnConditionCards";
import {
  buildEncyclopediaFacetOptions,
  activeEncyclopediaFilterChips,
  clearEncyclopediaFilter,
  defaultEncyclopediaFilters,
  isEncyclopediaFilters,
  ENC_FILTERS_ALL,
  rankEncyclopediaRows,
  type EncyclopediaFiltersState,
} from "./encyclopediaFilters";
import { EDEXO_ENCY_NOT_FOUND_LS, readLsBool, writeLsBool } from "./lsPrefs";
import { EncyclopediaFilterBar } from "./EncyclopediaFilterBar";
import { RarityGem } from "./RarityGem";
import { ExomasteryPlanetsBody, FoundSpeciesPopup } from "./EncyclopediaPanels";
import {
  GuideColoursBlock,
  GuideGenusIntro,
  GuideMeasuredBlock,
  fmtGuideCredits,
  guideBodyFrom,
} from "./FieldGuide";
import type { FieldGuideDTO, GuideGenus, GuideSpecies } from "@shared/fieldGuide";

const EXO_DRAWER_TRANSITION_MS = 380;

type GuideMaps = { species: Map<string, GuideSpecies>; genera: Map<string, GuideGenus> };

/*
  The Encyclopedia's two requests, made when this chunk loads — which is the idle prefetch a moment
  after start (SharedModals `prefetchMenuModals`) — so the first open draws at once instead of
  waiting ~100 ms for its data. Every open asks again and updates the list if anything changed.
*/
let rowsCache: EncyclopediaSpeciesRowDTO[] | null = null;
let guideCache: GuideMaps | null = null;

async function loadRows(): Promise<EncyclopediaSpeciesRowDTO[]> {
  const r = await fetch("/api/species-encyclopedia");
  const j = (await r.json().catch(() => null)) as { species?: EncyclopediaSpeciesRowDTO[]; error?: string } | null;
  if (!r.ok) throw new Error(j?.error || r.statusText);
  if (!j?.species) throw new Error("Invalid response");
  rowsCache = j.species;
  return j.species;
}

async function loadGuide(): Promise<GuideMaps | null> {
  const r = await fetch("/api/field-guide");
  if (!r.ok) return null;
  const j = (await r.json()) as FieldGuideDTO;
  if (!j?.genera) return null;
  guideCache = {
    species: new Map(j.genera.flatMap((g) => g.species.map((s) => [s.id, s] as const))),
    genera: new Map(j.genera.map((g) => [g.id, g] as const)),
  };
  return guideCache;
}

if (typeof window !== "undefined") {
  void loadRows().catch(() => {});
  void loadGuide().catch(() => {});
}
/** Field-guide cards drawn on the first render; the rest follow right after paint. */
const FIRST_CHARTS = 12;

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
    [entry, spawnCompare?.scan, spawnCompare?.estimatedSurfaceTempK, spawnCompare?.speciesMatchContext],
  );

  // The field-guide layout (owner, 2026-09-29): one row per condition — what the species needs, and
  // how the body being compared fares, coloured blue (matches) / yellow (unsure) / red (fails).
  return (
    <dl className="fg-req fg-req--conditions">
      {cards.map((card) => (
        <div
          key={card.id}
          className={`fg-req-row fg-req-row--${spawnTierCssSuffix(card.tier)}`}
          title={card.lines.join("\n")}
        >
          <dt>{card.label}</dt>
          <dd>{card.lines.filter(Boolean).join(" · ") || "—"}</dd>
          {spawnCompare ? <dd className="fg-req-body">{card.caption}</dd> : null}
        </div>
      ))}
    </dl>
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

// The placeholder URL is shared with the server, which writes it — see shared/photoPlaceholder.
const BUILTIN_PLACEHOLDER = BUILTIN_PLACEHOLDER_URL;

/** A catalogue row with its labels normalised once (they were normalised again for every species). */
interface NormFoot {
  f: FootScannedEntry;
  variant: string;
  genus: string;
  label: string;
}

function normFoot(catalog: FootScannedEntry[]): NormFoot[] {
  return catalog.map((f) => ({
    f,
    variant: normLabel(f.variantLocalised || ""),
    genus: (f.genusLocalised ?? "").trim().toLowerCase(),
    label: normLabel(f.variantLocalised || f.speciesLocalised || ""),
  }));
}

function footHitsForEntry(entry: SpeciesEntry, catalog: NormFoot[]): FootScannedEntry[] {
  const nid = entry.id;
  const ns = normLabel(entry.displayName);
  const genus = entry.genus?.trim().toLowerCase() ?? "";
  const out: FootScannedEntry[] = [];
  for (const n of catalog) {
    const f = n.f;
    if (
      f.speciesEntryId === nid ||
      f.dbProbableSpeciesId === nid ||
      (n.variant === ns && ns.length > 2) ||
      (genus && n.genus === genus && n.label && (ns.includes(n.label) || n.label.includes(ns)))
    ) {
      out.push(f);
    }
  }
  return out;
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
function EncyclopediaThumb({
  photoUrl,
  displayName,
  className = "encyclopedia-species-img encyclopedia-species-img--thumb",
  size = "thumb",
}: {
  photoUrl: string;
  displayName: string;
  className?: string;
  /** "card" for the field-guide banner: 1024 px (~44 KB) — the 320 px thumbnail looked dull there. */
  size?: "thumb" | "card";
}) {
  const retriedRef = useRef(false);
  useEffect(() => {
    retriedRef.current = false;
  }, [photoUrl]);

  /** A WebP variant (320 px ~6 KB, 1024 px ~44 KB) rather than the original (~600 KB average). */
  const thumbUrl = speciesPhotoVariant(photoUrl, size);

  return (
    <img
      src={thumbUrl}
      alt=""
      width={104}
      height={88}
      decoding="async"
      className={className}
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

export function EncyclopediaModal({
  footScannedEntries,
  spawnCompare,
  onClose,
}: {
  footScannedEntries: FootScannedEntry[];
  spawnCompare: EncyclopediaSpawnCompare | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<EncyclopediaSpeciesRowDTO[] | null>(rowsCache);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Remembered between opens, all but the search text (usePersistedState).
  const [filters, setFilters] = usePersistedState<EncyclopediaFiltersState>(
    "encyclopedia.filters",
    () => defaultEncyclopediaFilters(ENC_FILTERS_ALL),
    isEncyclopediaFilters,
    (f) => ({ ...f, search: "" }),
  );
  const [foundFor, setFoundFor] = useState<SpeciesEntry | null>(null);
  const [photoZoom, setPhotoZoom] = useState<{
    urls: string[];
    note: string | null;
    creditByUrl?: EncyclopediaSpeciesRowDTO["photoCreditByUrl"];
  } | null>(null);
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
            EncyclopediaExomasteryPlanetsResponseDTO | { error?: string } | null;
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
              return {
                ...prev,
                loading: false,
                err: null,
                data: j as EncyclopediaExomasteryPlanetsResponseDTO,
              };
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
          EncyclopediaExomasteryPlanetsResponseDTO | { error?: string } | null;
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
            return {
              ...prev,
              loading: false,
              err: null,
              data: j as EncyclopediaExomasteryPlanetsResponseDTO,
            };
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
    // Deliberately the fields, not the object: re-scroll when the drawer's content changes, not on
    // every re-render that rebuilds `inlineExo` with the same content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* The field guide (published conditions + measured charts), by species id and genus folder. */
  const [guide, setGuide] = useState<GuideMaps | null>(guideCache);
  useEffect(() => {
    void loadGuide()
      .then((g) => {
        if (g) setGuide(g);
      })
      .catch(() => {
        /* the cards still show everything else */
      });
  }, []);
  const guideBody = useMemo(
    () =>
      spawnCompare
        ? guideBodyFrom(
            spawnCompare.scan,
            spawnCompare.estimatedSurfaceTempK,
            spawnCompare.speciesMatchContext,
            spawnCompare.bodyTabLabel ?? "this body",
          )
        : null,
    [spawnCompare],
  );

  useEffect(() => {
    void loadRows()
      .then(setRows)
      .catch((e) => {
        // A list already on screen stays; only a first load that fails says so.
        if (!rowsCache) setLoadErr(e instanceof Error ? e.message : String(e));
      });
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

  const facets = useMemo(() => (rows?.length ? buildEncyclopediaFacetOptions(rows) : null), [rows]);

  /**
   * Foot-catalog hit count per species, computed once per (rows, catalog) instead of scanning the
   * whole catalog for every row on every render — that was O(rows x catalog) over a 231 KB file.
   */
  const normCatalog = useMemo(() => normFoot(footScannedEntries), [footScannedEntries]);
  const footHitCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!rows?.length) return m;
    for (const r of rows) m.set(r.entry.id, footHitsForEntry(r.entry, normCatalog).length);
    return m;
  }, [rows, normCatalog]);

  const genusLabels = useMemo(() => {
    if (!rows?.length) return [];
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.entry.genus?.trim() || r.entry.genusDataDir);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  /*
    "Not found yet": species with no find in your foot catalog (guild tester report, 2026-09-30: "what
    you've found vs what is still out there"). Per colour variant, that list is Achievements' "Still to
    find". Remembered between opens.
  */
  const [notFoundOnly, setNotFoundOnlyState] = useState(() => readLsBool(EDEXO_ENCY_NOT_FOUND_LS, false));
  const setNotFoundOnly = (v: boolean) => {
    setNotFoundOnlyState(v);
    writeLsBool(EDEXO_ENCY_NOT_FOUND_LS, v);
  };
  const { rows: filtered, searching } = useMemo(() => {
    const ranked = rows ? rankEncyclopediaRows(rows, filters) : { rows: [], searching: false };
    return notFoundOnly
      ? { ...ranked, rows: ranked.rows.filter((r) => (footHitCounts.get(r.entry.id) ?? 0) === 0) }
      : ranked;
  }, [rows, filters, notFoundOnly, footHitCounts]);
  const notFoundCount = useMemo(
    () => (rows ?? []).filter((r) => (footHitCounts.get(r.entry.id) ?? 0) === 0).length,
    [rows, footHitCounts],
  );

  /** Genus is how players think about exobiology, and it makes 108 rows navigable without
   *  virtualisation: ~25 headers instead of one undifferentiated column. */
  const genusSections = useMemo(() => {
    const byGenus = new Map<string, EncyclopediaSpeciesRowDTO[]>();
    const dirOf = new Map<string, string>();
    for (const r of filtered) {
      dirOf.set(r.entry.genus?.trim() || r.entry.genusDataDir, r.entry.genusDataDir);
      const g = r.entry.genus?.trim() || r.entry.genusDataDir;
      const arr = byGenus.get(g);
      if (arr) arr.push(r);
      else byGenus.set(g, [r]);
    }
    return [...byGenus.entries()]
      .map(([genus, rs]) => ({ genus, dir: dirOf.get(genus) ?? genus, rows: rs }))
      .sort((x, y) => x.genus.localeCompare(y.genus, undefined, { sensitivity: "base" }));
  }, [filtered]);

  const chips = useMemo(() => activeEncyclopediaFilterChips(filters), [filters]);

  /*
    Two passes (UI review, 2026-09-30): all 118 field-guide cards are ~22,000 page elements, which
    doubled the Encyclopedia's open time. The first pass draws the first cards only, so the panel
    shows at once; the second draws the rest right after it has painted. (A dozen per frame was
    tried: every step re-rendered the whole list and cost more in total.)
  */
  const displayOrder = useMemo(() => {
    const ids = searching
      ? filtered.map((r) => r.entry.id)
      : genusSections.flatMap((s) => s.rows.map((r) => r.entry.id));
    return new Map(ids.map((id, i) => [id, i]));
  }, [searching, filtered, genusSections]);
  const [allCharts, setAllCharts] = useState(false);
  useEffect(() => {
    if (!rows || allCharts) return;
    let t = 0;
    const id = requestAnimationFrame(() => {
      t = window.setTimeout(() => setAllCharts(true), 0);
    });
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [rows, allCharts]);

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
    priceCredits,
    photoUrl,
    photoUrls,
    photoNote,
    photoCreditByUrl,
    exomasteryFeederBodyCount = 0,
    exomasteryProfileFilePresent = false,
    exomasteryEncyclopediaAvailable = false,
    exomasteryDataInsufficient = false,
  }: EncyclopediaSpeciesRowDTO) => {
    const exoEnabled = exomasteryEncyclopediaAvailable;
    const foundN = footHitCounts.get(entry.id) ?? 0;
    const exoExpanded = inlineExo?.speciesEntryId === entry.id && !exoClosing;
    const hasExoDrawer = inlineExo?.speciesEntryId === entry.id;
    const g = guide?.species.get(entry.id);
    // Before the second pass only the first cards exist (see allCharts).
    if (!allCharts && (displayOrder.get(entry.id) ?? 0) >= FIRST_CHARTS) return null;
    return (
      <article key={entry.id} className="encyclopedia-species-card fg-card">
        {exoEnabled && exomasteryDataInsufficient ? (
          <Tooltip
            className="ency-low-sample-anchor"
            text="Low sample — exomastery has only one recorded body for this species, so its habitat figures are indicative, not typical."
          >
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
        {/*
          The field-guide card (owner, 2026-09-29, after the website's species page): the photo on
          top, then the description, the conditions checked against the body, where the species was
          actually found, and mode charts with the body marked on each.
        */}
        <button
          type="button"
          className="fg-photo"
          onClick={() =>
            setPhotoZoom({
              urls: photoUrls?.length ? photoUrls : [photoUrl],
              note: photoNote,
              creditByUrl: photoCreditByUrl,
            })
          }
          aria-label={`Enlarge photo for ${entry.displayName}`}
          // Credit on the hover here and in full once opened: the photographs are not this
          // project's to show unmarked.
          title={[photoCreditTitle(photoUrl, photoCreditByUrl?.[photoUrl]), "Click for the full-size photos"]
            .filter(Boolean)
            .join(" — ")}
        >
          <EncyclopediaThumb photoUrl={photoUrl} displayName={entry.displayName} className="fg-photo-img" size="card" />
          {(photoUrls?.length ?? 0) > 1 ? <span className="fg-photo-count">{photoUrls!.length} photos</span> : null}
        </button>
        <div className="encyclopedia-species-col">
          <header className="fg-head">
            <div className="fg-head-name">
              <h4 className="encyclopedia-species-title">
                <RarityGem rarity={entry.rarity} className="rarity-gem--ency" />
                {entry.displayName}
              </h4>
              <span className="encyclopedia-species-genus dim tiny">{entry.genus || entry.genusDataDir}</span>
            </div>
            {priceCredits ? (
              <div className="fg-value">
                <strong title={`${priceCredits.toLocaleString("en-US")} cr`}>{fmtGuideCredits(priceCredits)} cr</strong>
                <span title={`${(priceCredits * 5).toLocaleString("en-US")} cr`}>
                  {fmtGuideCredits(priceCredits * 5)} first footfall
                </span>
              </div>
            ) : null}
          </header>
          {photoNote ? <p className="encyclopedia-photo-note dim tiny">{photoNote}</p> : null}
          {entry.description ? <p className="encyclopedia-desc">{entry.description}</p> : null}
          {g?.sampleDistanceM ? (
            <span className="fg-chip">Clonal range {g.sampleDistanceM.toLocaleString("en-US")} m</span>
          ) : null}
          <div className="encyclopedia-criteria">
            <span className="fg-h">Conditions{spawnCompare ? ` · vs ${spawnCompare.bodyTabLabel ?? "this body"}` : ""}</span>
            <EncyclopediaSpeciesConditions entry={entry} spawnCompare={spawnCompare} />
          </div>
          {g?.measured ? (
            <GuideMeasuredBlock m={g.measured} body={guideBody} />
          ) : guide ? (
            <p className="fg-none">
              Not measured yet: the corpus has not confirmed this species on enough bodies to chart. The
              conditions above are what the app predicts from.
            </p>
          ) : null}
          <GuideColoursBlock c={g?.colours ?? null} />
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
              {inlineExo?.data && !inlineExo.loading ? <ExomasteryPlanetsBody data={inlineExo.data} /> : null}
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
                <button
                  type="button"
                  className={`btn-top-toggle ency-notfound-toggle${notFoundOnly ? " btn-top-toggle--on" : ""}`}
                  onClick={() => setNotFoundOnly(!notFoundOnly)}
                  title="Only species you have not found yet (no Log, Sample or Analyse in your journals). Per colour variant: Achievements → Still to find."
                >
                  {notFoundOnly ? `Not found yet ✓ (${notFoundCount})` : "Not found yet ✗"}
                </button>
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
                  Compared with <strong>{spawnCompare.bodyTabLabel ?? "the selected body"}</strong>
                  {spawnCompare.scan?.PlanetClass ? (
                    <>
                      {" "}
                      (<span className="ency-spawn-scan-class">{spawnCompare.scan.PlanetClass}</span>)
                    </>
                  ) : spawnCompare.scan ? (
                    <> (detailed scan incomplete)</>
                  ) : (
                    <> — no detailed scan of it yet</>
                  )}
                  . Conditions: <span className="fg-key fg-key--ok">blue</span> matches,{" "}
                  <span className="fg-key fg-key--warn">yellow</span> not known yet,{" "}
                  <span className="fg-key fg-key--bad">red</span> does not match. Charts: the bodies each species
                  was confirmed on, the <span className="fg-key fg-key--mode">orange</span> bar and line the most
                  common value, the <span className="fg-key fg-key--ok">blue</span> line this body.
                </p>
              ) : (
                <p className="encyclopedia-spawn-compare-line dim tiny">
                  Charts: the bodies each species was confirmed on; the{" "}
                  <span className="fg-key fg-key--mode">orange</span> bar and line mark the most common value.
                  Open the Encyclopedia with a body selected to see how that body compares.
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
                    <div className="fg-grid">{filtered.map(renderSpeciesRow)}</div>
                  ) : (
                    genusSections.map((sec) => (
                      <section key={sec.genus} className="ency-genus-section">
                        <h4 className="ency-genus-head">
                          <span className="ency-genus-name">{sec.genus}</span>
                          <span className="ency-genus-count">{sec.rows.length}</span>
                        </h4>
                        <GuideGenusIntro g={guide?.genera.get(sec.dir)} />
                        <div className="fg-grid">{sec.rows.map(renderSpeciesRow)}</div>
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
        <PhotoGallery
          urls={photoZoom.urls}
          note={photoZoom.note}
          creditByUrl={photoZoom.creditByUrl}
          onClose={() => setPhotoZoom(null)}
        />
      ) : null}
      {foundFor ? (
        <FoundSpeciesPopup
          entry={foundFor}
          hits={footHitsForEntry(foundFor, normCatalog)}
          onClose={() => setFoundFor(null)}
        />
      ) : null}
    </div>
  );
}
