/**
 * Where the backups go against where the originals are (src/server/backupFolderRisk.ts): red on the
 * same partition, yellow on the same physical drive, fine elsewhere, and "unknown" rather than a guess.
 */
import { describe, expect, it } from "vitest";
import { assessBackupFolder, type DiskProbe } from "../src/server/backupFolderRisk.js";

/** A made-up PC: C: and F: on one SSD, D: its own disk, U: a USB stick, Z: with no disk map. */
const volumes: Record<string, { dev: number; disk: string | null; usb?: boolean }> = {
  C: { dev: 1, disk: "ssd" },
  F: { dev: 2, disk: "ssd" },
  D: { dev: 3, disk: "hdd" },
  U: { dev: 4, disk: "stick", usb: true },
  Z: { dev: 5, disk: null },
};
const letter = (p: string) => p[0]!.toUpperCase();
const probe: DiskProbe = {
  volumeOf: (p) => {
    const v = volumes[letter(p)];
    return v ? { dev: v.dev, label: `${letter(p)}:` } : null;
  },
  diskOf: async (p) => {
    const v = volumes[letter(p)];
    return v?.disk ? { id: v.disk, usb: !!v.usb } : null;
  },
};
const data = { journals: "C:/Users/Cmdr/Saved Games/Frontier Developments/Elite Dangerous", appData: "C:/Users/Cmdr/AppData/Local/ED Exo Compare" };

describe("backup folder risk", () => {
  it("is red on the partition that holds the journals (the Desktop, Documents)", async () => {
    expect(await assessBackupFolder("C:/Users/Cmdr/Desktop/backups", data, probe)).toMatchObject({
      level: "same-volume",
      against: "journals",
      folderVolume: "C:",
      dataVolume: "C:",
    });
  });

  it("is red on the app data's partition even when the journals are elsewhere", async () => {
    const r = await assessBackupFolder("C:/b", { journals: "D:/Elite", appData: "C:/app" }, probe);
    expect(r).toMatchObject({ level: "same-volume", against: "app data" });
  });

  it("is yellow on another partition of the same drive", async () => {
    expect(await assessBackupFolder("F:/Backups", data, probe)).toMatchObject({
      level: "same-disk",
      against: "journals",
      folderVolume: "F:",
      dataVolume: "C:",
      usb: false,
    });
  });

  it("is fine on another drive, and says when that drive is USB", async () => {
    expect(await assessBackupFolder("D:/Backups", data, probe)).toMatchObject({ level: "separate", usb: false });
    expect(await assessBackupFolder("U:/Backups", data, probe)).toMatchObject({ level: "separate", usb: true });
  });

  it("treats a network share as separate, and a drive it cannot map as unknown", async () => {
    expect(await assessBackupFolder("\\\\nas\\backups\\elite", data, probe)).toMatchObject({ level: "separate", network: true });
    expect((await assessBackupFolder("Z:/Backups", data, probe)).level).toBe("unknown");
    expect((await assessBackupFolder("Q:/Backups", data, probe)).level).toBe("unknown"); // no such drive
  });

  it("with no journal folder set, compares with the app data only", async () => {
    expect(await assessBackupFolder("F:/Backups", { journals: null, appData: "C:/app" }, probe)).toMatchObject({
      level: "same-disk",
      against: "app data",
    });
  });
});
