import { describe, expect, it } from "vitest";
import type { AppSnapshot, BodyComputed } from "../src/shared/types.js";
import { parseWsChannel, slimBodyForHud, slimSnapshotForChannel } from "../src/server/wsChannels.js";

function body(key: string): BodyComputed {
  return {
    state: { key, bodyName: "Body " + key, biologicalSignals: 2, organicGenusLocks: [] },
    tabLabel: key,
    matches: [
      {
        entry: { id: "x_1", displayName: "Tubus compagibus", genus: "Tubus", genusDataDir: "tubus", criteria: {}, notes: "long" },
        priceCredits: 2_000_000,
        presenceProbabilityPercent: 80,
        unlikely: false,
        organicAnalysisComplete: true,
        exomasterySimilarityPercent: 91,
        photoUrl: "/species-photos/x.jpg",
        photoUrls: ["/species-photos/x.jpg"],
        exomasteryDetail: { huge: "payload" },
        reasons: [{ field: "PlanetClass", detail: "…" }],
      },
    ],
    exoPayoutRange: { big: true },
    genusCertainty: { status: "certain" },
  } as unknown as BodyComputed;
}

function snap(): AppSnapshot {
  return {
    port: 7111,
    journalBoot: null,
    journalDir: "X",
    journalDirConfiguredOk: true,
    journalFileCount: 3,
    lastJournalEventIso: "2026-09-13T00:00:00Z",
    currentRegion: { name: "Inner Orion Spur", index: 18 },
    jumpTarget: { starSystem: "A", systemAddress: 1, starClass: "K", at: "", arrived: false, source: "route" },
    bodies: [body("1:2"), body("1:3")],
    exoOverlayFocusBodyKey: "1:2",
    exoOverlayFocusBody: body("1:2"),
    journalSystems: [{ systemAddress: 1, starSystem: "A" }],
    speciesCount: 108,
    canonnUpload: { enabled: false },
    edsmAutoFetch: { enabled: false },
  } as unknown as AppSnapshot;
}

describe("socket channels: slim snapshots per client kind", () => {
  it("parses only the three channels", () => {
    expect(parseWsChannel("hud")).toBe("hud");
    expect(parseWsChannel("launcher")).toBe("launcher");
    expect(parseWsChannel("app")).toBe("app");
    expect(parseWsChannel("nope")).toBeNull();
    expect(parseWsChannel(undefined)).toBeNull();
  });

  it("gives the app the whole state, untouched", () => {
    const s = snap();
    expect(slimSnapshotForChannel(s, "app")).toBe(s);
  });

  it("gives the launcher its five fields and nothing heavy", () => {
    const out = slimSnapshotForChannel(snap(), "launcher") as unknown as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ["journalBoot", "journalDir", "journalDirConfiguredOk", "journalFileCount", "lastJournalEventIso", "port"].sort(),
    );
    expect(out.bodies).toBeUndefined();
    expect(out.journalSystems).toBeUndefined();
  });

  it("gives the HUD its fields plus bodies cut to what the candidate rows read", () => {
    const out = slimSnapshotForChannel(snap(), "hud") as unknown as AppSnapshot;
    expect(out.jumpTarget?.starSystem).toBe("A");
    expect(out.currentRegion?.name).toBe("Inner Orion Spur");
    expect((out as unknown as Record<string, unknown>).journalSystems).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).speciesCount).toBeUndefined();
    expect(out.bodies).toHaveLength(2);
    const b = out.bodies[0]!;
    expect(b.state.key).toBe("1:2");
    expect(b.tabLabel).toBe("1:2");
    expect((b as unknown as Record<string, unknown>).exoPayoutRange).toBeUndefined();
    const m = b.matches[0]! as unknown as Record<string, unknown>;
    expect(m.priceCredits).toBe(2_000_000);
    expect(m.organicAnalysisComplete).toBe(true);
    expect(m.photoUrl).toBeUndefined();
    expect(m.exomasteryDetail).toBeUndefined();
    expect((m.entry as unknown as Record<string, unknown>).notes).toBeUndefined();
    expect(out.exoOverlayFocusBody?.matches[0]?.entry.displayName).toBe("Tubus compagibus");
  });

  it("slims a body far below its full size", () => {
    const full = JSON.stringify(body("1:2")).length;
    const slim = JSON.stringify(slimBodyForHud(body("1:2"))).length;
    expect(slim).toBeLessThan(full * 0.6);
  });
});
