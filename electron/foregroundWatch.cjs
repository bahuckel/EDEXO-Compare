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
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
}
"@
# Per-monitor aware (-4), so window rectangles are real screen pixels on every monitor.
[void][EdexoFg]::SetProcessDpiAwarenessContext([IntPtr](-4))
$lastPid = -1
$lastAt = 
$tick = 0
while ($true) {
  # The app that started this is gone (crashed, ended in Task Manager): so is this.
  if ((++$tick % 10) -eq 0 -and -not (Get-Process -Id __PARENT_PID__ -ErrorAction SilentlyContinue)) { exit }
  $h = [EdexoFg]::GetForegroundWindow()
  $p = 0
  [void][EdexoFg]::GetWindowThreadProcessId($h, [ref]$p)
  # Where the window's centre is, in screen pixels: which monitor the game is on.
  $r = New-Object EdexoFg+RECT
  $at = ''
  if ([EdexoFg]::GetWindowRect($h, [ref]$r)) { $at = [string][int](($r.L + $r.R) / 2) + ',' + [string][int](($r.T + $r.B) / 2) }
  if ($p -ne $lastPid -or $at -ne $lastAt) {
    $lastPid = $p
    $lastAt = $at
    $n = ''
    try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
    try {
      [Console]::Out.WriteLine($n + [char]9 + $at)
      [Console]::Out.Flush()
    } catch { exit }
  }
  Start-Sleep -Milliseconds 400
}
`;

const MAX_RESTARTS = 5;

/**
 * One line of the watcher: the process name, a tab, and the window's centre in screen pixels ("x,y",
 * empty when it could not be read).
 * @param {string} line
 * @returns {{ name: string, at: { x: number, y: number } | null }}
 */
function parseForegroundLine(line) {
  const [name = "", at = ""] = String(line).split("\t");
  const m = /^(-?\d+),(-?\d+)$/.exec(at.trim());
  return { name: name.trim(), at: m ? { x: Number(m[1]), y: Number(m[2]) } : null };
}

/**
 * @param {(processName: string, at: { x: number, y: number } | null) => void} onName called with the
 *   foreground process's name (no ".exe") and its window's centre in screen pixels
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
          Buffer.from(SCRIPT.replace("__PARENT_PID__", String(process.pid)), "utf16le").toString("base64"),
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
        const { name, at } = parseForegroundLine(line);
        onName(name, at);
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
  // "Idle" is process 0: no window in front for a moment, as Windows reports between two windows.
  if (n === "idle") return true;
  return n === "elitedangerous64" || own.includes(n);
}

/** The game itself, not this app's windows (the HUD follows the game's monitor). */
function isGame(name) {
  return String(name || "").toLowerCase() === "elitedangerous64";
}

module.exports = { watchForeground, isGameOrOwn, isGame, parseForegroundLine };
