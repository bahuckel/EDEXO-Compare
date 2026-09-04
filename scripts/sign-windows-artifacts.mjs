/**
 * Optional Authenticode signing for Windows .exe (CLI / pkg outputs).
 * Electron portable is signed by electron-builder only when EDEXO_WIN_CODESIGN=1 and a PFX + password are configured.
 *
 * PFX resolution:
 *   BAHUCKEL_CODESIGN_PFX / CSC_LINK, or if missing and present on disk: build/self-signed-codesign.pfx
 * Password: BAHUCKEL_CODESIGN_PASSWORD / CSC_KEY_PASSWORD / EDEXO_SELFSIGN_PASSWORD
 * Env:
 *   EDEXO_WIN_CODESIGN — set to 1 so npm run dist:win:signed signs CLI exes (and electron-builder when packaging).
 *   BAHUCKEL_SIGNTOOL — optional full path to signtool.exe
 *   EDEXO_SELFSIGN_NO_TIMESTAMP — set to 1 to omit /tr (useful for some self-signed setups)
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const defaultSelfPfxPath = resolve(__dirname, "..", "build", "self-signed-codesign.pfx");

function resolvePfxAndPassword() {
  const explicit = process.env.BAHUCKEL_CODESIGN_PFX || process.env.CSC_LINK || "";
  const pfx = explicit
    ? resolve(explicit)
    : existsSync(defaultSelfPfxPath)
      ? defaultSelfPfxPath
      : "";
  const password =
    process.env.BAHUCKEL_CODESIGN_PASSWORD ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.EDEXO_SELFSIGN_PASSWORD ||
    "";
  return { pfx, password, isSelfSignedDevPfx: Boolean(pfx && resolve(pfx) === resolve(defaultSelfPfxPath)) };
}

function findSigntool() {
  if (process.env.BAHUCKEL_SIGNTOOL && existsSync(process.env.BAHUCKEL_SIGNTOOL)) {
    return process.env.BAHUCKEL_SIGNTOOL;
  }
  const kits = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const binRoot = join(kits, "Windows Kits", "10", "bin");
  if (!existsSync(binRoot)) return null;
  const vers = readdirSync(binRoot)
    .filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of vers) {
    const p = join(binRoot, v, "x64", "signtool.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {string[]} exePaths Absolute or cwd-relative paths to existing .exe files
 * @returns {void}
 */
export function signWindowsArtifactsIfConfigured(exePaths) {
  if (process.platform !== "win32") return;
  if (process.env.EDEXO_WIN_CODESIGN !== "1") return;

  const { pfx, password, isSelfSignedDevPfx } = resolvePfxAndPassword();
  if (!pfx || !existsSync(pfx) || !password) return;

  const signtool = findSigntool();
  if (!signtool) {
    console.warn(
      "[sign] codesign PFX is configured but signtool.exe was not found. Install Windows SDK (Signing tools) or set BAHUCKEL_SIGNTOOL.",
    );
    return;
  }

  const skipTs =
    isSelfSignedDevPfx ||
    process.env.EDEXO_SELFSIGN_NO_TIMESTAMP === "1" ||
    process.env.EDEXO_SELFSIGN_WITH_TIMESTAMP === "0";
  const ts = process.env.BAHUCKEL_TIMESTAMP_URL || "http://timestamp.digicert.com";

  for (const raw of exePaths) {
    const file = resolve(raw);
    if (!existsSync(file)) continue;
    console.info(`[sign] ${file}`);
    const args = ["sign", "/fd", "SHA256", "/f", pfx, "/p", password];
    if (!skipTs) {
      args.push("/tr", ts, "/td", "SHA256");
    }
    args.push(file);
    const r = spawnSync(signtool, args, { stdio: "inherit", cwd: process.cwd() });
    if (r.error) throw r.error;
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
