/**
 * The foot catalog is written in batches (owner, 2026-09-25: the launcher froze after a long break).
 *
 * A journal replay records hundreds of ScanOrganic lines in a row, and each one used to re-read and
 * rewrite the whole catalog on the thread the launcher window shares. Now a change stays in memory,
 * is visible to every reader at once, moves the cache signature at once, and reaches disk on the
 * next flush — at most a second later, or on shutdown.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearFootScannedCatalogCache,
  flushFootScannedCatalog,
  footScannedCatalogSignature,
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

const record = (bodyId: number) =>
  recordFootScanned(root, {
    systemAddress: 2870514554257,
    bodyId,
    bodyName: `Test ${bodyId}`,
    starSystem: "Test",
    scan,
    lock,
    ts: "2026-09-25T12:00:00Z",
    includeBacterium: true,
    confirmationSource: "sample",
  });

const onDisk = () =>
  (JSON.parse(readFileSync(resolveFootScannedPath(), "utf8")) as { entries: unknown[] }).entries.length;

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-footbatch-"));
  priorEnv = process.env.EDEXO_USER_DATA_DIR;
  process.env.EDEXO_USER_DATA_DIR = userDir;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  if (!resolveFootScannedPath().startsWith(userDir)) throw new Error("refusing to run outside the temp dir");
  writeFileSync(resolveFootScannedPath(), JSON.stringify({ formatVersion: 1, entries: [] }), "utf8");
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorEnv;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  rmSync(userDir, { recursive: true, force: true });
});

describe("batched foot catalog writes", () => {
  it("keeps changes in memory, visible at once, and writes them on flush", () => {
    const before = footScannedCatalogSignature(root);
    record(1);
    record(2);
    expect(loadFootScannedCatalog(root).entries).toHaveLength(2);
    expect(footScannedCatalogSignature(root)).not.toBe(before);
    expect(onDisk()).toBe(0);
    flushFootScannedCatalog();
    expect(onDisk()).toBe(2);
    expect(loadFootScannedCatalog(root).entries).toHaveLength(2);
  });
});
