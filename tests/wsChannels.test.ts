import { describe, expect, it } from "vitest";
import type { AppSnapshot, BodyComputed } from "../src/shared/types.js";
import { findMatchDetail, parseWsChannel, slimBodyForHud, slimSnapshotForChannel } from "../src/server/wsChannels.js";

function body(key: string): BodyComputed {
  return {
    state: { key, bodyName: "Body " + key, biologicalSignals: 2, organicGenusLocks: [] },
    tabLabel: key,
    matches: [
      {
        entry: {
          id: "x_1",
          displayName: "Tubus compagibus",
          genus: "Tubus",
          genusDataDir: "tubus",
          criteria: {},
          notes: "long",
        },
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
    jumpTarget: {
      starSystem: "A",
      systemAddress: 1,
      starClass: "K",
      at: "",
      arrived: false,
      source: "route",
    },
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

  it("gives the app every field, with each candidate's habitat detail left out and a ref to fetch it", () => {
    const s = snap();
    const withDetail = { stats: [{ id: "a" }], atmosphereClimateStats: [], compositionGroups: [] };
    (s.bodies[0]!.matches[0] as unknown as Record<string, unknown>).exomasteryDetail = withDetail;
    (s.bodies[0]!.matches[0] as unknown as Record<string, unknown>).exomasteryVarietyHints = [{ big: 1 }];
    const out = slimSnapshotForChannel(s, "app") as AppSnapshot;
    expect(Object.keys(out).sort()).toEqual(Object.keys(s).sort());
    expect(out.journalSystems).toBe(s.journalSystems);
    const m = out.bodies[0]!.matches[0]! as unknown as Record<string, unknown>;
    expect(m.exomasteryDetail).toBeUndefined();
    expect(m.exomasteryVarietyHints).toBeUndefined();
    expect(m.lazyDetail).toMatchObject({ body: "1:2", habitat: true, otherCards: 0 });
    expect(m.priceCredits).toBe(2_000_000);
    // A detail with nothing to draw is dropped without a marker (the card shows no modal button).
    const m2 = out.bodies[1]!.matches[0]! as unknown as Record<string, unknown>;
    expect(m2.exomasteryDetail).toBeUndefined();
    expect(m2.lazyDetail).toBeUndefined();
    // The marker changes when only the left-out detail does.
    (s.bodies[0]!.matches[0] as unknown as Record<string, unknown>).exomasteryVarietyHints = [{ big: 2 }];
    const again = slimSnapshotForChannel(s, "app") as AppSnapshot;
    const v = (x: AppSnapshot) => (x.bodies[0]!.matches[0]!.lazyDetail as { v: string }).v;
    expect(v(again)).not.toBe(v(out));
    // The snapshot itself is not touched: the endpoint reads the detail from it.
    expect(s.bodies[0]!.matches[0]!.exomasteryDetail).toBe(withDetail);
    expect(findMatchDetail(s, "1:2", "x_1")?.exomasteryDetail).toBe(withDetail);
    expect(findMatchDetail(s, "1:2", "nope")).toBeNull();
    expect(findMatchDetail(s, "9:9", "x_1")).toBeNull();
  });

  it("gives the launcher its five fields and nothing heavy", () => {
    const out = slimSnapshotForChannel(snap(), "launcher") as unknown as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      [
        "journalBoot",
        "journalDir",
        "journalDirConfiguredOk",
        "journalFileCount",
        "lastJournalEventIso",
        "port",
      ].sort(),
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

  it("carries the rarity tier and the new-codex mark to the HUD rows, and no more of them", () => {
    const b = body("1:2");
    const m = b.matches[0] as unknown as Record<string, unknown>;
    (m.entry as Record<string, unknown>).rarity = { tier: "epic", systems: 3000, share: 0.004 };
    m.regionRarity = { region: "Inner Orion Spur", found: true, tier: "rare", count: 12, share: 0.02 };
    m.codexNew = true;
    const slim = slimBodyForHud(b).matches![0]! as unknown as Record<string, unknown>;
    expect((slim.entry as Record<string, unknown>).rarity).toEqual({ tier: "epic" });
    expect(slim.regionRarity).toEqual({ region: "Inner Orion Spur", found: true, tier: "rare" });
    expect(slim.codexNew).toBe(true);
  });

  it("slims a body far below its full size", () => {
    const full = JSON.stringify(body("1:2")).length;
    const slim = JSON.stringify(slimBodyForHud(body("1:2"))).length;
    expect(slim).toBeLessThan(full * 0.6);
  });
});
