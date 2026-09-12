/**
 * The app bar and its tray, split out of App.tsx (WEBUI-REDESIGN 7.3). No logic changed.
 */
import { useLastStateAt } from "./useLiveSnapshot";
import { useConfirm, useToast } from "./ui/feedback";
import { InfoPopover, Tooltip } from "./ui/Tooltip";
import { IconChevronDown, IconEncyclopedia, IconExobiology, IconFeeder, IconGalaxy, IconOptions, IconBacklog } from "./ui/icons";
import { useValueFlash } from "./ui/useValueFlash";
import { fmtCrExact, fmtCrShort } from "./credits";
import { useCallback, lazy, memo, Suspense, useEffect, useId, useRef, useState, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useFdevServerStatus } from "./useFdevServerStatus";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import type { AppSnapshot, FootScannedEntry, JournalSystemInfo, NotableBodyInfo } from "@shared/types";
import { primaryStarChipClass, primaryStarRoleTag, primaryStarRoleTooltip } from "./speciesMatchHelpers";
import { useFeederStatus } from "./FeederStatusPanel";
import { DataValueBreakdownModal, FeederModal, MyExobiologyModal } from "./AppModals";
import { ExoDataAlertsHeaderHub } from "./ExoDataAlertsHub";
import { MapOptionsModal } from "./OptionsModal";
import { EncyclopediaModal, FirstDiscoveryBacklogModal, InlineSpinner, ModalLoading } from "./SharedModals";
import { EDEXO_HEADER_TRAY_LS, readLsBool, writeLsBool } from "./lsPrefs";
import { readRouteHeaderMetricMode, routeHeaderBarAria, routeHeaderBarModel, routeHeaderToggleTitleHint, routeNavCardTitle, writeRouteHeaderMetricMode } from "./routeHeader";
import type { RouteHeaderMetricMode } from "./routeHeader";

const PlanetQuickFactsPopup = lazy(() =>
  import("./PlanetQuickFactsPopup").then((m) => ({ default: m.PlanetQuickFactsPopup })),
);

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

export const HeaderBar = memo(function HeaderBar({
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
  const [feederOpen, setFeederOpen] = useState(false);
  /**
   * §11.3. The button appears only when this machine actually has a corpus — otherwise it would
   * open an empty modal for every normal install. One fetch, shared with the panel.
   */
  const feeder = useFeederStatus();
  const [myExoOpen, setMyExoOpen] = useState(false);
  const [encyclopediaOpen, setEncyclopediaOpen] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
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
  useEffect(() => {
    if (!menuOpen) return;
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
            {snap.currentRegion ? (
              /*
               * Where in the galaxy this is, without opening the galaxy map.
               *
               * Region decides what can grow here — several species do not occur outside particular
               * ones — and a commander deep in the black checking a candidate list should not have
               * to open a second screen to learn which region they are reading it in. Follows the
               * system on show, so browsing somewhere else names *that* region.
               */
              <Tooltip
                className="appbar-region"
                text={`${snap.currentRegion.name} — the galactic region this system sits in. Region is one of the strongest signals in exobiology; several species never appear outside particular ones.`}
              >
                <span className="appbar-region-chip">{snap.currentRegion.name}</span>
              </Tooltip>
            ) : null}
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
          <div className="appbar-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className={`appbar-icon-btn appbar-menu-btn${menuOpen ? " appbar-menu-btn--open" : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu"
              title="Menu: my exobiology, unfinished business, feeder, galaxy map, encyclopedia, options"
            >
              <span className="appbar-menu-glyph" aria-hidden="true" />
            </button>
          <div className={`appbar-menu${menuOpen ? " appbar-menu--open" : ""}`} role="menu" onClick={() => setMenuOpen(false)}>
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
        <p className="sub-live dim header-commander-away">Commander: {snap.currentSystem ?? "—"}</p>
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
      {feederOpen ? <FeederModal status={feeder.status} onRefresh={feeder.refresh} onClose={() => setFeederOpen(false)} /> : null}
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
