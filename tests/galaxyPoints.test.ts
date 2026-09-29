/**
 * The 3D map's data (G0/G1): the overview buffer (galaxyPoints.ts), the close-up tiles and cell list
 * (galaxyTiles.ts), and the client readers (galaxy3d/galaxyBinary.ts) reading what the server wrote.
 */
import { describe, expect, it } from "vitest";
import { buildGalaxyPoints, POINTS_HEADER, POINTS_MAGIC } from "../src/server/galaxyPoints.js";
import { buildTileIndex, encodeCells, encodeTile, parseCellParam, sectorNames } from "../src/server/galaxyTiles.js";
import { readCells, readOverview, readTile } from "../src/client/galaxy3d/galaxyBinary.js";
import { cellMin, cellOf, maskTexel, TILE_STEP_LY } from "../src/shared/galaxyGrid.js";
import type { BioIndex } from "../src/server/bioIndex.js";

const SYSTEMS = [
  { name: "Eol Prou AA-A h0", x: -42000.5, y: -1500, z: -20000, tiers: 1, species: 0 },
  { name: "Sol", x: 0, y: 0, z: 0, tiers: 3, species: 2 },
  { name: "Sagittarius A*", x: 25.21875, y: -20.90625, z: 25899.96875, tiers: 7, species: 9 },
  { name: "Oevasy SG-Y d0", x: 41000, y: 2800, z: 65000, tiers: 8, species: 1 },
  { name: "Alpha Centauri", x: 3.03125, y: -0.09375, z: 3.15625, tiers: 2, species: 3 }, // Sol's cell
];
const VALUES = new Uint16Array([0, 12, 950, 3, 40]);

function fakeIndex(systems = SYSTEMS): BioIndex {
  return {
    systemCount: systems.length,
    species: [],
    lookup: () => null,
    ordinalOf: () => -1,
    systemsWithAny: () => [],
    forEachRegionSpecies: () => {},
    forEachPoint: (cb) => systems.forEach((s, i) => cb(i, s.x, s.y, s.z, s.tiers, s.species)),
    pointAt: (i) => {
      const s = systems[i]!;
      return [s.x, s.y, s.z, s.tiers, s.species];
    },
    nameOf: (i) => systems[i]!.name,
    systemAt: (i) => {
      const s = systems[i]!;
      return { id64: BigInt(i), name: s.name, x: s.x, y: s.y, z: s.z, regionId: 0, species: [], tiers: s.tiers, bodyCount: 0 };
    },
  };
}

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;

describe("overview buffer", () => {
  it("carries the magic, the count and one position + two summary bytes per system", () => {
    const buf = buildGalaxyPoints(fakeIndex(), 1, VALUES);
    expect(buf.toString("ascii", 0, 8)).toBe(POINTS_MAGIC);
    expect(buf.length).toBe(POINTS_HEADER + SYSTEMS.length * 10);
    const o = readOverview(ab(buf));
    expect(o.count).toBe(5);
    expect(o.stride).toBe(1);
    expect([...o.tiers]).toEqual([1, 3, 7, 8, 2]);
    expect([...o.species]).toEqual([0, 2, 9, 1, 3]);
    expect([...o.values]).toEqual([0, 12, 950, 3, 40]);
  });

  it("puts every system back within one quantisation step, corners exactly", () => {
    const o = readOverview(ab(buildGalaxyPoints(fakeIndex())));
    const at = (i: number, a: number) => o.min[a]! + (o.positions[i * 3 + a]! + 32768) * o.step[a]!;
    SYSTEMS.forEach((s, i) => {
      // A step is (range / 65535): about 1.3 ly on x here, 0.07 ly on y.
      expect(Math.abs(at(i, 0) - s.x)).toBeLessThan(1.3);
      expect(Math.abs(at(i, 1) - s.y)).toBeLessThan(0.1);
      expect(Math.abs(at(i, 2) - s.z)).toBeLessThan(1.4);
    });
    expect(at(0, 0)).toBeCloseTo(-42000.5, 1);
    expect(at(3, 2)).toBeCloseTo(65000, 0);
  });

  it("keeps every Nth system for light mode, with the stride in the header", () => {
    const o = readOverview(ab(buildGalaxyPoints(fakeIndex(), 2, VALUES)));
    expect(o.stride).toBe(2);
    expect(o.count).toBe(3); // systems 0, 2, 4
    expect([...o.tiers]).toEqual([1, 7, 2]);
    expect([...o.values]).toEqual([0, 950, 40]);
  });

  it("survives an empty index", () => {
    expect(readOverview(ab(buildGalaxyPoints(fakeIndex([])))).count).toBe(0);
  });
});

