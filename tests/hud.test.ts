// @vitest-environment jsdom
/**
 * The HUD overlay logic (public/hud.js) against fake snapshots.
 *
 * hud.js is a plain browser script with all the rendering of the five overlay sections. It is
 * loaded into jsdom here and driven through `HUD.mount` / `HUD.render` with `noTimers`, so nothing
 * polls or opens sockets. These are the rules the owner asked for and the bugs he reported: the
 * unlikely tier hidden unless confirmed, scan progress after the species, the targeted body winning
 * over the current one, the tracker folding away from a surface, the star-class verdicts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type HudApi = {
  mount: (names: string[], opts?: { noTimers?: boolean }) => HTMLElement;
  render: (d: unknown) => void;
  starKind: (cls: string) => { kind: string; label: string };
  SECTIONS: string[];
  /*
    The rest of `public/hud.js`'s surface, as the newer tests drive it. This type is hand-written —
    `hud.js` is a plain browser script loaded through `new Function`, so nothing generates it — and
    it had fallen behind what the file exports, which typechecks as an error while the tests
    themselves pass. Kept loose on purpose: it describes what the tests need, not the whole API.
  */
  readScale: () => number;
  readOpacity: () => number;
  readAlpha?: () => number;
  audioOn: () => boolean;
  /** A hook the page assigns, not a registrar: `hud.js` calls `HUD.onCue(kind)` if it is set. */
  onCue?: (kind: string) => unknown;
  /** Fed the overlay payload each frame; it decides whether a cue has just become due. */
  cueFromOverlay: (eo: unknown) => void;
};

function loadHud(): HudApi {
  document.body.innerHTML =
    '<div class="shell" id="shell"><div class="panel" id="card"><div class="panel__body" id="hud"></div></div></div>';
  const src = readFileSync(path.resolve(__dirname, "../public/hud.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", "location", src)(window, document, window.localStorage, window.location);
  return (window as unknown as { HUD: HudApi }).HUD;
}

const body = (key: string, name: string, matches: unknown[], extra: Record<string, unknown> = {}) => ({
  state: { key, bodyName: name, biologicalSignals: 4, dssComplete: true, organicGenusLocks: [], ...extra },
  tabLabel: name,
  genusLikelihoods: [{ genus: "Stratum" }, { genus: "Tussock" }, { genus: "Bacterium" }],
  matches,
});
const match = (genus: string, species: string, cr: number, extra: Record<string, unknown> = {}) => ({
  entry: { genus, displayName: `${genus} ${species}` },
  priceCredits: cr,
  ...extra,
});

describe("hud.js candidates", () => {
  let HUD: HudApi;
  beforeEach(() => {
    window.localStorage.clear();
    HUD = loadHud();
    HUD.mount(["candidates"], { noTimers: true });
  });

  it("hides the unlikely tier unless something confirmed the species on this body", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      bodies: [
        body("1:2", "A 2", [
          match("Tussock", "propagito", 1_000_000),
          match("Osseus", "discus", 1_000_000, { unlikely: true }),
          match("Stratum", "tectonicas", 19_010_800, { unlikely: true, organicAnalysisComplete: true }),
        ]),
      ],
    });
    const rows = [...document.querySelectorAll(".hud-list li")].map((li) => li.textContent);
    expect(rows.some((t) => t?.includes("Osseus"))).toBe(false);
    expect(rows.some((t) => t?.includes("Stratum Tectonicas"))).toBe(true);
    expect(rows.some((t) => t?.includes("3/3"))).toBe(true);
  });

  it("capitalises the species and shows the live run's progress only for the active species", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      bodies: [body("1:2", "A 2", [match("Tussock", "propagito", 1_000_000), match("Bacterium", "cerbrus", 1_689_800)])],
      exoOrganicOverlay: { visible: true, trackingBodyKey: "1:2", speciesDisplay: "Tussock propagito", sampleCount: 2 },
    });
    const rows = [...document.querySelectorAll(".hud-list li")].map((li) => li.textContent ?? "");
    expect(rows.find((t) => t.includes("Tussock"))).toContain("Tussock Propagito2/3");
    expect(rows.find((t) => t.includes("Bacterium"))).not.toContain("/3");
  });

  it("prefers the targeted body from Status.json and tags it", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      statusDestination: { systemAddress: 1, bodyId: 3, name: "Sys C 3" },
      bodies: [body("1:2", "A 2", [match("Tussock", "propagito", 1)]), body("1:3", "C 3", [match("Fonticulua", "campestris", 5)])],
    });
    expect(document.querySelector('[data-f="body"]')?.textContent).toBe("C 3");
    expect(document.querySelector('[data-f="body"]')?.className).toContain("tgt");
    expect(document.querySelector('[data-f="bodyK"]')?.textContent).toBe("Target body");
    expect(document.querySelector(".hud-list")?.textContent).toContain("Fonticulua");
  });

  it("orders by value when asked", () => {
    window.localStorage.setItem("edexoHudCandOrder", "value");
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      bodies: [body("1:2", "A 2", [match("Stratum", "tectonicas", 100), match("Tussock", "propagito", 5_000_000)])],
    });
    const first = document.querySelector(".hud-list li")?.textContent ?? "";
    expect(first).toContain("Tussock");
  });
});

