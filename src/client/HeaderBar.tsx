/**
 * The app bar and its tray, split out of App.tsx (WEBUI-REDESIGN 7.3). No logic changed.
 */
import { useLastStateAt } from "./useLiveSnapshot";
import { HeaderArt } from "./HeaderArt";
import { useConfirm, useToast } from "./ui/feedback";
import { InfoPopover, Tooltip } from "./ui/Tooltip";
import {
  IconAchievements,
  IconChevronDown,
  IconEncyclopedia,
  IconExobiology,
  IconFeeder,
  IconGalaxy,
  IconOptions,
  IconBacklog,
  IconCarrier,
  IconPoi, IconBookmark, IconBoxel,
  IconStats,
  IconSession,
} from "./ui/icons";
import { useValueFlash } from "./ui/useValueFlash";
import { fmtCrExact, fmtCrShort } from "./credits";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useFdevServerStatus } from "./useFdevServerStatus";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import type { AppSnapshot, FootScannedEntry, NotableBodyInfo } from "@shared/types";
import { useFeederStatus } from "./FeederStatusPanel";
import { ExoDataAlertsHeaderHub } from "./ExoDataAlertsHub";
import { NoticesBell } from "./NoticesBell";
import { measurePopoverSide, type PopoverSide } from "./ui/popoverSide";
import {
  AchievementsModal,
  MapOptionsModal,
  prefetchMenuModals,
  CarriersModal,
  EncyclopediaModal,
  PoiModal,
  BookmarksModal,
  BoxelModal,
  StatisticsModal,
  FirstDiscoveryBacklogModal,
  ModalLoading,
  MyExobiologyModal,
  DataValueBreakdownModal,
  SessionLogModal,
  FeederModal,
} from "./SharedModals";
import { EDEXO_HEADER_TRAY_LS, readLsBool, writeLsBool } from "./lsPrefs";
import {
  readRouteHeaderMetricMode,
  routeHeaderBarAria,
  routeHeaderBarModel,
  routeHeaderToggleTitleHint,
  routeNavCardTitle,
  writeRouteHeaderMetricMode,
} from "./routeHeader";
import type { RouteHeaderMetricMode } from "./routeHeader";
import { CopySystemButton } from "./CopySystemButton";
import { SystemCardRow } from "./SystemCard";

/** A notable body's quick facts, asked for from outside the header (the body strip's notable tabs). */
export const NOTABLE_QUICK_EVENT = "edexo-notable-quick";
import { JournalSystemSearch } from "./JournalSystemSearch";

const PlanetQuickFactsPopup = lazy(() =>
  import("./PlanetQuickFactsPopup").then((m) => ({ default: m.PlanetQuickFactsPopup })),
);

