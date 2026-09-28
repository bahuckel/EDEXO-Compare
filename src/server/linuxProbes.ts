/**
 * The real system behind linuxCheck.ts's probes, on Linux. Every one answers quickly and never
 * throws: a probe that cannot tell says "no" (or, for the tray, `null` — unknown, so no warning).
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runLinuxCheck, parseOsRelease, type LinuxCheckResult, type LinuxProbes } from "./linuxCheck.js";

export const linuxProbes: LinuxProbes = {
  hasCommand(name) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir) continue;
      try {
        accessSync(path.join(dir, name), constants.X_OK);
        return true;
      } catch {
        /* next */
      }
    }
    return false;
  },
  processRunning(names) {
    let pids: string[];
    try {
      pids = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
    } catch {
      return false;
    }
    for (const pid of pids) {
      try {
        if (names.includes(readFileSync(`/proc/${pid}/comm`, "utf8").trim())) return true;
      } catch {
        /* gone */
      }
    }
    return false;
  },
  trayHost() {
    if (!linuxProbes.hasCommand("dbus-send")) return null;
    try {
      const out = execFileSync(
        "dbus-send",
        [
          "--session",
          "--print-reply",
          "--dest=org.freedesktop.DBus",
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus.NameHasOwner",
          "string:org.kde.StatusNotifierWatcher",
        ],
        { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
      );
      return /boolean true/.test(out);
    } catch {
      return null;
    }
  },
};

function readOsRelease(): Record<string, string> {
  for (const f of ["/etc/os-release", "/usr/lib/os-release"]) {
    try {
      return parseOsRelease(readFileSync(f, "utf8"));
    } catch {
      /* next */
    }
  }
  return {};
}

/** This machine's check, or null off Linux. `electron`: the launcher + HUD app rather than the browser build. */
export function linuxCheckForThisMachine(electron: boolean): LinuxCheckResult | null {
  if (process.platform !== "linux") return null;
  return runLinuxCheck({
    osRelease: readOsRelease(),
    ostreeBooted: existsSync("/run/ostree-booted"),
    env: process.env,
    electron,
    probes: linuxProbes,
  });
}
