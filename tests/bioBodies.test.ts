/**
 * The galaxy body file: reading it, and what the scan over it is allowed to claim.
 *
 * The real file is 536 MB, built from a galaxy dump only its owner has, and is not in the
 * repository — so these tests write a small one in the format `scripts/build-bio-bodies.ts`
 * produces and read it back. That makes the **format** the thing under test, which is right: the
 * reader and the builder agree on byte offsets and nothing else checks that they still do.
 *
 * The scan tests care about two things a review cannot see by reading:
 *
 * - **Units.** The dump writes Earth gees and atmospheres where the journal writes m/s² and
 *   pascals, and getting it backwards produces plausible nonsense rather than an error. The 2.5 g
 *   body exists to catch exactly that: unconverted it would read as 0.255 g and sail through a
 *   0.28 g ceiling.
 * - **The evidence filter.** Three independent ticks, the owner's design, and unticking one has to
 *   *exclude* rather than merely deprioritise.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BODY_DSS,
  BODY_LANDABLE,
  clearBioBodiesCache,
  loadBioBodies,
  readBioBodiesSummary,
  type BioBodyRow,
} from "../src/server/bioBodies.js";
import { atmosphereTypeFromDump, galaxyBodyScan, planetClassFromDump } from "../src/server/galaxyBodyScan.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const SYS_RECORD = 28;
const BODY_RECORD = 24;

interface TestBody {
  bodyId: number;
  subType: string;
  atmosphere: string;
  volcanism?: string;
  temperatureK: number;
  gravityG: number;
  pressureAtm: number;
  bioCount: number;
  landable?: boolean;
  dss?: boolean;
  /** The part after the system name, exactly as the builder stores it. */
  suffix: string;
}

interface TestSystem {
  id64: bigint;
  name: string;
  x: number;
  y: number;
  z: number;
  regionId: number;
  starType?: string;
  bodies: TestBody[];
}

/** A file in the builder's own format — see the header of `scripts/build-bio-bodies.ts`. */
function writeBioBodiesFile(file: string, systems: TestSystem[]): void {
  const subTypes: string[] = [];
  const atmospheres: string[] = [];
  const volcanisms: string[] = [];
  const starTypes: string[] = [];
  /** 1-based, with 0 reserved for "not recorded" — the same contract the builder writes. */
  const id = (table: string[], value: string | undefined): number => {
    const s = (value ?? "").trim();
    if (!s) return 0;
    const at = table.indexOf(s);
    if (at >= 0) return at + 1;
    table.push(s);
    return table.length;
  };

  const bodyCount = systems.reduce((n, s) => n + s.bodies.length, 0);
  const sysTable = Buffer.alloc(systems.length * SYS_RECORD);
  const bodyTable = Buffer.alloc(bodyCount * BODY_RECORD);
  const sysNames: Buffer[] = [];
  const bodyNames: Buffer[] = [];
  const nameBuf = (s: string) => {
    const b = Buffer.from(s, "utf8").subarray(0, 255);
    return Buffer.concat([Buffer.from([b.length]), b]);
  };

  let firstBody = 0;
  systems.forEach((sys, i) => {
    const o = i * SYS_RECORD;
    sysTable.writeBigUInt64LE(sys.id64, o);
    sysTable.writeFloatLE(sys.x, o + 8);
    sysTable.writeFloatLE(sys.y, o + 12);
    sysTable.writeFloatLE(sys.z, o + 16);
    sysTable.writeUInt8(sys.regionId, o + 20);
    sysTable.writeUInt8(id(starTypes, sys.starType), o + 21);
    sysTable.writeUInt16LE(sys.bodies.length, o + 22);
    sysTable.writeUInt32LE(firstBody, o + 24);
    sysNames.push(nameBuf(sys.name));

    sys.bodies.forEach((b, j) => {
      const bo = (firstBody + j) * BODY_RECORD;
      bodyTable.writeUInt32LE(i, bo);
      bodyTable.writeUInt16LE(b.bodyId, bo + 4);
      bodyTable.writeUInt8(id(subTypes, b.subType), bo + 6);
      bodyTable.writeUInt8(id(atmospheres, b.atmosphere), bo + 7);
      bodyTable.writeUInt8(id(volcanisms, b.volcanism), bo + 8);
      bodyTable.writeUInt8((b.landable === false ? 0 : BODY_LANDABLE) | (b.dss ? BODY_DSS : 0), bo + 9);
      bodyTable.writeFloatLE(b.temperatureK, bo + 10);
      bodyTable.writeFloatLE(b.gravityG, bo + 14);
      bodyTable.writeFloatLE(b.pressureAtm, bo + 18);
      bodyTable.writeUInt8(b.bioCount, bo + 22);
      bodyTable.writeUInt8(0, bo + 23);
      bodyNames.push(nameBuf(b.suffix));
    });
    firstBody += sys.bodies.length;
  });

  const json = Buffer.from(JSON.stringify({ subTypes, atmospheres, volcanisms, starTypes }), "utf8");
  const header = Buffer.alloc(24);
  header.write("EDEXOBOD", 0, "ascii");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(systems.length, 12);
  header.writeUInt32LE(bodyCount, 16);
  header.writeUInt32LE(json.length, 20);

  writeFileSync(file, Buffer.concat([header, json, sysTable, bodyTable, ...sysNames, ...bodyNames]));
}

