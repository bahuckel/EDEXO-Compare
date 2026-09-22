/**
 * The on-foot catalog only accepts a landing the game could actually have produced.
 *
 * Every row is first-hand evidence — "you scanned this species, on this exact body" — and
 * `speciesProvenance` reads it as such. A row keyed on a made-up address therefore claims a landing
 * that never happened, on a body that does not exist.
 *
 * One got in: Tubus Compagibus in a system called "A", at `systemAddress: 1`, with no temperature,
 * no atmosphere and no codex symbols. It passed every other check because a fixture can still name a
 * real genus on a real planet class.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearFootScannedCatalogCache,
  loadFootScannedCatalog,
  recordFootScanned,
  resetFootScannedCarryOver,
} from "../src/server/footScannedCatalog.js";
import { resolveFootScannedPath } from "../src/server/paths.js";
import type { OrganicGenusLock, PlanetScan } from "../src/shared/types.js";

let userDir = "";
let priorEnv: string | undefined;
const root = process.cwd();

const scan = {
  PlanetClass: "Rocky body",
  AtmosphereType: "CarbonDioxide",
  SurfaceTemperature: 180,
  SurfaceGravity: 0.5,
  Landable: true,
} as unknown as PlanetScan;

const lock = {
  genusLocalised: "Tubus",
  genusSymbol: "$Codex_Ent_Tubus_Genus_Name;",
  speciesLocalised: "Tubus Compagibus",
  speciesSymbol: "$Codex_Ent_Tubus_02_Name;",
  variantLocalised: "",
} as unknown as OrganicGenusLock;

const record = (systemAddress: number, starSystem: string) =>
  recordFootScanned(root, {
    systemAddress,
    bodyId: 1,
    bodyName: `${starSystem} 1`,
    starSystem,
    scan,
    lock,
    ts: "2026-09-22T12:00:00Z",
    includeBacterium: true,
    confirmationSource: "analyse",
  });

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-footguard-"));
  priorEnv = process.env.EDEXO_USER_DATA_DIR;
  process.env.EDEXO_USER_DATA_DIR = userDir;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  // The same refusal the other catalog tests carry: these cases write, so a resolver pointed at a
  // real profile would edit a live catalog.
  if (!resolveFootScannedPath().startsWith(userDir)) throw new Error("refusing to run outside the temp dir");
  /*
    Start from an empty catalog on purpose. The project root here is the repo, which still has the
    pre-move `data/foot_scanned.json` in it, and the carry-over would copy those rows in and drown
    the assertions.
  */
  writeFileSync(resolveFootScannedPath(), JSON.stringify({ formatVersion: 1, entries: [] }), "utf8");
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorEnv;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  rmSync(userDir, { recursive: true, force: true });
});

describe("what may be written down as a landing", () => {
  it("refuses a fixture address, which is how the bad row got in", () => {
    record(1, "A");
    expect(loadFootScannedCatalog(root).entries).toHaveLength(0);
  });

  it("accepts a real one", () => {
    // Myiesue CH-L d8-10, where the commander actually found Tubus cavas.
    record(357899802443, "Myiesue CH-L d8-10");
    const entries = loadFootScannedCatalog(root).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.starSystem).toBe("Myiesue CH-L d8-10");
  });

  it("is nowhere near a real address, so it can never reject a genuine landing", () => {
    // Sol is 10,477,373,803; the smallest in the owner's own catalog is 117,415,220,979. The floor
    // is a million — four orders of magnitude of headroom.
    record(10_477_373_803, "Sol");
    expect(loadFootScannedCatalog(root).entries).toHaveLength(1);
  });

  it("refuses the not-a-number cases too", () => {
    record(Number.NaN, "Nowhere");
    record(0, "Nowhere");
    record(-5, "Nowhere");
    expect(loadFootScannedCatalog(root).entries).toHaveLength(0);
  });
});
