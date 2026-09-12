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
      exoOrganicOverlay: { visible: true, phase: "tracking", sampleCount: 1, separationMeetsMin: false, minSampleDistanceM: 200, distToFirstM: 30, speciesDisplay: "Tussock propagito" },
    });
    expect(document.querySelector(".minimap-hint")).not.toBeNull();
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Too close");
    HUD.render({
      exoMinimap: mm,
      exoOrganicOverlay: { visible: true, phase: "tracking", sampleCount: 1, separationMeetsMin: true, minSampleDistanceM: 200, distToFirstM: 250, speciesDisplay: "Tussock propagito" },
    });
    expect(document.querySelector(".minimap-hint")).toBeNull();
  });

  it("keeps the radar's static layer across renders (the sweep must not restart)", () => {
    const mm = { headingDeg: 0, radiusM: 500, minSampleDistanceM: 0, marks: [] };
    HUD.render({ exoMinimap: mm, exoOrganicOverlay: null });
    const sweep = document.querySelector(".minimap-sweep");
    HUD.render({ exoMinimap: { ...mm, headingDeg: 90 }, exoOrganicOverlay: null });
    expect(document.querySelector(".minimap-sweep")).toBe(sweep);
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
