// @vitest-environment jsdom
/**
 * The radar moves between fixes instead of snapping to them.
 *
 * Raising the `Status.json` poll rate was never going to fix the chop, and this is the reason:
 * each read is one position, so the radar redrew four to ten times a second and jumped each time.
 * Ten discrete jumps a second is still ten jumps — and Elite only rewrites the file about every
 * 150 ms, so no interval exists at which snapping looks continuous.
 *
 * Drawing is therefore decoupled from data: each fix is a target, and the radar walks to it across
 * the measured gap at animation-frame rate. The cost is one interval of latency, which is invisible
 * for a plant hundreds of metres away, and the gain is motion that looks like motion.
 *
 * What is pinned here is the part that would be easy to "optimise" back into snapping, plus the two
 * cases where interpolating would be *wrong*: a brand-new mark, and a heading that crosses north.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
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

/** One sample due north at `northM`, with the commander facing `headingDeg`. */
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

/** The rotation the world layer is drawn at, which is what a turning commander sees move. */
function worldRotation(root: HTMLElement): number | null {
  const g = root.querySelector(".mm-world > g");
  const m = /rotate\(([-\d.]+)\)/.exec(g?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

/** The sample's plotted y, in the SVG's own units. North is up, so this is negative. */
function sampleY(root: HTMLElement): number | null {
  const el = root.querySelector(".minimap-sample");
  const m = /translate\([-\d.]+,([-\d.]+)\)/.exec(el?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

let HUD: HudApi;
let root: HTMLElement;

beforeEach(() => {
  vi.useRealTimers();
  HUD = loadHud();
  root = HUD.mount(["distance"], { noTimers: true });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the radar tween", () => {
  it("draws the first fix exactly, with nothing to move from", async () => {
    // There is no previous position to walk from, so the first frame must be the truth, not a blend.
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    expect(sampleY(root)).toBeCloseTo(-40, 1); // 200 m at 100 units / 500 m
  });

  it("does not jump straight to the next fix", async () => {
    /*
      The whole feature. After a second fix arrives the radar must be somewhere between the two,
      not already at the new one — that is the difference between motion and chop.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    await new Promise((r) => setTimeout(r, 40));
    HUD.renderExoLive({ exoOrganicOverlay: overlay(100), exoMinimap: frame(100) });
    await tick();

    const y = sampleY(root)!;
    // -40 was the old position, -20 is the new one. Part-way means strictly between.
    expect(y).toBeLessThan(-20);
    expect(y).toBeGreaterThan(-40.001);
  });

  it("arrives at the target and stops there", async () => {
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    await new Promise((r) => setTimeout(r, 40));
    HUD.renderExoLive({ exoOrganicOverlay: overlay(100), exoMinimap: frame(100) });
    await new Promise((r) => setTimeout(r, 400));

    expect(sampleY(root)).toBeCloseTo(-20, 1);
  });

  it("turns the short way past north", async () => {
    /*
      350 degrees to 10 is a twenty-degree turn of the head. Interpolating the raw numbers would
      spin the entire radar 340 degrees the other way, which is worse than the chop it replaced.
      The world layer is rotated by -heading, so the values seen here are negated.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200, 350), exoMinimap: frame(200, 350) });
    await new Promise((r) => setTimeout(r, 40));
    HUD.renderExoLive({ exoOrganicOverlay: overlay(200, 10), exoMinimap: frame(200, 10) });
    await tick();

    const rot = worldRotation(root)!;
    // Heading walks 350 -> 360/0 -> 10, so -heading stays within the -350..-10 corridor near north.
    expect(Math.abs(rot)).toBeLessThan(351);
    expect(Math.abs(rot)).toBeGreaterThan(9);
  });

  it("puts a newly sampled plant straight at its real position", async () => {
    /*
      A new mark has no previous position. Sliding it in from wherever some other mark was would
      animate a journey the plant never made — it was always there, the commander just scanned it.
    */
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(200), exoMinimap: frame(200) });
    await new Promise((r) => setTimeout(r, 40));

    const two = frame(200);
    two.marks.push({
      kind: "sample",
      label: "Bacterium aurasus",
      active: false,
      northM: 0,
      eastM: 250,
      distanceM: 250,
    });
    HUD.renderExoLive({ exoOrganicOverlay: { ...overlay(200), minimap: two }, exoMinimap: two });
    await tick();

    const marks = [...root.querySelectorAll(".minimap-sample")];
    const xs = marks.map((el) => {
      const m = /translate\(([-\d.]+),/.exec(el.getAttribute("transform") ?? "");
      return m ? Number(m[1]) : NaN;
    });
    // 250 m east at 100 units / 500 m = +50, exactly, on its very first frame.
    expect(xs.some((x) => Math.abs(x - 50) < 0.51)).toBe(true);
  });
});
