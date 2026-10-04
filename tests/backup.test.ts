/**
 * Backups (src/server/backup.ts): what goes in, every backup complete (unchanged files copied from
 * the one before, after a CRC check), pruning to the newest N without breaking an old-style incremental
 * pair, and restores that never overwrite.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appDataExclusion,
  applyPendingRestore,
  backupFileName,
  DEFAULT_BACKUP_SETTINGS,
  listBackups,
  normaliseBackupSettings,
  pruneBackups,
  restoreJournals,
  runBackup,
  stageAppDataRestore,
  type BackupSettings,
} from "../src/server/backup.js";
import { listZip, readZipEntry, ZipWriter } from "../src/server/backupZip.js";

/** A backup as the first test build wrote them (full, or incremental naming `previous`). */
async function legacyZip(folder: string, when: Date, kind: "full" | "incremental", previous: string | null, journals: string[]): Promise<string> {
  const file = backupFileName("FALrenica", when);
  const z = new ZipWriter(path.join(folder, file));
  for (const j of journals) await z.addBuffer(`journals/${j}`, `${j}\n`, when);
  const manifest = {
    format: "edexo-backup/1", app: "ED Exo Compare 1.2.5", created: when.toISOString(), commander: "FALrenica",
    kind, chain: previous ?? file, previous,
    journals: { dir: "J", all: [], included: journals }, appData: { dir: "A", files: [], excluded: [] }, exports: [], errors: [],
  };
  await z.addBuffer("manifest.json", JSON.stringify(manifest), when);
  await z.finish();
  return file;
}

const dirs: string[] = [];
function world() {
  const root = mkdtempSync(path.join(tmpdir(), "edexo-backup-"));
  dirs.push(root);
  const app = path.join(root, "app");
  const journals = path.join(root, "journals");
  const out = path.join(root, "backups");
  mkdirSync(path.join(app, "shared-exomastery"), { recursive: true });
  mkdirSync(path.join(app, ".edexo-cache"), { recursive: true });
  mkdirSync(journals, { recursive: true });
  writeFileSync(path.join(app, "edexo-compare-user-settings.json"), '{"a":1}');
  writeFileSync(path.join(app, "edexo-foot-scanned.json"), '{"scans":[1,2,3]}');
  writeFileSync(path.join(app, "shared-exomastery", "friend.json"), "{}");
  writeFileSync(path.join(app, ".edexo-cache", "merge.bin"), "cache");
  writeFileSync(path.join(app, "edexo-bio-bodies.bin"), "big");
  writeFileSync(path.join(app, "edexo-compare-edsm-key.json"), '{"key":"secret"}');
  writeFileSync(path.join(app, "window-state.json"), "{}");
  writeFileSync(path.join(journals, "Journal.2026-09-01T100000.01.log"), '{"event":"Fileheader"}\n');
  writeFileSync(path.join(journals, "Status.json"), "{}");
  writeFileSync(path.join(journals, "notes.txt"), "not the game's");
  const settings: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS, folder: out };
  const src = {
    appDataDir: app,
    journalDir: journals,
    commander: "FALrenica",
    appVersion: "9.9.9",
    exports: () => [{ fileName: "exomastery-FALrenica.json", body: { species: 3 } }],
  };
  return { root, app, journals, out, settings, src };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const minute = (n: number) => new Date(2026, 8, 29, 10, n, 0);
const names = async (zip: string) => (await listZip(zip)).map((e) => e.name).sort();

describe("backup settings", () => {
  it("fills in and clamps what arrives", () => {
    expect(normaliseBackupSettings({ everyHours: 7, keep: -3, folder: "  " })).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(normaliseBackupSettings({ everyHours: 12, keep: 500, includeKeys: true, folder: "D:/b" })).toMatchObject({
      everyHours: 12,
      keep: 100,
      includeKeys: true,
      folder: "D:/b",
    });
  });

  it("names the file after the commander and the time", () => {
    expect(backupFileName("FALrenica", minute(5))).toBe("EDExoCompare-backup-FALrenica-2026-09-29_1005.zip");
    expect(backupFileName("A/B: C", minute(5), true)).toBe("EDExoCompare-backup-AB_C-2026-09-29_100500.zip");
    expect(backupFileName(null, minute(5))).toBe("EDExoCompare-backup-CMDR-2026-09-29_1005.zip");
  });
});

