/**
 * The Codex map (owner, 2026-09-27): EDSM's systems per region, coloured by the commander's codex.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexMapRegion, codexMapRegions, resetCodexMapCacheForTests } from "../src/server/codexMap.js";
import { codexEntryKey, codexMapKeyFromLine } from "../src/shared/codexLog.js";
import { regionJoinKey } from "../src/shared/regionMap.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "codexmap-"));
  mkdirSync(path.join(root, "data", "codex"), { recursive: true });
  writeFileSync(
    path.join(root, "data", "codex", "edsm-codex-regions.json"),
    JSON.stringify({
      source: { note: "Codex data provided by EDSM" },
      types: [
        ["codex_ent_stratum_07_m", "Stratum Tectonicas - Green", "bio"],
        ["codex_ent_bacterial_01_k", "Bacterium Aurasus - Green", "bio"],
        ["codex_ent_m_type", "M Type", "bodies"],
      ],
      regions: {
        "The Formidine Rift": {
          bio: [
            ["111", "Sys One", 0, 0, [0, 1]],
            ["222", "Sys Two", 10, 10, [0]],
            ["333", "Sys Three", 20, 20, [1]],
          ],
          bodies: [["111", "Sys One", 0, 0, [2]]],
        },
      },
    }),
  );
  return root;
}

afterEach(() => resetCodexMapCacheForTests());

describe("codex map", () => {
  it("keys a journal CodexEntry the way EDSM names the entry, per region", () => {
    expect(codexEntryKey("$Codex_Ent_Stratum_07_M_Name;")).toBe("codex_ent_stratum_07_m");
    expect(codexEntryKey("$Codex_Ent_K_Type_Name;")).toBe("codex_ent_k_type");
    expect(codexEntryKey("Stratum")).toBe("");
    expect(regionJoinKey("Formidine Rift")).toBe(regionJoinKey("The Formidine Rift"));
    expect(regionJoinKey("Achilles's Altar")).toBe(regionJoinKey("Achilles' Altar"));
    expect(
      codexMapKeyFromLine({ Name: "$Codex_Ent_Stratum_07_M_Name;", Region_Localised: "Formidine Rift" }),
    ).toBe("formidinerift|codex_ent_stratum_07_m");
  });

  it("colours a system by what is logged anywhere in its region", () => {
    const root = fixtureRoot();
    // Logged Stratum Tectonicas Green somewhere else in the region.
    const logged = new Set(["formidinerift|codex_ent_stratum_07_m"]);
    const r = codexMapRegion(root, logged, "Formidine Rift", "bio")!;
    const by = Object.fromEntries(r.systems.map((s) => [s.name, s.status]));
    expect(by).toEqual({ "Sys One": "partial", "Sys Two": "done", "Sys Three": "todo" });
    expect(
      r.systems.find((s) => s.name === "Sys One")!.entries.find((e) => e.key === "codex_ent_stratum_07_m")!
        .logged,
    ).toBe(true);
  });

  it("summarises each region per kind", () => {
    const root = fixtureRoot();
    const s = codexMapRegions(root, new Set(["formidinerift|codex_ent_m_type"]));
    expect(s.available).toBe(true);
    const k = s.regions[0]!.kinds;
    expect(k.bodies).toMatchObject({ systems: 1, entries: 1, logged: 1, done: 1 });
    expect(k.bio).toMatchObject({ systems: 3, entries: 2, logged: 0, todo: 3 });
  });

  it("collects every CodexEntry from the journal, any category", () => {
    const s = new GameStateStore();
    s.apply({
      timestamp: "2026-09-27T01:00:00Z",
      event: "CodexEntry",
      EntryID: 1,
      Name: "$Codex_Ent_M_Type_Name;",
      Name_Localised: "M Type",
      Category: "$Codex_Category_StellarBodies;",
      Region: "$Codex_RegionName_18;",
      Region_Localised: "Inner Orion Spur",
      System: "Sol",
      SystemAddress: 10477373803,
    } as unknown as JournalLine);
    expect(s.codexMapLogged.has("innerorionspur|codex_ent_m_type")).toBe(true);
  });
});
