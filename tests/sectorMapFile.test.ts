/**
 * INCLUDE-BODY-IDS Phase 10 step 3 — the shipped aggregate and its accessors.
 *
 * The file is written by the feeder and read by the app, so the shape is a contract between two
 * processes that never share memory. These tests pin the parts a rename would silently break.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVIDENCE_INDEX, allTaxa, cellTotals, type SectorMapFile } from "../src/shared/sectorMapFile.js";
import { cellMarkerKind, readSectorNames, writeSectorMapFile } from "../src/feeder/sectorMapData.js";
import { aggregateBySector, type BodyEvidence } from "../src/shared/sectorAggregate.js";

const cell = (over: Partial<SectorMapFile["cells"][number]> = {}): SectorMapFile["cells"][number] => ({
  key: "39:32:18",
  x: 39,
  y: 32,
  z: 18,
  name: "Wregoe",
  taxa: { "bacterium aurasus": [10, 1, 2, 0], "frutexa acus": [5, 0, 0, 0] },
  ...over,
});

describe("packed counts", () => {
  /** `[confirmed, genus, signal, predicted]` — the order is the file format. */
  it("indexes the tuple strongest-first", () => {
    expect(EVIDENCE_INDEX).toEqual({ confirmed: 0, genus: 1, signal: 2, predicted: 3 });
  });

  it("totals a cell across every taxon", () => {
    expect(cellTotals(cell())).toEqual({ confirmed: 15, genus: 1, signal: 2, predicted: 0, bodies: 18 });
  });

  it("totals one taxon when asked, and reports honest zeros for an absent one", () => {
    expect(cellTotals(cell(), "frutexa acus")).toEqual({
      confirmed: 5,
      genus: 0,
      signal: 0,
      predicted: 0,
      bodies: 5,
    });
    // A sector that holds none of the selected species must total zero, not fall back to everything.
    expect(cellTotals(cell(), "electricae radialem").bodies).toBe(0);
  });

  it("lists every taxon in the file, sorted", () => {
    const file: SectorMapFile = {
      generatedAt: "",
      note: "",
      sectorNameSource: "",
      cells: [cell(), cell({ key: "1:2:3", taxa: { "osseus discus": [1, 0, 0, 0] } })],
    };
    expect(allTaxa(file)).toEqual(["bacterium aurasus", "frutexa acus", "osseus discus"]);
  });

  it("gives a cell the strongest colour present across its taxa", () => {
    expect(cellMarkerKind({ a: [0, 0, 3, 0], b: [1, 0, 0, 0] })).toBe("confirmed");
    expect(cellMarkerKind({ a: [0, 0, 3, 0] })).toBe("signal");
    expect(cellMarkerKind({})).toBeNull();
  });
});

describe("writing the file", () => {
  const ev = (x: number, bodyKey: string, taxon: string, kind: BodyEvidence["kind"]): BodyEvidence => ({
    x,
    y: 0,
    z: 0,
    bodyKey,
    taxon,
    kind,
  });

  it("groups by cell, packs the counts, and carries its own caveat", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-map-"));
    try {
      const entries = aggregateBySector([
        ev(0, "b1", "bacterium aurasus", "confirmed"),
        ev(0, "b2", "bacterium aurasus", "signal"),
        ev(0, "b3", "frutexa acus", "confirmed"),
      ]);
      const { file, bytes } = writeSectorMapFile(
        dir,
        { entries, sources: { confirmed: 2, genus: 0, signal: 1 } },
        path.join(dir, "no-such-catalogue.csv"),
      );

      expect(file.cells).toHaveLength(1);
      expect(file.cells[0]!.taxa["bacterium aurasus"]).toEqual([1, 0, 1, 0]);
      expect(file.cells[0]!.taxa["frutexa acus"]).toEqual([1, 0, 0, 0]);
      // The bias warning travels with the data, so a reader cannot get the counts without it.
      expect(file.note).toMatch(/what is KNOWN/);
      expect(file.note).toMatch(/commander traffic/i);
      expect(bytes).toBeGreaterThan(0);

      const onDisk = JSON.parse(
        readFileSync(path.join(dir, "data", "exomastery", "sector-map.json"), "utf8"),
      ) as SectorMapFile;
      expect(onDisk.cells).toEqual(file.cells);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A missing catalogue must not lose the markers — a nameless sector is still a place to fly. */
  it("writes cells with a null name when the catalogue is absent", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-map-"));
    try {
      const { file } = writeSectorMapFile(
        dir,
        { entries: aggregateBySector([ev(0, "b1", "x", "confirmed")]), sources: { confirmed: 1, genus: 0, signal: 0 } },
        path.join(dir, "missing.csv"),
      );
      expect(file.cells[0]!.name).toBeNull();
      expect(file.cells[0]!.key).toMatch(/^\d+:\d+:\d+$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns no names rather than throwing when the catalogue cannot be read", () => {
    const r = readSectorNames(path.join(tmpdir(), "definitely-not-here.csv"), new Set(["1:2:3"]));
    expect(r.names).toEqual({});
    expect(r.catalogueCells).toBe(0);
  });
});
