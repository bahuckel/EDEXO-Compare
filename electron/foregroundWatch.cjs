/**
 * Which program owns the foreground window, for the HUD overlays (owner, 2026-09-30: "hide the HUD
 * when the game is not running or not in focus").
 *
 * Electron can only see its own windows' focus, so this asks Windows directly: one hidden PowerShell,
 * started once, that reads GetForegroundWindow every 400 ms and prints the owning process's name when
 * it changes. One line per change, nothing in between; the process name is resolved only when the
 * window's process id changes. Windows only: elsewhere it never reports, so nothing hides.
 *
 * If PowerShell cannot start or dies, it is restarted a few times with a growing wait, then left:
 * the overlays then simply behave as before (shown while the game runs).
 */
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EdexoFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$lastPid = -1
while ($true) {
  $h = [EdexoFg]::GetForegroundWindow()
  $p = 0
  [void][EdexoFg]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -ne $lastPid) {
    $lastPid = $p
    $n = ''
    try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
    [Console]::Out.WriteLine($n)
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 400
}
`;

const MAX_RESTARTS = 5;

/**
 * @param {(processName: string) => void} onName called with the foreground process's name (no ".exe")
 *   each time it changes; "" when it could not be read.
 * @returns {{ stop: () => void }}
 */
function watchForeground(onName) {
  if (process.platform !== "win32") return { stop() {} };
  let child = null;
  let stopped = false;
  let restarts = 0;

  const start = () => {
    if (stopped) return;
    try {
      child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          Buffer.from(SCRIPT, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      child = null;
      return;
    }
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      restarts = 0;
      try {
        onName(String(line).trim());
      } catch {
        /* the listener's failure is its own */
      }
    });
    child.on("error", () => {});
    child.on("exit", () => {
      child = null;
      if (stopped || restarts >= MAX_RESTARTS) return;
      restarts += 1;
      const t = setTimeout(start, 2000 * restarts);
      t.unref?.();
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      if (child) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
      child = null;
    },
  };
}

/**
 * Whether the foreground belongs to the game or to this app (its own windows keep the overlays: the
 * commander looking at the app on a second screen still has the game beside it).
 * @param {string} name @param {readonly string[]} own lower-case process names of this app
 */
function isGameOrOwn(name, own) {
  const n = String(name || "").toLowerCase();
  if (!n) return true; // unreadable: do not hide on a guess
  return n === "elitedangerous64" || own.includes(n);
}

module.exports = { watchForeground, isGameOrOwn };
