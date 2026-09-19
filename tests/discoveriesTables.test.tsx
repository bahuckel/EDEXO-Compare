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
 * The Type chips on the Bodies tab.
 *
 * They come from `topValues` over `planetClass`, which ranks by frequency and keeps the top twelve.
 * That is the wrong ranking for a filter list: measured on the commander's own data, Earth-like
 * world is the **thirteenth** commonest class he has scanned — 30 bodies against 10,170 Icy ones —
 * so it fell off by a single place, and an Earth-like is exactly what somebody opens this panel to
 * look for. He reported it as "they are already in the list, just no filter for them".
 *
 * Notable classes are pinned in when the data contains them, and never invented when it does not: a
 * chip that filters to nothing is worse than no chip at all.
 */
describe("the Bodies type chips", () => {
  /** Enough classes ahead of it to push anything rare past a top-twelve cut. */
  const crowd = (): DiscoveryBodyRow[] =>
    Array.from({ length: 14 }, (_, i) =>
      bod({ key: `c:${i}`, bodyName: `Filler ${i}`, planetClass: `Filler class ${i}` }),
    );

  const dto = (bodies: DiscoveryBodyRow[]): DiscoveriesDTO => ({ ...DATA, bodies });

  const chipLabels = (bodies: DiscoveryBodyRow[]) => {
    const r = render(dto(bodies), "bodies");
    const labels = [...r.host.querySelectorAll<HTMLButtonElement>("button.disc-chip")].map(
      (b) => b.textContent ?? "",
    );
    r.unmount();
    return labels;
  };

  it("offers an Earth-like chip even when it is far down the frequency list", () => {
    const labels = chipLabels([
      ...crowd(),
      bod({ key: "e:1", bodyName: "Eden", planetClass: "Earth-like world" }),
    ]);
    expect(labels.some((t) => t.includes("Earth-like world"))).toBe(true);
  });

  it("does not offer one when no such body has been scanned", () => {
    // Never invent the chip. Filtering to an empty table reads as a bug in the data, not the filter.
    expect(chipLabels(crowd()).some((t) => t.includes("Earth-like world"))).toBe(false);
  });

  it("keeps the common classes too", () => {
    const labels = chipLabels([
      ...crowd(),
      bod({ key: "i:1", bodyName: "Ice", planetClass: "Icy body" }),
      bod({ key: "i:2", bodyName: "Ice 2", planetClass: "Icy body" }),
      bod({ key: "e:1", bodyName: "Eden", planetClass: "Earth-like world" }),
    ]);
    expect(labels.some((t) => t.includes("Icy body"))).toBe(true);
    expect(labels.some((t) => t.includes("Earth-like world"))).toBe(true);
  });

  it("pins the other rarities a commander goes looking for", () => {
    const labels = chipLabels([
      ...crowd(),
      bod({ key: "a:1", bodyName: "Ammonia", planetClass: "Ammonia world" }),
      bod({ key: "w:1", bodyName: "Giant", planetClass: "Water giant" }),
    ]);
    expect(labels.some((t) => t.includes("Ammonia world"))).toBe(true);
    expect(labels.some((t) => t.includes("Water giant"))).toBe(true);
  });
});
