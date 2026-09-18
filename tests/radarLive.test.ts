// @vitest-environment jsdom
/**
 * The radar draws each fix exactly, and the metres readout counts.
 *
 * Both halves are the owner's decision after trying the alternative, so they are pinned rather than
 * merely implemented.
 *
 * The radar **did** tween, briefly. Polling faster had not fixed the chop — each read of
 * `Status.json` is one position, so it jumped once per fix however short the interval — so drawing
 * was decoupled from data and walked to each fix across the gap. He did not want it: dots drifting
 * toward and away read as the ground moving, and a tween is a frame of latency bought with a frame
 * of fiction. It is unnecessary now that `Status.json` is watched rather than polled, so fixes
 * arrive at Elite's own ~150 ms cadence, within milliseconds of the write.
 *
 * The **number** is the opposite case and he asked for the opposite treatment. Nobody reads "312 m"
 * as a claim about an instant, so counting between two real figures invents nothing, while a
 * readout lurching in eight-metre steps is genuinely harder to read.
 *
 * So: position is never interpolated, the figure beside it always is.
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

const frame = (northM: number, headingDeg = 0) => ({
  radiusM: 500,
  headingDeg,
  minSampleDistanceM: 500,
  marks: [{ kind: "sample", label: "Stratum tectonicas", active: true, northM, eastM: 0, distanceM: northM }],
});

const overlay = (northM: number, headingDeg = 0) => ({
  visible: true,
  phase: "sampling",
  speciesDisplay: "Stratum tectonicas",
  minSampleDistanceM: 500,
  distToFirstM: northM,
  sampleCount: 1,
  minimap: frame(northM, headingDeg),
});

/** The sample's plotted y in SVG units. North is up, so it is negative. 100 units = 500 m. */
function sampleY(root: HTMLElement): number | null {
  const el = root.querySelector(".minimap-sample");
  const m = /translate\([-\d.]+,([-\d.]+)\)/.exec(el?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

function worldRotation(root: HTMLElement): number | null {
  const g = root.querySelector(".mm-world > g");
  const m = /rotate\(([-\d.]+)\)/.exec(g?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

const d1 = (root: HTMLElement) => root.querySelector('[data-f="d1"]')?.textContent ?? "";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let HUD: HudApi;
let root: HTMLElement;

beforeEach(() => {
  HUD = loadHud();
  root = HUD.mount(["distance"], { noTimers: true });
});

describe("the radar", () => {
  it("puts a dot exactly where the fix says, on the very first frame", () => {
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    expect(sampleY(root)).toBeCloseTo(-40, 2); // 200 m of a 500 m radius
  });

  it("moves the dot to the new fix immediately, with nothing in between", async () => {
    /*
      The pinned decision. A tween would leave the dot short of its target for a frame or two; the
      owner asked for the ground to stay still and the position to be the real one.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    await wait(30);
    HUD.renderExoLive({ exoOrganicOverlay: overlay(100), exoMinimap: frame(100) });

    expect(sampleY(root)).toBeCloseTo(-20, 2);
  });

  it("rotates to the new heading immediately too", async () => {
    // He stays centred with his arrow up, so north and the dots turn around him — at once, not into it.
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200, 0), exoMinimap: frame(200, 0) });
    await wait(30);
    HUD.renderExoLive({ exoOrganicOverlay: overlay(200, 90), exoMinimap: frame(200, 90) });

    expect(worldRotation(root)).toBeCloseTo(-90, 2);
  });
});

describe("the metres readout", () => {
  it("snaps to its first figure rather than counting up from nothing", () => {
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    expect(d1(root)).toBe("200 m");
  });

  it("counts toward the new figure instead of jumping to it", async () => {
    /*
      Polled rather than sampled once. The count runs on animation frames, and under a loaded test
      run jsdom can take longer than one frame to deliver the first — a single 16 ms look made this
      fail in the full suite while passing on its own. Catching *any* intermediate value is the real
      claim: a snap would never produce one.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    HUD.renderExoLive({ exoOrganicOverlay: overlay(160), exoMinimap: frame(160) });

    let intermediate: number | null = null;
    for (let i = 0; i < 40 && intermediate == null; i += 1) {
      await wait(4);
      const shown = Number(/(\d+)/.exec(d1(root))?.[1]);
      if (shown < 200 && shown > 160) intermediate = shown;
    }
    expect(intermediate, "the readout jumped straight to the new figure").not.toBeNull();
  });

  it("arrives at the figure and stops there", async () => {
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    HUD.renderExoLive({ exoOrganicOverlay: overlay(160), exoMinimap: frame(160) });
    await wait(400);

    expect(d1(root)).toBe("160 m");
  });

  it("snaps across a jump too large to be a walk", async () => {
    /*
      Switching body, or a row coming back from "—", is not movement. Counting through it would be
      a lie with an animation on top — and at walking pace nobody covers 250 m between two fixes.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    HUD.renderExoLive({ exoOrganicOverlay: overlay(1400), exoMinimap: frame(1400) });

    expect(d1(root)).toBe("1400 m");
  });
});
