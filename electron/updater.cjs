"use strict";
/**
 * Installing a downloaded update on restart (owner, 2026-10-02: "instead of the user having to
 * download and replace it, integrate an updater, that requires an app restart to take effect").
 *
 * The server downloads the newer release and checks it against GitHub's SHA-256
 * (`src/server/appUpdater.ts`); this puts it in place when the commander presses "Restart to update".
 * A running program cannot replace itself on Windows, so on the way out a detached PowerShell
 * (`update-apply.ps1`) waits for this process and the portable launcher stub to end, swaps the file or
 * the folder, and starts the new copy — or the old one again if anything failed. An AppImage can be
 * replaced while it runs, so Linux renames the new image over the old one here and relaunches.
 *
 * Which copies can do this: a packaged build only. The portable exe (`PORTABLE_EXECUTABLE_FILE`), the
 * program folder from the zip (Windows), and the AppImage (`APPIMAGE`). A source run, macOS and the
 * console builds keep the release-page link.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXE_NAME = "EDExoCompare.exe";

/**
 * "portable" | "zip" | "appimage" | null for this copy.
 * @param {{ isPackaged: boolean, platform?: string, env?: NodeJS.ProcessEnv, execPath?: string }} o
 */
function selfUpdateForm(o) {
  const env = o.env || process.env;
  const platform = o.platform || process.platform;
  if (!o.isPackaged) return null;
  if (platform === "win32") {
    if (env.PORTABLE_EXECUTABLE_FILE) return "portable";
    const exe = o.execPath || process.execPath;
    return path.basename(exe).toLowerCase() === EXE_NAME.toLowerCase() ? "zip" : null;
  }
  if (platform === "linux" && env.APPIMAGE) return "appimage";
  return null;
}

/** What the swap replaces: the user's exe, the program folder, or the AppImage. */
function updateTarget(form, env = process.env, execPath = process.execPath) {
  if (form === "portable") return env.PORTABLE_EXECUTABLE_FILE || null;
  if (form === "zip") return path.dirname(execPath);
  if (form === "appimage") return env.APPIMAGE || null;
  return null;
}

/**
 * The copy the last update moved aside, removed at the next start. A folder only when it holds this
 * app's exe — never a guess at someone else's folder.
 */
function removeOldCopy(form, env = process.env, execPath = process.execPath) {
  const target = updateTarget(form, env, execPath);
  if (!target) return;
  const old = target + ".old";
  try {
    if (!fs.existsSync(old)) return;
    if (form === "zip") {
      if (!fs.existsSync(path.join(old, EXE_NAME))) return;
      fs.rmSync(old, { recursive: true, force: true });
    } else {
      fs.rmSync(old, { force: true });
    }
  } catch {
    /* still in use (an explorer window, an antivirus scan); the next start tries again */
  }
}

/**
 * Start the swap on the way out. Call from will-quit with the staged update (`ready.json`).
 * Returns how the app comes back: "helper" (the PowerShell starts it), "relaunch" (Electron should
 * relaunch the given path), or "none" (nothing to install: relaunch as usual).
 * @param {{ form: string, file: string, version: string }} staged
 * @param {{ form: string, scriptPath: string, logPath: string, pids: number[], env?: NodeJS.ProcessEnv, execPath?: string, start?: boolean }} o
 */
function installOnQuit(staged, o) {
  const env = o.env || process.env;
  const target = updateTarget(o.form, env, o.execPath || process.execPath);
  if (!staged || staged.form !== o.form || !target || !fs.existsSync(staged.file)) return { how: "none" };
  if (o.form === "appimage") {
    // Same folder, then a rename over the running image: atomic, and Linux lets a running file go.
    const next = target + ".new";
    fs.copyFileSync(staged.file, next);
    fs.chmodSync(next, 0o755);
    fs.renameSync(next, target);
    return { how: "relaunch", execPath: target };
  }
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    o.scriptPath,
    "-WaitPids",
    o.pids.filter((p) => Number.isInteger(p) && p > 0).join(","),
    "-Mode",
    o.form,
    "-Target",
    target,
    "-Staged",
    staged.file,
    "-Start",
    o.start === false ? "0" : "1",
    "-Log",
    o.logPath,
  ];
  /*
    Through `cmd /c start`: PowerShell 5.1 started straight from a detached process (no console) exits
    at once without running the script, and a child that is not detached is killed with this process
    (libuv puts it in a kill-on-close job). `start /b` hands it off and lets this process go.
    Every argument quoted: paths have spaces ("ED Exo Compare 1.2.9").
  */
  const line = "powershell.exe " + args.map((a) => `"${String(a).replace(/"/g, "")}"`).join(" ");
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start "" /b ${line}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
  return { how: "helper" };
}

module.exports = { selfUpdateForm, updateTarget, removeOldCopy, installOnQuit, EXE_NAME };
