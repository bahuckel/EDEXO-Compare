// @vitest-environment jsdom
/**
 * The HUD overlay logic (public/hud/) against fake snapshots.
 *
 * public/hud/ holds the rendering of the overlay sections as plain browser modules, no build step.
 * They are loaded into jsdom here (tests/helpers/loadHud.ts) and driven through `HUD.mount` / `HUD.render` with `noTimers`, so nothing
 * polls or opens sockets. These are the rules the owner asked for and the bugs he reported: the
 * unlikely tier hidden unless confirmed, scan progress after the species, the targeted body winning
 * over the current one, the tracker folding away from a surface, the star-class verdicts.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { loadHudModule } from "./helpers/loadHud.js";

type HudApi = {
  mount: (names: string[], opts?: { noTimers?: boolean }) => HTMLElement;
  render: (d: unknown) => void;
  starKind: (cls: string) => { kind: string; label: string };
  SECTIONS: string[];
  /*
    The rest of the HUD's surface, as the newer tests drive it. This type is hand-written —
    public/hud/ is plain browser JavaScript, so nothing generates it — and
    it had fallen behind what the file exports, which typechecks as an error while the tests
    themselves pass. Kept loose on purpose: it describes what the tests need, not the whole API.
  */
  readScale: () => number;
  readOpacity: () => number;
  readAlpha?: () => number;
  audioOn: () => boolean;
  /** A hook the page assigns, not a registrar: the HUD calls `HUD.onCue(kind)` if it is set. */
  onCue?: (kind: string) => unknown;
  /** Fed the overlay payload each frame; it decides whether a cue has just become due. */
  cueFromOverlay: (eo: unknown) => void;
  /** Free move's placing frame (electron/hudWindows.cjs sends `edexo:hud-move-mode`). */
  setMoveMode: (on: boolean) => void;
};

const loadHud = () => loadHudModule<HudApi>();

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

describe("HUD candidates", () => {
  let HUD: HudApi;
  beforeEach(async () => {
    window.localStorage.clear();
    HUD = await loadHud();
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
      bodies: [
        body("1:2", "A 2", [
          match("Tussock", "propagito", 1_000_000),
          match("Bacterium", "cerbrus", 1_689_800),
        ]),
      ],
      exoOrganicOverlay: {
        visible: true,
        trackingBodyKey: "1:2",
        speciesDisplay: "Tussock propagito",
        sampleCount: 2,
      },
    });
    const rows = [...document.querySelectorAll(".hud-list li")].map((li) => li.textContent ?? "");
    expect(rows.find((t) => t.includes("Tussock"))).toContain("Tussock Propagito2/3");
    expect(rows.find((t) => t.includes("Bacterium"))).not.toContain("/3");
  });

  it("marks a new codex entry CX and a first one for the region FCX, as the app's body tabs do", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      bodies: [
        body("1:2", "A 2", [
          match("Tussock", "propagito", 1_000_000, { codexNew: true }),
          match("Bacterium", "cerbrus", 1_689_800, { codexNew: true, codexFirst: true }),
          match("Stratum", "tectonicas", 19_010_800),
        ]),
      ],
    });
    const mark = (genus: string) =>
      [...document.querySelectorAll(".hud-list li")].find((li) => li.textContent?.includes(genus))?.querySelector(".cxnew");
    expect(mark("Tussock")?.textContent).toBe("CX");
    expect(mark("Tussock")?.className).toBe("cxnew");
    expect(mark("Bacterium")?.textContent).toBe("FCX");
    expect(mark("Bacterium")?.className).toBe("cxnew cxnew--first");
    expect(mark("Stratum")).toBeNull();
  });

  /** The solver names genera by data folder; the rows must follow its order, not the delivered one. */
  it("lists rows in the solver's genus order, matched by data folder", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      bodies: [
        {
          ...body("1:2", "A 2", [
            match("Bacterium", "cerbrus", 1, { entry: { genus: "Bacterium", genusDataDir: "bacterium", displayName: "Bacterium cerbrus" } }),
            match("Brain Trees", "roseum", 1, { entry: { genus: "Brain Trees", genusDataDir: "brain-tree", displayName: "Roseum Brain Tree" } }),
          ]),
          genusLikelihoods: [{ genus: "brain-tree" }, { genus: "bacterium" }],
        },
      ],
    });
    const rows = [...document.querySelectorAll(".hud-list li")].map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("Brain Trees");
    expect(rows[1]).toContain("Bacterium");
  });

  /** Seen live 2026-10-01: the HUD printed 12,934,900 CR beside the app's 64.7 M ×5 for the same row. */
  it("prices a row as the app does: ×5 unwalked, ×1 walked, the list price tagged while unknown", () => {
    const priceOf = (footfall: string | undefined) => {
      HUD.render({
        exoOverlayFocusBodyKey: "1:2",
        bodies: [{ ...body("1:2", "A 2", [match("Stratum", "tectonicas", 1_000_000)]), footfall }],
      });
      return document.querySelector(".hud-list li .cr")?.textContent;
    };
    expect(priceOf("unwalked")).toBe((5_000_000).toLocaleString() + " CR ×5");
    expect(priceOf("walked")).toBe((1_000_000).toLocaleString() + " CR ×1");
    expect(priceOf("unknown")).toBe((1_000_000).toLocaleString() + " CR ×1 ?");
    expect(priceOf(undefined)).toBe((1_000_000).toLocaleString() + " CR ×1 ?");
  });

  it("prefers the targeted body from Status.json and tags it", () => {
    HUD.render({
      exoOverlayFocusBodyKey: "1:2",
      statusDestination: { systemAddress: 1, bodyId: 3, name: "Sys C 3" },
      bodies: [
        body("1:2", "A 2", [match("Tussock", "propagito", 1)]),
        body("1:3", "C 3", [match("Fonticulua", "campestris", 5)]),
      ],
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
      bodies: [
        body("1:2", "A 2", [match("Stratum", "tectonicas", 100), match("Tussock", "propagito", 5_000_000)]),
      ],
    });
    const first = document.querySelector(".hud-list li")?.textContent ?? "";
    expect(first).toContain("Tussock");
  });
});