/**
 * Two regions, so a region walk has something to leave behind.
 *
 * The conditions are Fonticulua fluctus's — Icy body, thin Oxygen, under 0.28 g — because it is the
 * species the whole feature was first run against in the field.
 */
const FLUCTUS_BODY: TestBody = {
  bodyId: 12,
  subType: "Icy body",
  atmosphere: "Thin Oxygen",
  temperatureK: 151.7,
  gravityG: 0.269,
  pressureAtm: 0.0346,
  bioCount: 2,
  suffix: "A 4",
};

const SYSTEMS: TestSystem[] = [
  {
    id64: 1001n,
    name: "Testia AA-A a1-0",
    x: 10,
    y: 20,
    z: 30,
    regionId: 7,
    starType: "M0",
    bodies: [
      FLUCTUS_BODY,
      // Same world, nine times the gravity. Reading the dump's gees as m/s² would call this 0.255 g
      // and offer the species here, which is the whole point of the row.
      { ...FLUCTUS_BODY, bodyId: 13, suffix: "A 5", gravityG: 2.5 },
      // Probed by somebody: the genus is already public, so the FSS-only tick must exclude it.
      { ...FLUCTUS_BODY, bodyId: 14, suffix: "A 6", dss: true },
    ],
  },
  {
    id64: 1002n,
    name: "Testia BB-B b2-0",
    x: 40,
    y: 50,
    z: 60,
    regionId: 8,
    starType: "K3",
    bodies: [
      { ...FLUCTUS_BODY, bodyId: 21, suffix: "1 a" },
      /*
        The same world under the dump's own spelling of a class the journal writes differently.
        Fonticulua fluctus lists `Rocky ice body`; Spansh writes `Rocky Ice world`, and the matcher
        compares those strings exactly — so without the translation this body is rejected on a
        technicality, and it is 92,883 bodies in Inner Orion Spur alone.
      */
      { ...FLUCTUS_BODY, bodyId: 22, suffix: "1 b", subType: "Rocky Ice world" },
      // Spansh joins what the journal splits: `AtmosphereType` is the composition alone, and the
      // normaliser strips a leading Thin or Thick but not a leading Hot.
      { ...FLUCTUS_BODY, bodyId: 23, suffix: "1 c", atmosphere: "Hot thin Oxygen" },
    ],
  },
];

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-bio-bodies-"));
  file = path.join(dir, "edexo-bio-bodies.bin");
  writeBioBodiesFile(file, SYSTEMS);
  clearBioBodiesCache();
  // The scan reads the cached handle, so priming it here is what points it at the fixture.
  loadBioBodies(file);
});

