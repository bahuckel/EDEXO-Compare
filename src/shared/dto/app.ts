import type { JournalHistoryPreset } from "../journalHistoryPreset.js";
import type { PollRatesDTO } from "../pollRates.js";
import type { RadarRadiusDTO } from "../radarRadius.js";
import type { ExoDataAlertDTO } from "./body.js";
import type { JumpTargetSource } from "./scan.js";

/**
 * Feeder state for the Options panel.
 *
 * The feeder is a maintainer tool: its 250 MB corpus of raw EDSM sample packs never ships, so on a
 * normal install `available` is false and the panel is not rendered at all. Where it is present, the
 * panel answers one question — is the data the app ranks with the data the corpus actually holds?
 */
/** GET /api/app/update — the running version and the newest release on GitHub. */
export interface UpdateInfoDTO {
  current: string;
  /** Newest published version, or null when GitHub has not answered yet. */
  latest: string | null;
  /** True only when `latest` is a higher version than `current`. */
  newer: boolean;
  /** That release's page for this form of the app (single exe or zip), on github.com. */
  pageUrl: string | null;
  publishedAt: string | null;
  form: "portable" | "zip" | "appimage";
  /** When GitHub was last asked (ISO), null before the first try. */
  checkedAt: string | null;
  /** Why the last try failed; the last good `latest` is kept. */
  error: string | null;
  /** Downloading the newer release for an install on restart (appUpdater.ts); absent on old servers. */
  download?: UpdateDownloadDTO;
}

/** The launcher's updater: the newer release downloaded and checked, waiting for a restart. */
export interface UpdateDownloadDTO {
  /** False where this copy cannot replace itself (a source run, the console builds): link only. */
  supported: boolean;
  state: "idle" | "downloading" | "ready" | "error";
  /** The version being downloaded or ready. */
  version: string | null;
  received: number;
  total: number | null;
  error: string | null;
}

export interface FeederStatusDTO {
  /** False when there is no corpus on this machine; the panel hides itself. */
  available: boolean;
  corpusDir: string | null;
  /**
   * The path the owner set in Options, or null when none is remembered.
   *
   * The two search locations are relative to `PROJECT_ROOT`, which in a packaged build is the
   * install directory — so a corpus that lives beside the *repository* was unreachable and the
   * feeder reported itself unavailable no matter what was on disk. This is the escape.
   */
  configuredCorpusDir: string | null;
  /** Everywhere the app looked, in order, so an unavailable feeder can say why rather than just hide. */
  searchedDirs: string[];
  /**
   * Counts that need the feeder's SQLite store, taken from the snapshot its CLI writes rather than
   * by opening the store here — that would pull a WASM SQLite build into the shipped server.
   * Null until the feeder has run once on this machine.
   */
  snapshot: {
    writtenAtIso: string;
    lastCommand: string;
    uniqueSystems: number;
    uniquePlanets: number;
    uniqueSightings: number;
    corpusSpecies: number;
    cumulativeCsvRows: number;
  } | null;
  /** Species with sample packs on disk — what a rebuild would read. Computed live. */
  hydratedSpecies: number;
  speciesRows: number;
  speciesRowsWithProfile: number;
  /** Total size of the installed profiles, so the shipped-data cost is visible. */
  profileBytes: number;
  /**
   * Profiles built from fewer bodies than the corpus already holds — the actionable list, truncated
   * for display. {@link behindCount} and {@link behindOccurrences} are the real totals, because a
   * truncated list that reports its own length understates the problem it exists to show.
   */
  behind: { species: string; profileSamples: number; corpusOccurrences: number }[];
  behindCount: number;
  /** Observed bodies the corpus holds that no installed profile has been built from. */
  behindOccurrences: number;
  /** Corpus species with no row in the app's species tree, listed rather than guessed at. */
  unmatchedCorpusLabels: string[];
}

/** Shown in the UI while the initial journal folder merge (or a full resync) runs. */
export interface JournalBootProgressDTO {
  /** 0–100, best-effort progress. */
  percent: number;
  phase: "starting" | "listing" | "merging" | "watching";
  filesDone: number;
  filesTotal: number;
  message: string;
}

