/**
 * When backups happen (docs/galaxy-plan-28092026.md section B, "When"), and the one place that runs
 * them, so two can never overlap.
 *
 * - **On leaving the game** (default on): the journal's `Shutdown` line, then a minute's wait so the
 *   game has flushed its last files. A crash or a killed game writes no `Shutdown`, so there is a
 *   fallback: the journal has moved since the last backup, has been quiet for {@link QUIET_MS}, and
 *   the game's process is not running.
 * - **Every N hours** while the app runs, counted from the newest backup in the folder.
 * - **Now**, from the launcher.
 *
 * A failed backup is kept as `lastError` and shown in the launcher — never silently.
 *
 * - **Missed while the app was closed** (owner, 2026-09-29): a minute after start, if the journals
 *   changed after the newest backup and the game is not running, the backup the app could not make
 *   then is made now. (With the game running, its Shutdown line will come.)
 *
 * Nothing runs on its own until the commander has **chosen a folder** (owner, 2026-09-29). The
 * default, Documents, sits on the same partition as the journals on nearly every PC — a copy there is
 * lost with the drive — so it is only ever used for a backup asked for with "Back up now".
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  defaultBackupFolder,
  listBackups,
  normaliseBackupSettings,
  RESTORE_PENDING_DIR,
  readBackupSettings,
  restoreJournals,
  runBackup,
  stageAppDataRestore,
  writeBackupSettings,
  type BackupInfo,
  type BackupResult,
  type BackupSettings,
  type BackupSources,
  type JournalRestoreResult,
} from "./backup.js";
import { assessBackupFolder, type DiskProbe, type FolderRisk } from "./backupFolderRisk.js";

/** After `Shutdown`, before the backup starts. */
export const AFTER_SHUTDOWN_MS = 60_000;
/** Journal silence that, with the game not running, counts as having left it. */
export const QUIET_MS = 20 * 60_000;
const TICK_MS = 5 * 60_000;
/** After start, before looking for a backup missed while the app was closed. */
export const STARTUP_CHECK_MS = 60_000;

/** When the newest journal was last written (ms since epoch), 0 when there is none. */
export function newestJournalWrite(dir: string | null): number {
  if (!dir) return 0;
  let newest = 0;
  try {
    for (const n of readdirSync(dir)) {
      if (!/^Journal\..+\.log$/i.test(n)) continue;
      try {
        newest = Math.max(newest, statSync(`${dir}/${n}`).mtimeMs);
      } catch {
        /* rotated away while listing */
      }
    }
  } catch {
    return 0;
  }
  return newest;
}

export interface BackupStatus {
  settings: BackupSettings;
  folder: string;
  running: boolean;
  /** Why the running one started. */
  reason: string | null;
  last: { file: string; at: string; bytes: number; kind: string } | null;
  lastError: { at: string; message: string } | null;
  /** A backup is due this long after the game shut down (ms since epoch), or null. */
  pendingAt: number | null;
  count: number;
  restorePending: boolean;
  /** A folder was chosen; until then nothing runs on its own. */
  folderChosen: boolean;
}

export interface BackupServiceOptions {
  appDataDir: string;
  getJournalDir: () => string | null;
  getCommander: () => string | null;
  appVersion: string;
  exports?: BackupSources["exports"];
  log?: (line: string) => void;
  /** Tests replace the process check, the disk probe and the clock. */
  isGameRunning?: () => Promise<boolean | null>;
  diskProbe?: DiskProbe;
  now?: () => number;
}

