import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { parseEdsmSystemCoords } from "../src/feeder/edsm.js";

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

let corpus: string;
let ctx: FeederContext;

function csv(rows: string[]): string {
  const p = path.join(corpus, `import-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  return p;
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-coords-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

/**
 * EDSM answers a batch with only the systems it knows, so a missing name is a fact rather than an
 * error, and a row without usable coordinates is worse than no row at all — it would be stored as a
 * position the system does not have.
 */
describe("parseEdsmSystemCoords", () => {
  it("takes the systems that came back with a position", () => {
    expect(
      parseEdsmSystemCoords([
        { name: "Sol", coords: { x: 0, y: 0, z: 0 } },
        { name: "Colonia", coords: { x: -9530.5, y: -910.28125, z: 19808.125 } },
      ]),
    ).toEqual([
      { name: "Sol", x: 0, y: 0, z: 0 },
      { name: "Colonia", x: -9530.5, y: -910.28125, z: 19808.125 },
    ]);
  });

  it("drops rows with no usable position rather than inventing one", () => {
    expect(
      parseEdsmSystemCoords([
        { name: "No Coords" },
        { name: "Partial", coords: { x: 1, y: 2 } },
        { name: "", coords: { x: 1, y: 2, z: 3 } },
        { name: "NaN", coords: { x: Number.NaN, y: 0, z: 0 } },
        "not an object",
      ]),
    ).toEqual([]);
  });

  it("returns nothing for a payload that is not a list", () => {
    expect(parseEdsmSystemCoords({ error: "nope" })).toEqual([]);
    expect(parseEdsmSystemCoords(null)).toEqual([]);
  });
});

/**
 * The corpus was built from an endpoint that does not return coordinates, so they arrive later and
 * a system without them has to be a normal state the store can report on and resume from.
 */
describe("system coordinates in the store", () => {
  it("lists the systems still missing coordinates, and stops listing them once stored", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 4 a,Rocky body,120,Bacterium Aurasus,1000,1",
        "Colonia,Colonia 5 b,Rocky body,90,Stratum Tectonicas,19010800,1",
      ]),
    );
    expect(ctx.store.systemsMissingCoords().sort()).toEqual(["Colonia", "Sol"]);
    expect(ctx.store.getStats().systemsWithCoords).toBe(0);

    const written = ctx.store.setSystemCoords([{ name: "Sol", x: 0, y: 0, z: 0 }]);
    expect(written).toBe(1);
    expect(ctx.store.systemsMissingCoords()).toEqual(["Colonia"]);
    expect(ctx.store.getStats().systemsWithCoords).toBe(1);
    expect(ctx.store.systemCoords().size).toBe(1);
  });

  it("ignores coordinates for a system the corpus has never heard of", async () => {
    await importCsv(ctx, csv(["Sol,Sol 4 a,Rocky body,120,Bacterium Aurasus,1000,1"]));
    expect(ctx.store.setSystemCoords([{ name: "Somewhere Else", x: 1, y: 2, z: 3 }])).toBe(0);
    expect(ctx.store.getStats().uniqueSystems).toBe(1);
  });

  it("matches system names the way the rest of the store does", async () => {
    await importCsv(ctx, csv(["Sol,Sol 4 a,Rocky body,120,Bacterium Aurasus,1000,1"]));
    // Case and surrounding space are normalised on import; the coordinate write has to agree.
    expect(ctx.store.setSystemCoords([{ name: "  sOL ", x: 1, y: 2, z: 3 }])).toBe(1);
    expect([...ctx.store.systemCoords().values()]).toEqual([{ x: 1, y: 2, z: 3 }]);
  });
});
