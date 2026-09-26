/**
 * The app bar and its tray, split out of App.tsx (WEBUI-REDESIGN 7.3). No logic changed.
 */
import { useLastStateAt } from "./useLiveSnapshot";
import { useConfirm, useToast } from "./ui/feedback";
import { InfoPopover, Tooltip } from "./ui/Tooltip";
import {
  IconChevronDown,
  IconEncyclopedia,
  IconExobiology,
  IconFeeder,
  IconGalaxy,
  IconOptions,
  IconBacklog,
  IconCarrier,
  IconPoi,
  IconStats,
  IconSession,
} from "./ui/icons";
import { useValueFlash } from "./ui/useValueFlash";
import { fmtCrExact, fmtCrShort } from "./credits";
import { lazy, memo, Suspense, useEffect, useRef, useState, ReactNode } from "react";
import { useFdevServerStatus } from "./useFdevServerStatus";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import type { AppSnapshot, FootScannedEntry, JournalSystemInfo, NotableBodyInfo } from "@shared/types";
import { useFeederStatus } from "./FeederStatusPanel";
import { DataValueBreakdownModal, FeederModal, MyExobiologyModal, SessionLogModal } from "./AppModals";
import { ExoDataAlertsHeaderHub } from "./ExoDataAlertsHub";
import { measurePopoverSide, type PopoverSide } from "./ui/popoverSide";
import { MapOptionsModal } from "./OptionsModal";
import {
  CarriersModal,
  EncyclopediaModal,
  PoiModal,
  StatisticsModal,
  FirstDiscoveryBacklogModal,
  InlineSpinner,
  ModalLoading,
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
import { bodyPartOfQuery, ownerFirst } from "./systemSearchMatch";

const PlanetQuickFactsPopup = lazy(() =>
  import("./PlanetQuickFactsPopup").then((m) => ({ default: m.PlanetQuickFactsPopup })),
);

/**
 * The header's system search: the journals first, Spansh as you type (owner, 2026-09-25).
 *
 * Pasting a name copied from EDSM or Spansh used to show nothing unless you then pressed a "Search:
 * EDSM / Spansh" button, and choosing a hit showed "no data" unless you pressed a "Load bodies"
 * button too. Now a name of three letters or more is looked up on Spansh by itself, the hits join
 * the dropdown — nothing is opened until you pick one — and picking a system the journals do not know
 * fetches its bodies from Spansh (see `server/remoteSystems.ts`). When a name cannot be found, the
 * list says so and says where it looked.
 */
function JournalSystemSearch({
  snap,
  onGoToBioBody,
}: {
  snap: AppSnapshot;
  onGoToBioBody?: (bodyKey: string) => void;
}) {
  const toast = useToast();
  const systems: JournalSystemInfo[] = snap.journalSystems ?? [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<{
    q: string;
    busy: boolean;
    hits: JournalSystemInfo[];
    error: string | null;
  }>({ q: "", busy: false, hits: [], error: null });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** A pasted body name: its tab opens once the chosen system's bodies are in. */
  const [pendingBody, setPendingBody] = useState<{ name: string; at: number } | null>(null);

  const journalLoading = snap.journalBoot != null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const typed = query.trim();
  const q = typed.toLowerCase();
  const filtered =
    q === ""
      ? systems
      : ownerFirst(
          systems.filter(
            (s) =>
              s.starSystem.toLowerCase().includes(q) ||
              String(s.systemAddress).includes(q) ||
              bodyPartOfQuery(typed, s.starSystem) !== null,
          ),
          typed,
        );

  useEffect(() => {
    if (!pendingBody) return;
    if (Date.now() - pendingBody.at > 30_000) {
      setPendingBody(null);
      return;
    }
    const want = pendingBody.name.toLowerCase();
    const hit = (snap.bodies ?? []).find((b) => b.state.bodyName.trim().toLowerCase() === want);
    if (hit) {
      onGoToBioBody?.(hit.state.key);
      setPendingBody(null);
    }
  }, [pendingBody, snap.bodies, onGoToBioBody]);

  // Spansh, by itself, a moment after the typing or the paste stops.
  useEffect(() => {
    if (!open || journalLoading || typed.length < 3) {
      setRemote((r) => (r.q === "" && !r.busy ? r : { q: "", busy: false, hits: [], error: null }));
      return;
    }
    let live = true;
    setRemote({ q: typed, busy: true, hits: [], error: null });
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(`/api/system/spansh-search?q=${encodeURIComponent(typed)}`);
          const j = (await r.json().catch(() => null)) as {
            systems?: JournalSystemInfo[];
            error?: string;
          } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
          if (live) setRemote({ q: typed, busy: false, hits: j?.systems ?? [], error: null });
        } catch (e) {
          if (live) {
            setRemote({ q: typed, busy: false, hits: [], error: e instanceof Error ? e.message : String(e) });
          }
        }
      })();
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [typed, open, journalLoading]);

  // Anything the journals know is never offered again as a Spansh hit, matched or not.
  const journalAddrs = new Set(systems.map((s) => s.systemAddress));
  const spanshHits = ownerFirst(
    remote.hits.filter((s) => !journalAddrs.has(s.systemAddress)),
    typed,
  );
  const searched = remote.q === typed && typed.length >= 3;

  const applyView = (systemAddress: number | null, meta?: { starSystem?: string }) => {
    const bodyPart = meta?.starSystem ? bodyPartOfQuery(typed, meta.starSystem) : null;
    setPendingBody(bodyPart ? { name: typed, at: Date.now() } : null);
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

  const rv = snap.remoteView ?? null;

  return (
    <div className="journal-system-search" ref={wrapRef}>
      <input
        type="search"
        className="journal-system-search-input"
        autoComplete="off"
        placeholder={journalLoading ? "Loading journals…" : "Search or paste a system name…"}
        value={query}
        disabled={journalLoading}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !journalLoading && setOpen(true)}
        aria-label="Search systems in your journals and on Spansh"
        aria-expanded={open}
        aria-controls="journal-system-search-results"
      />
      {(snap.viewingSystemAddress != null || rv) && !journalLoading ? (
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
          {/* A looked-up system: say where its bodies came from, or why there are none. */}
          {rv?.state === "loading" ? (
            <span className="journal-system-remote dim">
              <InlineSpinner /> Fetching {rv.starSystem} from Spansh…
            </span>
          ) : rv?.state === "error" ? (
            <span className="journal-system-remote journal-system-remote--error">
              {rv.starSystem}: {rv.error ?? "could not be fetched."}
            </span>
          ) : rv?.state === "ready" ? (
            <span
              className="journal-system-remote dim"
              title="Not from your journals: bodies, signals and logged species from Spansh, kept 30 days. Species other commanders logged are marked; the rest is the app’s prediction."
            >
              From Spansh · {rv.bioBodyCount ?? 0} bio {(rv.bioBodyCount ?? 0) === 1 ? "body" : "bodies"} of{" "}
              {rv.bodyCount ?? 0}
              {rv.fetchedAt ? ` · fetched ${rv.fetchedAt.slice(0, 10)}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {open && !journalLoading ? (
        <ul
          className="journal-system-search-results"
          id="journal-system-search-results"
          role="listbox"
          aria-label="Matching systems"
        >
          {filtered.slice(0, 50).map((s) => (
            <li key={s.systemAddress}>
              <button
                type="button"
                className="journal-system-search-row"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
              >
                <span className="journal-system-search-name">{s.starSystem}</span>
                {bodyPartOfQuery(typed, s.starSystem) ? (
                  <span className="journal-system-search-body">→ {bodyPartOfQuery(typed, s.starSystem)}</span>
                ) : null}
                <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
              </button>
              <CopySystemButton system={s.starSystem} />
            </li>
          ))}
          {spanshHits.map((s) => (
            <li key={`spansh-${s.systemAddress}`}>
              <button
                type="button"
                className="journal-system-search-row journal-system-search-row--edsm"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
              >
                <span className="journal-system-search-name">{s.starSystem}</span>
                {bodyPartOfQuery(typed, s.starSystem) ? (
                  <span className="journal-system-search-body">→ {bodyPartOfQuery(typed, s.starSystem)}</span>
                ) : null}
                <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
                <span className="journal-system-search-edsm-badge dim">Spansh</span>
              </button>
              <CopySystemButton system={s.starSystem} />
            </li>
          ))}
          {typed.length >= 3 && (remote.busy || !searched) ? (
            <li className="journal-system-search-empty dim">
              <InlineSpinner /> Searching Spansh…
            </li>
          ) : null}
          {searched && !remote.busy && remote.error ? (
            <li className="journal-system-search-empty">
              Spansh could not be searched ({remote.error}).
              {filtered.length === 0 ? ` “${typed}” is not in your journals.` : ""}
            </li>
          ) : null}
          {searched && !remote.busy && !remote.error && filtered.length === 0 && spanshHits.length === 0 ? (
            <li className="journal-system-search-empty dim">
              “{typed}” is not in your journals or on Spansh.
            </li>
          ) : null}
          {typed.length > 0 && typed.length < 3 && filtered.length === 0 ? (
            <li className="journal-system-search-empty dim">
              Not in your journals — type 3 letters or more to search Spansh.
            </li>
          ) : null}
        </ul>
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
  onDiscoveriesNavigate?: (systemAddress: number, bodyName?: string) => void;
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
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [carriersOpen, setCarriersOpen] = useState(false);
  const [poiOpen, setPoiOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [notableQuick, setNotableQuick] = useState<{
    notable: NotableBodyInfo;
    x: number;
    y: number;
  } | null>(null);
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

  return (
    <header className="top">
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
            <ExoDataAlertsHeaderHub snap={snap} />
            <div className="appbar-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className={`appbar-icon-btn appbar-menu-btn${menuOpen ? " appbar-menu-btn--open" : ""}`}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Menu"
                title="Menu: my exobiology, unfinished business, carriers, points of interest, statistics, feeder, galaxy map, encyclopedia, options"
              >
                <span className="appbar-menu-glyph" aria-hidden="true" />
              </button>
              <div
                className={`appbar-menu appbar-menu--${menuSide}${menuOpen ? " appbar-menu--open" : ""}`}
                role="menu"
                onClick={() => setMenuOpen(false)}
              >
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
                    onClick={() => setMyExoOpen(true)}
                    aria-label="My discoveries"
                  >
                    <IconExobiology />
                  </button>
                </Tooltip>
                <Tooltip text="Unfinished business — biology you found first and never collected, still worth 5x.">
                  <button
                    type="button"
                    className="appbar-icon-btn"
                    onClick={() => setBacklogOpen(true)}
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
                    onClick={() => setCarriersOpen(true)}
                    aria-label="Carriers"
                  >
                    <IconCarrier />
                  </button>
                </Tooltip>
                <Tooltip text="Points of interest — the Galactic Exploration Catalog near you, from EDAstro. Downloads on request.">
                  <button
                    type="button"
                    className="appbar-icon-btn"
                    onClick={() => setPoiOpen(true)}
                    aria-label="Points of interest"
                  >
                    <IconPoi />
                  </button>
                </Tooltip>
                <Tooltip text="Statistics — income by source, activity and balances, over 24 h to all time.">
                  <button
                    type="button"
                    className="appbar-icon-btn"
                    onClick={() => setStatsOpen(true)}
                    aria-label="Statistics"
                  >
                    <IconStats />
                  </button>
                </Tooltip>
                {feeder.available ? (
                  <Tooltip text="Data feeder — the corpus behind the rankings, and whether any profile is behind it.">
                    <button
                      type="button"
                      className="appbar-icon-btn"
                      onClick={() => setFeederOpen(true)}
                      aria-label="Data feeder"
                    >
                      <IconFeeder />
                    </button>
                  </Tooltip>
                ) : null}
                <Tooltip text="Galaxy map — every sector where a species is known, confirmed or merely signalled. Opens in a new tab.">
                  <a
                    className="appbar-icon-btn"
                    href="?screen=map"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Galaxy sector map"
                  >
                    <IconGalaxy />
                  </a>
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
                <Tooltip text="Session log — tonight's systems, landings, species analysed and sales; copy as Markdown.">
                  <button
                    type="button"
                    className="appbar-icon-btn"
                    onClick={() => setSessionOpen(true)}
                    aria-label="Session log"
                  >
                    <IconSession />
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
        onNotableClick={(n, ev) => {
          ev.stopPropagation();
          setNotableQuick({ notable: n, x: ev.clientX, y: ev.clientY });
        }}
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
            title="Unsold exobiology value — click for a per-sample breakdown"
            onClick={() => setDataBreakdownOpen(true)}
          >
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
          onNavigateSystem={onDiscoveriesNavigate}
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
          exobioScanCount={snap.organicPendingSampleCount}
          exobioValueCredits={snap.organicDataValueCredits}
          onClose={() => setDataBreakdownOpen(false)}
        />
      ) : null}
      {sessionOpen ? (
        <SessionLogModal log={snap.sessionLog ?? null} onClose={() => setSessionOpen(false)} />
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
      {feederOpen ? (
        <FeederModal status={feeder.status} onRefresh={feeder.refresh} onClose={() => setFeederOpen(false)} />
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
