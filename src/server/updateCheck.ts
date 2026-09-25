/**
 * "Is there a newer release?" — the launcher's version line (owner, 2026-09-25).
 *
 * The easy way, by his choice: say which version is running, say which is newest when they differ,
 * and link to the release page. Nothing is downloaded and nothing on disk is touched — the commander
 * replaces the program themselves, and everything of theirs lives in the user data folder, not in
 * what a release ships.
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
/** One answer per hour is plenty; GitHub allows an unauthenticated caller 60 requests an hour. */
const MEMO_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** `v1.2.3` or `v1.2.3-zip` — the only tag shapes this repo publishes. Anything else is ignored. */
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(-zip)?$/;

export type ReleaseForm = "portable" | "zip";

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
  return env.PORTABLE_EXECUTABLE_FILE ? "portable" : "zip";
}

interface GithubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
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
): { version: string; pageUrl: string; publishedAt: string | null } | null {
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
  const tag = entry.tags.get(form === "zip") ?? entry.tags.get(form !== "zip")!;
  return { version: best, pageUrl: RELEASE_PAGE + encodeURIComponent(tag), publishedAt: entry.publishedAt };
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
  let lastGood: { version: string; pageUrl: string; publishedAt: string | null } | null = null;
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
      const picked = pickLatestRelease(await res.json(), form);
      if (!picked) throw new Error("No release found on GitHub");
      lastGood = picked;
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
    /** The release page to open, only when a newer version is known. */
    updatePageUrl(): string | null {
      const a = answer();
      return a.newer ? a.pageUrl : null;
    },
  };
}
