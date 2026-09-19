/**
 * @vitest-environment jsdom
 *
 * The discoveries tables actually render, sort and filter.
 *
 * A table of 18,127 rows built from a DTO is the kind of component that typechecks perfectly and
 * then white-screens on a null the fixture never had. These are the behaviours worth holding: that
 * it renders at all, that sorting a column reorders the rows rather than the headers, that a filter
 * chip removes rows, and that the window caps what reaches the DOM.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DiscoveriesTables } from "../src/client/DiscoveriesTables";
import type { DiscoveriesDTO, DiscoveryBodyRow, DiscoveryStarRow, DiscoverySystemRow } from "../src/shared/types";

function sys(over: Partial<DiscoverySystemRow>): DiscoverySystemRow {
  return {
    systemAddress: 1,
    name: "Probe",
    region: "Inner Orion Spur",
    x: 0,
    y: 0,
    z: 0,
    stars: 1,
    bodies: 2,
    landables: 1,
    terraformables: 0,
    earthLikes: 0,
    waterWorlds: 0,
    ammoniaWorlds: 0,
    bioBodies: 0,
    bioSignals: 0,
    speciesConfirmed: 0,
    firstDiscoveries: 0,
    firstDiscoveredSystem: null,
    firstFootfalls: 0,
    dssMapped: 0,
    primaryStarType: "K",
    estimatedCredits: 1000,
    soldExplorationCredits: null,
    soldExobiologyCredits: null,
    fullyScanned: false,
    firstVisit: "2026-09-01T00:00:00Z",
    lastVisit: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function bod(over: Partial<DiscoveryBodyRow>): DiscoveryBodyRow {
  return {
    key: "1:1",
    systemAddress: 1,
    system: "Probe",
    region: "Inner Orion Spur",
    bodyName: "Probe 1",
    planetClass: "High metal content body",
    atmosphere: null,
    volcanism: null,
    terraformState: null,
    landable: true,
    gravityG: 0.35,
    surfaceTemperatureK: 240,
    surfacePressurePa: null,
    radiusEarth: 0.628,
    massEM: 0.4,
    distanceLs: null,
    bioSignals: null,
    speciesConfirmed: [],
    dssMapped: false,
    firstDiscoverer: false,
    firstDiscoveredSystem: null,
    firstFootfall: false,
    estimatedCredits: 500,
    scannedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const STAR: DiscoveryStarRow = {
  key: "1:0",
  systemAddress: 1,
  system: "Probe",
  region: "Inner Orion Spur",
  bodyName: "Probe A",
  starType: "K",
  subclass: 5,
  luminosity: "V",
  solarMasses: 0.8,
  radiusSolar: 0.719,
  surfaceTemperatureK: 4200,
  distanceLs: 0,
  firstDiscoverer: true,
  firstDiscoveredSystem: null,
  estimatedCredits: 1200,
  scannedAt: "2026-09-01T00:00:00Z",
};

function render(data: DiscoveriesDTO, tab: "systems" | "bodies" | "stars") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<DiscoveriesTables data={data} tab={tab} />);
  });
  return {
    host,
    rows: () => [...host.querySelectorAll("tbody tr")],
    firstCells: () => [...host.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent),
    header: (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button.disc-sort")].find(
        (b) => b.textContent?.trim().replace(/[▲▼]/g, "").trim() === label,
      ),
    chip: (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button.disc-chip")].find((b) =>
        b.textContent?.startsWith(label),
      ),
    click: (el: HTMLElement | undefined) => act(() => el?.click()),
    unmount: () => act(() => root.unmount()),
  };
}

const DATA: DiscoveriesDTO = {
  generatedAt: "2026-09-17T00:00:00Z",
  systems: [
    sys({ systemAddress: 1, name: "Alpha", estimatedCredits: 100, bioSignals: 0 }),
    sys({ systemAddress: 2, name: "Beta", estimatedCredits: 9000, bioSignals: 4, region: "Norma Expanse" }),
    sys({ systemAddress: 3, name: "Gamma", estimatedCredits: 5000, bioSignals: 0, soldExobiologyCredits: 42 }),
  ],
  bodies: [
    bod({ key: "1:1", bodyName: "Alpha 1", planetClass: "Icy body", estimatedCredits: 10 }),
    bod({ key: "2:1", bodyName: "Beta 1", planetClass: "Earth-like world", estimatedCredits: 900_000 }),
    bod({ key: "3:1", bodyName: "Gamma 1", landable: false, estimatedCredits: 300, bioSignals: 2 }),
  ],
  stars: [STAR],
};

describe("the discoveries tables", () => {
  it("renders every tab without throwing", () => {
    for (const tab of ["systems", "bodies", "stars"] as const) {
      const r = render(DATA, tab);
      expect(r.rows().length, tab).toBeGreaterThan(0);
      r.unmount();
    }
  });

  it("opens sorted by value, richest first", () => {
    // The default a commander wants on a table of everything he owns.
    const r = render(DATA, "systems");
    expect(r.firstCells()).toEqual(["Beta", "Gamma", "Alpha"]);
    r.unmount();
  });

  it("reverses a column when its header is clicked twice", () => {
    const r = render(DATA, "systems");
    r.click(r.header("System"));
    expect(r.firstCells()).toEqual(["Gamma", "Beta", "Alpha"]);
    r.click(r.header("System"));
    expect(r.firstCells()).toEqual(["Alpha", "Beta", "Gamma"]);
    r.unmount();
  });

  it("filters to the systems a chip names", () => {
    const r = render(DATA, "systems");
    r.click(r.chip("Biology"));
    expect(r.firstCells()).toEqual(["Beta"]);
    // Clicking it again is the way back — a filter nobody can turn off is a trap.
    r.click(r.chip("Biology"));
    expect(r.rows()).toHaveLength(3);
    r.unmount();
  });

  it("filters bodies by type, from chips it built out of the data", () => {
    /*
      The type chips are the commonest classes in the rows themselves, so the list needs no
      maintaining as the commander's history grows — and a class he has never scanned never appears.
    */
    const r = render(DATA, "bodies");
    r.click(r.chip("Earth-like world"));
    expect(r.firstCells()).toEqual(["Beta 1"]);
    r.unmount();
  });

  it("does not offer a filter for something absent from the data", () => {
    const r = render(DATA, "stars");
    expect(r.chip("Water world")).toBeUndefined();
    r.unmount();
  });

  it("caps what reaches the DOM and says how much it left out", () => {
    // 18,127 rows is the real number this has to survive.
    const many: DiscoveriesDTO = {
      ...DATA,
      bodies: Array.from({ length: 1200 }, (_, i) =>
        bod({ key: `9:${i}`, bodyName: `Body ${i}`, estimatedCredits: i }),
      ),
    };
    const r = render(many, "bodies");
    expect(r.rows()).toHaveLength(300);
    // Locale-agnostic on purpose: jsdom groups digits differently from a browser, and the claim
    // here is that the count is stated at all, not how it is punctuated.
    expect(r.host.textContent?.replace(/[  ,]/g, "")).toContain("1200");
    r.unmount();
  });

  it("shows a dash where a value was never measured", () => {
    // Null is "not measured" and must never render as 0 — on this table a 0 g body would be a lie.
    const r = render(
      { ...DATA, bodies: [bod({ gravityG: null, surfaceTemperatureK: null, massEM: null, radiusEarth: null })] },
      "bodies",
    );
    expect(r.host.textContent).toContain("—");
    r.unmount();
  });
});

