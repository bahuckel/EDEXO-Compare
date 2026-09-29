import type { JournalHistoryPreset } from "../journalHistoryPreset.js";
import type { TriageTiming } from "../systemTriage.js";
import type {
  HudPrefsDTO,
  JournalBootProgressDTO,
  PhotoStampPrefs,
  SessionLogDTO,
  SharedExomasteryDTO,
} from "./app.js";
import type { BodyComputed, OrganicPendingLineItem } from "./body.js";
import type { FootScannedEntry } from "./footCatalog.js";
import type {
  DScanBodiesDTO,
  ExoMinimapDTO,
  ExoOrganicOverlayDTO,
  JournalSystemInfo,
  LiveShipFuelRangeDTO,
  NotableBodyInfo,
  PrimaryStarsHeaderDTO,
  ShipProximityDTO,
  SystemKind,
} from "./hud.js";
import type { RemoteViewDTO } from "./remote.js";
import type { JumpTargetSource } from "./scan.js";
import type { SystemMapSnapshot } from "./systemMap.js";
import type { NoticesSnapshotDTO } from "../notices.js";

export interface AppSnapshot {
  journalPath: string | null;
  /** How many Journal.*.log files were merged (oldest → newest) */
  journalFileCount: number;
  journalDir: string;
  /** False if the configured journal folder is missing or not a directory. */
  journalDirConfiguredOk: boolean;
  /**
   * Merge every `Journal.*.log` in the folder, or only files from a rolling window (cutoff recomputed when merging).
   */
  journalHistoryPreset: JournalHistoryPreset;
  /**
   * When viewing a journal-known system, the system map is drawn from EDSM because merged journals have no `Scan` rows for that system yet.
   * Cleared when real journal scans arrive; exploration payouts remain journal-first elsewhere.
   */
  edsmMapSupplementForViewingSystem: boolean;
  /**
   * When set, the server is still merging journals (or switching journal folders).
   * The client should show a loading shell; snapshot lists/maps may be empty or stale until this clears.
   */
  journalBoot: JournalBootProgressDTO | null;
  mode: "server" | "client";
  bindHost: string;
  port: number;
  lanUrls: string[];
  /** Journal `LoadGame.Commander`; null until a LoadGame line is merged. */
  commanderName: string | null;
  currentSystem: string | null;
  currentSystemAddress: number | null;
  /**
   * Which of the galaxy's 42 named regions the focused system sits in.
   *
   * Region is one of the strongest signals in exobiology — several species simply do not occur
   * outside particular regions — and the app already shipped a 2 048-row region map that nothing
   * read. It was reachable only by opening the galaxy map, which is the one place a commander does
   * not need to be told where they are. Now it rides on every snapshot, so the header can say it and
   * the matcher can eventually use it.
   *
   * Follows the *viewed* system, not the commander: browsing a system 5 kly away should name that
   * system's region, not the one under the ship. Null when the system has no recorded `StarPos`, or
   * when the point falls outside every named region — which is most of the galaxy.
   */
  currentRegion: { name: string; index: number } | null;
  /**
   * What kind of system is on show: `bubble` (Frontier populated it), `colony`, `colonising` (a
   * claim under construction), `empty`, or null when unknown. See `GameStateStore.systemKind`.
   */
  currentSystemKind?: SystemKind | null;
  /**
   * When non-null, the body list reflects this system (journal memory); null = follow commander (`currentSystemAddress`).
   */
  viewingSystemAddress: number | null;
  /** Friendly name for `viewingSystemAddress` when browsing; null if not browsing or unknown. */
  viewingSystemName: string | null;
  /** Set while the viewed system is one looked up from Spansh rather than known from the journals. */
  remoteView?: RemoteViewDTO | null;
  /** The shared-exomastery folder: files read, finds merged, gate notices (server/sharedExomastery.ts, §S). */
  sharedExomastery?: SharedExomasteryDTO | null;
  /** How far each bio body is from the ship, for the "Closest" body sort (server/shipProximity.ts). */
  shipProximity?: ShipProximityDTO | null;
  /** Distinct systems from merged journal (and any body rows) for search / picker. */
  journalSystems: JournalSystemInfo[];
  bodies: BodyComputed[];
  speciesCount: number;
  lastJournalEventIso: string | null;
  /**
   * Sum of typical sell values for completed (3× analyse) organic samples still unsold in the journal,
   * using `price-list.json`, with 5× total on first-footfall bodies (1× base payout + 4× first-footfall bonus).
   */
  organicDataValueCredits: number;
  /** Rows included in `organicDataValueCredits` (pending sales). */
  organicPendingSampleCount: number;
  /** Per-sample breakdown for the data value modal (unsold completes in journal). */
  organicPendingLines: OrganicPendingLineItem[];
  /** When true, journal has `FSSAllBodiesFound` for the current system and no bodies match bio/hints/organics yet. */
  fssAllBodiesFoundNoBio: boolean;
  /** When true, Bacterium genus is included in planet↔species matching. */
  includeBacteriumInSearch: boolean;
  /**
   * The launcher's HUD settings, mirrored on the server so a phone (its own browser, its own
   * localStorage) renders the HUD in the same colours and order (owner, 2026-09-13, task 13).
   */
  hudPrefs: HudPrefsDTO | null;
  /** The achievement the commander tracks, with what in this system would advance it; null when none. */
  trackedAchievement?: import("./achievements.js").TrackedAchievementDTO | null;
  /** Tonight's play, from live journal lines since the app started (NEXT-TASKS 11). App channel only. */
  sessionLog: SessionLogDTO | null;
  /**
   * EDSM auto-fetch on jump (§50): the toggle, plus enough about the stored credentials for the
   * Options panel to tell the commander what state they are in.
   *
   * `keyHint` is the key's last four characters and nothing else — enough to recognise, useless to
   * anyone who reads it. The key itself never leaves the server.
   */
  /**
   * Sending discoveries to Canonn Research.
   *
   * `sent` / `failed` are this session's tally, so the option can say what it has actually done
   * rather than only what it is set to.
   */
  canonnUpload: { enabled: boolean; sent: number; failed: number };
  /** Sending live events to EDDN. `sent` / `failed` are this session's tally. See `eddnUpload.ts`. */
  eddnUpload: { enabled: boolean; sent: number; failed: number };
  edsmAutoFetch: {
    enabled: boolean;
    commanderName: string | null;
    hasKey: boolean;
    keyHint: string | null;
  };
  /**
   * Contributing the journal to EDSM. Off unless asked for; see `edsmUpload.ts`.
   *
   * `progress` describes the run happening now and is null between runs; `ledger` is what has ever
   * been sent, and survives restarts.
   */
  edsmUpload: {
    enabled: boolean;
    /** Keep sending while the commander plays — a timer over the same catch-up. */
    live: boolean;
    progress: {
      running: boolean;
      filesDone: number;
      filesTotal: number;
      currentFile: string | null;
      eventsSent: number;
      eventsRejected: number;
      eventsDiscarded: number;
      error: string | null;
      fatal: boolean;
      finishedAt: string | null;
    } | null;
    ledger: {
      filesTracked: number;
      eventsAccepted: number;
      eventsRejected: number;
      lastRunAt: string | null;
      lastError: string | null;
    };
  };
  /**
   * DSS fallback: extra slack (0–50%) on physical gates — temperature estimator band, codex pressure, codex gravity.
   * 0 = strict codex matching for those fallbacks. See Options.
   */
  /**
   * When true, “Data value” adds approximate UC exploration data (FSS/DSS) from merged journal scans.
   * Not first-discoverer bonuses; see Options.
   */
  includeExplorationScanDataInDataValue: boolean;
  /** Estimated CR from all merged `Scan` rows (MattG-style formulas; belts excluded). */
  explorationScanDataValueCredits: number;
  /** Unique bodies with journal `FSSBodySignals` (any system in merged logs). */
  explorationFssScanCount: number;
  /**
   * This commander's own median minutes per landing and per sampling run (B5).
   *
   * Measured from the merged journals rather than configured: time is the one quantity on the triage
   * screen that varies between commanders, and the app already reads the events that state it. Null
   * until there are ten of each leg, where the screen falls back to the shipped medians and says so.
   */
  onSiteTiming: TriageTiming | null;
  /**
   * The miss log's running count (B6) — species the commander found where the app did not offer them.
   *
   * `absent` was not in the list at all, `unlikelyOnly` was behind "show unlikely (N)", and
   * `rankedLow` is the case the ranking model created: offered, but sorted below the genera the panel
   * names. Zero of everything is the honest reading of a fresh install, not a claim of accuracy.
   */
  exoOutliers: { total: number; absent: number; unlikelyOnly: number; rankedLow: number; colour: number };
  /** Sum of FSS-only estimates for those bodies with merged scan data (belts skipped). */
  explorationFssValueCredits: number;
  /** Planetary bodies with `SAAScanComplete` (stars & belts excluded). */
  explorationDssScanCount: number;
  /** Sum of full mapped (DSS) estimates for those bodies. */
  explorationDssValueCredits: number;
  /** @deprecated Use explorationDssScanCount — kept for older clients. */
  dssMappedPlanetaryBodyCount: number;

