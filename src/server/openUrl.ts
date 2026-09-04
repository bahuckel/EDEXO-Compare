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
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
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
