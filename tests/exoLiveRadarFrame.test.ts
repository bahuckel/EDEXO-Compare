// @vitest-environment jsdom
/**
 * The radar's own frame.
 *
 * The owner reported the sample radar still being choppy after dropping the `Status.json` poll rate
 * as low as it goes, and the poll was never the limit. The radar arrived only inside the full
 * snapshot push, which is coalesced at `PUSH_WINDOW_MS = 250` — so it could not update more than
 * four times a second whatever the poll was set to, and each of those four rebuilt the entire
 * snapshot to deliver two fields.
 *
 * `ExoLiveDTO` carries exactly what the radar draws, is built straight off the store, and is sent
 * on every poll. What is worth pinning is the part that is easy to lose later:
 *
 *  - it must re-render the radar **without** a snapshot, because there is no snapshot in the frame;
 *  - it must re-render **only** the radar, or ten frames a second rebuild the candidate list and
 *    the FSS table for data that did not change — which would cost more than the chop it fixes;
 *  - it must not disturb the rest of the last snapshot, since the next full push may be 250 ms away
 *    and everything else on screen is still being read from it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type HudApi = {
  mount: (names: string[], opts?: { noTimers?: boolean }) => HTMLElement;
  render: (d: unknown) => void;
  renderExoLive: (live: unknown) => void;
  lastSnapshot?: Record<string, unknown>;
  /** The section implementations, so a test can count which of them a frame ran. */
  sectionImpls?: Record<string, { render: (d: unknown, el: HTMLElement) => unknown }>;
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

/**
 * A surface position with one plant already taken, which is all the radar needs to draw.
 *
 * `northM`/`eastM` are the field names the renderer actually reads. An earlier version of this
 * helper invented `xM`/`yM`, so every mark drew at the origin and the radar assertions below were
 * really only watching the distance text change.
 */
const minimap = (youAheadM: number) => ({
  radiusM: 500,
  headingDeg: 0,
  minSampleDistanceM: 500,
  marks: [
    { kind: "sample", label: "Scan 1", active: true, northM: youAheadM, eastM: 0, distanceM: youAheadM },
  ],
});

/** Where the sample dot is plotted, which is what "the radar redrew" has to mean. */
function sampleY(root: HTMLElement): number | null {
  const el = root.querySelector(".minimap-sample");
  const m = /translate\([-\d.]+,([-\d.]+)\)/.exec(el?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : null;
}

const overlay = (distToFirstM: number) => ({
  visible: true,
  phase: "sampling",
  speciesDisplay: "Stratum tectonicas",
  minSampleDistanceM: 500,
  distToFirstM,
  sampleCount: 1,
  minimap: minimap(distToFirstM),
});

describe("the radar's own frame", () => {
  it("redraws the radar from a frame that carries no snapshot", () => {
    const HUD = loadHud();
    const root = HUD.mount(["distance"], { noTimers: true });
    HUD.render({ port: 7111, exoOrganicOverlay: overlay(120), exoMinimap: minimap(120) });
    const first = root.innerHTML;

    HUD.renderExoLive({ exoOrganicOverlay: overlay(340), exoMinimap: minimap(340) });
    expect(root.innerHTML).not.toBe(first);
    // The dot itself moved: 120 m -> 340 m of a 500 m radius, so -24 -> -68 in plot units.
    expect(sampleY(root)).toBeCloseTo(-68, 1);
  });

  it("leaves the rest of the last snapshot alone", () => {
    /*
      The next full push may be a quarter of a second away and every other section is still reading
      the snapshot this frame is being merged into. Replacing it wholesale would blank them.
    */
    const HUD = loadHud();
    HUD.mount(["distance"], { noTimers: true });
    HUD.render({
      port: 7111,
      currentRegion: "Inner Orion Spur",
      dScanBodies: [{ bodyName: "A 1" }],
      exoOrganicOverlay: overlay(120),
      exoMinimap: minimap(120),
    });

    HUD.renderExoLive({ exoOrganicOverlay: overlay(340), exoMinimap: minimap(340) });
    expect(HUD.lastSnapshot?.currentRegion).toBe("Inner Orion Spur");
    expect(HUD.lastSnapshot?.dScanBodies).toEqual([{ bodyName: "A 1" }]);
    expect(HUD.lastSnapshot?.port).toBe(7111);
  });

  it("only touches the section that draws the radar", () => {
    /*
      Mounted with the candidate list beside the tracker: at a 100 ms poll this runs ten times a
      second, and re-rendering every section would rebuild that whole table each time for data the
      frame does not even contain.
    */
    const HUD = loadHud();
    const root = HUD.mount(["candidates", "distance"], { noTimers: true });
    HUD.render({
      port: 7111,
      exoOverlayFocusBodyKey: "b1",
      exoOverlayFocusBody: {
        state: {
          key: "b1",
          bodyName: "A 1 a",
          biologicalSignals: 3,
          dssComplete: true,
          organicGenusLocks: [],
        },
        tabLabel: "A 1 a",
        genusLikelihoods: [{ genus: "Stratum" }],
        matches: [
          { entry: { genus: "Stratum", displayName: "Stratum tectonicas" }, priceCredits: 19_010_800 },
        ],
      },
      exoOrganicOverlay: overlay(120),
      exoMinimap: minimap(120),
    });

    /*
      Counting the calls, because the DOM cannot answer this. Two earlier versions of this test
      compared the section's markup and then planted a sentinel node in it, and both passed with
      the fix reverted: the candidate data is identical between these two frames, so re-rendering
      that section produces the same markup, and it patches fields rather than rebuilding, so the
      sentinel survived as well. Only the call itself distinguishes the two behaviours.
    */
    const impls = HUD.sectionImpls!;
    const real = impls.candidates.render;
    let calls = 0;
    impls.candidates.render = (d: unknown, el: HTMLElement) => {
      calls += 1;
      return real(d, el);
    };

    HUD.renderExoLive({ exoOrganicOverlay: overlay(340), exoMinimap: minimap(340) });
    impls.candidates.render = real;
    expect(calls, "a radar frame re-rendered the candidate list").toBe(0);
  });

  it("does nothing before the first snapshot, rather than rendering half a HUD", () => {
    /*
      A socket can deliver one of these before the first state frame — the poll that produces them
      runs on its own clock. There is nothing to merge into yet, and guessing an empty snapshot
      would blank every other section.
    */
    const HUD = loadHud();
    const root = HUD.mount(["distance"], { noTimers: true });
    const before = root.innerHTML;
    expect(() =>
      HUD.renderExoLive({ exoOrganicOverlay: overlay(340), exoMinimap: minimap(340) }),
    ).not.toThrow();
    expect(root.innerHTML).toBe(before);
  });
});
