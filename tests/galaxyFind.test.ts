/**
 * The 3D map's Find box and sector panel (galaxyFind.ts, G4): sectors by name, the commander's own
 * systems first, index systems inside a named sector, and a sector column's most valuable systems.
 */
import { describe, expect, it } from "vitest";
import { buildTileIndex } from "../src/server/galaxyTiles.js";
import { galaxyFind, galaxySector } from "../src/server/galaxyFind.js";
import { cellOf } from "../src/shared/galaxyGrid.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { BioIndex } from "../src/server/bioIndex.js";
import type { JournalLine } from "../src/shared/types.js";

const SYSTEMS = [
  { name: "Eol Prou AA-A g2", x: -9530, y: -910, z: 19808, species: 0 },
  { name: "Eol Prou IW-W e1-3", x: -9500, y: -900, z: 19820, species: 4 },
  { name: "Eol Prou RS-T d3-94", x: -9600, y: -850, z: 19700, species: 2 },
  { name: "Colonia", x: -9530.5, y: -910.28125, z: 19808.125, species: 1 },
  { name: "Synuefe XO-P c22-17", x: 400, y: -100, z: -200, species: 6 },
];
const VALUES = new Uint16Array([0, 380, 120, 25, 900]);

const index: BioIndex = {
  systemCount: SYSTEMS.length,
  species: [],
  lookup: () => null,
  ordinalOf: () => -1,
  systemsWithAny: () => [],
  forEachRegionSpecies: () => {},
  forEachPoint: (cb) => SYSTEMS.forEach((s, i) => cb(i, s.x, s.y, s.z, 0, s.species)),
  pointAt: (i) => [SYSTEMS[i]!.x, SYSTEMS[i]!.y, SYSTEMS[i]!.z, 0, SYSTEMS[i]!.species],
  nameOf: (i) => SYSTEMS[i]!.name,
  systemAt: (i) => ({ id64: BigInt(i), name: SYSTEMS[i]!.name, x: 0, y: 0, z: 0, regionId: 0, species: [], tiers: 0, bodyCount: 0 }),
};
const t = buildTileIndex(index, VALUES);

describe("Find", () => {
  it("finds a sector by name, with its centroid and size", () => {
    const r = galaxyFind(t, null, "eol pr");
    expect(r.sectors.map((s) => s.name)).toEqual(["Eol Prou"]);
    expect(r.sectors[0]!.systems).toBeGreaterThanOrEqual(3);
    expect(r.sectors[0]!.x).toBeCloseTo(-9540, -1);
  });

  it("finds index systems inside the sector a procgen name names, with their ordinal", () => {
    const r = galaxyFind(t, null, "Eol Prou IW-W");
    expect(r.systems).toEqual([expect.objectContaining({ name: "Eol Prou IW-W e1-3", ordinal: 1, mine: false })]);
    expect(r.partial).toBe(false);
  });

  it("finds a hand-named system by scanning, and puts the commander's own systems first", () => {
    const st = new GameStateStore();
    st.apply({
      timestamp: "2026-05-05T05:09:05Z",
      event: "FSDJump",
      StarSystem: "Colonia",
      SystemAddress: 3238296097059,
      StarPos: [-9530.5, -910.28125, 19808.125],
    } as unknown as JournalLine);
    const r = galaxyFind(t, st, "colon");
    expect(r.systems[0]).toMatchObject({ name: "Colonia", mine: true, addr: "3238296097059", ordinal: null });
    // The index's own Colonia is the same name: listed once, as the commander's.
    expect(r.systems.filter((s) => s.name === "Colonia")).toHaveLength(1);
  });

  it("asks for two letters before searching", () => {
    expect(galaxyFind(t, null, "e")).toMatchObject({ sectors: [], systems: [] });
  });
});

describe("sector panel", () => {
  it("lists a sector column's most valuable systems first, and names it", () => {
    const c = cellOf(-9530, -910, 19808);
    const d = galaxySector(t, c.cx, c.cz)!;
    expect(d.name).toBe("Eol Prou");
    expect(d.systems).toBe(4);
    expect(d.top.map((s) => s.name)).toEqual(["Eol Prou IW-W e1-3", "Eol Prou RS-T d3-94", "Colonia", "Eol Prou AA-A g2"]);
    expect(d.top[0]).toMatchObject({ valueCr: 38_000_000, species: 4, ordinal: 1 });
  });

  it("answers an empty column with nothing", () => {
    expect(galaxySector(t, 0, 0)).toBeNull();
  });
});
