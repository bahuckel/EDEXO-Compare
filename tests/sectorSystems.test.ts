/**
 * INCLUDE-BODY-IDS Phase 10 step 4 — the per-sector system rows.
 *
 * The property that matters is that the two files agree: summing a sector's systems must give the
 * sector's own counts. They are built by separate code paths from the same evidence, so a divergence
 * would show as a sector whose drill-down disagrees with the dot the user just clicked.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { buildSectorMapData, buildSectorSystems, writeSectorSystemsFile } from "../src/feeder/sectorMapData.js";
import { cellTotals, systemTotals, type SectorMapFile } from "../src/shared/sectorMapFile.js";
import { sectorCellFromCoords, sectorCellKey } from "../src/shared/sectorName.js";

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

let corpus: string;
let ctx: FeederContext;

async function seed(rows: string[], coords: { name: string; x: number; y: number; z: number }[]) {
  const p = path.join(corpus, "in.csv");
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  await importCsv(ctx, p);
  ctx.store.setSystemCoords(coords);
  ctx.store.persist();
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-sysmap-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

describe("per-sector systems", () => {
  it("groups systems under the cell their coordinates fall in", async () => {
    await seed(
      [
        "Alpha,Alpha 1 a,Rocky body,100,Osseus Discus,19010000,1",
        "Beta,Beta 2 b,Rocky body,100,Osseus Discus,19010000,1",
      ],
      [
        { name: "Alpha", x: 0, y: 0, z: 0 },
        // Far enough away to land in a different 1280 ly cell.
        { name: "Beta", x: 5000, y: 0, z: 0 },
      ],
    );
    const file = buildSectorSystems(ctx.store);
    const cellA = sectorCellKey(sectorCellFromCoords(0, 0, 0));
    const cellB = sectorCellKey(sectorCellFromCoords(5000, 0, 0));
    expect(cellA).not.toBe(cellB);
    expect(file.cells[cellA]).toHaveLength(1);
    expect(file.cells[cellB]).toHaveLength(1);
    expect(file.cells[cellA]![0]!.name).toBe("Alpha");
  });

  /**
   * The invariant. Two code paths, one answer — otherwise clicking a dot showing 12 bodies would
   * open a sector listing some other number.
   */
  it("sums to the same totals as the galaxy view", async () => {
    await seed(
      [
        "Alpha,Alpha 1 a,Rocky body,100,Osseus Discus,19010000,1",
        "Alpha,Alpha 2 b,Rocky body,100,Osseus Discus,19010000,1",
        "Alpha,Alpha 3 c,Rocky body,100,Bacterium Aurasus,19010000,1",
        "Gamma,Gamma 1 a,Rocky body,100,Osseus Discus,19010000,1",
      ],
      [
        { name: "Alpha", x: 0, y: 0, z: 0 },
        { name: "Gamma", x: 100, y: 0, z: 0 }, // same cell as Alpha
      ],
    );

    const { entries } = buildSectorMapData(ctx.store);
    const systemsFile = buildSectorSystems(ctx.store);
    const cellKey = sectorCellKey(sectorCellFromCoords(0, 0, 0));

    // The galaxy view's per-cell totals, from its own entries.
    const mapCell: SectorMapFile["cells"][number] = {
      key: cellKey,
      x: 0,
      y: 0,
      z: 0,
      name: null,
      taxa: Object.fromEntries(
        entries
          .filter((e) => e.cellKey === cellKey)
          .map((e) => [e.taxon, [e.counts.confirmed, e.counts.genus, e.counts.signal, e.counts.predicted]]),
      ),
    };

    const fromSystems = (systemsFile.cells[cellKey] ?? []).reduce(
      (acc, s) => {
        const t = systemTotals(s);
        acc.confirmed += t.confirmed;
        acc.genus += t.genus;
        acc.signal += t.signal;
        acc.bodies += t.bodies;
        return acc;
      },
      { confirmed: 0, genus: 0, signal: 0, bodies: 0 },
    );

    const fromCell = cellTotals(mapCell);
    expect(fromSystems.confirmed).toBe(fromCell.confirmed);
    expect(fromSystems.genus).toBe(fromCell.genus);
    expect(fromSystems.signal).toBe(fromCell.signal);
    expect(fromSystems.bodies).toBe(fromCell.bodies);
    expect(fromCell.confirmed).toBe(4);
  });

  it("keeps each species separate within a system", async () => {
    await seed(
      [
        "Alpha,Alpha 1 a,Rocky body,100,Osseus Discus,19010000,1",
        "Alpha,Alpha 1 a,Rocky body,100,Bacterium Aurasus,19010000,1",
      ],
      [{ name: "Alpha", x: 0, y: 0, z: 0 }],
    );
    const file = buildSectorSystems(ctx.store);
    const sys = file.cells[sectorCellKey(sectorCellFromCoords(0, 0, 0))]![0]!;
    // One body, two species — two taxa, one body each.
    expect(Object.keys(sys.taxa).sort()).toEqual(["bacterium aurasus", "osseus discus"]);
    expect(systemTotals(sys, "osseus discus").bodies).toBe(1);
    expect(systemTotals(sys, "bacterium aurasus").bodies).toBe(1);
  });

  it("excludes a system with no coordinates rather than drawing it at the origin", async () => {
    await seed(["Alpha,Alpha 1 a,Rocky body,100,Osseus Discus,19010000,1"], []);
    expect(Object.keys(buildSectorSystems(ctx.store).cells)).toHaveLength(0);
  });

  it("writes the file and reports its size", async () => {
    await seed(
      ["Alpha,Alpha 1 a,Rocky body,100,Osseus Discus,19010000,1"],
      [{ name: "Alpha", x: 0, y: 0, z: 0 }],
    );
    const w = writeSectorSystemsFile(corpus, buildSectorSystems(ctx.store));
    expect(w.systems).toBe(1);
    expect(w.bytes).toBeGreaterThan(0);
    expect(w.path).toContain("sector-systems.json");
  });
});