  /**
   * High-value exploration targets in the focused system (from merged `Scan`):
   * Earth-like, water world, ammonia world, or terraformable worlds. UI uses FSS-orange vs DSS-green.
   */
  notableBodies: NotableBodyInfo[];
  /** "Notify me": unread notices for the mail icon, and records broken in this system (shared/notices.ts). */
  notices?: NoticesSnapshotDTO;
  /**
   * System map exobiology node suffixes: min estimated sell heuristic (price-list × 5) for `+` and `++`.
   * `++` threshold is always kept strictly greater than `+` (CR, integer).
   */
  exoMapTierPlusMinCr: number;
  exoMapTierPlusPlusMinCr: number;

  /**
   * Discovery-scanner honk (`FSSDiscoveryScan`) for the focused system: journal `BodyCount` is bodies only
   * (stars / planets / moons), excluding `NonBodyCount` signals. `found` tracks FSS progress until `FSSAllBodiesFound`.
   */
  dScanBodies: DScanBodiesDTO | null;

  /** Focused-system stars from merged scans: system name + per-star role chips for the header. */
  primaryStarsHeader: PrimaryStarsHeaderDTO | null;

  /**
   * Hierarchical system map + exploration estimates for the focused system (viewing or live).
   * Built from merged journal `Scan` events plus exobiology state.
   */
  systemMap: SystemMapSnapshot | null;
  /**
   * The focused system's main star was undiscovered when this commander scanned it — show FIRST.
   *
   * From `Scan` on `BodyID 0`, the only event that carries `WasDiscovered`. False also covers "no
   * main-star scan yet", which is why the chip is an award rather than a verdict: its absence never
   * claims somebody else got there first.
   */
  focusedSystemUndiscovered: boolean;
  /** Journal `FSDTarget.RemainingJumpsInRoute`; null until line merged. */
  remainingJumpsInRoute: number | null;
  /**
   * Commander fuel tank + rough “how many max-range jumps left” from Status.json + journal `Loadout`/`FSDJump`.
   * Null when Status.json unread or no fuel fields.
   */
  liveShipFuelRange: LiveShipFuelRangeDTO | null;

