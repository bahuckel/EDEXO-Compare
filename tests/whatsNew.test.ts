/**
 * "What's new" after an update (combined plan, Phase 5): the launcher shows, once, the notes of the
 * releases since the version last seen, cut from GitHub's release notes.
 */
import { describe, expect, it } from "vitest";
import { releaseNotesBetween, releaseNotesSection } from "../src/server/updateCheck.js";
import { createWhatsNew, whatsNewRange } from "../src/server/whatsNew.js";

/** The shape release.mjs published for 1.2.10: intro, download text, the body, then the fixed tail. */
const BODY_1_2_10 = `A journal-linked exobiology companion for Elite Dangerous.

**This release is the unpacked program folder.** For the single-file version, see v1.2.10.

Extract \`EDExoCompare-1.2.10-win-x64.zip\`; it contains one folder.

The app updates itself, and a round of fixes.

## What's new

1. Updates from the launcher
   - a) One press downloads it.

## Fixes

1. HUD fix.

## Linux — ![Untested](https://img.shields.io/badge/Linux-untested-orange)

Still untested on Linux.

## Where your data lives

\`%LOCALAPPDATA%\\ED Exo Compare\\\`

## Licence

Code: MIT.`;

const marked = (v: string) =>
  `Intro.\n\nDownload it.\n\n<!-- whats-new -->\nSummary of ${v}.\n\n## What's new\n\n1. Thing in ${v}.\n<!-- /whats-new -->\n\n## Where your data lives\n\nHere.`;

describe("releaseNotesSection", () => {
  it("cuts an unmarked release (1.2.10) from the summary line to the data section, Linux left out", () => {
    const s = releaseNotesSection(BODY_1_2_10, "zip");
    expect(s.startsWith("The app updates itself, and a round of fixes.")).toBe(true);
    expect(s).toContain("## What's new");
    expect(s).toContain("1. HUD fix.");
    expect(s).not.toContain("Linux");
    expect(s).not.toContain("Extract");
    expect(s).not.toContain("Where your data lives");
    expect(s).not.toContain("Licence");
  });

  it("keeps the Linux section for the AppImage", () => {
    expect(releaseNotesSection(BODY_1_2_10, "appimage")).toContain("Still untested on Linux.");
  });

  it("takes the marked part when release.mjs marked it", () => {
    expect(releaseNotesSection(marked("1.2.11"), "portable")).toBe(
      "Summary of 1.2.11.\n\n## What's new\n\n1. Thing in 1.2.11.",
    );
  });
});

const RELEASES = [
  { tag_name: "v1.2.12", published_at: "2026-10-20T00:00:00Z", body: marked("1.2.12 exe") },
  { tag_name: "v1.2.12-zip", published_at: "2026-10-20T00:00:00Z", body: marked("1.2.12 zip") },
  { tag_name: "v1.2.11-zip", body: marked("1.2.11") },
  { tag_name: "v1.2.10-zip", body: BODY_1_2_10 },
  { tag_name: "v1.2.13-zip", draft: true, body: marked("draft") },
];

describe("releaseNotesBetween", () => {
  it("lists the releases after the one seen, up to this one, newest first", () => {
    const n = releaseNotesBetween(RELEASES, "1.2.10", "1.2.12", "zip");
    expect(n.map((r) => r.version)).toEqual(["1.2.12", "1.2.11"]);
    expect(n[0]!.notes).toContain("1.2.12 zip");
    expect(n[0]!.pageUrl).toBe("https://github.com/bahuckel/EDEXO-Compare/releases/tag/v1.2.12-zip");
  });

  it("prefers the exe's release for the exe", () => {
    const n = releaseNotesBetween(RELEASES, "1.2.11", "1.2.12", "portable");
    expect(n).toHaveLength(1);
    expect(n[0]!.notes).toContain("1.2.12 exe");
    expect(n[0]!.pageUrl.endsWith("/v1.2.12")).toBe(true);
  });

  it("with no version seen, only this one", () => {
    expect(releaseNotesBetween(RELEASES, null, "1.2.11", "zip").map((r) => r.version)).toEqual(["1.2.11"]);
  });

  it("is empty for a list it cannot read", () => {
    expect(releaseNotesBetween(null, "1.2.10", "1.2.12", "zip")).toEqual([]);
  });
});

describe("whatsNewRange", () => {
  it("shows after an update, not on the same or an older version", () => {
    expect(whatsNewRange("1.2.10", "1.2.11", true)).toEqual({ show: true, from: "1.2.10" });
    expect(whatsNewRange("1.2.11", "1.2.11", true).show).toBe(false);
    expect(whatsNewRange("1.2.12", "1.2.11", true).show).toBe(false);
  });

  it("a new install shows nothing; an install from before this shows this version's notes", () => {
    expect(whatsNewRange(null, "1.2.11", false)).toEqual({ show: false, from: null });
    expect(whatsNewRange(null, "1.2.11", true)).toEqual({ show: true, from: null });
  });
});

describe("createWhatsNew", () => {
  const make = (saved: string | null, existing: boolean) => {
    const store = { saved, writes: 0 };
    const w = createWhatsNew({
      current: "1.2.12",
      check: async () => undefined,
      notesBetween: (from, to) => releaseNotesBetween(RELEASES, from, to, "zip"),
      lastError: () => "offline",
      readSaved: () => store.saved,
      writeSaved: (v) => {
        store.saved = v;
        store.writes += 1;
      },
      existing: () => existing,
    });
    return { w, store };
  };

  it("a new install saves its version at once and has nothing pending", async () => {
    const { w, store } = make(null, false);
    expect(store.saved).toBe("1.2.12");
    expect((await w.get()).pending).toBe(false);
  });

  it("after an update: pending until closed, then saved and gone", async () => {
    const { w, store } = make("1.2.10", true);
    const a = await w.get();
    expect(a.pending).toBe(true);
    expect(a.releases.map((r) => r.version)).toEqual(["1.2.12", "1.2.11"]);
    w.seen();
    expect(store.saved).toBe("1.2.12");
    expect((await w.get()).pending).toBe(false);
    // The way back: this version's notes, whatever was seen.
    const again = await w.get(true);
    expect(again.pending).toBe(false);
    expect(again.releases.map((r) => r.version)).toEqual(["1.2.12"]);
  });

  it("an older version running never moves the saved one back", () => {
    const { w, store } = make("1.2.13", true);
    w.seen();
    expect(store.saved).toBe("1.2.13");
    expect(store.writes).toBe(0);
  });

  it("says why when there are no notes", async () => {
    const w = createWhatsNew({
      current: "1.2.12",
      check: async () => undefined,
      notesBetween: () => [],
      lastError: () => "GitHub answered HTTP 403",
      readSaved: () => "1.2.10",
      writeSaved: () => undefined,
      existing: () => true,
    });
    const a = await w.get();
    expect(a.pending).toBe(true);
    expect(a.error).toBe("GitHub answered HTTP 403");
  });
});