afterEach(() => {
  clearBioBodiesCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("the galaxy body file", () => {
  it("reads back what the builder wrote", () => {
    const f = loadBioBodies(file)!;
    expect(f.systemCount).toBe(2);
    expect(f.bodyCount).toBe(6);

    const sys = f.system(0);
    expect(sys.name).toBe("Testia AA-A a1-0");
    expect(sys.id64).toBe(1001n);
    expect(sys.regionId).toBe(7);
    expect(sys.starType).toBe("M0");
    expect(sys.bioBodyCount).toBe(3);
    expect([sys.x, sys.y, sys.z]).toEqual([10, 20, 30]);
  });

  it("joins the system name back onto the body suffix", () => {
    // The builder stores only "A 4"; a name the commander can paste has to be whole again.
    const f = loadBioBodies(file)!;
    expect(f.bodyName(0, 0)).toBe("Testia AA-A a1-0 A 4");
    expect(f.bodyName(1, 3)).toBe("Testia BB-B b2-0 1 a");
  });

  it("walks one region and leaves the other alone", () => {
    const f = loadBioBodies(file)!;
    const seen: string[] = [];
    f.forEachInRegion(7, (b) => {
      seen.push(f.bodyName(b.systemIndex, b.bodyIndex));
    });
    expect(seen).toEqual(["Testia AA-A a1-0 A 4", "Testia AA-A a1-0 A 5", "Testia AA-A a1-0 A 6"]);
    const other: number[] = [];
    f.forEachInRegion(8, (b) => void other.push(b.bodyId));
    expect(other).toEqual([21, 22, 23]);
  });

  it("keeps the dump's own units, unconverted", () => {
    const f = loadBioBodies(file)!;
    const rows: BioBodyRow[] = [];
    f.forEachInRegion(7, (b) => {
      rows.push(b.snapshot());
      return false;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gravityG).toBeCloseTo(0.269, 3);
    expect(rows[0]!.pressureAtm).toBeCloseTo(0.0346, 4);
    expect(rows[0]!.temperatureK).toBeCloseTo(151.7, 1);
  });

  it("hands the same cursor to every body, so a kept row must be a snapshot", () => {
    /*
      Not a curiosity — it is the contract that makes a 10.3 M body walk affordable, and the one way
      a caller can silently get four identical rows.
    */
    const f = loadBioBodies(file)!;
    const live: unknown[] = [];
    const copies: number[] = [];
    f.forEachInRegion(7, (b) => {
      live.push(b);
      copies.push(b.snapshot().bodyId);
    });
    expect(new Set(live).size).toBe(1);
    expect(copies).toEqual([12, 13, 14]);
  });

  it("counts systems per region for the picker", () => {
    const counts = loadBioBodies(file)!.systemsByRegion();
    expect(counts[7]).toBe(1);
    expect(counts[8]).toBe(1);
    expect(counts[9]).toBe(0);
  });

  it("answers the picker without loading the file", () => {
    /*
      The map screen asks for the region list the moment it opens. Reading the whole file to answer
      that would leave 536 MB resident for the session on the strength of somebody looking at a map,
      so the summary is a partial read — and it has to agree with the full one exactly.
    */
    const summary = readBioBodiesSummary(file)!;
    expect(summary.systemCount).toBe(2);
    expect(summary.bodyCount).toBe(6);
    expect([...summary.systemsByRegion]).toEqual([...loadBioBodies(file)!.systemsByRegion()]);
  });

  it("has no summary to give when there is no file", () => {
    expect(readBioBodiesSummary(path.join(dir, "not-here.bin"))).toBeNull();
  });

  it("is absent rather than broken when the machine has no file", () => {
    clearBioBodiesCache();
    expect(loadBioBodies(path.join(dir, "not-here.bin"))).toBeNull();
  });
});

/**
 * The vocabulary bridge, tested on its own rather than through the scan.
 *
 * It has to be, for the atmosphere half. Going through the scan proved nothing: `Hot thin Oxygen`
 * matched Fonticulua fluctus whether or not the prefix was stripped, because the matcher's §44
 * observation overrule let it through the back door — the same escape hatch that hid the planet
 * class mismatch for a whole session. A test that passes with the fix reverted is not a test.
 */
describe("the dump's vocabulary against the journal's", () => {
  it("renames the two classes Spansh spells differently", () => {
    expect(planetClassFromDump("High metal content world")).toBe("High metal content body");
    expect(planetClassFromDump("Rocky Ice world")).toBe("Rocky ice body");
  });

  it("leaves the classes both sides spell alike, and renames the rest", () => {
    for (const same of ["Icy body", "Rocky body", "Metal rich body", "Sudarsky class III gas giant"]) {
      expect(planetClassFromDump(same)).toBe(same);
    }
    // Once listed here as already the journal's spelling. The journal writes it without the hyphen.
    expect(planetClassFromDump("Metal-rich body")).toBe("Metal rich body");
    expect(planetClassFromDump("Class III gas giant")).toBe("Sudarsky class III gas giant");
    expect(planetClassFromDump("Earth-like world")).toBe("Earthlike body");
    // A body the dump never classified stays unset rather than becoming an empty class name.
    expect(planetClassFromDump("")).toBeUndefined();
  });

  it("strips the heat word the journal keeps in its prose field", () => {
    // The journal writes AtmosphereType "SulphurDioxide" and Atmosphere "hot thin sulphur dioxide
    // atmosphere". The dump writes one string for both, and the matcher's normaliser strips a
    // leading Thin or Thick and nothing else.
    expect(atmosphereTypeFromDump("Hot thin Sulphur dioxide")).toBe("thin Sulphur dioxide");
    expect(atmosphereTypeFromDump("Hot thick Carbon dioxide")).toBe("thick Carbon dioxide");
    expect(atmosphereTypeFromDump("Hot Water")).toBe("Water");
  });

  it("leaves an ordinary atmosphere alone, and reports none as none", () => {
    expect(atmosphereTypeFromDump("Thin Oxygen")).toBe("Thin Oxygen");
    expect(atmosphereTypeFromDump("")).toBeUndefined();
    // "No atmosphere" travels through as-is; `normalizeScanAtmosphereForMatch` reads it as vacuum,
    // which is what Brain Trees gate on.
    expect(atmosphereTypeFromDump("No atmosphere")).toBe("No atmosphere");
  });
});

describe("what could be there", () => {
  const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
  const fluctus = db.species.find((e) => e.displayName.toLowerCase() === "fonticulua fluctus")!;

  it("offers the species where the conditions suit it", async () => {
    const r = await galaxyBodyScan({ regionId: 7, speciesIds: [fluctus.id], includeUnprobed: true });
    expect(r.available).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.starSystem).toBe("Testia AA-A a1-0");
    expect(r.hits[0]!.bodies.map((b) => b.bodyName)).toEqual(["Testia AA-A a1-0 A 4"]);
    expect(r.hits[0]!.bodies[0]!.species.map((s) => s.displayName)).toEqual([fluctus.displayName]);
  });

  it("reads gravity as gees, not as metres per second squared", () => {
    /*
      `A 5` is `A 4` at 2.5 g. Fonticulua fluctus stops at 0.28 g, so the body must not be offered —
      and if the dump's gees were handed to the matcher unconverted it would divide them by 9.80665,
      call the body 0.255 g, and offer it. The body above proves the scan works; this one proves it
      works for the right reason.
    */
    expect(fluctus.criteria.surfaceGravity?.max).toBe(0.28);
    return galaxyBodyScan({ regionId: 7, speciesIds: [fluctus.id], includeUnprobed: true }).then((r) => {
      const names = r.hits.flatMap((h) => h.bodies.map((b) => b.bodyName));
      expect(names).not.toContain("Testia AA-A a1-0 A 5");
    });
  });

  it("excludes probed bodies unless they are asked for", async () => {
    const without = await galaxyBodyScan({
      regionId: 7,
      speciesIds: [fluctus.id],
      includeUnprobed: true,
      includeProbed: false,
    });
    expect(without.hits[0]!.bodies.map((b) => b.bodyId)).toEqual([12]);

    const with_ = await galaxyBodyScan({
      regionId: 7,
      speciesIds: [fluctus.id],
      includeUnprobed: true,
      includeProbed: true,
    });
    expect(with_.hits[0]!.bodies.map((b) => b.bodyId).sort()).toEqual([12, 14]);
  });

  it("can ask for probed bodies alone", async () => {
    const r = await galaxyBodyScan({
      regionId: 7,
      speciesIds: [fluctus.id],
      includeUnprobed: false,
      includeProbed: true,
    });
    expect(r.hits[0]!.bodies.map((b) => b.bodyId)).toEqual([14]);
  });

  it("answers nothing when neither kind of body is allowed", async () => {
    const r = await galaxyBodyScan({
      regionId: 7,
      speciesIds: [fluctus.id],
      includeUnprobed: false,
      includeProbed: false,
    });
    expect(r.hits).toEqual([]);
    expect(r.bodiesScanned).toBe(0);
  });

  it("stays inside the region it was asked about", async () => {
    const r = await galaxyBodyScan({ regionId: 8, speciesIds: [fluctus.id], includeUnprobed: true });
    expect(r.hits.map((h) => h.starSystem)).toEqual(["Testia BB-B b2-0"]);
  });

  it("reads the dump's spelling of a planet class the journal spells differently", async () => {
    /*
      `Rocky Ice world` is Spansh; `Rocky ice body` is the journal, and every `planetClassAnyOf` in
      the species data. The comparison is an exact string match, so without a translation the body
      is rejected — measured across the whole database, 37 species-and-class verdicts flip from
      rejected to allowed once it is applied, Fonticulua fluctus on Rocky ice among them.
    */
    expect(fluctus.criteria.planetClassAnyOf).toContain("Rocky ice body");
    const r = await galaxyBodyScan({ regionId: 8, speciesIds: [fluctus.id], includeUnprobed: true });
    expect(r.hits[0]!.bodies.map((b) => b.bodyId)).toContain(22);
  });

  it("offers a body whose atmosphere the dump prefixed with Hot", async () => {
    const r = await galaxyBodyScan({ regionId: 8, speciesIds: [fluctus.id], includeUnprobed: true });
    expect(r.hits[0]!.bodies.map((b) => b.bodyId)).toContain(23);
  });

  it("reports the class and atmosphere as the dump wrote them", async () => {
    // The translation is for the matcher, not for the reader: a commander looking this up on Spansh
    // has to see the words Spansh uses.
    const r = await galaxyBodyScan({ regionId: 8, speciesIds: [fluctus.id], includeUnprobed: true });
    const row = r.hits[0]!.bodies.find((b) => b.bodyId === 22)!;
    expect(row.planetClass).toBe("Rocky Ice world");
  });

  it("reports how much ground it covered, not only what it found", () => {
    /*
      The counts are what make the claim readable: one match out of three bodies searched is a
      different statement from one out of three million, and the panel prints both.
    */
    return galaxyBodyScan({ regionId: 7, speciesIds: [fluctus.id], includeUnprobed: true }).then((r) => {
      expect(r.bodiesScanned).toBe(3);
      expect(r.systemsWithCandidates).toBe(1);
      expect(r.systemsSearched).toBe(r.systemsInRegion);
      expect(r.bodiesMatched).toBe(1);
      expect(r.matchedSystems).toBe(1);
      expect(r.regionId).toBe(7);
      expect(r.truncated).toBe(false);
    });
  });

  it("orders by distance when it knows where the commander is", async () => {
    const r = await galaxyBodyScan({
      regionId: 7,
      speciesIds: [fluctus.id],
      includeUnprobed: true,
      from: { x: 0, y: 0, z: 0 },
    });
    // sqrt(10² + 20² + 30²)
    expect(r.hits[0]!.distanceLy).toBeCloseTo(37.417, 2);
  });

  it("asks for nothing and returns nothing, rather than every species in the region", async () => {
    const r = await galaxyBodyScan({ regionId: 7, includeUnprobed: true });
    expect(r.available).toBe(true);
    expect(r.hits).toEqual([]);
    expect(r.speciesConsidered).toBe(0);
  });
});
