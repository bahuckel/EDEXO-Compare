/**
 * The launcher's updater, download half (plan: self-update, owner 2026-10-02). The newer release's
 * file for this form is found in the release list with GitHub's SHA-256, downloaded into the update
 * folder, and kept only when it hashes to that; `ready.json` then names it for the restart.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanUpdateDir, createAppUpdater, readStagedUpdate, READY_FILE } from "../src/server/appUpdater.js";
import { createUpdateChecker, pickLatestRelease, RELEASE_DOWNLOAD } from "../src/server/updateCheck.js";

const EXE = Buffer.from("MZ the new exe");
const ZIP = Buffer.from("PK the new folder");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const RELEASES = [
  {
    tag_name: "v1.3.0",
    published_at: "2026-10-10T00:00:00Z",
    assets: [{ name: "EDExoCompare.exe", size: EXE.length, digest: `sha256:${sha(EXE)}` }],
  },
  {
    tag_name: "v1.3.0-zip",
    published_at: "2026-10-10T00:00:00Z",
    assets: [
      { name: "EDExoCompare-1.3.0-win-x64.zip", size: ZIP.length, digest: `sha256:${sha(ZIP)}` },
      { name: "EDExoCompare-1.3.0-x86_64.AppImage", size: 3, digest: "sha256:" + "0".repeat(64) },
    ],
  },
  { tag_name: "v1.2.9", assets: [{ name: "EDExoCompare.exe", size: 1, digest: "sha256:" + "1".repeat(64) }] },
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-update-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** GitHub's release list, then the download (served from this repo's URL only). */
function fakeGithub(files: Record<string, Buffer>, seen: string[] = []): typeof fetch {
  return (async (url: string) => {
    seen.push(String(url));
    if (String(url).startsWith("https://api.github.com/")) return new Response(JSON.stringify(RELEASES), { status: 200 });
    const name = decodeURIComponent(String(url).split("/").pop()!);
    const body = files[name];
    return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
}

async function updaterFor(form: "portable" | "zip" | "appimage", files: Record<string, Buffer>, seen: string[] = []) {
  const f = fakeGithub(files, seen);
  const checker = createUpdateChecker({ fetchImpl: f, current: "1.2.9", form });
  await checker.check(true);
  return createAppUpdater({ newerAsset: () => checker.newerAsset(), form, dir, fetchImpl: f, current: "1.2.9", supported: true });
}

describe("the release file for each form", () => {
  it("is the exe on v<x>, the zip and the AppImage on v<x>-zip, with GitHub's SHA-256", () => {
    expect(pickLatestRelease(RELEASES, "portable")?.asset).toMatchObject({
      tag: "v1.3.0",
      name: "EDExoCompare.exe",
      url: RELEASE_DOWNLOAD + "v1.3.0/EDExoCompare.exe",
      sha256: sha(EXE),
    });
    expect(pickLatestRelease(RELEASES, "zip")?.asset?.name).toBe("EDExoCompare-1.3.0-win-x64.zip");
    expect(pickLatestRelease(RELEASES, "appimage")?.asset?.name).toBe("EDExoCompare-1.3.0-x86_64.AppImage");
    expect(pickLatestRelease(RELEASES, "appimage")?.pageUrl).toContain("v1.3.0-zip");
  });

  it("is none when GitHub gives no checksum: never downloaded, only linked", () => {
    const noDigest = RELEASES.map((r) => ({ ...r, assets: r.assets.map((a) => ({ ...a, digest: undefined })) }));
    expect(pickLatestRelease(noDigest, "portable")?.asset).toBeNull();
    expect(pickLatestRelease(noDigest, "portable")?.version).toBe("1.3.0");
  });
});

describe("downloading the newer release", () => {
  it("keeps a file that hashes to GitHub's checksum and names it in ready.json", async () => {
    const seen: string[] = [];
    const u = await updaterFor("portable", { "EDExoCompare.exe": EXE }, seen);
    const st = await u.start();
    expect(st).toMatchObject({ supported: true, state: "ready", version: "1.3.0", received: EXE.length, error: null });
    const staged = u.staged()!;
    expect(readFileSync(staged.file)).toEqual(EXE);
    expect(staged).toMatchObject({ version: "1.3.0", form: "portable", sha256: sha(EXE) });
    expect(seen.filter((x) => !x.startsWith("https://api.github.com/"))).toEqual([RELEASE_DOWNLOAD + "v1.3.0/EDExoCompare.exe"]);
  });

  it("throws away a file that does not match, and says so", async () => {
    const u = await updaterFor("portable", { "EDExoCompare.exe": Buffer.from("tampered") });
    const st = await u.start();
    expect(st.state).toBe("error");
    expect(st.error).toMatch(/checksum/);
    expect(u.staged()).toBeNull();
    expect(existsSync(path.join(dir, READY_FILE))).toBe(false);
    expect(existsSync(path.join(dir, "EDExoCompare.exe"))).toBe(false);
    expect(existsSync(path.join(dir, "EDExoCompare.exe.part"))).toBe(false);
  });

  it("does nothing where this copy cannot replace itself", async () => {
    const f = fakeGithub({ "EDExoCompare.exe": EXE });
    const checker = createUpdateChecker({ fetchImpl: f, current: "1.2.9", form: "portable" });
    await checker.check(true);
    const u = createAppUpdater({ newerAsset: () => checker.newerAsset(), form: "portable", dir, fetchImpl: f, current: "1.2.9", supported: false });
    const st = await u.start();
    expect(st).toMatchObject({ supported: false, state: "idle" });
    expect(existsSync(path.join(dir, "EDExoCompare.exe"))).toBe(false);
  });

  it("downloads once when asked twice at the same time", async () => {
    const seen: string[] = [];
    const u = await updaterFor("zip", { "EDExoCompare-1.3.0-win-x64.zip": ZIP }, seen);
    const [a, b] = await Promise.all([u.start(), u.start()]);
    expect(a.state).toBe("ready");
    expect(b.state).toBe("ready");
    expect(seen.filter((x) => x.endsWith(".zip"))).toHaveLength(1);
  });
});

describe("the update folder at start", () => {
  it("keeps an update still to install, and clears one this copy already is", () => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "EDExoCompare.exe");
    writeFileSync(file, EXE);
    writeFileSync(path.join(dir, "stale.part"), "half");
    writeFileSync(path.join(dir, READY_FILE), JSON.stringify({ version: "1.3.0", form: "portable", file, sha256: sha(EXE), stagedAt: "x" }));
    cleanUpdateDir(dir, "1.2.9");
    expect(readStagedUpdate(dir, "1.2.9")?.version).toBe("1.3.0");
    expect(existsSync(path.join(dir, "stale.part"))).toBe(false);
    // Restarted into 1.3.0: the staged copy is this version now, and goes.
    cleanUpdateDir(dir, "1.3.0");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(path.join(dir, READY_FILE))).toBe(false);
  });

  it("comes back as ready after a restart that did not install it", () => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "EDExoCompare.exe");
    writeFileSync(file, EXE);
    writeFileSync(path.join(dir, READY_FILE), JSON.stringify({ version: "1.3.0", form: "portable", file, sha256: sha(EXE), stagedAt: "x" }));
    const u = createAppUpdater({ newerAsset: () => null, form: "portable", dir, current: "1.2.9", supported: true });
    expect(u.status()).toMatchObject({ state: "ready", version: "1.3.0" });
  });
});
