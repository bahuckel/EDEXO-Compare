/**
 * The nudge research (owner, 2026-10-08): which gas giants to photograph (shared/gggNudge.ts) and the
 * log that keeps the scans and the screenshots, only where `ggg-research.on` is (server/gggResearch.ts).
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bandsText, nudgeLook, photoReason, REFERENCES_PER_CLASS } from "../src/shared/gggNudge.js";
import {
  createGggResearch,
  GGG_RESEARCH_FLAG,
  GGG_RESEARCH_LOG,
  type GggResearchNotice,
} from "../src/server/gggResearch.js";

const C2 = "Sudarsky class II gas giant";
const C3 = "Sudarsky class III gas giant";
// 300 Earth masses, 70,000 km: about 1,250 kg/m³, dense enough for the ceiling.
const giant = { massEM: 300, radiusM: 7e7 };

describe("which gas giants show the nudge", () => {
  it("a cold class II: three cold-band layers if not nudged, none if nudged — always worth a photo", () => {
    const look = nudgeLook({ planetClass: C2, tempK: 160.123, ...giant })!;
    expect(look.nudge).toBe("always");
    expect(bandsText(look.cls, look.bandsShown)).toBe("3× 114–210 K, 3× 210–270 K, 1× 270–370 K");
    // Nudged (bottom moved to 250–280 K): no layer below 210 K.
    for (const p of look.bandsNudged) expect(p.bands.every((b) => b >= 2)).toBe(true);
    expect(look.changedMin).toBeGreaterThanOrEqual(3);
    expect(photoReason(look, 0)).toBe("always");
  });

  it("a cold class III: its 270–370 K layers go if nudged", () => {
    const look = nudgeLook({ planetClass: C3, tempK: 266.14, ...giant })!;
    expect(bandsText(look.cls, look.bandsShown)).toBe("1× 210–270 K, 3× 270–370 K, 3× 370–700 K");
    expect(look.changedMin).toBe(4);
    expect(photoReason(look, 0)).toBe("always");
  });

  it("a maybe-range giant whose layers can change, and references until there are enough of the class", () => {
    const maybe = nudgeLook({
      planetClass: "Gas giant with ammonia based life",
      tempK: 107.55,
      massEM: 300,
      radiusM: 6.2e7,
    })!;
    expect(maybe.nudge).toBe("maybe");
    expect(maybe.changedMax).toBeGreaterThanOrEqual(2);
    expect(photoReason(maybe, 0)).toBe("maybe");
    const ref = nudgeLook({ planetClass: C3, tempK: 532.27, ...giant })!;
    expect(ref.nudge).toBe("none");
    expect(photoReason(ref, REFERENCES_PER_CLASS - 1)).toBe("reference");
    expect(photoReason(ref, REFERENCES_PER_CLASS)).toBeNull();
    // Not a giant, or no mass: nothing to say.
    expect(nudgeLook({ planetClass: "Icy body", tempK: 100, ...giant })).toBeNull();
    expect(nudgeLook({ planetClass: C2, tempK: 160, massEM: null, radiusM: null })).toBeNull();
  });
});

describe("the research log", () => {
  const scan = (over: Record<string, unknown> = {}) => ({
    timestamp: "2026-10-08T12:00:00Z",
    event: "Scan",
    ScanType: "Detailed",
    BodyName: "Phooe Chraei CI-D c12-1 A 3",
    BodyID: 7,
    StarSystem: "Phooe Chraei CI-D c12-1",
    SystemAddress: 123456,
    PlanetClass: C2,
    SurfaceTemperature: 167.17,
    MassEM: 300,
    Radius: 7e7,
    ...over,
  });
  function setup(on: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "ggg-research-"));
    if (on) writeFileSync(join(dir, GGG_RESEARCH_FLAG), "");
    const sent: GggResearchNotice[] = [];
    const r = createGggResearch({ dir, notify: (n) => (sent.push(n), true) });
    const rows = () =>
      existsSync(join(dir, GGG_RESEARCH_LOG))
        ? readFileSync(join(dir, GGG_RESEARCH_LOG), "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        : [];
    return { r, sent, rows, dir };
  }

  it("does nothing without the flag file", () => {
    const { r, sent, rows } = setup(false);
    expect(r.observe(scan())).toBe(false);
    expect(sent).toEqual([]);
    expect(rows()).toEqual([]);
  });

  it("logs the scan with its layers, sends one notice per body, and matches the screenshot to it", () => {
    const { r, sent, rows } = setup(true);
    expect(r.observe(scan())).toBe(true);
    expect(r.observe(scan())).toBe(false); // the same body again
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ bodyKey: "123456:7", body: "A 3", system: "Phooe Chraei CI-D c12-1" });
    expect(sent[0]!.title).toMatch(/nudge test/);
    expect(sent[0]!.text).toMatch(
      /Not nudged its layers would be 3× 114–210 K, 3× 210–270 K, 1× 270–370 K; nudged/,
    );
    r.observe({
      timestamp: "2026-10-08T12:00:05Z",
      event: "Scan",
      ScanType: "AutoScan",
      StarType: "K",
      BodyName: "Phooe Chraei CI-D c12-1 A",
      BodyID: 1,
      StarSystem: "Phooe Chraei CI-D c12-1",
      SystemAddress: 123456,
    });
    r.observe({
      timestamp: "2026-10-08T12:03:00Z",
      event: "Screenshot",
      Filename: "\\ED_Pictures\\Screenshot_0007.bmp",
      System: "Phooe Chraei CI-D c12-1",
      Body: "Phooe Chraei CI-D c12-1 A 3",
    });
    r.observe({
      timestamp: "2026-10-08T12:04:00Z",
      event: "Screenshot",
      Filename: "\\ED_Pictures\\Screenshot_0008.bmp",
      System: "Phooe Chraei CI-D c12-1",
    });
    const [g, star, photo, loose] = rows();
    expect(g).toMatchObject({
      type: "giant",
      bodyKey: "123456:7",
      cls: "II",
      nudge: "always",
      reason: "always",
    });
    expect((g!.line as Record<string, unknown>).SurfaceTemperature).toBe(167.17);
    expect(star).toMatchObject({ type: "star" });
    expect(photo).toMatchObject({
      type: "photo",
      file: "\\ED_Pictures\\Screenshot_0007.bmp",
      bodyKey: "123456:7",
      reason: "always",
    });
    expect(loose).toMatchObject({ type: "photo", bodyKey: null });
  });

  it("asks for references of a class until there are enough, also across restarts", () => {
    const { r, sent, dir } = setup(true);
    const ref = (i: number) =>
      scan({ BodyID: 100 + i, BodyName: `Ref ${i}`, PlanetClass: C3, SurfaceTemperature: 532.27 + i / 10 });
    for (let i = 0; i < REFERENCES_PER_CLASS + 3; i++) r.observe(ref(i));
    expect(sent.filter((n) => /reference/.test(n.title))).toHaveLength(REFERENCES_PER_CLASS);
    // The next start reads the log: enough class III references already, and a logged body stays logged.
    const later: GggResearchNotice[] = [];
    const again = createGggResearch({ dir, notify: (n) => (later.push(n), true) });
    again.observe(ref(50));
    again.observe(scan());
    expect(later.map((n) => n.title)).toEqual([expect.stringMatching(/nudge test/)]);
    again.observe(scan());
    expect(later).toHaveLength(1);
  });
});