export interface BackupService {
  status(): Promise<BackupStatus>;
  runNow(reason?: string): Promise<BackupResult>;
  setSettings(patch: unknown): BackupSettings;
  list(): Promise<BackupInfo[]>;
  /** Where a backup folder sits against the journals and the app data (the saved one when omitted). */
  checkFolder(folder?: string): Promise<FolderRisk & { folder: string }>;
  restoreAppData(file: string): Promise<{ staged: number }>;
  restoreJournals(file: string, target: string, allowGameFolder: boolean): Promise<JournalRestoreResult>;
  /** Every live journal line (not the replay). */
  onJournalLine(event: string | undefined): void;
  /** For tests: run the periodic check now. */
  tick(): Promise<void>;
  /** The start-up check for a backup missed while the app was closed (runs by itself after a minute). */
  catchUp(): Promise<void>;
  /** A backup is being written now (the app's exit asks before throwing it away). */
  isRunning(): boolean;
  /** Resolves when no backup is running. */
  whenIdle(): Promise<void>;
  dispose(): void;
}

/** Is Elite running? Null when the check itself fails — then nothing is inferred. */
export function eliteIsRunning(): Promise<boolean | null> {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === "win32"
        ? ["tasklist", ["/FI", "IMAGENAME eq EliteDangerous64.exe", "/NH"]]
        : ["pgrep", ["-f", "EliteDangerous64"]];
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (process.platform === "win32") {
        if (err) return resolve(null);
        return resolve(/EliteDangerous64\.exe/i.test(stdout));
      }
      // pgrep: exit 1 = no match, anything else = could not ask.
      if (err) return resolve((err as { code?: number }).code === 1 ? false : null);
      resolve(stdout.trim().length > 0);
    });
  });
}