/**
 * The Type chips on the Bodies tab list **every** class present.
 *
 * They used to be the commonest twelve. On the commander's own data that cut off Earth-like world,
 * which is thirteenth — 30 bodies against 10,170 Icy ones — along with Ammonia world (26), Water
 * giant (14) and Helium rich gas giant (3). His words: "make sure ALL types of planets are included,
 * even if there are only 2 of a type".
 *
 * Frequency is the wrong ranking for a filter list, because the values worth filtering *for* are the
 * rare ones. It stays the right ranking for the *order* — most-scanned first, rarities at the end.
 *
 * A first attempt pinned a hand-picked list of "notable" classes instead. That fixed the four I had
 * thought of and would have failed the next commander with a Helium rich gas giant, which is the
 * kind of half-measure this test exists to prevent.
 */
/**
 * "First discovery" on the Systems tab means the **system** is his.
 *
 * The owner: "its showing systems that I recognize that I wasnt the first there." The chip filtered
 * on `firstDiscoveries > 0` — the count of *bodies* he was first to scan — and being first to a
 * body in somebody else's system is an everyday occurrence, so the list was full of systems he knew
 * he had not found.
 *
 * The game decides the system on the main star's `WasDiscovered`, which the store has always tracked
 * (`mainStarWasDiscoveredBySystem`) and `discoveries.ts` never read. Unknown stays out: a main star
 * that was never scanned with the flag is not evidence of anything.
 */