describe("what goes in", () => {
  const s = { includeKeys: false, includeBioBodies: false };
  it("leaves out caches, downloads, window positions, old copies and (by default) the keys", () => {
    expect(appDataExclusion(".edexo-cache/x.bin", s)).toMatch(/cache/);
    expect(appDataExclusion("edexo-bio-bodies.bin", s)).toMatch(/Spansh/);
    expect(appDataExclusion("edexo-compare-carriers.csv", s)).toMatch(/download/);
    expect(appDataExclusion("edexo-compare-edsm-key.json", s)).toMatch(/key/);
    expect(appDataExclusion("edexo-compare-lan-key.txt", s)).toMatch(/key/);
    expect(appDataExclusion("window-state.json", s)).toMatch(/this PC/);
    expect(appDataExclusion("edexo-predictions.json.before-smoke-removal.bak", s)).toMatch(/old copy/);
    expect(appDataExclusion("restore-pending/x.json", s)).toMatch(/restore/);
  });
  it("keeps the commander's own data, and anything it does not know", () => {
    for (const f of ["edexo-foot-scanned.json", "edexo-predictions.json", "shared-exomastery/x.json", "species-fixes/a.json", "something-new.json"]) {
      expect(appDataExclusion(f, s)).toBeNull();
    }
    expect(appDataExclusion("edexo-compare-edsm-key.json", { ...s, includeKeys: true })).toBeNull();
    expect(appDataExclusion("edexo-bio-bodies.bin", { ...s, includeBioBodies: true })).toBeNull();
  });
});

