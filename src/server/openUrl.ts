import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** Avoid the `open` npm package — its ESM `import.meta.url` breaks esbuild+cjs bundles. */
export function openUrlInBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    execFile("open", [url], () => {});
    return;
  }
  execFile("xdg-open", [url], () => {});
}

/**
 * Hand a local file to whatever the desktop opens it with.
 *
 * The same three shell commands as {@link openUrlInBrowser} — `start`, `open`, `xdg-open` all take a
 * path as readily as a URL — but named separately because the two callers mean different things and
 * a file path handed to something called "open in browser" reads like a mistake.
 *
 * No return value and no error path: these commands are fire-and-forget by design, and on Windows a
 * file type with no association does not fail, it shows the "how do you want to open this?" picker.
 * That is a better outcome than a toast saying nothing happened.
 */
export function openLocalFile(file: string): void {
  if (process.platform === "win32") {
    // The empty string is `start`'s title argument. Without it a quoted path is taken *as* the
    // title and nothing opens.
    spawn("cmd", ["/c", "start", "", file], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    execFile("open", [file], () => {});
    return;
  }
  execFile("xdg-open", [file], () => {});
}

/**
 * Minimal framed window (Chromium/Edge app mode) so users get a GUI without Electron when desired.
 */
export function openLauncherShell(url: string): void {
  if (process.platform !== "win32") {
    openUrlInBrowser(url);
    return;
  }
  const tryExe = (exe: string, args: string[]) => {
    if (!existsSync(exe)) return false;
    spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  };
  const home = process.env.LOCALAPPDATA || "";
  const edgeCandidates = [
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ];
  const chrome = path.join(home, "Google", "Chrome", "Application", "chrome.exe");

  const edge = edgeCandidates.find((p) => existsSync(p));
  const appArgs = [`--app=${url}`, "--new-window", "--disable-features=TranslateUI"];
  if (edge) {
    if (tryExe(edge, appArgs)) return;
  }
  if (tryExe(chrome, appArgs)) return;
  openUrlInBrowser(url);
}