describe("the Systems first-discovery filter", () => {
  const rows: DiscoverySystemRow[] = [
    sys({ systemAddress: 10, name: "Mine", firstDiscoveredSystem: true, firstDiscoveries: 3 }),
    sys({ systemAddress: 11, name: "TheirsMyBodies", firstDiscoveredSystem: false, firstDiscoveries: 4 }),
    sys({ systemAddress: 12, name: "Unknown", firstDiscoveredSystem: null, firstDiscoveries: 2 }),
  ];

  const namesWith = (chip: string) => {
    const r = render({ ...DATA, systems: rows }, "systems");
    r.click(r.chip(chip));
    const names = r.firstCells().map((t) => (t ?? "").trim());
    r.unmount();
    return names;
  };

  it("lists only systems the game credits to him", () => {
    const names = namesWith("First discovery");
    expect(names.some((n) => n.startsWith("Mine"))).toBe(true);
    expect(names.some((n) => n.startsWith("TheirsMyBodies")), "someone else's system").toBe(false);
  });

  it("does not claim a system whose main star was never scanned", () => {
    // Unknown is not "yes". Claiming one would be the same mistake in the other direction.
    expect(namesWith("First discovery").some((n) => n.startsWith("Unknown"))).toBe(false);
  });

  it("keeps the body-count question available under its own name", () => {
    /*
      Still worth asking: a system somebody else found where he was first to bodies nobody had. It
      just is not what "first discovery" means.
    */
    const names = namesWith("Has first-scanned bodies");
    expect(names.some((n) => n.startsWith("TheirsMyBodies"))).toBe(true);
    expect(names.some((n) => n.startsWith("Mine"))).toBe(true);
  });
});

/**
 * "First discovery" means the same thing on every tab.
 *
 * The owner, comparing two panels on the same data: "the same filter for Earth-like with first
 * discovery in the system tab shows 6 earth-like bodies. The body tab shows 25." Both numbers were
 * right and they answered different questions — the Systems tab asked about the system, the Bodies
 * tab asked whether he was first to *scan that body*, which is an everyday occurrence inside a
 * system somebody else found.
 *
 * A label that means one thing on one tab and something looser on the next is worse than either
 * rule on its own, so all three now ask about the system, and the per-body question keeps its own
 * chip under a name that says what it is.
 */
describe("first discovery means the system, on every tab", () => {
  const rows: DiscoveryBodyRow[] = [
    bod({ key: "a:1", bodyName: "Mine", planetClass: "Earth-like world", firstDiscoverer: true, firstDiscoveredSystem: true }),
    bod({ key: "b:1", bodyName: "TheirSystem", planetClass: "Earth-like world", firstDiscoverer: true, firstDiscoveredSystem: false }),
    bod({ key: "c:1", bodyName: "Unknown", planetClass: "Earth-like world", firstDiscoverer: true, firstDiscoveredSystem: null }),
  ];

  const namesWith = (chip: string, tab: "bodies" | "stars" = "bodies") => {
    const r = render({ ...DATA, bodies: rows }, tab);
    r.click(r.chip(chip));
    const names = r.firstCells().map((t) => (t ?? "").trim());
    r.unmount();
    return names;
  };

  it("counts only bodies in systems the game credits to him", () => {
    const names = namesWith("First discovery");
    expect(names.some((n) => n.startsWith("Mine"))).toBe(true);
    expect(names.some((n) => n.startsWith("TheirSystem")), "25-vs-6 case").toBe(false);
  });

  it("does not claim a body whose system was never resolved", () => {
    expect(namesWith("First discovery").some((n) => n.startsWith("Unknown"))).toBe(false);
  });

  it("keeps the per-body question under its own name", () => {
    // Still worth asking: first to a body nobody had, inside a system somebody else found.
    const names = namesWith("First to scan this body");
    expect(names.some((n) => n.startsWith("TheirSystem"))).toBe(true);
    expect(names.some((n) => n.startsWith("Mine"))).toBe(true);
  });
});