describe("backups", () => {
  it("a first backup is full: journals, app data, exports and a manifest", async () => {
    const w = world();
    const r = await runBackup(w.src, w.settings, minute(0));
    expect(r).toMatchObject({ kind: "full", journals: 2, appDataFiles: 3, errors: [] });
    expect(await names(r.path)).toEqual([
      "app-data/edexo-compare-user-settings.json",
      "app-data/edexo-foot-scanned.json",
      "app-data/shared-exomastery/friend.json",
      "exports/exomastery-FALrenica.json",
      "journals/Journal.2026-09-01T100000.01.log",
      "journals/Status.json",
      "manifest.json",
    ]);
    const [b] = await listBackups(w.out);
    expect(b!.manifest).toMatchObject({ kind: "full", chain: r.file, previous: null, commander: "FALrenica" });
    expect(b!.manifest.appData.excluded.map((x) => x.path).sort()).toEqual([
      ".edexo-cache/merge.bin",
      "edexo-bio-bodies.bin",
      "edexo-compare-edsm-key.json",
      "window-state.json",
    ]);
    expect(existsSync(`${r.path}.partial`)).toBe(false);
  });

  it("every backup is complete: all journals again, unchanged ones copied, changed ones compressed", async () => {
    const w = world();
    const first = await runBackup(w.src, w.settings, minute(0));
    expect(first.reused).toBe(0);
    writeFileSync(path.join(w.journals, "Journal.2026-09-02T100000.01.log"), "{}\n");
    const j1 = path.join(w.journals, "Journal.2026-09-01T100000.01.log");
    const t = new Date(Date.now() - 10_000);
    writeFileSync(j1, '{"event":"Fileheader"}\n{"event":"Music"}\n'); // grew
    utimesSync(j1, t, t);
    const r = await runBackup(w.src, w.settings, minute(1));
    expect(r).toMatchObject({ kind: "full", journals: 3, errors: [] });
    expect((await names(r.path)).filter((n) => n.startsWith("journals/"))).toEqual([
      "journals/Journal.2026-09-01T100000.01.log",
      "journals/Journal.2026-09-02T100000.01.log",
      "journals/Status.json",
    ]);
    // Status.json and the three app files did not change: copied. The grown and the new journal: compressed.
    expect(r.reused).toBe(4);
    const entries = await listZip(r.path);
    const grown = entries.find((e) => e.name === "journals/Journal.2026-09-01T100000.01.log")!;
    expect((await readZipEntry(r.path, grown)).toString()).toBe('{"event":"Fileheader"}\n{"event":"Music"}\n');
    const copied = entries.find((e) => e.name === "app-data/edexo-foot-scanned.json")!;
    expect((await readZipEntry(r.path, copied)).toString()).toBe('{"scans":[1,2,3]}');
    const [, b] = await listBackups(w.out);
    expect(b!.manifest).toMatchObject({ kind: "full", previous: null, chain: r.file, reused: 4 });
  });

  it("a copied entry is checked first: a damaged earlier backup is not copied from", async () => {
    const w = world();
    const first = await runBackup(w.src, w.settings, minute(0));
    // Damage the journal's bytes inside the first zip.
    const buf = readFileSync(first.path);
    const e = (await listZip(first.path)).find((x) => x.name === "journals/Journal.2026-09-01T100000.01.log")!;
    const at = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    buf[at + 2]! ^= 0xff;
    writeFileSync(first.path, buf);
    const r = await runBackup(w.src, w.settings, minute(1));
    const j = (await listZip(r.path)).find((x) => x.name === "journals/Journal.2026-09-01T100000.01.log")!;
    expect((await readZipEntry(r.path, j)).toString()).toBe('{"event":"Fileheader"}\n'); // compressed afresh
    expect(r.reused).toBe(4); // Status.json + 3 app files still copied
  });

  it("keeps the newest `keep` backups, each one complete", async () => {
    const w = world();
    for (let i = 0; i < 7; i++) await runBackup(w.src, { ...w.settings, keep: 1000 }, minute(i));
    expect(await pruneBackups(w.out, 5)).toHaveLength(2);
    const left = await listBackups(w.out);
    expect(left).toHaveLength(5);
    expect(left.every((b) => b.manifest.kind === "full")).toBe(true);
    expect(left[0]!.manifest.created).toBe(minute(2).toISOString());
    // Through runBackup: the setting is honoured on every run.
    await runBackup(w.src, { ...w.settings, keep: 3 }, minute(10));
    expect(await listBackups(w.out)).toHaveLength(3);
  });

  it("never removes an old-style backup that a kept incremental one still needs", async () => {
    const w = world();
    mkdirSync(w.out, { recursive: true });
    const full = await legacyZip(w.out, minute(0), "full", null, ["Journal.2026-09-01T100000.01.log"]);
    await legacyZip(w.out, minute(1), "incremental", full, ["Journal.2026-09-02T100000.01.log"]);
    await runBackup(w.src, w.settings, minute(2));
    // Keep 2: the new backup and the incremental one — which needs its full one, so that stays too.
    expect(await pruneBackups(w.out, 2)).toEqual([]);
    expect(await listBackups(w.out)).toHaveLength(3);
    // Keep 1: only the new backup; the pair goes together.
    expect((await pruneBackups(w.out, 1)).sort()).toHaveLength(2);
  });

  it("a partial file is not left behind when a backup fails", async () => {
    const w = world();
    const settings = { ...w.settings };
    const bad = { ...w.src, exports: () => [{ fileName: "../escape.json", body: {} }] };
    const r = await runBackup(bad, settings, minute(0));
    expect(r.errors.join()).toMatch(/exports/);
    expect(readdirSync(w.out).filter((f) => f.endsWith(".partial"))).toEqual([]);
  });
});

