// @vitest-environment jsdom
/**
 * The radar continues the commander's motion between fixes.
 *
 * `Status.json` is the only source of a position and it changes about **0.33 times a second** —
 * measured while running and turning on foot, median gap 3.0 s. It is already read within
 * milliseconds of each write, so nothing on this side makes it arrive sooner, and a radar drawn
 * straight from it steps once every three seconds.
 *
 * A tween was tried first and removed. It walked from the old fix to the new one, which is smooth
 * and *backwards*: it shows where he was up to three seconds ago, and the dots drift toward him as
 * it catches up. Prediction is the opposite sign of error — it shows where he is, estimated, and
 * the dots hold still relative to the ground while he moves through them.
 *
 * The direction is the whole point, so the first test asserts it: after a fix, a dot the commander
 * is walking toward must get **closer**, not stay put and not drift away. The rest are the bounds
 * that stop an estimate becoming a fiction.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type HudApi = {
  mount: (names: string[], opts?: { noTimers?: boolean }) => HTMLElement;
  render: (d: unknown) => void;
  renderExoLive: (live: unknown) => void;
};

function loadHud(): HudApi {
  document.body.innerHTML =
    '<div class="shell" id="shell"><div class="panel" id="card"><div class="panel__body" id="hud"></div></div></div>';
  const src = readFileSync(path.resolve(__dirname, "../public/hud.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", "location", src)(
    window,
    document,
    window.localStorage,
    window.location,
  );
  return (window as unknown as { HUD: HudApi }).HUD;
}

type Mark = {
  kind: string;
  label: string;
  active?: boolean;
  northM: number;
  eastM: number;
  distanceM: number;
};

const mk = (label: string, northM: number, eastM = 0): Mark => ({
  kind: "sample",
  label,
  active: label === "Scan 1",
  northM,
  eastM,
  distanceM: Math.sqrt(northM * northM + eastM * eastM),
});

const frame = (marks: Mark[], headingDeg = 0) => ({
  radiusM: 500,
  headingDeg,
  minSampleDistanceM: 500,
  marks,
});

const payload = (marks: Mark[], headingDeg = 0) => ({
  exoOrganicOverlay: {
    visible: true,
    phase: "sampling",
    speciesDisplay: "Stratum tectonicas",
    minSampleDistanceM: 500,
    distToFirstM: marks[0]?.distanceM ?? null,
    sampleCount: 1,
    nearestSampleMeetsMin: true,
    minimap: frame(marks, headingDeg),
  },
  exoMinimap: frame(marks, headingDeg),
});

/** The plotted y of a named mark, in SVG units. North is up, so nearer-ahead is less negative. */
function markY(root: HTMLElement, label: string): number | null {
  for (const el of [...root.querySelectorAll(".minimap-sample")]) {
    if (el.querySelector("title")?.textContent?.startsWith(label)) {
      const m = /translate\([-\d.]+,([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
      return m ? Number(m[1]) : null;
    }
  }
  return null;
}

function worldRotation(root: HTMLElement): number | null {
  const g = root.querySelector(".mm-world > g");
  const m = /rotate\(([-\d.]+)\)/.exec(g?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let HUD: HudApi;
let root: HTMLElement;

beforeEach(() => {
  HUD = loadHud();
  root = HUD.mount(["distance"], { noTimers: true });
});

describe("the marks hold still between fixes", () => {
  it("draws each fix exactly and then leaves it alone", async () => {
    /*
      THE OWNER'S REPORT, 2026-09-21: "the radar dots keep drifting away when I move — make them
      fixed in place and updated dynamically without drifting."

      The radar used to continue his motion between fixes. That is right while he walks in a straight
      line and wrong the rest of the time: position was predicted and heading deliberately was not,
      so turning while walking pushed the dots along his old bearing and every fix snapped them back.

      Now a fix is drawn where it says and stays there until the next one.
    */
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));

    const atFix = markY(root, "Scan 1")!;
    expect(atFix).toBeCloseTo(-32, 1); // 160 m of a 500 m radius, drawn exactly on arrival
    await wait(120);
    expect(markY(root, "Scan 1"), "the dot must not move between fixes").toBeCloseTo(atFix, 3);
  });

  it("moves the moment a new fix says so", async () => {
    // Fixed in place is not frozen: each fix updates the marks exactly.
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));
    const near = markY(root, "Scan 1")!;
    HUD.renderExoLive(payload([mk("Scan 1", 120)]));
    expect(markY(root, "Scan 1"), "a new fix must be drawn at once").toBeGreaterThan(near);
  });

  it("does not move when the panel re-renders the same fix", async () => {
    /*
      The bug the first version shipped with, and the reason it did nothing in the real app while
      every other test here passed.

      The tracker section re-renders on every snapshot push, several times a second, handing over
      the *same* minimap each time. Those repeats were treated as fresh fixes: `motionBetween`
      measured zero movement between two identical frames, cleared the velocity and stopped the
      prediction from ever starting. Only a change of position is a fix; a repeat must be left to
      carry on.
    */
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));
    const atFix = markY(root, "Scan 1")!;

    // Four re-renders of the very same fix, as the snapshot push does.
    for (let i = 0; i < 4; i += 1) {
      await wait(30);
      HUD.renderExoLive(payload([mk("Scan 1", 160)]));
    }

    expect(markY(root, "Scan 1"), "a repeat of one fix is not new information").toBeCloseTo(atFix, 3);
  });

  it("holds the last fix however long the game stays quiet", async () => {
    /*
      `Status.json` can go quiet for a long time — a menu, a pause, a cutscene. The marks stay where
      the last fix put them for as long as that lasts, rather than sailing off the map.
    */
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(250);
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));

    const settled = markY(root, "Scan 1")!;
    await wait(700);
    expect(markY(root, "Scan 1"), "silence must not move anything").toBeCloseTo(settled, 3);
  });

  it("does not drift when the commander is standing still", async () => {
    // Two identical fixes mean no velocity. Predicting jitter into a stationary radar is worse
    // than the stepping it was meant to cure.
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 200)]));

    const atFix = markY(root, "Scan 1")!;
    await wait(150);
    expect(markY(root, "Scan 1")).toBeCloseTo(atFix, 3);
  });

  it("draws a newly sampled plant where the fix puts it, and leaves it there too", async () => {
    // Every mark is world-fixed and none of them is animated, so a plant seen for the first time
    // behaves exactly like the ones already on screen.
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160), mk("Scan 2", 300)]));

    const atFix = markY(root, "Scan 2")!;
    await wait(120);
    expect(markY(root, "Scan 2")).toBeCloseTo(atFix, 3);
  });

  it("never predicts the heading, so the radar stops turning when the commander does", async () => {
    /*
      The owner's report: "flick the mouse and the radar keeps turning" — it did, and capping the
      predicted turn at the observed one could never fix it, because half of a flick that is over is
      still a turn that is not happening.

      Position is worth predicting because walking is continuous. Mouse-look is not: it starts and
      stops instantly, so the angle between two fixes three seconds apart describes a flick that has
      already finished. And because the world layer rotates about the commander, a heading that
      keeps creeping swings every dot with it — which is why this also read as the dots drifting
      while walking in a straight line.
    */
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)], 0) });
    await wait(250);
    HUD.renderExoLive(payload([mk("Scan 1", 200)], 20));

    const atFix = worldRotation(root)!;
    expect(atFix).toBeCloseTo(-20, 2); // the world is rotated by -heading
    await wait(600);
    expect(worldRotation(root), "the radar kept turning after the fix").toBeCloseTo(-20, 2);
  });

  it("holds the compass as still as the marks", async () => {
    /*
      Heading was never predicted even when position was, and the reason it was not is now the reason
      position is not either: a turn between two fixes is a flick that already finished, and carrying
      it forward keeps the radar rotating after the commander has stopped. Both are simply drawn as
      they arrive.
    */
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)], 45) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160)], 60));

    const rot = worldRotation(root)!;
    const atFix = markY(root, "Scan 1")!;
    await wait(150);
    expect(worldRotation(root)).toBeCloseTo(rot, 2);
    expect(markY(root, "Scan 1")).toBeCloseTo(atFix, 3);
  });

  it("takes no velocity from a gap that is not a walking cadence", async () => {
    // A first frame, a pause, a menu: the gap says nothing about speed, so nothing is predicted.
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(20); // shorter than PREDICT_MIN_GAP_MS
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));

    const atFix = markY(root, "Scan 1")!;
    await wait(150);
    expect(markY(root, "Scan 1")).toBeCloseTo(atFix, 3);
  });

  it("draws the newest fix exactly, however far the estimate had wandered", async () => {
    // The fix is the truth and replaces the estimate outright; errors must not accumulate.
    HUD.render({ port: 7111, ...payload([mk("Scan 1", 200)]) });
    await wait(300);
    HUD.renderExoLive(payload([mk("Scan 1", 160)]));
    await wait(200);
    HUD.renderExoLive(payload([mk("Scan 1", 90)]));

    expect(markY(root, "Scan 1")).toBeCloseTo(-18, 1); // 90 m, exactly
  });
});
