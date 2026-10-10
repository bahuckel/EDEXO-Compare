/**
 * Backups (owner, 2026-09-28; docs/galaxy-plan-28092026.md section B): the journals, the app's own
 * data folder and the two exomastery exports, in one zip per backup, into a folder of the
 * commander's choosing.
 *
 * - **Every backup is complete** (owner, 2026-09-29: "if I choose to make 5 backups, it should make 5
 *   backups of all data"). Each zip holds every journal, so keeping N means N whole copies and the
 *   oldest can go without taking anything with it. What keeps that quick: a file unchanged since an
 *   earlier backup (same name, size and time — a journal never changes once the next one starts) is
 *   *copied* from that backup's zip, compressed bytes as they are, after its CRC is checked; only new
 *   or changed files are compressed. The first backup of his journals took 6.7 s; the ones after are
 *   mostly a file copy.
 * - Backups made before that (2026-09-29, the first test build) could be *incremental* — only the
 *   journals new since the backup before, which they name in `previous`. They are still read: a
 *   restore walks back through `previous`, and pruning never removes one a kept backup still needs.
 * - **App data** is small and goes in whole every time, minus what rebuilds itself (caches, the
 *   downloaded EDAstro lists, the 0.5 GB bio-bodies file unless asked) and minus the two keys unless
 *   asked — a backup gets copied around, a key in it travels with it.
 * - **Exports**: "Download my exomastery" and "Download my codex", as the launcher's Exomastery
 *   button writes them.
 *
 * Every zip carries a `manifest.json` saying all of this, so the folder explains itself and the next
 * backup, the pruning and a restore work from the zips alone — no index file to lose.
 *
 * A restore never overwrites in place. App data is staged into `restore-pending/` and moved in by
 * {@link applyPendingRestore} at the next start, before anything reads it, with every file it
 * replaces moved into `before-restore-<time>/`. Journals are written into a folder the commander
 * picks; the game's own folder only on a second confirmation, and even then no existing file is
 * touched.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { listZip, readZipEntry, verifyZipEntry, ZipWriter, type ZipEntry } from "./backupZip.js";
import { writeFileAtomic } from "./atomicWrite.js";

export const BACKUP_SETTINGS_FILE = "edexo-backup-settings.json";
export const RESTORE_PENDING_DIR = "restore-pending";
const BEFORE_RESTORE_PREFIX = "before-restore-";
const NAME_RE = /^EDExoCompare-backup-.+-\d{4}-\d{2}-\d{2}_\d{4}(?:\d{2})?\.zip$/;

export interface BackupSettings {
  /** Back up a minute after the game shuts down. */
  onLeaveGame: boolean;
  /** Every N hours while the app runs; 0 = off. */
  everyHours: 0 | 6 | 12 | 24;
  /** Null = {@link defaultBackupFolder}. */
  folder: string | null;
  /** Backups to keep (at least; a chain is only ever removed whole). */
  keep: number;
  includeKeys: boolean;
  includeBioBodies: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  onLeaveGame: true,
  everyHours: 0,
  folder: null,
  keep: 10,
  includeKeys: false,
  includeBioBodies: false,
};

/** `Documents\ED Exo Compare backups` on Windows, `~/ED Exo Compare backups` elsewhere. */
export function defaultBackupFolder(home = homedir(), platform = process.platform): string {
  return platform === "win32" ? path.join(home, "Documents", "ED Exo Compare backups") : path.join(home, "ED Exo Compare backups");
}