export function createBackupService(o: BackupServiceOptions): BackupService {
  const now = o.now ?? Date.now;
  const log = o.log ?? ((l: string) => console.log(l));
  let settings = readBackupSettings(o.appDataDir);
  let running: Promise<BackupResult> | null = null;
  let reason: string | null = null;
  let last: BackupStatus["last"] = null;
  let lastError: BackupStatus["lastError"] = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingAt: number | null = null;
  let lastJournalLineAt = 0;
  let lastBackupAt = 0;
  let known = false;

  const folder = () => settings.folder ?? defaultBackupFolder();

  /** The newest backup in the folder, read once (the folder can hold backups from an earlier run). */
  async function learnLast(): Promise<void> {
    if (known) return;
    known = true;
    const all = await listBackups(folder());
    const b = all[all.length - 1];
    if (b) {
      last = { file: b.file, at: b.manifest.created, bytes: b.bytes, kind: b.manifest.kind };
      lastBackupAt = Date.parse(b.manifest.created) || 0;
    }
  }

  function runNow(why = "now"): Promise<BackupResult> {
    if (running) return Promise.reject(new Error("A backup is already running."));
    reason = why;
    const job = runBackup(
      {
        appDataDir: o.appDataDir,
        journalDir: o.getJournalDir(),
        commander: o.getCommander(),
        appVersion: o.appVersion,
        exports: o.exports,
      },
      settings,
      new Date(now()),
    );
    running = job;
    job.then(
      (r) => {
        last = { file: r.file, at: new Date(now()).toISOString(), bytes: r.bytes, kind: r.kind };
        lastBackupAt = now();
        known = true;
        lastError = r.errors.length ? { at: new Date(now()).toISOString(), message: `Saved with ${r.errors.length} problem(s): ${r.errors[0]}` } : null;
        log(
          `backup (${why}): ${r.file}, ${r.journals} journal files, ${r.appDataFiles} app files ` +
            `(${r.reused} copied from an earlier backup), ` +
            `${(r.bytes / 1e6).toFixed(1)} MB${r.pruned.length ? `; removed ${r.pruned.length} old` : ""}`,
        );
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        lastError = { at: new Date(now()).toISOString(), message };
        log(`backup (${why}) failed: ${message}`);
      },
    );
    void job.finally(() => {
      running = null;
      reason = null;
    }).catch(() => {});
    return job;
  }

  function scheduleAfterShutdown(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingAt = now() + AFTER_SHUTDOWN_MS;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      pendingAt = null;
      void runNow("left the game").catch(() => {});
    }, AFTER_SHUTDOWN_MS);
    pendingTimer.unref?.();
  }

  async function tick(): Promise<void> {
    if (running || pendingTimer || !settings.folder) return;
    await learnLast();
    const t = now();
    if (settings.everyHours > 0 && t - lastBackupAt >= settings.everyHours * 3_600_000) {
      await runNow(`every ${settings.everyHours} h`).catch(() => {});
      return;
    }
    // The game went away without a Shutdown line (a crash, a kill): journal moved, then went quiet.
    if (settings.onLeaveGame && lastJournalLineAt > lastBackupAt && t - lastJournalLineAt >= QUIET_MS) {
      const alive = await (o.isGameRunning ?? eliteIsRunning)();
      if (alive === false) await runNow("left the game (no Shutdown line)").catch(() => {});
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();

  /**
   * The game closed while this app was not running (or the app was closed first): nobody saw a
   * Shutdown line, but the journals on disk are newer than the newest backup.
   */
  async function catchUp(): Promise<void> {
    if (running || pendingTimer || !settings.folder || !settings.onLeaveGame) return;
    await learnLast();
    const written = newestJournalWrite(o.getJournalDir());
    if (!written || written <= lastBackupAt) return;
    const alive = await (o.isGameRunning ?? eliteIsRunning)();
    if (alive === false) await runNow("the game closed while the app was not running").catch(() => {});
  }
  const startTimer = setTimeout(() => void catchUp(), STARTUP_CHECK_MS);
  startTimer.unref?.();

  // A backup cut off by an exit leaves its `.partial` file; nothing is writing one at start.
  void (async () => {
    try {
      const dir = folder();
      for (const n of await readdir(dir)) if (n.endsWith(".zip.partial")) await rm(`${dir}/${n}`, { force: true });
    } catch {
      /* no folder yet */
    }
  })();

  return {
    async status() {
      await learnLast();
      let count = 0;
      try {
        count = (await listBackups(folder())).length;
      } catch {
        count = 0;
      }
      return {
        settings,
        folder: folder(),
        running: !!running,
        reason,
        last,
        lastError,
        pendingAt,
        count,
        restorePending: existsSync(path.join(o.appDataDir, `${RESTORE_PENDING_DIR}.json`)),
        folderChosen: !!settings.folder,
      };
    },
    runNow,
    setSettings(patch) {
      const next = normaliseBackupSettings(patch, settings);
      if ((next.folder ?? "") !== (settings.folder ?? "")) {
        // A new folder has its own newest backup (or none): learn it again.
        known = false;
        last = null;
        lastBackupAt = 0;
      }
      settings = next;
      writeBackupSettings(o.appDataDir, settings);
      if ((!settings.onLeaveGame || !settings.folder) && pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        pendingAt = null;
      }
      return settings;
    },
    list: () => listBackups(folder()),
    async checkFolder(f) {
      const target = f && f.trim() ? f.trim() : folder();
      const risk = await assessBackupFolder(target, { journals: o.getJournalDir(), appData: o.appDataDir }, o.diskProbe);
      return { ...risk, folder: target };
    },
    async restoreAppData(file) {
      const b = (await listBackups(folder())).find((x) => x.file === file);
      if (!b) throw new Error(`No backup named ${file}`);
      return { staged: await stageAppDataRestore(b.path, o.appDataDir) };
    },
    restoreJournals: (file, target, allowGameFolder) =>
      restoreJournals(folder(), file, target, { gameJournalDir: o.getJournalDir(), allowGameFolder }),
    onJournalLine(event) {
      lastJournalLineAt = now();
      if (event === "Shutdown" && settings.onLeaveGame && settings.folder) scheduleAfterShutdown();
    },
    tick,
    catchUp,
    isRunning: () => !!running,
    async whenIdle() {
      while (running) await running.then(() => undefined, () => undefined);
    },
    dispose() {
      clearInterval(timer);
      clearTimeout(startTimer);
      if (pendingTimer) clearTimeout(pendingTimer);
    },
  };
}
