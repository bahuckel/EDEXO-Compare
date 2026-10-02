/**
 * "Is there a newer release?" — the launcher's version line (owner, 2026-09-25).
 *
 * Say which version is running, say which is newest when they differ, and link to the release page.
 * This only asks; the newer release's file, when the commander presses "Download & Install", is
 * fetched and installed by `appUpdater.ts` and `electron/updater.cjs` (owner, 2026-10-02).
 * Everything of theirs lives in the user data folder, not in what a release ships.
 *
 * Every release is two GitHub releases at the same commit: `v<x>` carries the single-file exe and
 * `v<x>-zip` the unpacked folder (and is the one GitHub marks Latest). So the answer comes from the
 * release list, not `/releases/latest`, and the link goes to the page of the form this copy was
 * installed from.
 */
import type { UpdateInfoDTO } from "../shared/types.js";
import { APP_USER_AGENT, APP_VERSION } from "./appVersion.js";

export const RELEASES_API = "https://api.github.com/repos/bahuckel/EDEXO-Compare/releases?per_page=20";
const RELEASE_PAGE = "https://github.com/bahuckel/EDEXO-Compare/releases/tag/";
/** Where a release file is downloaded from: built from the tag and the file name, this repo only. */
export const RELEASE_DOWNLOAD = "https://github.com/bahuckel/EDEXO-Compare/releases/download/";
/** One answer per hour is plenty; GitHub allows an unauthenticated caller 60 requests an hour. */
const MEMO_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** `v1.2.3` or `v1.2.3-zip` — the only tag shapes this repo publishes. Anything else is ignored. */
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(-zip)?$/;

/** The single exe, the program folder (zip), or the Linux AppImage. */
export type ReleaseForm = "portable" | "zip" | "appimage";

/**
 * The file a release publishes for each form, and the tag it is under (docs/release/release.mjs):
 * the exe alone on `v<x>`; the zip and the AppImage on `v<x>-zip`.
 */
export function releaseAssetFor(form: ReleaseForm, version: string): { tag: string; name: string } {
  if (form === "portable") return { tag: `v${version}`, name: "EDExoCompare.exe" };
  if (form === "appimage") return { tag: `v${version}-zip`, name: `EDExoCompare-${version}-x86_64.AppImage` };
  return { tag: `v${version}-zip`, name: `EDExoCompare-${version}-win-x64.zip` };
}

/** One release file as the updater needs it: where, how big, and the SHA-256 GitHub holds for it. */
export interface ReleaseAsset {
  tag: string;
  name: string;
  url: string;
  size: number | null;
  sha256: string;
}

export function parseReleaseTag(tag: string): { version: string; parts: number[]; zip: boolean } | null {
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { version: parts.join("."), parts, zip: m[4] === "-zip" };
}

/** Numeric, part by part: 1.1.10 is newer than 1.1.9. Unparseable versions compare as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Which form this copy is. electron-builder's portable stub sets `PORTABLE_EXECUTABLE_FILE` for the
 * app it launches; the unpacked folder, the CLI builds and a source run have none — they all get the
 * zip page, which is the one with the folder and the CLI builds in it.
 */
export function currentReleaseForm(env: NodeJS.ProcessEnv = process.env): ReleaseForm {
  if (env.PORTABLE_EXECUTABLE_FILE) return "portable";
  // The AppImage runtime names the image it was started from.
  if (env.APPIMAGE) return "appimage";
  return "zip";
}

interface GithubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
  body?: unknown;
}

/**
 * This form's file in that version's release, when GitHub lists it with a SHA-256. No digest, no
 * asset: a file that cannot be checked is never downloaded for the commander, only linked.
 */
