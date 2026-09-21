/**
 * Where the learned on-foot catalog lives, and why it is not where it used to be.
 *
 * It sat at `<projectRoot>/data/foot_scanned.json`. In a packaged app the project root is the
 * **install tree**, which made one file wrong in two directions at once:
 *
 * - it shipped — `cpSync("data", …)` put the builder's own landings inside the release and seeded
 *   them into every installer's catalog as bodies they had scanned themselves, and
 * - it did not survive — a portable build extracts per version, and `npm run dist:win` wipes
 *   `dist/electron-out` before writing, so the commander's scan history was deleted by the next
 *   build every single time.
 *
 * It is beside the user settings now, with the LAN key and the outlier log, for the reason those are
 * there: first-hand observation that nothing else can rebuild.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearFootScannedCatalogCache,
  loadFootScannedCatalog,
  resetFootScannedCarryOver,
} from "../src/server/footScannedCatalog.js";
import { resolveFootScannedPath, resolveUserSettingsJsonPath } from "../src/server/paths.js";

let userDir = "";
let projectRoot = "";
let priorEnv: string | undefined;

const legacyFile = () => join(projectRoot, "data", "foot_scanned.json");

/** A catalog file in the old shape, with one row worth recognising. */
function writeLegacy(starSystem: string): void {
  mkdirSync(dirname(legacyFile()), { recursive: true });
  writeFileSync(
    legacyFile(),
    JSON.stringify({
      formatVersion: 1,
      entries: [
        {
          id: "1:2:legacy",
          recordedAt: "2026-01-01T00:00:00Z",
          confirmationSource: "analyse",
          starSystem,
          systemAddress: 1,
          bodyId: 2,
          bodyName: `${starSystem} 1`,
          speciesLocalised: "Bacterium Aurasus",
        },
      ],
    }),
    "utf8",
  );
}

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-foot-user-"));
  projectRoot = mkdtempSync(join(tmpdir(), "edexo-foot-root-"));
  priorEnv = process.env.EDEXO_USER_DATA_DIR;
  process.env.EDEXO_USER_DATA_DIR = userDir;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorEnv;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  rmSync(userDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("the location", () => {
  it("is beside the user settings, not inside the install tree", () => {
    /*
      THE ONE THAT MATTERS. Everything else in this file is about moving gracefully; this is the
      assertion that the destination is right. A path back under the project root would restore both
      the leak and the data loss at once, and neither announces itself.
    */
    expect(dirname(resolveFootScannedPath())).toBe(dirname(resolveUserSettingsJsonPath()));
    expect(resolveFootScannedPath().startsWith(userDir)).toBe(true);
  });

  it("writes new rows where it reads them, not back into the project", () => {
    writeLegacy("Carried Over");
    loadFootScannedCatalog(projectRoot);
    expect(existsSync(resolveFootScannedPath()), "the live file is in the user directory").toBe(true);
  });
});

describe("carrying the old file across", () => {
  it("picks up a catalog left at the old path", () => {
    writeLegacy("Eorgh Prou KN-A d14-201");
    const catalog = loadFootScannedCatalog(projectRoot);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]!.starSystem).toBe("Eorgh Prou KN-A d14-201");
  });

  it("leaves the old file where it is, because the install tree may be read-only", () => {
    // Copied, never moved. A delete that fails on a read-only install must not look like a failed
    // migration, and the old file being left behind costs nothing once it is no longer read.
    writeLegacy("Still There");
    loadFootScannedCatalog(projectRoot);
    expect(existsSync(legacyFile())).toBe(true);
  });

  it("does not overwrite a catalog the commander already has here", () => {
    /*
      The upgrade case, and the one that would quietly destroy data. A release still carrying an old
      `foot_scanned.json` next to a commander's real catalog must not replace it — so the carry-over
      only ever fills an empty slot.
    */
    writeFileSync(
      resolveFootScannedPath(),
      JSON.stringify({
        formatVersion: 1,
        entries: [{ id: "9:9:mine", recordedAt: "2026-02-02T00:00:00Z", starSystem: "Mine", bodyId: 9 }],
      }),
      "utf8",
    );
    writeLegacy("Someone Else's");
    const catalog = loadFootScannedCatalog(projectRoot);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]!.starSystem, "the commander's own rows win").toBe("Mine");
    // And the file on disk was not rewritten either.
    const onDisk = JSON.parse(readFileSync(resolveFootScannedPath(), "utf8")) as {
      entries: { starSystem: string }[];
    };
    expect(onDisk.entries[0]!.starSystem).toBe("Mine");
  });

  it("is an empty catalog when there is nothing in either place", () => {
    const catalog = loadFootScannedCatalog(projectRoot);
    expect(catalog.entries).toEqual([]);
    expect(catalog.formatVersion).toBe(1);
  });
});