describe("hud.js tracker", () => {
  let HUD: HudApi;
  beforeEach(() => {
    window.localStorage.clear();
    HUD = loadHud();
    HUD.mount(["distance"], { noTimers: true });
  });

  it("folds away from a surface and unfolds on one", () => {
    HUD.render({ exoOrganicOverlay: null, exoMinimap: null });
    expect(document.querySelector(".trk")?.className).toContain("trk--away");
    expect(document.querySelector(".trk__away")?.className).toContain("trk__away--on");
    HUD.render({ exoOrganicOverlay: null, exoMinimap: { headingDeg: 10, radiusM: 500, minSampleDistanceM: 0, marks: [] } });
    expect(document.querySelector(".trk")?.className).not.toContain("trk--away");
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("On foot");
  });

  it("draws the walk-this-way arc only when the second sample would be too close", () => {
    const mm = {
      headingDeg: 0,
      radiusM: 500,
      minSampleDistanceM: 200,
      marks: [{ kind: "sample", active: true, eastM: 30, northM: 0, distanceM: 30, label: "Tussock" }],
    };
    HUD.render({
      exoMinimap: mm,
      exoOrganicOverlay: { visible: true, phase: "tracking", sampleCount: 1, nearestSampleMeetsMin: false, minSampleDistanceM: 200, distToFirstM: 30, speciesDisplay: "Tussock propagito" },
    });
    expect(document.querySelector(".minimap-hint")).not.toBeNull();
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Too close");
    HUD.render({
      exoMinimap: mm,
      exoOrganicOverlay: { visible: true, phase: "tracking", sampleCount: 1, nearestSampleMeetsMin: true, minSampleDistanceM: 200, distToFirstM: 250, speciesDisplay: "Tussock propagito" },
    });
    expect(document.querySelector(".minimap-hint")).toBeNull();
  });

  /**
   * The OK / LOW pill, on the row for the scan you are about to take.
   *
   * It used to sit against the second scan and against a "Spacing" row that reported the gap between
   * the first two after both were taken — by which point there was nothing left to decide. Hunting
   * for the third plant is the same problem as hunting for the second and had no pill at all, which
   * is what the commander reported.
   */
  describe("the distance pill", () => {
    const pill = (n: string) => (document.querySelector('[data-f="' + n + '"]')?.textContent ?? "").trim();
    const eo = (sampleCount: number, ok: boolean | null) => ({
      exoMinimap: {
        headingDeg: 0,
        radiusM: 500,
        minSampleDistanceM: 200,
        marks: [{ kind: "sample", active: true, eastM: 30, northM: 0, distanceM: 30, label: "Tussock" }],
      },
      exoOrganicOverlay: {
        visible: true,
        phase: "tracking",
        sampleCount,
        nearestSampleMeetsMin: ok,
        minSampleDistanceM: 200,
        distToFirstM: 250,
        distToSecondM: 250,
        speciesDisplay: "Tussock propagito",
      },
    });

    it("sits on scan 2 while there is one plant down", () => {
      HUD.render(eo(1, false));
      expect(pill("pill2")).toBe("LOW");
      expect(pill("pill3")).toBe("");
    });

    it("moves to scan 3 once there are two", () => {
      HUD.render(eo(2, true));
      expect(pill("pill2")).toBe("");
      expect(pill("pill3")).toBe("OK");
    });

    it("goes quiet when the run is done", () => {
      HUD.render(eo(3, true));
      expect(pill("pill2")).toBe("");
      expect(pill("pill3")).toBe("");
    });

    it("has no Spacing row left to put one on", () => {
      HUD.render(eo(2, true));
      expect(document.querySelector('[data-f="span12"]')).toBeNull();
      expect(document.querySelector('[data-f="pillSpan"]')).toBeNull();
    });

    it("warns on the radar while hunting for the third, not only the second", () => {
      HUD.render(eo(2, false));
      expect(document.querySelector(".minimap-hint")).not.toBeNull();
      expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Too close");
    });
  });

  it("keeps the radar's static layer across renders (the sweep must not restart)", () => {
    const mm = { headingDeg: 0, radiusM: 500, minSampleDistanceM: 0, marks: [] };
    HUD.render({ exoMinimap: mm, exoOrganicOverlay: null });
    const sweep = document.querySelector(".minimap-sweep");
    HUD.render({ exoMinimap: { ...mm, headingDeg: 90 }, exoOrganicOverlay: null });
    expect(document.querySelector(".minimap-sweep")).toBe(sweep);
  });
});

