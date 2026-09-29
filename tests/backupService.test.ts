/**
 * When backups run (src/server/backupService.ts): a minute after Shutdown, every N hours, after a
 * crash once the journal is quiet and the game is gone, and never two at once.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listBackups } from "../src/server/backup.js";
import { AFTER_SHUTDOWN_MS, createBackupService, QUIET_MS, type BackupService } from "../src/server/backupService.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const f of cleanup.splice(0)) f();
});

function setup(opts: { gameRunning?: boolean | null; everyHours?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "edexo-bsvc-"));
  const app = path.join(root, "app");
  const journals = path.join(root, "journals");
  const out = path.join(root, "backups");
  mkdirSync(app, { recursive: true });
  mkdirSync(journals, { recursive: true });
  writeFileSync(path.join(app, "edexo-foot-scanned.json"), "{}");
  writeFileSync(path.join(journals, "Journal.2026-09-29T100000.01.log"), "{}\n");
  writeFileSync(
    path.join(app, "edexo-backup-settings.json"),
    JSON.stringify({ folder: out, everyHours: opts.everyHours ?? 0, onLeaveGame: true, keep: 10 }),
  );
  let t = Date.UTC(2026, 8, 29, 10, 0, 0);
  const lines: string[] = [];
  const svc: BackupService = createBackupService({
    appDataDir: app,
    getJournalDir: () => journals,
    getCommander: () => "FALrenica",
    appVersion: "9.9.9",
    log: (l) => lines.push(l),
    isGameRunning: async () => (opts.gameRunning === undefined ? false : opts.gameRunning),
    now: () => t,
  });
  cleanup.push(() => {
    svc.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return { svc, out, lines, journals, root, advance: (ms: number) => (t += ms), now: () => t };
}

async function settle(svc: BackupService) {
  for (let i = 0; i < 200 && (await svc.status()).running; i++) await new Promise((r) => setTimeout(r, 10));
}

describe("backup service", () => {
  it("backs up a minute after the game's Shutdown line, and says it is waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { svc, out } = setup();
    svc.onJournalLine("Music");
    svc.onJournalLine("Shutdown");
    expect((await svc.status()).pendingAt).not.toBeNull();
    await vi.advanceTimersByTimeAsync(AFTER_SHUTDOWN_MS - 1000);
    expect(await listBackups(out)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await settle(svc);
    const s = await svc.status();
    expect(s.last?.file).toMatch(/^EDExoCompare-backup-FALrenica-/);
    expect(s.pendingAt).toBeNull();
    expect(await listBackups(out)).toHaveLength(1);
  });

  it("does not wait for a Shutdown when leaving the game is switched off", async () => {
    const { svc } = setup();
    svc.setSettings({ onLeaveGame: false });
    svc.onJournalLine("Shutdown");
    expect((await svc.status()).pendingAt).toBeNull();
  });

  it("runs every N hours, counted from the newest backup", async () => {
    const { svc, out, advance } = setup({ everyHours: 6 });
    await svc.tick(); // nothing yet → due now
    await settle(svc);
    expect(await listBackups(out)).toHaveLength(1);
    advance(5 * 3_600_000);
    await svc.tick();
    await settle(svc);
    expect(await listBackups(out)).toHaveLength(1);
    advance(3_600_000 + 60_000);
    await svc.tick();
    await settle(svc);
    expect(await listBackups(out)).toHaveLength(2);
  });

  it("after a crash (no Shutdown), backs up once the journal is quiet and the game is gone", async () => {
    const running = setup({ gameRunning: true });
    running.svc.onJournalLine("FSDJump");
    running.advance(QUIET_MS + 1000);
    await running.svc.tick();
    expect(await listBackups(running.out)).toHaveLength(0); // still running: no backup

    const unknown = setup({ gameRunning: null });
    unknown.svc.onJournalLine("FSDJump");
    unknown.advance(QUIET_MS + 1000);
    await unknown.svc.tick();
    expect(await listBackups(unknown.out)).toHaveLength(0); // could not tell: no backup

    const gone = setup({ gameRunning: false });
    gone.svc.onJournalLine("FSDJump");
    gone.advance(QUIET_MS - 60_000);
    await gone.svc.tick();
    expect(await listBackups(gone.out)).toHaveLength(0); // not quiet long enough
    gone.advance(120_000);
    await gone.svc.tick();
    await settle(gone.svc);
    expect(await listBackups(gone.out)).toHaveLength(1);
    // Once backed up, the same quiet journal does not trigger again.
    gone.advance(QUIET_MS);
    await gone.svc.tick();
    await settle(gone.svc);
    expect(await listBackups(gone.out)).toHaveLength(1);
  });

  it("runs nothing on its own until a folder is chosen; Back up now still works", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { svc, out, advance } = setup({ everyHours: 6, gameRunning: false });
    svc.setSettings({ folder: null });
    expect((await svc.status()).folderChosen).toBe(false);
    svc.onJournalLine("Shutdown");
    expect((await svc.status()).pendingAt).toBeNull();
    await vi.advanceTimersByTimeAsync(AFTER_SHUTDOWN_MS * 2);
    vi.useRealTimers();
    advance(QUIET_MS + 7 * 3_600_000);
    await svc.tick(); // neither the timer nor the no-Shutdown fallback
    expect((await svc.status()).running).toBe(false);
    expect((await svc.status()).last).toBeNull();
    // Asked for, it runs — into the suggested folder (here: the one the settings file named before).
    svc.setSettings({ folder: out });
    await svc.runNow();
    expect((await svc.status()).last).not.toBeNull();
    svc.setSettings({ folder: null });
    // Chosen: the same Shutdown now schedules one.
    svc.setSettings({ folder: out });
    expect((await svc.status()).folderChosen).toBe(true);
    svc.onJournalLine("Shutdown");
    expect((await svc.status()).pendingAt).not.toBeNull();
  });

  it("on start, makes the backup missed while the app was closed — only with the game gone", async () => {
    // The journal was written after the newest backup, and nobody saw a Shutdown line.
    const gone = setup({ gameRunning: false });
    await gone.svc.catchUp();
    await settle(gone.svc);
    expect(await listBackups(gone.out)).toHaveLength(1);
    expect((await gone.svc.status()).last).not.toBeNull();
    // Nothing new since: the next start does nothing.
    const j = path.join(gone.journals, "Journal.2026-09-29T100000.01.log");
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(j, past, past);
    await gone.svc.catchUp();
    await settle(gone.svc);
    expect(await listBackups(gone.out)).toHaveLength(1);

    // The game is still running: its Shutdown line will come, so nothing now.
    const playing = setup({ gameRunning: true });
    await playing.svc.catchUp();
    expect(await listBackups(playing.out)).toHaveLength(0);
    // Could not tell: nothing.
    const unknown = setup({ gameRunning: null });
    await unknown.svc.catchUp();
    expect(await listBackups(unknown.out)).toHaveLength(0);
    // No folder chosen, or leaving the game switched off: nothing.
    const off = setup({ gameRunning: false });
    off.svc.setSettings({ onLeaveGame: false });
    await off.svc.catchUp();
    expect(await listBackups(off.out)).toHaveLength(0);
  });

  it("says a backup is running and resolves when it is done; clears a half-written one at start", async () => {
    const { svc, out, root } = setup();
    expect(svc.isRunning()).toBe(false);
    const job = svc.runNow();
    expect(svc.isRunning()).toBe(true);
    await svc.whenIdle();
    expect(svc.isRunning()).toBe(false);
    await job;
    // An exit mid-backup leaves a .partial; a new start of the service removes it.
    const partial = path.join(out, "EDExoCompare-backup-FALrenica-2026-09-29_1000.zip.partial");
    writeFileSync(partial, "half");
    const again = createBackupService({
      appDataDir: path.join(root, "app"),
      getJournalDir: () => null,
      getCommander: () => null,
      appVersion: "9.9.9",
      log: () => {},
    });
    cleanup.push(() => again.dispose());
    await expect.poll(() => existsSync(partial)).toBe(false);
  });

  it("never runs two at once, and keeps a failure to show", async () => {
    const { svc } = setup();
    const a = svc.runNow();
    await expect(svc.runNow()).rejects.toThrow(/already running/);
    await a;
    svc.setSettings({ folder: path.join(tmpdir(), "edexo-bsvc-\0bad") });
    await expect(svc.runNow()).rejects.toThrow();
    const s = await svc.status();
    expect(s.lastError?.message).toBeTruthy();
    expect(s.running).toBe(false);
  });
});
