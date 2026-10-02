/**
 * Download a newer release for the launcher to install on restart (owner, 2026-10-02: "instead of the
 * user having to download and replace it, integrate an updater, that requires an app restart to take
 * effect").
 *
 * This half only fetches and checks. The update check (`updateCheck.ts`) already reads the release
 * list; GitHub lists every file there with its SHA-256. The file for this form of the app — the
 * single exe, the program folder's zip, the AppImage — is downloaded from this repo's release
 * download URL into `<user data>/update/`, hashed while it streams, and kept only when the hash is
 * GitHub's. Then `ready.json` names it, and nothing else happens: the running copy is replaced by
 * Electron when the commander restarts (`electron/updater.cjs`), never behind their back.
 *
 * Only where Electron says it can swap the file (`EDEXO_SELF_UPDATE=1`, a packaged Windows or Linux
 * build). A source run or the console builds keep the release-page link.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { UpdateDownloadDTO } from "../shared/types.js";
import { APP_USER_AGENT, APP_VERSION } from "./appVersion.js";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { compareVersions, type ReleaseAsset, type ReleaseForm } from "./updateCheck.js";

/** What `ready.json` holds: the checked file Electron puts in place on the next restart. */
export interface StagedUpdate {
  version: string;
  form: ReleaseForm;
  /** Absolute path of the downloaded, checked file. */
  file: string;
  sha256: string;
  stagedAt: string;
}

export const READY_FILE = "ready.json";

/** `<user data>/update` — beside the settings, never inside the program's own folder. */
export function resolveUpdateDir(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "update");
}

/** Electron sets this for a packaged build it knows how to swap (electron/updater.cjs). */
export function selfUpdateSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDEXO_SELF_UPDATE === "1";
}

/** A staged update that is still worth installing: newer than this copy, its file there. */
export function readStagedUpdate(dir: string, current = APP_VERSION): StagedUpdate | null {
  try {
    const j = JSON.parse(readFileSync(join(dir, READY_FILE), "utf8")) as Partial<StagedUpdate>;
    if (
      typeof j.version !== "string" ||
      typeof j.file !== "string" ||
      typeof j.sha256 !== "string" ||
      (j.form !== "portable" && j.form !== "zip" && j.form !== "appimage")
    )
      return null;
    if (compareVersions(j.version, current) <= 0 || !existsSync(j.file)) return null;
    return j as StagedUpdate;
  } catch {
    return null;
  }
}

/**
 * Empty the folder unless it holds an update still to install. Run at start: after an update the
 * staged file is this version (or older) and goes; a half download from a quit goes with it.
 */
export function cleanUpdateDir(dir: string, current = APP_VERSION): void {
  if (!existsSync(dir)) return;
  const keep = readStagedUpdate(dir, current);
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (keep && (p === keep.file || name === READY_FILE)) continue;
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* in use or gone; the next start tries again */
    }
  }
}

export interface AppUpdaterOptions {
  /** The newer release's file for this form, from the update check. */
  newerAsset: () => { version: string; asset: ReleaseAsset } | null;
  form: ReleaseForm;
  dir?: string;
  fetchImpl?: typeof fetch;
  current?: string;
  supported?: boolean;
}

export function createAppUpdater(o: AppUpdaterOptions) {
  const dir = o.dir ?? resolveUpdateDir();
  const fetchImpl = o.fetchImpl ?? fetch;
  const current = o.current ?? APP_VERSION;
  const supported = o.supported ?? selfUpdateSupported();
  let state: UpdateDownloadDTO["state"] = "idle";
  let version: string | null = null;
  let received = 0;
  let total: number | null = null;
  let error: string | null = null;
  let running: Promise<void> | null = null;

  if (supported) {
    cleanUpdateDir(dir, current);
    const staged = readStagedUpdate(dir, current);
    if (staged && staged.form === o.form) {
      state = "ready";
      version = staged.version;
    }
  }

  const status = (): UpdateDownloadDTO => ({ supported, state, version, received, total, error });

  async function download(v: string, asset: ReleaseAsset): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const part = join(dir, asset.name + ".part");
    const final = join(dir, asset.name);
    const res = await fetchImpl(asset.url, { headers: { "User-Agent": APP_USER_AGENT }, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`Download answered HTTP ${res.status}`);
    total = asset.size ?? (Number(res.headers.get("content-length")) || null);
    const hash = createHash("sha256");
    const out = createWriteStream(part);
    try {
      for await (const chunk of Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)) {
        const buf = chunk as Buffer;
        hash.update(buf);
        received += buf.length;
        if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    const got = hash.digest("hex");
    if (got !== asset.sha256) {
      rmSync(part, { force: true });
      throw new Error(`The download does not match GitHub's checksum (got ${got.slice(0, 12)}…, expected ${asset.sha256.slice(0, 12)}…)`);
    }
    rmSync(final, { force: true });
    renameSync(part, final);
    const staged: StagedUpdate = { version: v, form: o.form, file: final, sha256: got, stagedAt: new Date().toISOString() };
    writeFileSync(join(dir, READY_FILE), JSON.stringify(staged, null, 2));
  }

  return {
    status,
    /** The staged file, for Electron to install on restart; null until one is checked and ready. */
    staged(): StagedUpdate | null {
      return state === "ready" ? readStagedUpdate(dir, current) : null;
    },
    /** Start (or join) the download of the newer release. Resolves with the status when it ends. */
    async start(): Promise<UpdateDownloadDTO> {
      if (!supported) {
        error = "This copy cannot update itself; download it from the release page.";
        return status();
      }
      const newer = o.newerAsset();
      if (!newer) {
        error = "No newer release with a checkable download is known.";
        return status();
      }
      if (state === "ready" && version === newer.version) return status();
      if (!running) {
        state = "downloading";
        version = newer.version;
        received = 0;
        total = newer.asset.size;
        error = null;
        running = download(newer.version, newer.asset)
          .then(() => {
            state = "ready";
          })
          .catch((e) => {
            state = "error";
            error = e instanceof Error ? e.message : String(e);
          })
          .finally(() => {
            running = null;
          });
      }
      await running;
      return status();
    },
  };
}
