/**
 * The galaxy map's extra layers (src/server/galaxyLayers.ts, D10): built from lists already on this
 * PC, detail lines kept once each.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { galaxyLayer } from "../src/server/galaxyLayers.js";
import { createBookmarksService } from "../src/server/bookmarks.js";
import { layerPointText } from "../src/shared/galaxyLayers.js";
import { resetNspMemo } from "../src/server/edastroNsp.js";
import { GGG_CANDIDATES } from "../src/shared/gggCandidates.js";

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-layers-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetNspMemo();
});
afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe("galaxy map layers", () => {
  it("says a list is missing rather than drawing nothing silently", () => {
    for (const kind of ["poi", "nsp", "carriers"] as const) {
      expect(galaxyLayer(kind, undefined)).toMatchObject({ kind, available: false, points: [] });
    }
  });

  it("draws bookmarks that have coordinates, with their tags and note as the detail", () => {
    const bm = createBookmarksService({ filePath: null });
    bm.save({ system: "Blatrimpe", systemAddress: 7, body: "14 e", bodyKey: "7:45", tags: ["Biology"], note: "Frutexa" }, { x: 1.04, y: 2, z: 3 });
    bm.save({ system: "Nowhere", systemAddress: 8, body: null, bodyKey: null, tags: [], note: "" }, null);
    const d = galaxyLayer("bookmarks", bm);
    expect(d.available).toBe(true);
    expect(d.points).toEqual([[1, 2, 3, "Blatrimpe 14 e", 0, "Blatrimpe"]]);
    expect(layerPointText(d, d.points[0]!)).toEqual({ detail: "Biology — Frutexa", system: "Blatrimpe" });
  });

  it("draws the edGGG catalogue, then the cloud ladder's candidates from the Spansh dump, strongest first", () => {
    const d = galaxyLayer("ggg", undefined);
    const ladder = d.points
      .map((p) => ({ body: p[3], detail: layerPointText(d, p).detail }))
      .filter((p) => p.detail.startsWith("Cloud ladder "));
    expect(ladder.map((p) => p.body).sort()).toEqual(GGG_CANDIDATES.map((c) => c[0]).sort());
    const scores = ladder.map((p) => Number(/^Cloud ladder (\d\.\d)\/5/.exec(p.detail)![1]));
    expect(scores.every((s) => s >= 1.5)).toBe(true);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(5);
    // Every candidate is flagged unconfirmed (drawn grey, badged on the map), and nothing else is.
    const flagged = new Set(d.unconfirmed);
    expect(d.points.filter((_, i) => flagged.has(i)).map((p) => p[3]).sort()).toEqual(ladder.map((p) => p.body).sort());
    // A candidate the commander has confirmed shows as his find, once.
    const [body, system, , , , , x, y, z] = GGG_CANDIDATES[0]!;
    const withOwn = galaxyLayer("ggg", undefined, Date.now(), () => [{ x, y, z, body, system }]);
    expect(withOwn.points.filter((p) => p[3] === body)).toHaveLength(1);
  });
});