describe("hud.js size and opacity", () => {
  it("scales the root font and the panel alpha from the launcher's keys", () => {
    localStorage.setItem("edexoHudScale", "1.5");
    localStorage.setItem("edexoHudOpacity", "0.6");
    const HUD = loadHud();
    HUD.mount(["jump"], { noTimers: true });
    expect(document.documentElement.style.fontSize).toBe("150%");
    // the slider fades the box's own layers (frame + fill) through one variable; the text above stays solid
    expect(document.documentElement.style.getPropertyValue("--hud-bg-opacity")).toBe("0.6");
    expect(document.documentElement.style.getPropertyValue("--hud-bg")).toContain("0.55)"); // 92 % of 0.6
    expect(document.documentElement.style.getPropertyValue("--hud-bg-2")).toContain("0.21)");
    localStorage.setItem("edexoHudScale", "9");
    expect(HUD.readScale()).toBe(2);
    localStorage.removeItem("edexoHudScale");
    localStorage.removeItem("edexoHudOpacity");
    expect(HUD.readScale()).toBe(1);
    expect(HUD.readOpacity()).toBe(0.45);
  });
});

describe("hud.js audio cues", () => {
  it("fires once on the ring clearing and once on the third sample, and stays silent when off", () => {
    const HUD = loadHud();
    const cues: string[] = [];
    HUD.onCue = (k: string) => cues.push(k);
    const eo = (sampleCount: number, meets: boolean | null) => ({
      visible: true,
      bodyKeyOnFoot: "1:2",
      speciesDisplay: "Tubus compagibus",
      sampleCount,
      nearestSampleMeetsMin: meets,
    });
    HUD.cueFromOverlay(eo(1, false));
    HUD.cueFromOverlay(eo(1, false));
    expect(cues).toEqual([]);
    HUD.cueFromOverlay(eo(1, true));
    HUD.cueFromOverlay(eo(1, true));
    expect(cues).toEqual(["clear"]);
    HUD.cueFromOverlay(eo(2, false)); // second sample taken: back inside the ring
    HUD.cueFromOverlay(eo(2, true));
    expect(cues).toEqual(["clear", "clear"]);
    HUD.cueFromOverlay(eo(3, null));
    HUD.cueFromOverlay(eo(3, null));
    expect(cues).toEqual(["clear", "clear", "third"]);
    // a new species starts a new run: no cue for its first frame
    HUD.cueFromOverlay({ ...eo(1, true), speciesDisplay: "Stratum tectonicas" });
    expect(cues).toHaveLength(3);
    expect(HUD.audioOn()).toBe(false);
    localStorage.setItem("edexoHudAudio", "1");
    expect(HUD.audioOn()).toBe(true);
    localStorage.removeItem("edexoHudAudio");
  });
});