export function readBackupSettings(appDataDir: string): BackupSettings {
  try {
    return normaliseBackupSettings(JSON.parse(readFileSync(path.join(appDataDir, BACKUP_SETTINGS_FILE), "utf8")));
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

/** Whatever arrives (the file, a request body), made into valid settings. */
export function normaliseBackupSettings(raw: unknown, base: BackupSettings = DEFAULT_BACKUP_SETTINGS): BackupSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hours = Number(o.everyHours);
  const keep = Math.round(Number(o.keep));
  const folder = typeof o.folder === "string" && o.folder.trim() ? o.folder.trim() : o.folder === null ? null : base.folder;
  return {
    onLeaveGame: typeof o.onLeaveGame === "boolean" ? o.onLeaveGame : base.onLeaveGame,
    everyHours: hours === 0 || hours === 6 || hours === 12 || hours === 24 ? hours : base.everyHours,
    folder,
    keep: Number.isFinite(keep) && keep >= 1 ? Math.min(100, keep) : base.keep,
    includeKeys: typeof o.includeKeys === "boolean" ? o.includeKeys : base.includeKeys,
    includeBioBodies: typeof o.includeBioBodies === "boolean" ? o.includeBioBodies : base.includeBioBodies,
  };
}

export function writeBackupSettings(appDataDir: string, s: BackupSettings): void {
  writeFileAtomic(path.join(appDataDir, BACKUP_SETTINGS_FILE), JSON.stringify(s, null, 2), "utf8");
}

/* ------------------------------------------------------------------------------ what goes in */

/**
 * Why an app-data path stays out of a backup, or null when it goes in. Anything not named here goes
 * in — a file added in a later version is backed up until someone decides it is a cache.
 */
export function appDataExclusion(rel: string, s: Pick<BackupSettings, "includeKeys" | "includeBioBodies">): string | null {
  const top = rel.split("/")[0]!;
  const base = path.posix.basename(rel);
  if (top === ".edexo-cache") return "cache (rebuilt from the journals)";
  if (top === "diag") return "diagnostics";
  if (top === RESTORE_PENDING_DIR || top.startsWith(BEFORE_RESTORE_PREFIX)) return "an earlier restore";
  if (base === "edexo-bio-bodies.bin" && !s.includeBioBodies) return "large cache (rebuilt by re-importing the Spansh dump)";
  if (
    [
      "edexo-compare-carriers.csv",
      "edexo-compare-carriers.meta.json",
      "edexo-compare-dssa.csv",
      "edexo-compare-poi.json",
      "edexo-compare-poi.meta.json",
      "edexo-compare-statistics.json",
      "edexo-remote-systems.json",
    ].includes(base)
  ) {
    return "download or cache (fetched again)";
  }
  if ((base === "edexo-compare-edsm-key.json" || base === "edexo-compare-lan-key.txt") && !s.includeKeys) return "key (off by default)";
  // Where the windows were belongs to this PC's screens, not to the data.
  if (base === "window-state.json" || base === "app-window.json") return "window positions (this PC only)";
  if (/\.(bak|tmp|partial|rar|zip|7z)$/i.test(base) || /\.bak-/i.test(base)) return "old copy or archive";
  return null;
}

/** The journal folder's files a backup wants: the journals and the game's JSON status files. */
export function isJournalFolderFile(name: string): boolean {
  return /^Journal\..+\.log$/i.test(name) || /^[A-Za-z]+\.json$/.test(name);
}

interface FileStat {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

function walk(dir: string, relBase = ""): FileStat[] {
  const out: FileStat[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const abs = path.join(dir, n);
    const rel = relBase ? `${relBase}/${n}` : n;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(abs, rel));
    else if (st.isFile()) out.push({ rel, abs, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
  }
  return out;
}

/* --------------------------------------------------------------------------------- manifest */

export interface JournalRecord {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface BackupManifest {
  format: "edexo-backup/1";
  app: string;
  created: string;
  commander: string | null;
  /** Every backup is "full" now; "incremental" ones came from the first test build (see the top). */
  kind: "full" | "incremental";
  /** Legacy chains: the full backup an incremental one belongs to (a full one names itself). */
  chain: string;
  /** Legacy chains: the backup an incremental one builds on; null for a full one. */
  previous: string | null;
  /** Files copied from an earlier backup rather than compressed again (for the log; 0 on the first). */
  reused?: number;
  journals: {
    dir: string;
    /** Every journal-folder file at the time, whether in this zip or an earlier one of the chain. */
    all: JournalRecord[];
    /** The ones in this zip. */
    included: string[];
  };
  appData: { dir: string; files: { path: string; size: number }[]; excluded: { path: string; reason: string }[] };
  exports: string[];
  errors: string[];
}

export interface BackupInfo {
  file: string;
  path: string;
  bytes: number;
  manifest: BackupManifest;
}

/** The backups in a folder, oldest first, read from their manifests; unreadable zips are left out. */
export async function listBackups(folder: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const file of names) {
    const p = path.join(folder, file);
    try {
      const entries = await listZip(p);
      const m = entries.find((e) => e.name === "manifest.json");
      if (!m) continue;
      const manifest = JSON.parse((await readZipEntry(p, m)).toString("utf8")) as BackupManifest;
      if (manifest.format !== "edexo-backup/1") continue;
      out.push({ file, path: p, bytes: (await stat(p)).size, manifest });
    } catch {
      /* a damaged or foreign zip is not one of ours */
    }
  }
  return out.sort((a, b) => a.manifest.created.localeCompare(b.manifest.created) || a.file.localeCompare(b.file));
}

/* ------------------------------------------------------------------------------------ backup */

export interface BackupSources {
  appDataDir: string;
  journalDir: string | null;
  commander: string | null;
  appVersion: string;
  /** The two exports, built in-process. */
  exports?: () => { fileName: string; body: unknown }[];
}

export interface BackupResult {
  file: string;
  path: string;
  bytes: number;
  kind: "full" | "incremental";
  journals: number;
  appDataFiles: number;
  /** Of those, copied from an earlier backup rather than compressed again. */
  reused: number;
  pruned: string[];
  errors: string[];
}

const sameDir = (a: string, b: string) =>
  process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function stamp(d: Date, seconds: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${seconds ? p(d.getSeconds()) : ""}`;
}

export function backupFileName(commander: string | null, d: Date, seconds = false): string {
  const who = (commander ?? "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_") || "CMDR";
  return `EDExoCompare-backup-${who}-${stamp(d, seconds)}.zip`;
}

/** Back up now: write a complete zip, then prune the folder down to `keep`. */
export async function runBackup(src: BackupSources, settings: BackupSettings, now = new Date()): Promise<BackupResult> {
  const folder = settings.folder ?? defaultBackupFolder();
  await mkdir(folder, { recursive: true });
  const errors: string[] = [];

  // Journals: every one in the folder, every time.
  const journalAll: (JournalRecord & { abs: string })[] = [];
  if (src.journalDir) {
    for (const f of walk(src.journalDir)) {
      if (f.rel.includes("/") || !isJournalFolderFile(f.rel)) continue;
      journalAll.push({ name: f.rel, size: f.size, mtimeMs: f.mtimeMs, abs: f.abs });
    }
  }

  // App data, minus the exclusions.
  const appFiles: FileStat[] = [];
  const excluded: { path: string; reason: string }[] = [];
  for (const f of walk(src.appDataDir)) {
    const why = appDataExclusion(f.rel, settings);
    if (why) excluded.push({ path: f.rel, reason: why });
    else appFiles.push(f);
  }

  // What earlier backups already hold, newest first: an unchanged file is copied from there.
  const reusable = new Map<string, { zip: string; entry: ZipEntry }>();
  for (const b of (await listBackups(folder)).reverse()) {
    try {
      for (const e of await listZip(b.path)) if (!reusable.has(e.name)) reusable.set(e.name, { zip: b.path, entry: e });
    } catch {
      /* an unreadable backup offers nothing */
    }
  }
  let reused = 0;
  /** Copy from an earlier backup when that entry is this very file and still reads back; else compress. */
  const add = async (name: string, f: { abs: string; size: number; mtimeMs: number }) => {
    const r = reusable.get(name);
    // Zip times are local and to 2 s, so "the same time" is within 2 s.
    if (r && r.entry.size === f.size && Math.abs(r.entry.mtime.getTime() - f.mtimeMs) < 2000 && (await verifyZipEntry(r.zip, r.entry))) {
      await zip.addCopy(name, r.zip, r.entry);
      reused++;
      return;
    }
    await zip.addFile(name, f.abs);
  };

  let file = backupFileName(src.commander, now);
  if (existsSync(path.join(folder, file))) file = backupFileName(src.commander, now, true);
  const finalPath = path.join(folder, file);
  const partial = `${finalPath}.partial`;
  const zip = new ZipWriter(partial);
  const exportNames: string[] = [];
  try {
    for (const j of journalAll) {
      try {
        await add(`journals/${j.name}`, j);
      } catch (e) {
        errors.push(`journal ${j.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const f of appFiles) {
      try {
        await add(`app-data/${f.rel}`, f);
      } catch (e) {
        errors.push(`app data ${f.rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      for (const x of src.exports?.() ?? []) {
        await zip.addBuffer(`exports/${x.fileName}`, JSON.stringify(x.body, null, 2));
        exportNames.push(x.fileName);
      }
    } catch (e) {
      errors.push(`exports: ${e instanceof Error ? e.message : String(e)}`);
    }
    const manifest: BackupManifest = {
      format: "edexo-backup/1",
      app: `ED Exo Compare ${src.appVersion}`,
      created: now.toISOString(),
      commander: src.commander,
      kind: "full",
      chain: file,
      previous: null,
      reused,
      journals: {
        dir: src.journalDir ?? "",
        all: journalAll.map(({ name, size, mtimeMs }) => ({ name, size, mtimeMs })),
        included: journalAll.map((j) => j.name).filter((n) => !errors.some((e) => e.startsWith(`journal ${n}:`))),
      },
      appData: {
        dir: src.appDataDir,
        files: appFiles.filter((f) => !errors.some((e) => e.startsWith(`app data ${f.rel}:`))).map((f) => ({ path: f.rel, size: f.size })),
        excluded,
      },
      exports: exportNames,
      errors,
    };
    await zip.addBuffer("manifest.json", JSON.stringify(manifest, null, 2), now);
    await zip.finish();
  } catch (e) {
    await zip.abort();
    await rm(partial, { force: true });
    throw e;
  }
  await rename(partial, finalPath);
  const bytes = (await stat(finalPath)).size;
  const pruned = await pruneBackups(folder, settings.keep);
  return {
    file,
    path: finalPath,
    bytes,
    kind: "full",
    journals: journalAll.length,
    appDataFiles: appFiles.length,
    reused,
    pruned,
    errors,
  };
}

/**
 * Keep the newest `keep` backups and remove the rest — except a backup that a kept one still builds
 * on (the incremental backups of the first test build name theirs in `previous`), so pruning can never
 * leave a kept backup incomplete.
 */
export async function pruneBackups(folder: string, keep: number): Promise<string[]> {
  const all = await listBackups(folder);
  const byFile = new Map(all.map((b) => [b.file, b]));
  const needed = new Set<string>();
  for (const b of all.slice(-Math.max(1, keep))) {
    for (let cur: BackupInfo | undefined = b; cur && !needed.has(cur.file); ) {
      needed.add(cur.file);
      cur = cur.manifest.previous ? byFile.get(cur.manifest.previous) : undefined;
    }
  }
  const removed: string[] = [];
  for (const b of all) {
    if (needed.has(b.file)) continue;
    await rm(b.path, { force: true });
    removed.push(b.file);
  }
  return removed;
}

/* ----------------------------------------------------------------------------------- restore */

/**
 * The part of a zip entry's name under `prefix`, or null when it could land outside the folder it is
 * written into (combined plan 1.5, 2026-10-01). Windows takes `\` as a separator too, so an entry
 * named `app-data/..\..\Startup\x.bat` passed the old `/`-only check and `path.join` wrote it outside
 * the staging folder: a crafted zip in a shared backup folder could put a file anywhere. Backslashes
 * count as separators here, and a `:` anywhere (drive letters, alternate data streams) is refused.
 */
export function safeZipRel(name: string, prefix: string): string | null {
  if (!name.startsWith(prefix)) return null;
  const rel = name.slice(prefix.length).replace(/\\/g, "/");
  if (!rel || rel.includes(":") || rel.startsWith("/")) return null;
  if (rel.split("/").some((p) => !p || p === "." || p === "..")) return null;
  return rel;
}

/** `to` resolves inside `root`: the last check before a restored file is written. */
function insideFolder(root: string, to: string): boolean {
  const r = path.relative(path.resolve(root), path.resolve(to));
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}

/**
 * Stage a backup's app data for the next start. Returns how many files were staged. Anything staged
 * earlier and not yet applied is replaced.
 */
export async function stageAppDataRestore(backupPath: string, appDataDir: string): Promise<number> {
  const staging = path.join(appDataDir, RESTORE_PENDING_DIR);
  // The marker first: a staging that fails half way must not be applied at the next start under an
  // earlier staging's marker (combined plan 1.5). It is written again once every file is in.
  await rm(path.join(appDataDir, `${RESTORE_PENDING_DIR}.json`), { force: true });
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  let n = 0;
  for (const e of await listZip(backupPath)) {
    const rel = safeZipRel(e.name, "app-data/");
    if (!rel) continue;
    const to = path.join(staging, ...rel.split("/"));
    if (!insideFolder(staging, to)) continue;
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, await readZipEntry(backupPath, e));
    n++;
  }
  await writeFile(path.join(appDataDir, `${RESTORE_PENDING_DIR}.json`), JSON.stringify({ from: path.basename(backupPath), staged: new Date().toISOString(), files: n }), "utf8");
  return n;
}

/**
 * At start, before anything reads the app data: move a staged restore in. Every file it replaces is
 * moved into `before-restore-<time>/`, never deleted. Returns lines for the log (empty: nothing to do).
 */
export function applyPendingRestore(appDataDir: string, now = new Date()): string[] {
  const staging = path.join(appDataDir, RESTORE_PENDING_DIR);
  const marker = path.join(appDataDir, `${RESTORE_PENDING_DIR}.json`);
  if (!existsSync(staging) || !existsSync(marker)) return [];
  const aside = path.join(appDataDir, `${BEFORE_RESTORE_PREFIX}${stamp(now, true)}`);
  let from = "a backup";
  try {
    from = (JSON.parse(readFileSync(marker, "utf8")) as { from?: string }).from ?? from;
  } catch {
    /* the marker only names the backup */
  }
  let moved = 0;
  let asideCount = 0;
  for (const f of walk(staging)) {
    const dest = path.join(appDataDir, ...f.rel.split("/"));
    if (existsSync(dest)) {
      const keep = path.join(aside, ...f.rel.split("/"));
      mkdirSync(path.dirname(keep), { recursive: true });
      renameSync(dest, keep);
      asideCount++;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(f.abs, dest);
    moved++;
  }
  rmSync(staging, { recursive: true, force: true });
  rmSync(marker, { force: true });
  return [
    `restore: ${moved} files from ${from}` +
      (asideCount ? `; the ${asideCount} they replaced are in ${path.basename(aside)}` : ""),
  ];
}

export interface JournalRestoreResult {
  written: number;
  skippedExisting: number;
  target: string;
}

/**
 * Write the journals of a backup (walking its chain back to the full one) into `target`. A file that
 * already exists there is left alone — a journal never changes once closed, so the one there is at
 * least as complete. The game's own folder is refused unless `allowGameFolder` says the commander
 * confirmed it twice.
 */
export async function restoreJournals(
  folder: string,
  file: string,
  target: string,
  opts: { gameJournalDir?: string | null; allowGameFolder?: boolean } = {},
): Promise<JournalRestoreResult> {
  if (opts.gameJournalDir && sameDir(target, opts.gameJournalDir) && !opts.allowGameFolder) {
    throw new Error("That is the game's journal folder; restoring there needs a second confirmation.");
  }
  const all = await listBackups(folder);
  const chosen = all.find((b) => b.file === file);
  if (!chosen) throw new Error(`No backup named ${file} in ${folder}`);
  // The chain up to and including the chosen one; later backups hold the newer copy of a file.
  const chain: BackupInfo[] = [];
  for (let b: BackupInfo | undefined = chosen; b; ) {
    chain.unshift(b);
    const prev: string | null = b.manifest.previous;
    b = prev ? all.find((x) => x.file === prev) : undefined;
    if (prev && !b) throw new Error(`${prev}, which ${chain[0]!.file} builds on, is missing`);
  }
  const newest = new Map<string, { zip: string; entry: ZipEntry }>();
  for (const b of chain) {
    for (const e of await listZip(b.path)) {
      const rel = safeZipRel(e.name, "journals/");
      if (rel && !rel.includes("/")) newest.set(rel, { zip: b.path, entry: e });
    }
  }
  await mkdir(target, { recursive: true });
  let written = 0;
  let skippedExisting = 0;
  for (const [name, { zip, entry }] of newest) {
    const to = path.join(target, name);
    if (!insideFolder(target, to)) continue;
    if (existsSync(to)) {
      skippedExisting++;
      continue;
    }
    await writeFile(to, await readZipEntry(zip, entry), { flag: "wx" });
    written++;
  }
  return { written, skippedExisting, target };
}
