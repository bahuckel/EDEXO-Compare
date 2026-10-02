/**
 * The self-update swap (electron/update-apply.ps1 via electron/updater.cjs), run for real on fake
 * programs in a temp folder: it waits for the app's process to end, puts the new exe or the new
 * folder in place, keeps the old one as `.old`, and puts the old one back when the new one is bad.
 * Windows only — the swap is PowerShell; the AppImage path is a rename in updater.cjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const updater = require("../electron/updater.cjs") as {
  selfUpdateForm: (o: { isPackaged: boolean; platform?: string; env?: Record<string, string>; execPath?: string }) => string | null;
  removeOldCopy: (form: string, env?: Record<string, string>, execPath?: string) => void;
  installOnQuit: (
    staged: { form: string; file: string; version: string },
    o: { form: string; scriptPath: string; logPath: string; pids: number[]; env?: Record<string, string>; execPath?: string; start?: boolean },
  ) => { how: string; execPath?: string };
};
const SCRIPT = path.resolve(__dirname, "..", "electron", "update-apply.ps1");
const win = process.platform === "win32";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-apply-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Stand-in for the app: a process that is still running when the swap starts, and then ends. */
function fakeApp(ms: number) {
  return spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { stdio: "ignore" });
}
async function waitFor(check: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out");
}
const logOf = () => (existsSync(path.join(dir, "update.log")) ? readFileSync(path.join(dir, "update.log"), "utf8") : "");

describe("which copies can update themselves", () => {
  it("packaged portable, packaged folder, AppImage; not a source run", () => {
    expect(updater.selfUpdateForm({ isPackaged: false, platform: "win32", env: { PORTABLE_EXECUTABLE_FILE: "x" } })).toBeNull();
    expect(updater.selfUpdateForm({ isPackaged: true, platform: "win32", env: { PORTABLE_EXECUTABLE_FILE: "C:\\a\\EDExoCompare.exe" } })).toBe("portable");
    expect(updater.selfUpdateForm({ isPackaged: true, platform: "win32", env: {}, execPath: "D:\\Games\\ED Exo Compare 1.2.9\\EDExoCompare.exe" })).toBe("zip");
    expect(updater.selfUpdateForm({ isPackaged: true, platform: "win32", env: {}, execPath: "C:\\x\\electron.exe" })).toBeNull();
    expect(updater.selfUpdateForm({ isPackaged: true, platform: "linux", env: { APPIMAGE: "/home/a/EDExo.AppImage" } })).toBe("appimage");
    expect(updater.selfUpdateForm({ isPackaged: true, platform: "darwin", env: {} })).toBeNull();
  });
});

describe.runIf(win)("the swap on Windows", () => {
  it("portable: waits for the app, replaces the exe, keeps the old one as .old, and the next start removes it", async () => {
    const target = path.join(dir, "EDExoCompare.exe");
    const staged = path.join(dir, "staged.exe");
    writeFileSync(target, "old exe");
    writeFileSync(staged, "new exe");
    const app = fakeApp(1500);
    updater.installOnQuit(
      { form: "portable", file: staged, version: "9.9.9" },
      { form: "portable", scriptPath: SCRIPT, logPath: path.join(dir, "update.log"), pids: [app.pid!], env: { PORTABLE_EXECUTABLE_FILE: target }, start: false },
    );
    // Still the old one while the app runs.
    await new Promise((r) => setTimeout(r, 600));
    expect(readFileSync(target, "utf8")).toBe("old exe");
    await waitFor(() => logOf().includes("update: installed") || logOf().includes("update: FAILED"));
    expect(logOf()).toContain("update: installed");
    expect(readFileSync(target, "utf8")).toBe("new exe");
    expect(readFileSync(target + ".old", "utf8")).toBe("old exe");
    updater.removeOldCopy("portable", { PORTABLE_EXECUTABLE_FILE: target });
    expect(existsSync(target + ".old")).toBe(false);
  }, 40_000);

  it("folder: unpacks the zip's one folder in place of the program folder", async () => {
    const program = path.join(dir, "ED Exo Compare 1.2.9");
    mkdirSync(program);
    writeFileSync(path.join(program, "EDExoCompare.exe"), "old exe");
    writeFileSync(path.join(program, "only-in-old.txt"), "x");
    const src = path.join(dir, "src", "ED Exo Compare 9.9.9");
    mkdirSync(path.join(src, "resources"), { recursive: true });
    writeFileSync(path.join(src, "EDExoCompare.exe"), "new exe");
    writeFileSync(path.join(src, "resources", "app.txt"), "new");
    const zip = path.join(dir, "EDExoCompare-9.9.9-win-x64.zip");
    const z = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -LiteralPath '${src}' -DestinationPath '${zip}'`]);
    expect(z.status).toBe(0);
    updater.installOnQuit(
      { form: "zip", file: zip, version: "9.9.9" },
      { form: "zip", scriptPath: SCRIPT, logPath: path.join(dir, "update.log"), pids: [], execPath: path.join(program, "EDExoCompare.exe"), env: {}, start: false },
    );
    await waitFor(() => logOf().includes("update: installed") || logOf().includes("update: FAILED"));
    expect(logOf()).toContain("update: installed");
    expect(readFileSync(path.join(program, "EDExoCompare.exe"), "utf8")).toBe("new exe");
    expect(readFileSync(path.join(program, "resources", "app.txt"), "utf8")).toBe("new");
    expect(existsSync(path.join(program, "only-in-old.txt"))).toBe(false);
    expect(existsSync(path.join(program + ".old", "only-in-old.txt"))).toBe(true);
    updater.removeOldCopy("zip", {}, path.join(program, "EDExoCompare.exe"));
    expect(existsSync(program + ".old")).toBe(false);
  }, 60_000);

  it("folder: a zip without the program leaves the old folder exactly as it was", async () => {
    const program = path.join(dir, "ED Exo Compare 1.2.9");
    mkdirSync(program);
    writeFileSync(path.join(program, "EDExoCompare.exe"), "old exe");
    const src = path.join(dir, "src", "something else");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "readme.txt"), "no exe here");
    const zip = path.join(dir, "bad.zip");
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -LiteralPath '${src}' -DestinationPath '${zip}'`]);
    updater.installOnQuit(
      { form: "zip", file: zip, version: "9.9.9" },
      { form: "zip", scriptPath: SCRIPT, logPath: path.join(dir, "update.log"), pids: [], execPath: path.join(program, "EDExoCompare.exe"), env: {}, start: false },
    );
    await waitFor(() => logOf().includes("update: installed") || logOf().includes("update: FAILED"));
    expect(logOf()).toContain("FAILED");
    expect(readFileSync(path.join(program, "EDExoCompare.exe"), "utf8")).toBe("old exe");
    expect(existsSync(program + ".old")).toBe(false);
    // Nothing half-unpacked left beside it.
    expect(readdirSync(dir).sort()).toEqual(["ED Exo Compare 1.2.9", "bad.zip", "src", "update.log"]);
  }, 60_000);
});