export interface AppStatusDTO {
  mode: "server" | "client";
  bindHost: string;
  port: number;
  /** LAN links already carrying `?k=` when {@link lanKeyRequired}; see server/lanAuth.ts. */
  lanUrls: string[];
  /** True when non-loopback clients must present the access key. Only ever true in server mode. */
  lanKeyRequired: boolean;
  /**
   * The launcher's "LAN access" switch (owner, 2026-10-01): `saved` is the choice, `active` what this
   * run listens on (a change applies at the next start). Null where the switch does not decide: the
   * dev server, the console builds, client mode, or an explicit --host / --lan.
   */
  lanAccess: { saved: boolean; active: boolean } | null;
  journalDir: string;
  journalDirConfiguredOk: boolean;
  journalPath: string | null;
  journalFileCount: number;
  journalHistoryPreset: JournalHistoryPreset;
  lastJournalEventIso: string | null;
  commanderName: string | null;
  journalBoot: JournalBootProgressDTO | null;
  /**
   * The launcher's live strip, cheap store reads only (no snapshot rebuild): where the commander
   * is and what is unsold. All optional so older status payloads still parse.
   */
  live?: {
    systemName: string | null;
    bodyName: string | null;
    /** FSS biological signal count on that body, when known. */
    bioSignals: number | null;
    organicDataValueCredits: number | null;
    organicPendingSampleCount: number;
    /** The next jump, mirrored for the strip. See AppSnapshot.jumpTarget for `source`. */
    jumpTarget: { starSystem: string; starClass: string; arrived: boolean; source: JumpTargetSource } | null;
  };
  /**
   * Species rows carrying a `conditions` key nothing in the app reads — see `conditionKeyAudit`.
   *
   * Empty for the shipped data, and a test keeps it that way. It is surfaced here because the only
   * other report was a `console.warn`, and a packaged Electron build has no console: the owner went
   * looking for it in the app folder and in `%APPDATA%` and found nothing, which is the correct
   * outcome of writing a warning to a stream nobody can read. A hand-edited genus file is the case
   * this exists for, and `/api/status` is somewhere a commander can actually look.
   */
  speciesDataWarnings: string[];
  /**
   * The two live-file poll intervals and their bounds, so the launcher's inputs can never offer a
   * value the server would clamp. Optional: an older launcher against a newer server, or the
   * reverse, simply hides the row. See `shared/pollRates.ts`.
   */
  pollRates?: PollRatesDTO;
  /** The sample radar's radius and its bounds, for the Overlay panel's control. */
  radarRadius?: RadarRadiusDTO;
}

/**
 * Distances from where the ship is to each bio body of the viewed system (Discord batch O-F).
 * `arrival`: measured by the game, from the arrival star. `orbits`: estimated from the orbit tree
 * because the ship is at another body.
 */
/** See AppSnapshot.sharedExomastery. */
export interface SharedExomasteryDTO {
  folder: string;
  files: {
    file: string;
    kind: "exomastery" | "codex" | null;
    commander: string | null;
    fid: string | null;
    entries: number;
    skipped?: string;
  }[];
  /** Finds from other commanders (merged, duplicates counted once). */
  finds: number;
  /** Finds your own backup files hold. */
  ownBackupFinds: number;
  /** Other commanders who contributed. */
  commanders: number;
  /** Other commanders' finds that break a species gate — shown under the mail icon. */
  alerts: ExoDataAlertDTO[];
}

/** Options > Snapshot images: extra lines on a branded panel snapshot. */
export interface PhotoStampPrefs {
  commander: boolean;
  system: boolean;
  timestamp: boolean;
}

/** GET /api/feeder/import-dump/status — the Spansh export import started from the launcher. */
export interface ImportDumpStatusDTO {
  running: boolean;
  file: string | null;
  apply: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** The importer's human report (same text the CLI prints), once finished. */
  report: string | null;
  error: string | null;
  failures?: number;
  matched?: number;
  changed?: number;
  /** The last import that finished without error (persisted across runs). */
  lastImport?: { file: string; finishedAt: string; fileMtimeIso: string | null; apply: boolean } | null;
  /** mtime of the file the status was asked about (`?file=`), or of `lastImport.file`; null when unreadable. */
  fileMtimeIso?: string | null;
  /** True when that file is the last-imported one and has been rewritten since (owner, 2026-09-13: one-click re-import). */
  newerOnDisk?: boolean;
}

/** What the launcher's HUD settings modal writes; every field optional, unknown keys dropped. */
export interface HudPrefsDTO {
  theme?: { preset?: string; accent?: string; text?: string };
  scale?: number;
  /** The panel fill's opacity, 0.1–1 (text and lines stay solid). */
  opacity?: number;
  candOrder?: "likelihood" | "value";
  region?: boolean;
  audio?: boolean;
  /** Compact overlays: no explanatory lines, only the readings (guild tester, 2026-09-30). */
  compact?: boolean;
  /** Only when relevant: HUD sections with nothing to show step aside (guild tester, 2026-09-30). */
  relevant?: boolean;
}

/** The session log: what happened since the app started, for the modal and the Markdown copy. */
export interface SessionLogDTO {
  startedIso: string;
  systems: { name: string; at: string; jumpLy: number | null }[];
  landings: { body: string; system: string; at: string; firstFootfall: boolean; key: string | null }[];
  samples: {
    species: string;
    body: string;
    system: string;
    at: string;
    listCredits: number | null;
    mult: 1 | 5;
    credits: number | null;
  }[];
  sales: { at: string; items: number; credits: number }[];
  firstFootfalls: number;
  creditsAnalysed: number;
  creditsSold: number;
}