function findAsset(releases: GithubRelease[], form: ReleaseForm, version: string): ReleaseAsset | null {
  const want = releaseAssetFor(form, version);
  const rel = releases.find((r) => r && r.tag_name === want.tag && r.draft !== true && r.prerelease !== true);
  if (!rel || !Array.isArray(rel.assets)) return null;
  for (const a of rel.assets as Record<string, unknown>[]) {
    if (!a || a.name !== want.name) continue;
    const m = typeof a.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest) : null;
    if (!m) return null;
    return {
      tag: want.tag,
      name: want.name,
      url: RELEASE_DOWNLOAD + encodeURIComponent(want.tag) + "/" + encodeURIComponent(want.name),
      size: typeof a.size === "number" && a.size > 0 ? a.size : null,
      sha256: m[1]!.toLowerCase(),
    };
  }
  return null;
}

/**
 * The newest published version and the page to send this form of the app to.
 *
 * Newest by version number, not by date: a hotfix to an old line published later must not read as
 * an update. The link is built from the tag here, never taken from the API's `html_url`, so the
 * launcher can only ever open this repo's release pages.
 */
export function pickLatestRelease(
  releases: unknown,
  form: ReleaseForm,
): { version: string; pageUrl: string; publishedAt: string | null; asset: ReleaseAsset | null } | null {
  if (!Array.isArray(releases)) return null;
  const byVersion = new Map<string, { tags: Map<boolean, string>; publishedAt: string | null }>();
  for (const r of releases as GithubRelease[]) {
    if (!r || r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") continue;
    const p = parseReleaseTag(r.tag_name);
    if (!p) continue;
    const entry = byVersion.get(p.version) ?? { tags: new Map(), publishedAt: null };
    entry.tags.set(p.zip, r.tag_name);
    if (typeof r.published_at === "string" && !entry.publishedAt) entry.publishedAt = r.published_at;
    byVersion.set(p.version, entry);
  }
  let best: string | null = null;
  for (const v of byVersion.keys()) if (best === null || compareVersions(v, best) > 0) best = v;
  if (best === null) return null;
  const entry = byVersion.get(best)!;
  // The exe's page for the exe; the zip page (folder, AppImage, console builds) for everything else.
  const zipPage = form !== "portable";
  const tag = entry.tags.get(zipPage) ?? entry.tags.get(!zipPage)!;
  return {
    version: best,
    pageUrl: RELEASE_PAGE + encodeURIComponent(tag),
    publishedAt: entry.publishedAt,
    asset: findAsset(releases as GithubRelease[], form, best),
  };
}

/** Where release.mjs marks the part of a release's notes that is about the version itself. */
const NOTES_START = "<!-- whats-new -->";
const NOTES_END = "<!-- /whats-new -->";

/**
 * The part of a release's notes the launcher shows after an update: the summary line and the
 * sections, without the download instructions above them and the data / licence text below, which
 * are the same in every release. Releases from 1.2.11 on mark that part; 1.2.10 is cut by its
 * headings. The Linux section is left out except for the AppImage.
 */
export function releaseNotesSection(body: string, form: ReleaseForm): string {
  const text = body.replace(/\r\n/g, "\n");
  let part: string;
  const a = text.indexOf(NOTES_START);
  const b = text.indexOf(NOTES_END);
  if (a >= 0 && b > a) {
    part = text.slice(a + NOTES_START.length, b);
  } else {
    const end = text.indexOf("\n## Where your data lives");
    const head = end >= 0 ? text.slice(0, end) : text;
    const paras = head.split(/\n{2,}/);
    const firstHeading = paras.findIndex((p) => p.startsWith("## "));
    part = firstHeading > 0 ? paras.slice(firstHeading - 1).join("\n\n") : head;
  }
  if (form !== "appimage") part = part.replace(/(^|\n)## Linux[^\n]*\n[\s\S]*?(?=\n## |$)/, "$1");
  return part.trim();
}

/** One release's notes for the launcher's "What's new". */
export interface ReleaseNotes {
  version: string;
  publishedAt: string | null;
  pageUrl: string;
  notes: string;
}

/**
 * The notes of every release after `from` up to `to`, newest first; with no `from` (an install that
 * never recorded one) only `to` itself. Each version's notes come from either of its two releases —
 * the middle is the same — preferring this form's own page for the link.
 */
export function releaseNotesBetween(
  releases: unknown,
  from: string | null,
  to: string,
  form: ReleaseForm,
  max = 5,
): ReleaseNotes[] {
  if (!Array.isArray(releases)) return [];
  const byVersion = new Map<string, ReleaseNotes & { own: boolean }>();
  for (const r of releases as GithubRelease[]) {
    if (!r || r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") continue;
    const p = parseReleaseTag(r.tag_name);
    if (!p || typeof r.body !== "string") continue;
    const inRange =
      from === null
        ? compareVersions(p.version, to) === 0
        : compareVersions(p.version, from) > 0 && compareVersions(p.version, to) <= 0;
    if (!inRange) continue;
    const own = p.zip === (form !== "portable");
    const prev = byVersion.get(p.version);
    if (prev && (prev.own || !own)) continue;
    const notes = releaseNotesSection(r.body, form);
    if (!notes) continue;
    byVersion.set(p.version, {
      version: p.version,
      publishedAt: typeof r.published_at === "string" ? r.published_at : null,
      pageUrl: RELEASE_PAGE + encodeURIComponent(r.tag_name),
      notes,
      own,
    });
  }
  return [...byVersion.values()]
    .sort((x, y) => compareVersions(y.version, x.version))
    .slice(0, max)
    .map(({ own: _own, ...n }) => n);
}

export interface UpdateCheckerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  current?: string;
  form?: ReleaseForm;
}

/**
 * Remembers the last answer for an hour, and keeps the last good one when GitHub cannot be reached —
 * a launcher opened offline should still say "1.1.9 available" if it knew that an hour ago.
 */
export function createUpdateChecker(o: UpdateCheckerOptions = {}) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const current = o.current ?? APP_VERSION;
  const form = o.form ?? currentReleaseForm();
  let lastGood: ReturnType<typeof pickLatestRelease> = null;
  /** The release list of the last good answer, for the notes. */
  let lastList: unknown = null;
  let checkedAt = 0;
  let error: string | null = null;
  let inflight: Promise<UpdateInfoDTO> | null = null;

  const answer = (): UpdateInfoDTO => ({
    current,
    latest: lastGood?.version ?? null,
    newer: lastGood !== null && compareVersions(lastGood.version, current) > 0,
    pageUrl: lastGood?.pageUrl ?? null,
    publishedAt: lastGood?.publishedAt ?? null,
    form,
    checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
    error,
  });

  async function refresh(): Promise<UpdateInfoDTO> {
    try {
      const res = await fetchImpl(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": APP_USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const list: unknown = await res.json();
      const picked = pickLatestRelease(list, form);
      if (!picked) throw new Error("No release found on GitHub");
      lastGood = picked;
      lastList = list;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    checkedAt = now();
    return answer();
  }

  return {
    /** `force` is the launcher's button; otherwise an answer younger than an hour is reused. */
    check(force = false): Promise<UpdateInfoDTO> {
      if (inflight) return inflight;
      if (!force && checkedAt && now() - checkedAt < MEMO_MS) return Promise.resolve(answer());
      inflight = refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    /** The newer release's file for this form, when there is one GitHub gives a SHA-256 for. */
    newerAsset(): { version: string; asset: ReleaseAsset } | null {
      const a = answer();
      return a.newer && lastGood?.asset ? { version: lastGood.version, asset: lastGood.asset } : null;
    },
    /** Release notes after `from` up to `to` from the last good answer (`releaseNotesBetween`). */
    notesBetween(from: string | null, to: string): ReleaseNotes[] {
      return releaseNotesBetween(lastList, from, to, form);
    },
    /** Why the last ask failed, or null. */
    lastError(): string | null {
      return error;
    },
    /** The release page to open, only when a newer version is known. */
    updatePageUrl(): string | null {
      const a = answer();
      return a.newer ? a.pageUrl : null;
    },
  };
}