describe("hud.js next jump", () => {
  it("classifies star classes the way the owner asked", () => {
    const HUD = loadHud();
    expect(HUD.starKind("G").kind).toBe("scoop");
    expect(HUD.starKind("M").kind).toBe("scoop");
    expect(HUD.starKind("DA").kind).toBe("noscoop");
    expect(HUD.starKind("TTS").kind).toBe("noscoop");
    expect(HUD.starKind("N").kind).toBe("neutron");
    expect(HUD.starKind("H").kind).toBe("hole");
    expect(HUD.starKind("").kind).toBe("unknown");
  });

  it("renders the target and flips to arrived", () => {
    const HUD = loadHud();
    HUD.mount(["jump"], { noTimers: true });
    HUD.render({ jumpTarget: { starSystem: "Traikee GL-S c6-0", starClass: "G", arrived: false } });
    expect(document.querySelector('[data-f="sys"]')?.textContent).toBe("Traikee GL-S c6-0");
    expect(document.querySelector(".jump")?.className).toContain("jump--scoop");
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Jumping");
    HUD.render({ jumpTarget: { starSystem: "Traikee GL-S c6-0", starClass: "H", arrived: true } });
    expect(document.querySelector(".jump")?.className).toContain("jump--hole");
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Arrived");
  });

  it("draws the route strip with the refuel pump on the nearest scoop", () => {
    const HUD = loadHud();
    HUD.mount(["jump"], { noTimers: true });
    const ahead = [
      { starSystem: "A", starClass: "K", scoopable: true, refuel: "none" },
      { starSystem: "B", starClass: "M", scoopable: true, refuel: "yellow" },
      { starSystem: "C", starClass: "F", scoopable: true, refuel: "none" },
      { starSystem: "D", starClass: "T", scoopable: false, refuel: "none" },
      { starSystem: "E", starClass: "N", scoopable: false, refuel: "none" },
    ];
    HUD.render({
      jumpTarget: { starSystem: "A", starClass: "K", arrived: false, source: "route" },
      liveShipFuelRange: { navRoute: { ahead, refuelInHops: 2, refuelLevel: "yellow" } },
    });
    const hops = [...document.querySelectorAll(".hop")];
    expect(hops.map((h) => h.textContent)).toEqual(["K", "M", "F", "T", "N"]);
    expect(hops[3]?.className).toContain("hop--noscoop");
    expect(hops[4]?.className).toContain("hop--neutron");
    expect(document.querySelectorAll(".hop__fuel--yellow")).toHaveLength(1);
    expect(hops[1]?.querySelector(".hop__fuel")).not.toBeNull();

    HUD.render({ jumpTarget: null, liveShipFuelRange: { navRoute: { ahead: [], refuelInHops: null, refuelLevel: "none" } } });
    expect((document.querySelector('[data-f="route"]') as HTMLElement).hidden).toBe(true);
  });
});

describe("hud.js merged panel", () => {
  it("mounts sections in the order given (the owner's stack order) and retints only the finished one", () => {
    const HUD = loadHud();
    HUD.mount(["distance", "jump", "fss", "jump", "bogus"], { noTimers: true });
    const secs = [...document.querySelectorAll(".hud-section")].map((s) => s.getAttribute("data-section"));
    expect(secs).toEqual(["distance", "jump", "fss"]);
    HUD.render({ dScanBodies: { systemName: "X", found: 5, total: 5, complete: true }, exoMinimap: null });
    expect(document.querySelector('[data-section="fss"]')?.className).toContain("hud-section--ok");
    expect(document.querySelector('[data-section="distance"]')?.className).not.toContain("hud-section--ok");
    expect(document.getElementById("card")?.className).toBe("panel");
  });
});
