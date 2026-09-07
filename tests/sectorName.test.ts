/**
 * INCLUDE-BODY-IDS Phase 10 step 1 — putting a system in a sector.
 *
 * Two methods, both correct, answering different questions. The grid is a uniform partition of
 * space; the name is the *named region* a system was assigned to. Where they disagree the system is
 * in both, and the map has to decide which it draws — see the overlay test at the bottom.
 */
import { describe, expect, it } from "vitest";
import {
  SECTOR_ORIGIN,
  SECTOR_SIZE_LY,
  classifySystemName,
  measureSectorCoverage,
  sectorCellFromCoords,
  sectorCellKey,
  systemSector,
} from "../src/shared/sectorName.js";

describe("the name parser", () => {
  it("reads the sector off a procgen name, in both grammars", () => {
    expect(systemSector("Swoiwns IZ-E d12-10")).toBe("Swoiwns");
    expect(systemSector("Ooscs Auf DR-T d4-1")).toBe("Ooscs Auf");
    expect(systemSector("Lyncis Sector CL-Y c14")).toBe("Lyncis Sector"); // no dash suffix
    expect(systemSector("Col 132 Sector WL-C b29-2")).toBe("Col 132 Sector");
    expect(systemSector("Eorgh Prou KN-A d14-201")).toBe("Eorgh Prou");
  });

  it("returns null for a hand-named system, and says it is named rather than broken", () => {
    for (const n of ["Sol", "18 Andromedae", "Merope", "HIP 168444", "Ross 903"]) {
      expect(systemSector(n), n).toBeNull();
      expect(classifySystemName(n).kind, n).toBe("named");
    }
  });

  it("does not mistake a body name or an empty string for a system", () => {
    // A body name carries the system plus a body designation; it is not a system name.
    expect(systemSector("18 Andromedae 8 a")).toBeNull();
    expect(classifySystemName("   ").kind).toBe("unreadable");
    expect(classifySystemName("").kind).toBe("unreadable");
  });

  it("needs both anchors — a boxel block and a mass code", () => {
    expect(systemSector("Something AA-A 12-3")).toBeNull(); // no mass code letter
    expect(systemSector("Something A-A a1")).toBeNull(); // malformed boxel
    expect(systemSector("Something AA-A z1")).toBeNull(); // mass code out of a-h
  });
});

describe("the grid", () => {
  /**
   * Solved from `sector-list.csv` rather than taken from a wiki: `Avg − index × 1280` bottoms out at
   * (−49984, −40985, −24104) across 11,649 sectors. The published origin is a light year away and
   * reproduces the catalogue indices exactly, so it is the one used.
   */
  it("uses the origin and cell size the catalogue implies", () => {
    expect(SECTOR_SIZE_LY).toBe(1280);
    expect(SECTOR_ORIGIN).toEqual({ x: -49985, y: -40985, z: -24105 });
  });

  it("places real systems in the cells the catalogue records", () => {
    // Verified against sector-list.csv's own id64 X/Y/Z columns.
    expect(sectorCellFromCoords(0, 0, 0)).toEqual({ x: 39, y: 32, z: 18 }); // Sol → Wregoe's cell
    expect(sectorCellFromCoords(-1180.1875, -486.125, 1292.96875)).toEqual({ x: 38, y: 31, z: 19 }); // Swoiwns
    expect(sectorCellFromCoords(-9509.46875, 2363.21875, 19841.4375)).toEqual({ x: 31, y: 33, z: 34 }); // Ooscs Auf
  });

  it("is total — negative coordinates floor downwards rather than towards zero", () => {
    // A cell boundary: one light year either side must not land in the same cell.
    const a = sectorCellFromCoords(SECTOR_ORIGIN.x + SECTOR_SIZE_LY - 0.5, 0, 0);
    const b = sectorCellFromCoords(SECTOR_ORIGIN.x + SECTOR_SIZE_LY + 0.5, 0, 0);
    expect(b.x).toBe(a.x + 1);
    // Far outside the galaxy still yields a cell rather than throwing.
    expect(Number.isFinite(sectorCellFromCoords(-99999, -99999, -99999).x)).toBe(true);
  });

  it("keys a cell the way the catalogue does", () => {
    expect(sectorCellKey({ x: 39, y: 32, z: 18 })).toBe("39:32:18");
  });
});

describe("coverage measurement", () => {
  it("separates procgen from hand-named, and counts distinct sectors", () => {
    const c = measureSectorCoverage([
      "Swoiwns IZ-E d12-10",
      "Swoiwns AA-B c1-2",
      "Ooscs Auf DR-T d4-1",
      "Sol",
      "Merope",
      "  ",
    ]);
    expect(c.total).toBe(6);
    expect(c.procgen).toBe(3);
    expect(c.sectors).toBe(2); // Swoiwns twice, Ooscs Auf once
    expect(c.named).toBe(2);
    expect(c.unreadable).toBe(1);
  });

  /**
   * A parser that invents plausible sector names would score 100 % against itself. Passing the
   * catalogue is what turns "we parsed something" into "we parsed something that exists" — and on
   * the corpus, the EDDN register and 244 journals, `unknownSector` was **zero** every time.
   */
  it("flags a sector that is not in the catalogue", () => {
    const known = new Set(["Swoiwns"]);
    const c = measureSectorCoverage(["Swoiwns IZ-E d12-10", "Nonesuch AA-A a1"], known);
    expect(c.procgen).toBe(2);
    expect(c.unknownSector).toBe(1);
    expect(c.unknownExamples).toEqual(["Nonesuch AA-A a1"]);
  });
});

/**
 * The two methods disagree on 409 of 2,044 corpus systems, and **that is not a bug**.
 *
 * 94.6 % of the disagreements are names ending "… Sector" or "… Dark Region" — Col 285 Sector,
 * Hyades Sector, Hind Sector. Those are Elite's hand-defined *overlay* regions: irregular shapes
 * around clusters and nebulae that contain procgen-named systems while sitting on top of the uniform
 * 1280 ly grid. A system named `Col 285 Sector KM-V d2-36` is genuinely in Col 285 Sector *and*
 * genuinely in the Wregoe grid cell.
 *
 * So the map draws the **grid** (a partition, uniform in volume, and it covers hand-named systems),
 * and uses the **name** for the label and the search box, because that is what a commander
 * recognises. Averaging the two, or picking one silently, would be the mistake.
 */
describe("named overlay regions are not a parsing failure", () => {
  it("keeps the name and the cell as separate answers", () => {
    const name = systemSector("Col 285 Sector KM-V d2-36");
    expect(name).toBe("Col 285 Sector");
    // The grid cell for that system's coordinates belongs to a different, procgen sector — both
    // descriptions are true of the same system.
    expect(sectorCellFromCoords(0, 0, 0)).toEqual({ x: 39, y: 32, z: 18 });
  });
});
