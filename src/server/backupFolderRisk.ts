/**
 * Is the backup folder somewhere a failure would not take the originals with it? (owner, 2026-09-29)
 *
 * - **Red** — the same partition as the journals or the app data (the Desktop, Documents on C:): a
 *   wiped or corrupted partition, a reinstall or a dead drive loses both at once. That is not a backup.
 * - **Yellow** — another partition of the same physical drive (C: and F: on one SSD): safe from a
 *   wiped partition, not from the drive failing.
 * - Fine — another drive, a USB drive or a network folder. A USB drive is said so: it is the
 *   recommended choice on a machine with one drive (most laptops).
 *
 * The partition test is the file system's own: two paths on one volume share `stat().dev` (the volume
 * serial number on Windows, the device on Linux). The drive test needs the partition → disk map:
 * `Get-Partition` / `Get-Disk` on Windows (no admin needed; ≈1.5 s, so cached), `lsblk` on Linux.
 * When that map cannot be read the answer is "unknown", never a guess.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

export type FolderRiskLevel = "same-volume" | "same-disk" | "separate" | "unknown";

export interface FolderRisk {
  level: FolderRiskLevel;
  /** What the folder is compared with, and where each sits ("C:", "/dev/sda2"). */
  against: "journals" | "app data" | null;
  folderVolume: string | null;
  dataVolume: string | null;
  /** The folder is on a USB drive. */
  usb: boolean;
  /** A network path (\\server\share): not a local disk at all. */
  network: boolean;
}

/** What the check needs from the machine; tests pass their own. */
export interface DiskProbe {
  /** The volume a path lives on, from the nearest folder of it that exists; null when none does. */
  volumeOf(p: string): { dev: number; label: string } | null;
  /** The physical disk behind a path's volume, or null when it cannot be told. */
  diskOf(p: string): Promise<{ id: string; usb: boolean } | null>;
}

function nearestExisting(p: string): string | null {
  let cur = path.resolve(p);
  for (;;) {
    try {
      statSync(cur);
      return cur;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return null;
      cur = up;
    }
  }
}

const isNetworkPath = (p: string) => /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(p);

export async function assessBackupFolder(
  folder: string,
  data: { journals: string | null; appData: string },
  probe: DiskProbe = systemDiskProbe,
): Promise<FolderRisk> {
  const base: FolderRisk = { level: "unknown", against: null, folderVolume: null, dataVolume: null, usb: false, network: false };
  if (isNetworkPath(folder)) return { ...base, level: "separate", network: true };
  const fv = probe.volumeOf(folder);
  if (!fv) return base;
  const targets: { name: "journals" | "app data"; dir: string }[] = [];
  if (data.journals) targets.push({ name: "journals", dir: data.journals });
  targets.push({ name: "app data", dir: data.appData });

  // Red: a shared volume with either. The journals are named first: they are what cannot come back.
  for (const t of targets) {
    const tv = probe.volumeOf(t.dir);
    if (tv && tv.dev === fv.dev) return { ...base, level: "same-volume", against: t.name, folderVolume: fv.label, dataVolume: tv.label };
  }
  const fd = await probe.diskOf(folder);
  const usb = !!fd?.usb;
  for (const t of targets) {
    const td = await probe.diskOf(t.dir);
    if (fd && td && fd.id === td.id) {
      return { ...base, level: "same-disk", against: t.name, folderVolume: fv.label, dataVolume: probe.volumeOf(t.dir)?.label ?? null, usb };
    }
    if (!fd || !td) return { ...base, level: "unknown", folderVolume: fv.label, usb };
  }
  return { ...base, level: "separate", folderVolume: fv.label, usb };
}

/* ------------------------------------------------------------------------- the real machine */

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

let winDisks: { at: number; map: Map<string, { id: string; usb: boolean }> } | null = null;
const WIN_DISK_TTL_MS = 5 * 60_000;

/** Drive letter → physical disk, from Windows' storage cmdlets; cached, as they take a second or two. */
async function windowsDiskMap(): Promise<Map<string, { id: string; usb: boolean }> | null> {
  if (winDisks && Date.now() - winDisks.at < WIN_DISK_TTL_MS) return winDisks.map;
  const out = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Partition | Where-Object DriveLetter | ForEach-Object { $d = Get-Disk -Number $_.DiskNumber; " +
      "[pscustomobject]@{ L = [string]$_.DriveLetter; N = $_.DiskNumber; B = [string]$d.BusType } } | ConvertTo-Json -Compress",
  ]);
  if (!out) return null;
  try {
    const raw = JSON.parse(out) as { L: string; N: number; B: string } | { L: string; N: number; B: string }[];
    const map = new Map<string, { id: string; usb: boolean }>();
    for (const r of Array.isArray(raw) ? raw : [raw]) map.set(r.L.toUpperCase(), { id: `disk${r.N}`, usb: /usb/i.test(r.B) });
    winDisks = { at: Date.now(), map };
    return map;
  } catch {
    return null;
  }
}

/** The disk behind a path on Linux: its mount's source device, then that device's parent disk. */
async function linuxDiskOf(p: string): Promise<{ id: string; usb: boolean } | null> {
  const src = (await run("findmnt", ["-no", "SOURCE", "-T", p]))?.trim().split("\n")[0]?.replace(/\[.*\]$/, "");
  if (!src || !src.startsWith("/dev/")) return null;
  // -s walks up through partitions, LVM and crypt layers; the last line is the physical disk.
  const tree = (await run("lsblk", ["-snlo", "NAME,TYPE,TRAN", src]))?.trim().split("\n") ?? [];
  const disk = tree.map((l) => l.trim().split(/\s+/)).find((cols) => cols[1] === "disk");
  if (!disk) return null;
  return { id: disk[0]!, usb: disk[2] === "usb" };
}

export const systemDiskProbe: DiskProbe = {
  volumeOf(p) {
    const at = nearestExisting(p);
    if (!at) return null;
    try {
      const dev = statSync(at).dev;
      // A drive letter where there is one; elsewhere the UI says "the same partition" without a name.
      const label = process.platform === "win32" ? path.parse(at).root.replace(/\\$/, "") : "";
      return { dev, label };
    } catch {
      return null;
    }
  },
  async diskOf(p) {
    const at = nearestExisting(p);
    if (!at) return null;
    if (process.platform === "win32") {
      const letter = /^([A-Za-z]):/.exec(at)?.[1]?.toUpperCase();
      if (!letter) return null;
      return (await windowsDiskMap())?.get(letter) ?? null;
    }
    if (process.platform === "linux") return linuxDiskOf(at);
    return null;
  },
};
