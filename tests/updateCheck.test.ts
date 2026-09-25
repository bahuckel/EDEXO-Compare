/**
 * The launcher's version line: which release is newest, and which page the link opens.
 * No network — every test hands the checker its own `fetch`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  createUpdateChecker,
  currentReleaseForm,
  parseReleaseTag,
  pickLatestRelease,
} from "../src/server/updateCheck.js";

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-09-25T10:00:00Z",
  ...extra,
});

/** The shape every release has had since 1.1.5: two tags per version, the -zip one marked Latest. */
const RELEASES = [rel("v1.1.9-zip"), rel("v1.1.9"), rel("v1.1.8-zip"), rel("v1.1.8")];

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("parseReleaseTag / compareVersions", () => {
  it("reads both tag forms and ignores anything else", () => {
    expect(parseReleaseTag("v1.1.9-zip")).toEqual({ version: "1.1.9", parts: [1, 1, 9], zip: true });
    expect(parseReleaseTag("v1.1.9")?.zip).toBe(false);
    expect(parseReleaseTag("1.1.9")).toBeNull();
    expect(parseReleaseTag("v1.1.9-beta")).toBeNull();
  });

  it("compares numerically, part by part", () => {
    expect(compareVersions("1.1.10", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.10")).toBeGreaterThan(0);
    expect(compareVersions("1.1.8", "1.1.8")).toBe(0);
    expect(compareVersions("1.1.8", "1.1.9")).toBeLessThan(0);
  });
});

describe("pickLatestRelease", () => {
  it("links the single-exe copy to the plain tag and the folder copy to the -zip tag", () => {
    expect(pickLatestRelease(RELEASES, "portable")?.pageUrl).toBe(
      "https://github.com/bahuckel/EDEXO-Compare/releases/tag/v1.1.9",
    );
    expect(pickLatestRelease(RELEASES, "zip")?.pageUrl).toBe(
      "https://github.com/bahuckel/EDEXO-Compare/releases/tag/v1.1.9-zip",
    );
  });

  it("goes by version, not by list order or date", () => {
    const hotfixOfOldLine = [rel("v1.1.3", { published_at: "2026-10-01T00:00:00Z" }), ...RELEASES];
    expect(pickLatestRelease(hotfixOfOldLine, "zip")?.version).toBe("1.1.9");
  });

  it("skips drafts, pre-releases and foreign tag shapes", () => {
    const list = [
      rel("v2.0.0", { draft: true }),
      rel("v1.9.0", { prerelease: true }),
      rel("nightly"),
      ...RELEASES,
    ];
    expect(pickLatestRelease(list, "zip")?.version).toBe("1.1.9");
  });

  it("falls back to the other form when a version has only one tag", () => {
    expect(pickLatestRelease([rel("v1.2.0-zip")], "portable")?.pageUrl).toMatch(/v1\.2\.0-zip$/);
  });

  it("answers null for nothing usable", () => {
    expect(pickLatestRelease({ message: "rate limited" }, "zip")).toBeNull();
    expect(pickLatestRelease([], "zip")).toBeNull();
  });
});

describe("currentReleaseForm", () => {
  it("is portable only when the portable stub launched us", () => {
    expect(currentReleaseForm({ PORTABLE_EXECUTABLE_FILE: "X:\\Games\\EDExoCompare.exe" })).toBe("portable");
    expect(currentReleaseForm({})).toBe("zip");
  });
});

describe("createUpdateChecker", () => {
  it("says newer, with the page, when GitHub has a higher version", async () => {
    const c = createUpdateChecker({ fetchImpl: fakeFetch(RELEASES), current: "1.1.8", form: "portable" });
    const a = await c.check();
    expect(a).toMatchObject({ current: "1.1.8", latest: "1.1.9", newer: true, error: null });
    expect(c.updatePageUrl()).toBe("https://github.com/bahuckel/EDEXO-Compare/releases/tag/v1.1.9");
  });

  it("is not newer when running the latest, and offers no page to open", async () => {
    const c = createUpdateChecker({ fetchImpl: fakeFetch(RELEASES), current: "1.1.9", form: "zip" });
    expect((await c.check()).newer).toBe(false);
    expect(c.updatePageUrl()).toBeNull();
  });

  it("is not newer when running a build ahead of GitHub", async () => {
    const c = createUpdateChecker({ fetchImpl: fakeFetch(RELEASES), current: "1.2.0", form: "zip" });
    expect((await c.check()).newer).toBe(false);
  });

  it("asks GitHub once an hour unless forced", async () => {
    let t = 0;
    const f = fakeFetch(RELEASES);
    const c = createUpdateChecker({ fetchImpl: f, current: "1.1.8", form: "zip", now: () => t });
    t = 1000;
    await c.check();
    t += 30 * 60 * 1000;
    await c.check();
    expect(f).toHaveBeenCalledTimes(1);
    await c.check(true);
    expect(f).toHaveBeenCalledTimes(2);
    t += 61 * 60 * 1000;
    await c.check();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good answer when GitHub fails, and says why", async () => {
    let ok = true;
    const f = vi.fn(async () =>
      ok ? new Response(JSON.stringify(RELEASES)) : new Response("{}", { status: 403 }),
    ) as unknown as typeof fetch;
    const c = createUpdateChecker({ fetchImpl: f, current: "1.1.8", form: "zip" });
    await c.check();
    ok = false;
    const a = await c.check(true);
    expect(a).toMatchObject({ latest: "1.1.9", newer: true, error: "GitHub answered HTTP 403" });
  });

  it("reports a network failure without throwing", async () => {
    const f = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    }) as unknown as typeof fetch;
    const a = await createUpdateChecker({ fetchImpl: f, current: "1.1.8", form: "zip" }).check();
    expect(a).toMatchObject({ latest: null, newer: false, pageUrl: null });
    expect(a.error).toMatch(/ENOTFOUND/);
  });
});