describe("close-up tiles", () => {
  const t = buildTileIndex(fakeIndex(), VALUES);

  it("groups systems by 1,280 ly cell and lists each non-empty cell once", () => {
    const list = readCells(ab(encodeCells(t)));
    expect(list.cells).toHaveLength(4); // Sol and Alpha Centauri share a cell
    const sol = cellOf(0, 0, 0);
    const solCell = list.cells.find((c) => c.cx === sol.cx && c.cy === sol.cy && c.cz === sol.cz)!;
    expect(solCell.systems).toBe(2);
    // The group sits where its systems are (between Sol and Alpha Centauri), showing the better one.
    expect(solCell.x).toBeCloseTo(1.515625, 3);
    expect(solCell.z).toBeCloseTo(1.578125, 3);
    expect(solCell.topValue).toBe(40);
    // The bounds cover every cell, so every cell has a texel in the client's mask.
    for (const c of list.cells) expect(maskTexel(list.bounds, c)).not.toBeNull();
  });

  it("gives a cell's systems back to 0.02 ly, with their ordinals", () => {
    const sol = cellOf(0, 0, 0);
    const tile = readTile(ab(encodeTile(t, sol)!));
    expect(tile.cell).toEqual(sol);
    expect(tile.count).toBe(2);
    const m = cellMin(sol);
    const back = (j: number) => [0, 1, 2].map((a) => [m.x, m.y, m.z][a]! + (tile.positions[j * 3 + a]! + 32768) * TILE_STEP_LY);
    const byOrdinal = new Map([...tile.ordinals].map((ord, j) => [ord, back(j)]));
    const centauri = byOrdinal.get(4)!;
    expect(Math.abs(centauri[0]! - 3.03125)).toBeLessThan(0.02);
    expect(Math.abs(centauri[2]! - 3.15625)).toBeLessThan(0.02);
    expect(Math.max(...byOrdinal.get(1)!.map(Math.abs))).toBeLessThan(0.02); // Sol at the origin
    expect([...tile.tiers].sort()).toEqual([2, 3]);
    expect(new Map([...tile.ordinals].map((ord, j) => [ord, tile.values[j]]))).toEqual(new Map([[1, 12], [4, 40]]));
  });

  it("answers an empty cell with nothing, and reads only well-formed cell parameters", () => {
    expect(encodeTile(t, { cx: 0, cy: 0, cz: 0 })).toBeNull();
    expect(parseCellParam("39:32:18")).toEqual({ cx: 39, cy: 32, cz: 18 });
    expect(parseCellParam("-1:0:5")).toEqual({ cx: -1, cy: 0, cz: 5 });
    for (const bad of ["1:2", "a:b:c", "1:2:3:4", "9999:0:0", undefined, 5]) expect(parseCellParam(bad)).toBeNull();
  });

  it("names each cell by its systems' sector, and leaves hand-named-only cells blank", () => {
    const list = readCells(ab(encodeCells(t)));
    const names = sectorNames(t);
    expect(names).toHaveLength(list.cells.length);
    const at = (x: number, y: number, z: number) => {
      const c = cellOf(x, y, z);
      return names[list.cells.findIndex((k) => k.cx === c.cx && k.cy === c.cy && k.cz === c.cz)];
    };
    expect(at(-42000.5, -1500, -20000)).toBe("Eol Prou");
    expect(at(41000, 2800, 65000)).toBe("Oevasy");
    expect(at(0, 0, 0)).toBe(""); // Sol and Alpha Centauri are hand-named
  });
});
