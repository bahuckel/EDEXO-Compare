/**
 * Exomastery and codex files: export, share, merge (owner, 2026-09-26 — BACKLOG §S).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCodexExport,
  buildExomasteryExport,
  clearSharedExomasteryCache,
  exportFileName,
  loadSharedExomastery,
  ownCodexBackupKeys,
  setOwnCommander,
  sharedFindsWithOwnership,
  sharedGateAlerts,
} from "../src/server/sharedExomastery.js";
import { resolveEntryForCatalogRow } from "../src/server/footScannedCatalog.js";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { FootScannedEntry } from "../src/shared/types.js";

function find(over: Partial<FootScannedEntry> = {}): FootScannedEntry {
  return {
    id: "100:3:stratum|stratum07|stratumtectonicasgreen",
    recordedAt: "2026-09-25T22:43:19Z",
    confirmationSource: "analyse",
    planetClass: "High metal content body",
    atmosphereNorm: "CarbonDioxide",
    surfacePressure: 5000,
    surfaceTemperatureK: 180,
    tempBandMinK: 175,
    tempBandMaxK: 185,
    tempMidK: 180,
    surfaceGravityMs2: 2,
    starSystem: "Flyai Flyuae XJ-A d5",
    systemAddress: 100,
    bodyId: 3,
    bodyName: "Flyai Flyuae XJ-A d5 C 6",
    genusLocalised: "Stratum",
    genusSymbol: "$Codex_Ent_Stratum_Genus_Name;",
    speciesLocalised: "Stratum Tectonicas",
    speciesSymbol: "$Codex_Ent_Stratum_07_Name;",
    variantLocalised: "Stratum Tectonicas - Green",
    speciesEntryId: "stratum_stratum_tectonicas",
    dbProbableSpeciesId: null,
    dbProbableDisagreed: false,
    ...over,
  };
}

let dir: string;
const write = (name: string, body: unknown) => writeFileSync(join(dir, name), JSON.stringify(body));
const me = { name: "FALrenica", fid: "F111" };
const bob = { name: "Bob", fid: "F222" };
const eve = { name: "Eve", fid: "F333" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-shared-"));
  clearSharedExomasteryCache();
  setOwnCommander(me);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  clearSharedExomasteryCache();
});

describe("export", () => {
  it("names the file after the commander and leaves test leftovers out", () => {
    expect(exportFileName("exomastery", "FALrenica", new Date("2026-09-26T10:00:00Z"))).toBe(
      "EDEXO-exomastery-FALrenica-2026-09-26.json",
    );
    const f = buildExomasteryExport([find(), find({ id: "x", starSystem: "Test Sector AB-C d1-2" })], me);
    expect(f.kind).toBe("edexo-exomastery");
    expect(f.commander).toEqual(me);
    expect(f.entries.map((e) => e.id)).toEqual([find().id]);
  });

  it("writes the codex as region, species, colour — without the 'any colour' helper keys", () => {
    const f = buildCodexExport(
      new Set(["the veils|stratum tectonicas|green", "the veils|stratum tectonicas|*"]),
      me,
    );
    expect(f.entries).toEqual([{ region: "the veils", species: "stratum tectonicas", colour: "green" }]);
  });
});

describe("the shared folder", () => {
  it("merges duplicates, counts every commander, and skips what it cannot use", () => {
    write("bob.json", buildExomasteryExport([find()], bob));
    write(
      "eve.json",
      buildExomasteryExport([find(), find({ id: "200:1:x", systemAddress: 200, bodyId: 1 })], eve),
    );
    write("notes.json", { hello: "world" });
    write("future.json", { ...buildExomasteryExport([find()], bob), formatVersion: 99 });
    writeFileSync(join(dir, "broken.json"), "{ not json");
    const s = loadSharedExomastery(dir);
    expect(s.finds.size).toBe(2);
    expect(
      s.finds
        .get(find().id)!
        .commanders.map((c) => c.name)
        .sort(),
    ).toEqual(["Bob", "Eve"]);
    const skipped = Object.fromEntries(s.files.filter((f) => f.skipped).map((f) => [f.file, f.skipped]));
    expect(Object.keys(skipped).sort()).toEqual(["broken.json", "future.json", "notes.json"]);
  });

  it("keeps the conditions most commanders agree on", () => {
    write("a.json", buildExomasteryExport([find({ surfaceTemperatureK: 180 })], bob));
    write("b.json", buildExomasteryExport([find({ surfaceTemperatureK: 180 })], eve));
    write(
      "c.json",
      buildExomasteryExport([find({ surfaceTemperatureK: 999 })], { name: "Mallory", fid: "F444" }),
    );
    expect(loadSharedExomastery(dir).finds.get(find().id)!.entry.surfaceTemperatureK).toBe(180);
  });

  it("tells your own backup from other commanders' files by FID", () => {
    write("mine.json", buildExomasteryExport([find()], me));
    write("bob.json", buildExomasteryExport([find({ id: "200:1:x", systemAddress: 200, bodyId: 1 })], bob));
    const rows = sharedFindsWithOwnership(loadSharedExomastery(dir));
    const mine = rows.find((r) => r.find.entry.id === find().id)!;
    const his = rows.find((r) => r.find.entry.id === "200:1:x")!;
    expect([mine.own, mine.others.length]).toEqual([true, 0]);
    expect([his.own, his.others.map((c) => c.name)]).toEqual([false, ["Bob"]]);
  });

  it("restores your own codex, and ignores other commanders' for your [CODEX] marks", () => {
    write("mine-codex.json", buildCodexExport(new Set(["the veils|stratum tectonicas|green"]), me));
    write("bob-codex.json", buildCodexExport(new Set(["inner orion spur|frutexa acus|green"]), bob));
    const keys = ownCodexBackupKeys(loadSharedExomastery(dir));
    expect(keys.has("the veils|stratum tectonicas|green")).toBe(true);
    expect(keys.has("the veils|stratum tectonicas|*")).toBe(true);
    expect(keys.has("inner orion spur|frutexa acus|green")).toBe(false);
  });
});

describe("gate notices", () => {
  it("flags another commander's find that breaks the species' own planet-class rule", () => {
    const db = loadSpeciesDatabase();
    // Stratum grows on rocky/HMC-type bodies; on an Icy body with 30 K it has no business.
    write(
      "bob.json",
      buildExomasteryExport(
        [
          find({
            planetClass: "Icy body",
            surfaceTemperatureK: 30,
            tempBandMinK: 28,
            tempBandMaxK: 32,
            tempMidK: 30,
          }),
        ],
        bob,
      ),
    );
    const alerts = sharedGateAlerts(
      db,
      resolveEntryForCatalogRow,
      (entry, scan, band, range) => speciesMatchesCriteria(entry, scan, band, range, null),
      loadSharedExomastery(dir),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).toContain("CMDR Bob");
    expect(alerts[0]!.detectionSource).toBe("exomastery");
  });

  it("stays quiet about your own finds — your journal already checks those", () => {
    const db = loadSpeciesDatabase();
    write(
      "mine.json",
      buildExomasteryExport([find({ planetClass: "Icy body", surfaceTemperatureK: 30 })], me),
    );
    const alerts = sharedGateAlerts(
      db,
      resolveEntryForCatalogRow,
      (entry, scan, band, range) => speciesMatchesCriteria(entry, scan, band, range, null),
      loadSharedExomastery(dir),
    );
    expect(alerts).toHaveLength(0);
  });
});

describe("commander id", () => {
  it("is hashed one way, stable per commander", async () => {
    const { commanderIdHash } = await import("../src/server/sharedExomastery.js");
    const a = commanderIdHash("F4783286");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("4783286");
    expect(commanderIdHash("F4783286")).toBe(a);
    expect(commanderIdHash("F1")).not.toBe(a);
    expect(commanderIdHash(null)).toBeNull();
  });
});
