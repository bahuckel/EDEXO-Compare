/**
 * Green gas giants (src/shared/greenGasGiant.ts, src/server/greenGiants.ts, owner 2026-09-30): the
 * verdict ladder, the codex ids and their water/ammonia bug, the notices, and the commander's calls.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyGreenGiant,
  greenCodexFits,
  greenCodexId,
  greenGiantIsNewFind,
  greenGiantLabel,
  gggCatalogueNumber,
  isGggClass,
  isK10CodexName,
} from "../src/shared/greenGasGiant.js";
import { GGG_CATALOGUE } from "../src/shared/gggCatalogue.js";
import { createGreenGiantMarks, greenGiantForRecord } from "../src/server/greenGiants.js";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";

const C1 = "Sudarsky class I gas giant";
const C3 = "Sudarsky class III gas giant";

describe("the catalogue", () => {
  it("holds edGGG's list, numbered, with the journal's class names", () => {
    expect(GGG_CATALOGUE.length).toBeGreaterThanOrEqual(70);
    const numbers = GGG_CATALOGUE.map((r) => r[0]);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const [, body, cls, t] of GGG_CATALOGUE) {
      expect(body).toMatch(/\S/);
      expect(isGggClass(cls)).toBe(true);
      expect(t).toBeGreaterThan(50);
    }
    expect(gggCatalogueNumber("Shaulai DL-P d5-274 7")).toBe(1);
    expect(gggCatalogueNumber("shaulai dl-p d5-274 7")).toBe(1);
    expect(gggCatalogueNumber("Shaulai DL-P d5-274 6")).toBeNull();
  });
});

describe("the verdict", () => {
  it("goes codex, then the commander's call, then the catalogue, then the temperature", () => {
    const base = { planetClass: C1, surfaceTemperatureK: 100 };
    expect(classifyGreenGiant({ ...base, codex: true })?.level).toBe("confirmed");
    expect(classifyGreenGiant({ ...base, mark: "yes" })).toMatchObject({ level: "confirmed", why: "You marked it green" });
    expect(classifyGreenGiant({ ...base, bodyName: "Shaulai DL-P d5-274 7" })).toMatchObject({ level: "catalogued", gggNumber: 1 });
    expect(classifyGreenGiant(base)).toBeNull();
  });

  it("likely at a catalogued temperature of the same class, within the journal's precision", () => {
    expect(classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 91.617615 })?.level).toBe("likely");
    expect(classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 91.6181 })?.level).toBe("likely");
    expect(classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 91.62 })).toBeNull();
    // The same temperature on another class says nothing.
    expect(classifyGreenGiant({ planetClass: "Sudarsky class II gas giant", surfaceTemperatureK: 91.617615 })).toBeNull();
  });

  it("possible on the class III 30 K grid, and not between its steps", () => {
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 310 })?.level).toBe("possible");
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 790.0004 })?.level).toBe("possible");
    // 370 is catalogued, so it is more than possible.
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 370 })?.level).toBe("likely");
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 576 })).toBeNull();
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 280 })).toBeNull();
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 820 })).toBeNull();
  });

  it("possible for any gas giant of a green class in a K10 system; never for other classes", () => {
    expect(classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 99, k10InSystem: true })?.level).toBe("possible");
    expect(classifyGreenGiant({ planetClass: "Sudarsky class V gas giant", surfaceTemperatureK: 1500, k10InSystem: true })).toBeNull();
    expect(classifyGreenGiant({ planetClass: "Helium rich gas giant", surfaceTemperatureK: 130, codex: true })).toBeNull();
    expect(classifyGreenGiant({ planetClass: "Icy body", surfaceTemperatureK: 130 })).toBeNull();
  });

  it("'not green' silences a guess, never the codex or the catalogue", () => {
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 370, mark: "no" })).toBeNull();
    expect(classifyGreenGiant({ planetClass: C3, surfaceTemperatureK: 370, mark: "no", codex: true })?.level).toBe("confirmed");
    expect(
      classifyGreenGiant({ planetClass: "Gas giant with water based life", surfaceTemperatureK: 1, bodyName: "Shaulai DL-P d5-274 7", mark: "no" })
        ?.level,
    ).toBe("catalogued");
  });

  it("labels and the new-find flag", () => {
    const own = classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 99, mark: "yes" })!;
    expect(greenGiantLabel(own)).toBe("Green gas giant (confirmed)");
    expect(greenGiantIsNewFind(own)).toBe(true);
    const known = classifyGreenGiant({ planetClass: C1, surfaceTemperatureK: 99, codex: true, bodyName: "Phrio Phoea DM-U c19-5 6" })!;
    expect(greenGiantLabel(known)).toBe("Green gas giant #70");
    expect(greenGiantIsNewFind(known)).toBe(false);
  });
});

describe("codex ids", () => {
  it("reads the journal's name form and knows the water/ammonia bug", () => {
    expect(greenCodexId("$Codex_Ent_Green_Sudarsky_Class_III_Name;")).toBe("codex_ent_green_sudarsky_class_iii");
    expect(greenCodexId("$Codex_Ent_Gas_Clds_Green_Storm_Name;")).toBeNull();
    expect(greenCodexId("$Codex_Ent_Sudarsky_Class_III_Name;")).toBeNull();
    // An ammonia-life GGG logs under the water-life entry.
    expect(greenCodexFits("codex_ent_green_giant_with_water_life", "Gas giant with ammonia based life")).toBe(true);
    expect(greenCodexFits("codex_ent_green_giant_with_water_life", "Gas giant with water based life")).toBe(true);
    expect(greenCodexFits("codex_ent_green_sudarsky_class_i", C3)).toBe(false);
    expect(isK10CodexName("$Codex_Ent_L_Phn_Part_Cld_011_Name;")).toBe(true);
    expect(isK10CodexName("$Codex_Ent_L_Phn_Part_Cld_001_Name;")).toBe(false);
  });
});

describe("the commander's calls", () => {
  it("are kept in a file, cleared with null, and feed the verdict", () => {
    const dir = mkdtempSync(join(tmpdir(), "edexo-ggg-"));
    const file = join(dir, "edexo-ggg-marks.json");
    const marks = createGreenGiantMarks({ filePath: file });
    expect(marks.set("1:5", "yes", { body: "X 5", system: "X" })).toBe(true);
    expect(marks.set("1:5", "yes", { body: "X 5", system: "X" })).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).marks["1:5"]).toMatchObject({ mark: "yes", body: "X 5" });
    const again = createGreenGiantMarks({ filePath: file });
    expect(again.get("1:5")).toBe("yes");
    const rec = { systemAddress: 1, bodyId: 5, bodyName: "X 5", planetClass: C1, surfaceTemperature: 99 };
    const src = { greenCodexBodies: new Map(), k10Systems: new Set<number>(), marks: again };
    expect(greenGiantForRecord(rec, src)?.level).toBe("confirmed");
    again.set("1:5", null, { body: "X 5", system: "X" });
    expect(greenGiantForRecord(rec, src)).toBeNull();
    expect(greenGiantForRecord(rec, { ...src, k10FromEdastro: () => new Set([1]) })?.level).toBe("possible");
    expect(greenGiantForRecord(rec, { ...src, greenCodexBodies: new Map([["1:5", "codex_ent_green_sudarsky_class_i"]]) })?.level).toBe(
      "confirmed",
    );
  });
});

describe("notices", () => {
  const ADDR = 42;
  const ctx = (): NoticesContext => ({
    isKnownBody: () => false,
    allScans: function* () {},
    currentSystem: () => ({ name: "Gree", address: ADDR }),
    greenGiant: (rec) =>
      greenGiantForRecord(rec, { greenCodexBodies: new Map(), k10Systems: new Set(), marks: { get: () => null } }),
    scanOf: (k) => (k === `${ADDR}:7` ? ({ bodyName: "Gree 7" } as never) : null),
  });

  it("a candidate scan, a codex confirmation and a K10 anomaly each come to the mail icon", () => {
    const n = createNoticesService({ filePath: null });
    n.observe(
      {
        timestamp: "2026-09-30T12:00:00Z",
        event: "Scan",
        ScanType: "Detailed",
        StarSystem: "Gree",
        SystemAddress: ADDR,
        BodyID: 7,
        BodyName: "Gree 7",
        PlanetClass: C3,
        SurfaceTemperature: 370,
      },
      ctx(),
    );
    n.observe(
      {
        timestamp: "2026-09-30T12:01:00Z",
        event: "CodexEntry",
        Name: "$Codex_Ent_Green_Sudarsky_Class_III_Name;",
        System: "Gree",
        SystemAddress: ADDR,
        BodyID: 7,
        IsNewEntry: true,
      },
      ctx(),
    );
    n.observe(
      {
        timestamp: "2026-09-30T12:02:00Z",
        event: "CodexEntry",
        Name: "$Codex_Ent_L_Phn_Part_Cld_011_Name;",
        System: "Gree",
        SystemAddress: ADDR,
        BodyID: 3,
      },
      ctx(),
    );
    const titles = n.list().map((x) => x.title);
    expect(titles).toContain("Green gas giant (likely)");
    expect(titles).toContain("Green gas giant — confirmed by the codex");
    expect(titles).toContain("K10-Type Anomaly — a green gas giant is likely here");
    expect(n.list().find((x) => x.id === `ggg-codex:${ADDR}:7`)).toMatchObject({ body: "7", codexNew: true });
  });

  it("stay quiet when green gas giants are switched off", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ notable: { green: false } });
    n.observe(
      { timestamp: "2026-09-30T12:01:00Z", event: "CodexEntry", Name: "$Codex_Ent_Green_Sudarsky_Class_I_Name;", SystemAddress: ADDR, BodyID: 7 },
      ctx(),
    );
    expect(n.list()).toHaveLength(0);
  });
});

describe("the store", () => {
  it("keeps green codex bodies, K10 systems, rings and star age, through the merge cache", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const a = new GameStateStore();
    const t = "2026-09-30T12:00:00Z";
    a.apply({
      timestamp: t,
      event: "CodexEntry",
      Name: "$Codex_Ent_Green_Sudarsky_Class_II_Name;",
      Region_Localised: "Inner Orion Spur",
      System: "Gree",
      SystemAddress: 42,
      BodyID: 7,
    } as never);
    a.apply({ timestamp: t, event: "CodexEntry", Name: "$Codex_Ent_L_Phn_Part_Cld_011_Name;", System: "Gree", SystemAddress: 42, BodyID: 1 } as never);
    a.mergeExplorationScan(
      {
        timestamp: t,
        event: "Scan",
        StarSystem: "Gree",
        SystemAddress: 42,
        BodyID: 0,
        BodyName: "Gree",
        StarType: "M",
        Age_MY: 13_020,
        Rings: [
          { Name: "Gree A Belt", RingClass: "eRingClass_Rocky", MassMT: 1, InnerRad: 1, OuterRad: 2 },
          { Name: "Gree A Ring", RingClass: "eRingClass_Icy", MassMT: 5, InnerRad: 10, OuterRad: 20 },
        ],
      } as never,
      t,
    );
    expect(a.greenCodexBodies.get("42:7")).toBe("codex_ent_green_sudarsky_class_ii");
    expect(a.k10Systems.has(42)).toBe(true);
    const b = new GameStateStore();
    expect(b.hydrateJournalMergePayload(a.serializeJournalMergePayload())).toBe(true);
    expect(b.greenCodexBodies.get("42:7")).toBe("codex_ent_green_sudarsky_class_ii");
    expect(b.k10Systems.has(42)).toBe(true);
    const star = b.explorationScans.get("42:0")!;
    expect(star.ageMy).toBe(13_020);
    expect(star.rings).toEqual([{ name: "Gree A Ring", ringClass: "eRingClass_Icy", massMt: 5, innerRadM: 10, outerRadM: 20 }]);
  });
});