describe("the Bodies type chips", () => {
  const dto = (bodies: DiscoveryBodyRow[]): DiscoveriesDTO => ({ ...DATA, bodies });

  const chipLabels = (bodies: DiscoveryBodyRow[]) => {
    const r = render(dto(bodies), "bodies");
    const labels = [...r.host.querySelectorAll<HTMLButtonElement>("button.disc-chip")].map(
      (b) => b.textContent ?? "",
    );
    r.unmount();
    return labels;
  };

  /** Twenty common classes, enough to bury anything rare under any cap worth having. */
  const crowd = (): DiscoveryBodyRow[] =>
    Array.from({ length: 20 }, (_, i) =>
      bod({ key: `c:${i}`, bodyName: `Filler ${i}`, planetClass: `Filler class ${i}` }),
    );

  it("lists a class with a single body, however far down it sits", () => {
    const labels = chipLabels([
      ...crowd(),
      bod({ key: "e:1", bodyName: "Eden", planetClass: "Earth-like world" }),
    ]);
    expect(labels.some((t) => t.includes("Earth-like world"))).toBe(true);
  });

  it("lists every rare class at once, not a chosen few", () => {
    // The real shape of his data: several rarities at the bottom, all of them worth a chip.
    const rare = ["Earth-like world", "Ammonia world", "Water giant", "Helium rich gas giant"];
    const labels = chipLabels([
      ...crowd(),
      ...rare.map((planetClass, i) => bod({ key: `r:${i}`, bodyName: `Rare ${i}`, planetClass })),
    ]);
    for (const c of rare) expect(labels.some((t) => t.includes(c)), c).toBe(true);
  });

  it("does not invent a class nobody has scanned", () => {
    // A chip that filters to nothing reads as a broken panel rather than an empty result.
    expect(chipLabels(crowd()).some((t) => t.includes("Earth-like world"))).toBe(false);
  });

  it("does the same for star class, where the rarities are the point", () => {
    /*
      The Stars tab had the same defect with a cap of 16. It hid seven of this commander's 23 types —
      neutron stars, Wolf-Rayet, Herbig Ae/Be and three white-dwarf classes — while a black hole
      survived at rank 12 by luck. Those are precisely what somebody filters a star list for.
    */
    const stars: DiscoveryStarRow[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        ...STAR,
        key: `s:${i}`,
        bodyName: `Common ${i}`,
        starType: `Type${i}`,
      })),
      { ...STAR, key: "s:n", bodyName: "Neutron", starType: "N" },
    ];
    const r = render({ ...DATA, stars }, "stars");
    const labels = [...r.host.querySelectorAll<HTMLButtonElement>("button.disc-chip")].map(
      (b) => b.textContent ?? "",
    );
    r.unmount();
    expect(labels.some((t) => t.startsWith("N"))).toBe(true);
  });

  it("still puts the commonest first", () => {
    const labels = chipLabels([
      bod({ key: "i:1", bodyName: "Ice", planetClass: "Icy body" }),
      bod({ key: "i:2", bodyName: "Ice 2", planetClass: "Icy body" }),
      bod({ key: "e:1", bodyName: "Eden", planetClass: "Earth-like world" }),
    ]);
    const icy = labels.findIndex((t) => t.includes("Icy body"));
    const eden = labels.findIndex((t) => t.includes("Earth-like world"));
    expect(icy).toBeGreaterThanOrEqual(0);
    expect(icy).toBeLessThan(eden);
  });
});