  /** User pref / launcher: HUD + Status.json polling for on-foot distance. */
  footTravelOdometerEnabled: boolean;
  /**
   * What the panel snapshots stamp beside the EDEXO branding (owner, 2026-09-26). All off by
   * default; the EDEXO stamp itself has no option.
   */
  photoStamp: PhotoStampPrefs;
  /** True when the odometer is accumulating for the active `organic_sample_session` body (survives Embark). */
  footTravelOdometerTracking: boolean;
  /** Metres walked while tracking (great-circle on `PlanetRadius`); persisted in `data/organic_sample_session.json`. */
  footTravelDistanceMeters: number;

  /** Completed on-foot analyses (`ScanOrganic` Analyse) persisted in `data/foot_scanned.json`, newest first. */
  footScannedEntries: FootScannedEntry[];
  /**
   * Live organic sample-distance overlay (journal tail + Status.json).
   * Null when inactive (no scans or post-celebration cooldown).
   */
  exoOrganicOverlay: ExoOrganicOverlayDTO | null;
  /**
   * The overlay radar, independent of whether a species is being sampled.
   *
   * Separate from {@link exoOrganicOverlay} because the two answer different questions: that one is
   * about the plant half-collected, this one is about the ground underfoot. Null until the game
   * reports a surface position.
   */
  exoMinimap: ExoMinimapDTO | null;
  /**
   * One-shot: client selects this body tab (`systemAddress:bodyId`) when present in `bodies`.
   * The server clears the pending value after a single snapshot build.
   */
  uiAutoSelectBodyKey: string | null;

  /**
   * Web UI body tab focus (`systemAddress:bodyId`), mirrored from the client for HUD overlays.
   * May be null until the user opens the app or changes tabs.
   */
  uiSelectedBodyKey: string | null;

  /**
   * Resolved focus for the Exo-Candidates overlay: same body as foot-distance tracking when that session is
   * active (after first `ScanOrganic`), otherwise {@link uiSelectedBodyKey}, else last touchdown.
   */
  exoOverlayFocusBodyKey: string | null;

  /**
   * When {@link exoOverlayFocusBodyKey} is not in `bodies` (e.g. FSS reported 0 biological signals),
   * full {@link BodyComputed} for that body so the overlay can still show `0/0` and species rows.
   */
  exoOverlayFocusBody: BodyComputed | null;

  /**
   * The body the commander has targeted, from `Status.json` `Destination` (polled live). The game
   * keeps it set while they are still on the previous body, which is exactly when the HUD should
   * already be showing the next one's candidates. Null when nothing is targeted.
   */
  statusDestination?: { systemAddress: number; bodyId: number; name: string } | null;

  /**
   * The last hyperspace jump target from `StartJump` (JumpType Hyperspace), for the HUD's next-jump
   * card: system name and the arrival star class, which decides whether the ship can scoop there.
   * `arrived` flips on the matching `FSDJump`. Null until the first jump this session.
   */
  jumpTarget?: {
    starSystem: string;
    systemAddress: number;
    starClass: string;
    /** ISO timestamp of the journal line that named it ("" for a NavRoute hop). */
    at: string;
    arrived: boolean;
    source: JumpTargetSource;
    /**
     * Would the commander probably be the first here? `null` while the lookup has not answered.
     *
     * Same asymmetry as {@link RouteAheadHopDTO.likelyFirstFootfall}: `false` is certain and `true`
     * is a good bet. Never set once `arrived` is true — by then the journal knows the answer and a
     * guess from EDSM would be the weaker source.
     */
    likelyFirstFootfall: boolean | null;
  } | null;
}