describe("HUD tracker", () => {
  let HUD: HudApi;
  beforeEach(async () => {
    window.localStorage.clear();
    HUD = await loadHud();
    HUD.mount(["distance"], { noTimers: true });
  });

  it("folds away from a surface and unfolds on one", () => {
    HUD.render({ exoOrganicOverlay: null, exoMinimap: null });
    expect(document.querySelector(".trk")?.className).toContain("trk--away");
    expect(document.querySelector(".trk__away")?.className).toContain("trk__away--on");
    HUD.render({
      exoOrganicOverlay: null,
      exoMinimap: { headingDeg: 10, radiusM: 500, minSampleDistanceM: 0, marks: [] },
    });
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
      exoOrganicOverlay: {
        visible: true,
        phase: "tracking",
        sampleCount: 1,
        nearestSampleMeetsMin: false,
        minSampleDistanceM: 200,
        distToFirstM: 30,
        speciesDisplay: "Tussock propagito",
      },
    });
    expect(document.querySelector(".minimap-hint")).not.toBeNull();
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Too close");
    HUD.render({
      exoMinimap: mm,
      exoOrganicOverlay: {
        visible: true,
        phase: "tracking",
        sampleCount: 1,
        nearestSampleMeetsMin: true,
        minSampleDistanceM: 200,
        distToFirstM: 250,
        speciesDisplay: "Tussock propagito",
      },
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

describe("HUD size and opacity", () => {
  it("scales the root font and the panel alpha from the launcher's keys", async () => {
    localStorage.setItem("edexoHudScale", "1.5");
    localStorage.setItem("edexoHudOpacity", "0.6");
    const HUD = await loadHud();
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

describe("HUD audio cues", () => {
  it("fires once on the ring clearing and once on the third sample, and stays silent when off", async () => {
    const HUD = await loadHud();
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

describe("HUD next jump", () => {
  it("classifies star classes the way the owner asked", async () => {
    const HUD = await loadHud();
    expect(HUD.starKind("G").kind).toBe("scoop");
    expect(HUD.starKind("M").kind).toBe("scoop");
    expect(HUD.starKind("DA").kind).toBe("noscoop");
    expect(HUD.starKind("TTS").kind).toBe("noscoop");
    expect(HUD.starKind("N").kind).toBe("neutron");
    expect(HUD.starKind("H").kind).toBe("hole");
    expect(HUD.starKind("").kind).toBe("unknown");
  });

  it("renders the target and flips to arrived", async () => {
    const HUD = await loadHud();
    HUD.mount(["jump"], { noTimers: true });
    HUD.render({ jumpTarget: { starSystem: "Traikee GL-S c6-0", starClass: "G", arrived: false } });
    expect(document.querySelector('[data-f="sys"]')?.textContent).toBe("Traikee GL-S c6-0");
    expect(document.querySelector(".jump")?.className).toContain("jump--scoop");
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Jumping");
    HUD.render({ jumpTarget: { starSystem: "Traikee GL-S c6-0", starClass: "H", arrived: true } });
    expect(document.querySelector(".jump")?.className).toContain("jump--hole");
    expect(document.querySelector('[data-f="status"]')?.textContent).toBe("Arrived");
  });

  it("draws the route strip with the refuel pump on the nearest scoop", async () => {
    const HUD = await loadHud();
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

    HUD.render({
      jumpTarget: null,
      liveShipFuelRange: { navRoute: { ahead: [], refuelInHops: null, refuelLevel: "none" } },
    });
    expect((document.querySelector('[data-f="route"]') as HTMLElement).hidden).toBe(true);
  });

  it("colours each arrow by what EDSM knows: orange visited, blue unvisited, grey no answer", async () => {
    // Owner, 2026-09-24: grey while EDSM has not answered, and when it could not be reached.
    const HUD = await loadHud();
    HUD.mount(["jump"], { noTimers: true });
    const hop = (s: string, ff: boolean | null, note: string | null = null) => ({
      starSystem: s,
      starClass: "K",
      scoopable: true,
      refuel: "none",
      likelyFirstFootfall: ff,
      firstFootfallNote: note,
    });
    HUD.render({
      jumpTarget: { starSystem: "A", starClass: "K", arrived: false, source: "route" },
      liveShipFuelRange: {
        navRoute: {
          ahead: [
            hop("A", false),
            hop("B", false),
            hop("C", true),
            hop("D", null, "EDSM rate limit — will retry"),
            hop("E", null, "Waiting for EDSM"),
          ],
          refuelInHops: null,
          refuelLevel: "none",
        },
      },
    });
    // The arrow before a hop describes that hop: B visited, C unvisited, D and E unknown.
    const seps = [...document.querySelectorAll(".hop__sep")];
    expect(seps.map((e) => e.className)).toEqual([
      "hop__sep",
      "hop__sep hop__sep--first",
      "hop__sep hop__sep--unknown",
      "hop__sep hop__sep--unknown",
    ]);
    expect(seps[2]?.getAttribute("title")).toBe("EDSM rate limit — will retry");
    expect(seps[0]?.getAttribute("title")).toBeNull();
  });
});

describe("HUD merged panel", () => {
  it("mounts sections in the order given (the owner's stack order) and retints only the finished one", async () => {
    const HUD = await loadHud();
    HUD.mount(["distance", "jump", "fss", "jump", "bogus"], { noTimers: true });
    const secs = [...document.querySelectorAll(".hud-section")].map((s) => s.getAttribute("data-section"));
    expect(secs).toEqual(["distance", "jump", "fss"]);
    HUD.render({ dScanBodies: { systemName: "X", found: 5, total: 5, complete: true }, exoMinimap: null });
    expect(document.querySelector('[data-section="fss"]')?.className).toContain("hud-section--ok");
    expect(document.querySelector('[data-section="distance"]')?.className).not.toContain("hud-section--ok");
    expect(document.getElementById("card")?.className).toBe("panel");
  });
  it("says whether the system was honked, and does not call a hand-scanned star complete", async () => {
    const HUD = await loadHud();
    HUD.mount(["fss"], { noTimers: true });
    // Scanned the star by hand, no honk: 1 / 1 is not a finished system.
    HUD.render({
      dScanBodies: { systemName: "X", found: 1, total: 1, complete: false, honked: false },
      exoMinimap: null,
    });
    expect(document.querySelector('[data-section="fss"]')?.className).not.toContain("hud-section--ok");
    expect(document.querySelector(".fss-line .honk")?.textContent).toBe("Honk: No");
    HUD.render({
      dScanBodies: { systemName: "X", found: 10, total: 10, complete: true, honked: true },
      exoMinimap: null,
    });
    expect(document.querySelector('[data-section="fss"]')?.className).toContain("hud-section--ok");
    expect(document.querySelector(".fss-line .honk")?.textContent).toBe("Honk: Yes");
  });
});

describe("only when relevant (guild tester report, 2026-09-30)", () => {
  const idle = (n: string) => document.querySelector(`[data-section="${n}"]`)!.classList.contains("hud-section--idle");
  const snap = (extra: Record<string, unknown> = {}) => ({
    dScanBodies: { systemName: "X", found: 10, total: 10, complete: true, honked: true },
    exoMinimap: null,
    bodies: [],
    notableBodies: [],
    notices: { items: [{ id: "old", kind: "notable", title: "Old", text: "a", system: "X", at: "" }], chime: false, recordMarks: [] },
    ...extra,
  });

  it("off by default: every section stays", async () => {
    window.localStorage.clear();
    const HUD = await loadHud();
    HUD.mount(["jump", "fss", "candidates", "notable", "notices"], { noTimers: true });
    HUD.render(snap());
    expect(["jump", "fss", "candidates", "notable", "notices"].some(idle)).toBe(false);
  });

  it("on: sections with nothing to say step aside, the rest stay, and a new notice comes in", async () => {
    window.localStorage.clear();
    window.localStorage.setItem("edexoHudRelevant", "1");
    const HUD = await loadHud();
    HUD.mount(["jump", "fss", "candidates", "notable", "notices"], { noTimers: true });
    HUD.render(snap());
    expect(idle("jump")).toBe(false); // no rule: always shown
    expect(idle("fss")).toBe(true); // system finished
    expect(idle("candidates")).toBe(true); // no body in focus
    expect(idle("notable")).toBe(true);
    expect(idle("notices")).toBe(true); // "old" was there when the page opened
    HUD.render(
      snap({
        dScanBodies: { systemName: "X", found: 3, total: 10, complete: false, honked: true },
        notableBodies: [{ bodyLabelShort: "3", tag: "Water world", bodyId: 3, dssMapped: false }],
        notices: {
          items: [{ id: "new", kind: "record", title: "Record: largest Icy body", text: "b", system: "X", at: "" }],
          unread: 4,
          chime: false,
          recordMarks: [],
        },
      }),
    );
    expect(idle("fss")).toBe(false);
    expect(idle("notable")).toBe(false);
    expect(idle("notices")).toBe(false);
    expect(document.querySelector('[data-section="notable"] .hud-mail')?.textContent).toContain("4");
  });

  it("waits five seconds before stepping aside", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      window.localStorage.clear();
      window.localStorage.setItem("edexoHudRelevant", "1");
      const HUD = (await loadHud()) as HudApi & { applyRelevance: () => void };
      HUD.mount(["fss"], { noTimers: true });
      HUD.render(snap({ dScanBodies: { systemName: "X", found: 3, total: 10, complete: false, honked: true } }));
      expect(idle("fss")).toBe(false);
      HUD.render(snap());
      expect(idle("fss")).toBe(false);
      vi.advanceTimersByTime(4000);
      HUD.applyRelevance();
      expect(idle("fss")).toBe(false);
      vi.advanceTimersByTime(1500);
      HUD.applyRelevance();
      expect(idle("fss")).toBe(true);
      expect(document.querySelector(".shell")?.classList.contains("shell--idle")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Free move (owner, 2026-10-02): the frame a HUD is dragged by while placing. */
describe("HUD placing frame", () => {
  it("draws the frame, reports the drag, and Done ends placing", async () => {
    const calls: string[] = [];
    (window as unknown as { edexoElectron?: unknown }).edexoElectron = {
      hudDrag: (phase: string) => {
        calls.push(phase);
        return Promise.resolve({ ok: true });
      },
    };
    try {
      const HUD = await loadHud();
      HUD.mount(["distance"], { noTimers: true });
      HUD.setMoveMode(true);
      HUD.setMoveMode(true);
      expect(document.querySelectorAll(".hud-move")).toHaveLength(1);
      const frame = document.querySelector(".hud-move") as HTMLElement;
      frame.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      frame.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      (document.querySelector(".hud-move-done") as HTMLButtonElement).click();
      expect(calls).toEqual(["start", "end", "done"]);
      HUD.setMoveMode(false);
      expect(document.querySelector(".hud-move")).toBeNull();
    } finally {
      delete (window as unknown as { edexoElectron?: unknown }).edexoElectron;
    }
  });
});