function LiveSnapshotFreshness({ connected }: { connected: boolean }) {
  /** Subscribed rather than passed down: this value changes on every push, and threading it
   * through <HeaderBar> would re-render the header each time. */
  const lastAt = useLastStateAt();
  const [, setTick] = useState(0);
  // Minutes only (owner, 2026-09-30: a seconds counter was distracting), so a slow tick will do.
  // One interval while connected, not a new one for every push (plan 2.2, Fable C6): a push re-renders
  // this anyway, and the tick reads the latest time when it fires.
  const hasLast = lastAt != null;
  useEffect(() => {
    if (!connected || !hasLast) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [connected, hasLast]);

  if (!connected || lastAt == null) return null;

  const sec = Math.floor((Date.now() - lastAt) / 1000);
  const min = Math.floor(sec / 60);
  return (
    <span
      className="top-live-freshness"
      title={`Last live snapshot from the server: ${sec < 60 ? "under a minute" : `${min} min`} ago`}
    >
      {" "}
      · <span className="top-live-freshness__m">{min}m</span>
    </span>
  );
}

const NO_FOOT_ENTRIES: FootScannedEntry[] = [];

type MenuOpeners = Record<
  | "setMyExoOpen"
  | "setBacklogOpen"
  | "setCarriersOpen"
  | "setPoiOpen"
  | "setBoxelOpen"
  | "setBookmarksOpen"
  | "setStatsOpen"
  | "setFeederOpen"
  | "setEncyclopediaOpen"
  | "setAchievementsOpen"
  | "setSessionOpen"
  | "setOptionsOpen",
  (v: boolean) => void
>;

/**
 * The menu's entries, apart from the header (plan 2.2, Fable C5): the header takes the whole
 * snapshot and renders on every push — ten a second in flight — and with it went twelve buttons,
 * thirteen tooltips and twelve icons that never change. Its props are the feeder flag and the
 * panels' setters, which are stable, so it renders when the feeder appears and not otherwise.
 */
const AppMenuEntries = memo(function AppMenuEntries({
  feederAvailable,
  open,
}: {
  feederAvailable: boolean;
  open: MenuOpeners;
}) {
  return (
    <>
      {/*
        The panel behind this icon stopped being only exobiology: it now carries every system,
        body and star in the merged journals beside the foot-confirmed species. The menu is
        icons and tooltips, so the tooltip is the only place the name lives — leaving it as "My
        exobiology" made three new tabs unfindable.
      */}
      <Tooltip text="My discoveries — every system, body and star you have scanned, plus the species you confirmed on foot.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setMyExoOpen(true)}
          aria-label="My discoveries"
        >
          <IconExobiology />
        </button>
      </Tooltip>
      <Tooltip text="Unfinished business — biology you found first and never collected, still worth 5x.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setBacklogOpen(true)}
          aria-label="Unfinished business"
        >
          <IconBacklog />
        </button>
      </Tooltip>
      {/*
        Carriers is in the menu rather than the app bar because it is a thing the commander goes
        looking for — where do I sell a full sample bag — not something they watch. The panel
        holds no data until they press its button.
      */}
      <Tooltip text="Carriers — fleet carriers near you, from EDAstro. Downloads on request; positions are last sightings.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setCarriersOpen(true)}
          aria-label="Carriers"
        >
          <IconCarrier />
        </button>
      </Tooltip>
      <Tooltip text="Points of interest — the Galactic Exploration Catalog near you, from EDAstro. Downloads on request.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setPoiOpen(true)}
          aria-label="Points of interest"
        >
          <IconPoi />
        </button>
      </Tooltip>
      <Tooltip text="Boxel — every system of one boxel, which you have flown, what is recorded there, and the next one to fly.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setBoxelOpen(true)}
          aria-label="Boxel"
        >
          <IconBoxel />
        </button>
      </Tooltip>
      <Tooltip text="Bookmarks — systems you marked with the ☆ beside a system's name, with tags and notes.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setBookmarksOpen(true)}
          aria-label="Bookmarks"
        >
          <IconBookmark />
        </button>
      </Tooltip>
      <Tooltip text="Statistics — income by source, activity and balances, over 24 h to all time.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setStatsOpen(true)}
          aria-label="Statistics"
        >
          <IconStats />
        </button>
      </Tooltip>
      {feederAvailable ? (
        <Tooltip text="Data feeder — the corpus behind the rankings, and whether any profile is behind it.">
          <button
            type="button"
            className="appbar-icon-btn"
            onClick={() => open.setFeederOpen(true)}
            aria-label="Data feeder"
          >
            <IconFeeder />
          </button>
        </Tooltip>
      ) : null}
      <Tooltip text="Galaxy map — 5.3 million systems with recorded biology, your own travels, search and codex, in 3D. Opens in its own window.">
        <a
          className="appbar-icon-btn"
          href="?screen=galaxy"
          target="_blank"
          rel="noreferrer"
          aria-label="Galaxy map"
        >
          <IconGalaxy />
        </a>
      </Tooltip>
      <Tooltip text="Encyclopedia — every species, its requirements, and what you have found.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setEncyclopediaOpen(true)}
          aria-label="Encyclopedia"
        >
          <IconEncyclopedia />
        </button>
      </Tooltip>
      <Tooltip text="Achievements — every plant variant by galaxy, genus, rarity and region, Bronze / Silver / Gold; track one to mark its plants.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setAchievementsOpen(true)}
          aria-label="Achievements"
        >
          <IconAchievements />
        </button>
      </Tooltip>
      <Tooltip text="Session log — tonight's systems, landings, species analysed and sales; copy as Markdown.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setSessionOpen(true)}
          aria-label="Session log"
        >
          <IconSession />
        </button>
      </Tooltip>
      <Tooltip text="Options — journal service info, map tier thresholds, reset.">
        <button
          type="button"
          className="appbar-icon-btn"
          onClick={() => open.setOptionsOpen(true)}
          aria-label="Options"
        >
          <IconOptions />
        </button>
      </Tooltip>
    </>
  );
});

export const HeaderBar = memo(function HeaderBar({
  snap,
  connected,
  onFootCatalogNavigate,
  onDiscoveriesNavigate,
  onGoToBioBody,
  encyclopediaSpawnCompare,
  onOpenSystemMap,
}: {
  snap: AppSnapshot;
  connected: boolean;
  onFootCatalogNavigate?: (e: FootScannedEntry) => void;
  onDiscoveriesNavigate?: (systemAddress: number, bodyKey?: string) => void;
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
  const [sessionOpen, setSessionOpen] = useState(false);
  const [feederOpen, setFeederOpen] = useState(false);
  /**
   * §11.3. The button appears only when this machine actually has a corpus — otherwise it would
   * open an empty modal for every normal install. One fetch, shared with the panel.
   */
  const feeder = useFeederStatus();
  const [myExoOpen, setMyExoOpen] = useState(false);
  const [encyclopediaOpen, setEncyclopediaOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [carriersOpen, setCarriersOpen] = useState(false);
  const [poiOpen, setPoiOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [boxelOpen, setBoxelOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // The menu's panel openers, one object for the header's life (useState setters never change).
  const menuOpeners: MenuOpeners = useMemo(
    () => ({
      setMyExoOpen,
      setBacklogOpen,
      setCarriersOpen,
      setPoiOpen,
      setBoxelOpen,
      setBookmarksOpen,
      setStatsOpen,
      setFeederOpen,
      setEncyclopediaOpen,
      setAchievementsOpen,
      setSessionOpen,
      setOptionsOpen,
    }),
    [],
  );
  const [notableQuick, setNotableQuick] = useState<{
    notable: NotableBodyInfo;
    x: number;
    y: number;
  } | null>(null);
  // My discoveries re-sorted its whole table on every push while open: a new onClose rebuilt its columns.
  const closeMyExo = useCallback(() => setMyExoOpen(false), []);
  // One function for the header's life, so the system card's memo holds (snapSlice.ts).
  const openNotableQuick = useCallback((n: NotableBodyInfo, ev: ReactMouseEvent) => {
    ev.stopPropagation();
    setNotableQuick({ notable: n, x: ev.clientX, y: ev.clientY });
  }, []);
  // Notable tabs in the body strip open the same quick facts (App.tsx, BodyTabStrip.tsx).
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ notable: NotableBodyInfo; x: number; y: number }>).detail;
      if (d?.notable) setNotableQuick(d);
    };
    window.addEventListener(NOTABLE_QUICK_EVENT, on);
    return () => window.removeEventListener(NOTABLE_QUICK_EVENT, on);
  }, []);
  const [routeHeaderMetricMode, setRouteHeaderMetricMode] = useState<RouteHeaderMetricMode>(() =>
    readRouteHeaderMetricMode(),
  );
  const [trayOpen, setTrayOpen] = useState(() => readLsBool(EDEXO_HEADER_TRAY_LS, true));
  /*
    The cockpit menu (WEBUI-REDESIGN 2.3): the six secondary destinations behind one button, so the
    app bar is search, status, alerts, menu, tray. Closes on outside click and Escape.
  */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => prefetchMenuModals(), []);
  /** Which way the menu opens; the rule is shared with the alerts popover. */
  const [menuSide, setMenuSide] = useState<PopoverSide>("left");
  useEffect(() => {
    if (!menuOpen) return;
    const wrap = menuRef.current;
    setMenuSide(measurePopoverSide(wrap, wrap?.querySelector<HTMLElement>(".appbar-menu"), 240));
    const onDoc = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  /* The Data value window's "+30% Pranav Antal bonus" (owner, 2026-10-03): a saved setting. */
  const togglePranavAntal = (on: boolean) => {
    void (async () => {
      try {
        const r = await fetch("/api/settings/pranav-antal-bonus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: on }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
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

  return (
    <header className="top">
      <HeaderArt />
      {/*
        Three zones, not one wrapping row.

        The bar was `display: flex; flex-wrap: wrap`, so at any width where the contents did not quite
        fit, items wrapped in whatever order they happened to fall — the commander name, the two status
        dots and the menu each landing somewhere different depending on how long the system name was.
        The owner's complaint was that they are "all around the screen when the width changes".

        A grid gives each of them a home that width cannot take away: identity on the left, the system
        and its search in the middle, status and actions on the right. Only the middle is elastic, and
        it truncates rather than pushing anything out of place.
      */}
      <div className="appbar">
        <div className="appbar-left">
          <img src="/edexo-icon-124.webp" alt="" className="appbar-mark" width={24} height={24} />
          <span className="appbar-wordmark logo">ED EXO COMPARE</span>
        </div>

        <div className="appbar-centre">
          <div className="appbar-search">
            <JournalSystemSearch snap={snap} onGoToBioBody={onGoToBioBody} />
          </div>
        </div>

        <div className="appbar-right">
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

          {/* Pinned to the right, on the same row as the wordmark and the system — the owner's ask. */}
          {cmdr ? (
            <span className="appbar-cmdr">
              <span className="top-playing-as-muted">CMDR </span>
              <span className="top-playing-as-cmdr">{cmdr}</span>
            </span>
          ) : null}

          <div className="appbar-actions">
            <NoticesBell snap={snap} />
            <ExoDataAlertsHeaderHub snap={snap} />
            <div className="appbar-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className={`appbar-icon-btn appbar-menu-btn${menuOpen ? " appbar-menu-btn--open" : ""}`}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Menu"
                // Same names and order as the entries (UI review F2).
                title="Menu: My discoveries, Unfinished business, Carriers, Points of interest, Statistics, Data feeder, Galaxy map, Encyclopedia, Achievements, Session log, Options"
              >
                <span className="appbar-menu-glyph" aria-hidden="true" />
              </button>
              <div
                className={`appbar-menu appbar-menu--${menuSide}${menuOpen ? " appbar-menu--open" : ""}`}
                role="menu"
                onClick={() => setMenuOpen(false)}
              >
                <AppMenuEntries feederAvailable={feeder.available} open={menuOpeners} />
              </div>
            </div>
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
      </div>

      {snap.edsmMapSupplementForViewingSystem ? (
        <p className="header-edsm-map-note dim">
          System map uses public galaxy data, EDSM or Spansh (no journal <code>Scan</code> for this system
          yet).
        </p>
      ) : null}

      {/* The System card, star cards and notable bodies — SystemCard.tsx (Discord batch O-E2). */}
      <SystemCardRow
        snap={snap}
        onOpenSystemMap={onOpenSystemMap}
        onNotableClick={openNotableQuick}
      />

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
            title={
              scanDataOn
                ? "Unsold exobiology plus your unsold planetary scans — click for a breakdown"
                : "Unsold exobiology — click for a per-sample breakdown. ⊕ adds your unsold planetary scans."
            }
            onClick={() => setDataBreakdownOpen(true)}
          >
            {/* "Data value" either way (owner, 2026-09-30); the tooltip says what it holds. */}
            <span className="data-value-label header-metric-card-label">Data value</span>
            <span
              className={`data-value-amount header-metric-card-value ${dataValueFlash}`.trim()}
              title={fmtCrExact(totalDataCr)}
            >
              {fmtCrShort(totalDataCr)} CR
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
            {snap.focusedSystemUndiscovered ? (
              <div
                className="d-scan-card d-scan-card--complete d-scan-card--header-row header-route-mini d-scan-card--label-only"
                title="You scanned this system's main star before anyone else had — the system is your discovery, and its cartographic data pays the first-discovery bonus."
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
                  let sepN = 0;
                  const sep = () => (
                    <span key={`sep-${sepN++}`} className="dim">
                      {" · "}
                    </span>
                  );
                  const compactLine: ReactNode[] = [];
                  if (nav) {
                    if (jumpsShown != null) {
                      compactLine.push(
                        <span key="j" className="header-route-num">
                          {jumpsShown}
                        </span>,
                        sep(),
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
                    if (compactLine.length) compactLine.push(sep());
                    compactLine.push(
                      <span key="est" className="dim">
                        ~{fr.estJumpsRemaining} max
                      </span>,
                    );
                  }
                  if (nav && !nav.onPlot) {
                    if (compactLine.length) compactLine.push(sep());
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
        <p className="sub-live dim header-commander-away">
          Commander: {snap.currentSystem ?? "—"}
          <CopySystemButton system={snap.currentSystem} />
        </p>
      ) : null}

      {statsOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <StatisticsModal onClose={() => setStatsOpen(false)} />
        </Suspense>
      ) : null}

      {boxelOpen ? (
        <Suspense fallback={null}>
          <BoxelModal onClose={() => setBoxelOpen(false)} currentSystem={snap.currentSystem ?? null} />
        </Suspense>
      ) : null}
      {bookmarksOpen ? (
        <Suspense fallback={null}>
          <BookmarksModal
            onClose={() => setBookmarksOpen(false)}
            currentSystemAddress={snap.currentSystemAddress ?? null}
          />
        </Suspense>
      ) : null}
      {poiOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <PoiModal onClose={() => setPoiOpen(false)} />
        </Suspense>
      ) : null}

      {carriersOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <CarriersModal onClose={() => setCarriersOpen(false)} />
        </Suspense>
      ) : null}

      {backlogOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <FirstDiscoveryBacklogModal onClose={() => setBacklogOpen(false)} />
        </Suspense>
      ) : null}

      {achievementsOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <AchievementsModal onClose={() => setAchievementsOpen(false)} />
        </Suspense>
      ) : null}
      {encyclopediaOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <EncyclopediaModal
            footScannedEntries={snap.footScannedEntries ?? []}
            spawnCompare={encyclopediaSpawnCompare}
            currentRegion={snap.currentRegion?.name ?? null}
            onClose={() => setEncyclopediaOpen(false)}
          />
        </Suspense>
      ) : null}
      {myExoOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <MyExobiologyModal
            entries={snap.footScannedEntries ?? NO_FOOT_ENTRIES}
            onClose={closeMyExo}
            onNavigateEntry={onFootCatalogNavigate}
            onNavigateSystem={onDiscoveriesNavigate}
          />
        </Suspense>
      ) : null}
      {dataBreakdownOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <DataValueBreakdownModal
            lines={snap.organicPendingLines ?? []}
            includeExplorationScanDataInDataValue={scanDataOn}
            explorationFssScanCount={snap.explorationFssScanCount ?? 0}
            explorationFssValueCredits={snap.explorationFssValueCredits ?? 0}
            explorationDssScanCount={snap.explorationDssScanCount ?? 0}
            explorationDssValueCredits={snap.explorationDssValueCredits ?? 0}
            exobioScanCount={snap.organicPendingSampleCount}
            exobioValueCredits={snap.organicDataValueCredits}
            pranavAntalBonus={snap.pranavAntalBonus === true}
            onTogglePranavAntal={togglePranavAntal}
            onClose={() => setDataBreakdownOpen(false)}
          />
        </Suspense>
      ) : null}
      {sessionOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <SessionLogModal log={snap.sessionLog ?? null} onClose={() => setSessionOpen(false)} />
        </Suspense>
      ) : null}
      {optionsOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <MapOptionsModal
            snap={snap}
            plusMinCr={snap.exoMapTierPlusMinCr}
            plusPlusMinCr={snap.exoMapTierPlusPlusMinCr}
            onResetExobiology={resetExobiology}
            onClose={() => setOptionsOpen(false)}
          />
        </Suspense>
      ) : null}
      {feederOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <FeederModal status={feeder.status} onRefresh={feeder.refresh} onClose={() => setFeederOpen(false)} />
        </Suspense>
      ) : null}
      {notableQuick ? (
        <Suspense fallback={null}>
          <PlanetQuickFactsPopup
            detail={snap.systemMap?.detailsByBodyId[String(notableQuick.notable.bodyId)] ?? null}
            fallbackTitle={notableQuick.notable.bodyName}
            fallbackSubtitle={`${notableQuick.notable.tag}${notableQuick.notable.dssMapped ? " · DSS mapped" : " · FSS / scan only"}`}
            bodyId={notableQuick.notable.bodyId}
            records={snap.notices?.recordMarks.filter((m) => m.bodyId === notableQuick.notable.bodyId)}
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