describe("restore", () => {
  it("stages app data, then moves it in at the next start with the replaced files set aside", async () => {
    const w = world();
    const r = await runBackup(w.src, w.settings, minute(0));
    writeFileSync(path.join(w.app, "edexo-foot-scanned.json"), '{"scans":[]}'); // lost since
    expect(await stageAppDataRestore(r.path, w.app)).toBe(3);
    // Nothing has changed yet.
    expect(readFileSync(path.join(w.app, "edexo-foot-scanned.json"), "utf8")).toBe('{"scans":[]}');
    const log = applyPendingRestore(w.app, minute(5));
    expect(log[0]).toMatch(/3 files from EDExoCompare-backup-FALrenica/);
    expect(readFileSync(path.join(w.app, "edexo-foot-scanned.json"), "utf8")).toBe('{"scans":[1,2,3]}');
    const aside = readdirSync(w.app).find((f) => f.startsWith("before-restore-"))!;
    expect(readFileSync(path.join(w.app, aside, "edexo-foot-scanned.json"), "utf8")).toBe('{"scans":[]}');
    // Files the backup did not hold are untouched, and a second start does nothing.
    expect(readFileSync(path.join(w.app, "edexo-compare-edsm-key.json"), "utf8")).toBe('{"key":"secret"}');
    expect(applyPendingRestore(w.app)).toEqual([]);
  });

  it("restores a backup's journals into another folder, never over an existing file", async () => {
    const w = world();
    await runBackup(w.src, w.settings, minute(0));
    writeFileSync(path.join(w.journals, "Journal.2026-09-02T100000.01.log"), "second\nmore\n");
    const last = await runBackup(w.src, w.settings, minute(1));
    const target = path.join(w.root, "restored");
    mkdirSync(target);
    writeFileSync(path.join(target, "Status.json"), "mine");
    const r = await restoreJournals(w.out, last.file, target);
    expect(r).toMatchObject({ written: 2, skippedExisting: 1 });
    expect(readFileSync(path.join(target, "Journal.2026-09-02T100000.01.log"), "utf8")).toBe("second\nmore\n");
    expect(readFileSync(path.join(target, "Journal.2026-09-01T100000.01.log"), "utf8")).toBe('{"event":"Fileheader"}\n');
    expect(readFileSync(path.join(target, "Status.json"), "utf8")).toBe("mine");
  });

  it("an old-style incremental backup restores through the one it builds on, and says when that is missing", async () => {
    const w = world();
    mkdirSync(w.out, { recursive: true });
    const full = await legacyZip(w.out, minute(0), "full", null, ["Journal.2026-09-01T100000.01.log"]);
    const inc = await legacyZip(w.out, minute(1), "incremental", full, ["Journal.2026-09-02T100000.01.log"]);
    const target = path.join(w.root, "legacy");
    expect(await restoreJournals(w.out, inc, target)).toMatchObject({ written: 2 });
    rmSync(path.join(w.out, full));
    await expect(restoreJournals(w.out, inc, path.join(w.root, "x"))).rejects.toThrow(/missing/);
  });

  it("refuses the game's own folder without the second confirmation", async () => {
    const w = world();
    const b = await runBackup(w.src, w.settings, minute(0));
    await expect(restoreJournals(w.out, b.file, w.journals, { gameJournalDir: w.journals })).rejects.toThrow(/second confirmation/);
    const r = await restoreJournals(w.out, b.file, w.journals, { gameJournalDir: w.journals, allowGameFolder: true });
    expect(r.written).toBe(0); // everything is already there
  });

  it("an older journal's timestamp is kept in the zip", async () => {
    const w = world();
    const j = path.join(w.journals, "Journal.2026-09-01T100000.01.log");
    const t = new Date(2026, 8, 1, 12, 0, 0);
    utimesSync(j, t, t);
    const r = await runBackup(w.src, w.settings, minute(0));
    const e = (await listZip(r.path)).find((x) => x.name === "journals/Journal.2026-09-01T100000.01.log")!;
    expect(e.mtime).toEqual(t);
  });
});

describe("restore entry names (combined plan 1.5)", () => {
  it("refuses names that could land outside the folder, backslashes included", async () => {
    const { safeZipRel } = await import("../src/server/backup.js");
    const bad = [
      String.raw`app-data/..\..\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\x.bat`,
      "app-data/../x",
      "app-data/a/../../x",
      String.raw`app-data/C:\x`,
      "app-data/x.txt:stream",
      "app-data//x",
      String.raw`app-data/\server\share\x`,
      "app-data/",
    ];
    for (const n of bad) expect(safeZipRel(n, "app-data/"), n).toBeNull();
    expect(safeZipRel("app-data/edexo-notices.json", "app-data/")).toBe("edexo-notices.json");
    expect(safeZipRel(String.raw`app-data/shared-exomastery\a.json`, "app-data/")).toBe("shared-exomastery/a.json");
    expect(safeZipRel("journals/Journal.2026-10-01T010000.01.log", "journals/")).toBe("Journal.2026-10-01T010000.01.log");
  });
});
