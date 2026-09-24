/**
 * The EDDN bio-collector export, read into feeder sightings: which rows count, and how a body is
 * re-spelled so a profile sees one key per gas and per material whichever source it came from.
 */
import { describe, expect, it } from "vitest";
import { edsmGasName, labelResolver, parseCaptureExport, toEdsmBody } from "../src/feeder/captureImport.js";

const line = (o: object) => JSON.stringify(o);
const exportText = [
  line({ kind: "manifest" }),
  line({ kind: "system", id64: "1", name: "Sys", coords: { x: 1, y: 2, z: 3 } }),
  line({ kind: "body", systemId64: "1", name: "Sys A", type: "Star", subType: "K (Yellow-Orange) star" }),
  line({
    kind: "body",
    systemId64: "1",
    name: "Sys 1 a",
    type: "Planet",
    signals: {
      organics: [
        { scanType: "Log", name: "Bacterium Aurasus" },
        { scanType: "Sample", name: "Bacterium Aurasus" },
        { scanType: "Analyse", name: "Tussock Ventusa" }, // not authoritative
      ],
    },
    codex: [
      { category: "$Codex_Category_Biology;", name: "Stratum Tectonicas" },
      { category: "$Codex_Category_StellarBodies;", name: "Something Else" },
    ],
  }),
].join("\n");

describe("reading a collector export", () => {
  it("takes Log/Sample and biology codex entries, once per body, and never Analyse", () => {
    const p = parseCaptureExport(exportText);
    expect(p.bodies).toBe(2);
    expect(p.sightings.map((s) => s.captureName).sort()).toEqual(["Bacterium Aurasus", "Stratum Tectonicas"]);
    expect(p.systems.get("1")!.bodies).toHaveLength(2); // the star rides along for host-star context
  });
});

describe("EDSM spelling", () => {
  it("writes gases and materials the way EDSM does", () => {
    expect(edsmGasName("CarbonDioxide")).toBe("Carbon dioxide");
    expect(edsmGasName("SulphurDioxide")).toBe("Sulphur dioxide");
    expect(edsmGasName("Nitrogen")).toBe("Nitrogen");
    const b = toEdsmBody({ materials: { iron: 21.1 }, atmosphereComposition: { CarbonDioxide: 99 }, gravity: 0.26 });
    expect(b.materials).toEqual({ Iron: 21.1 });
    expect(b.atmosphereComposition).toEqual({ "Carbon dioxide": 99 });
    expect(b.gravity).toBe(0.26);
  });

  it("keeps only the fields an EDSM body has, so nothing else becomes a profile parameter", () => {
    const b = toEdsmBody({
      name: "Sys 1 a",
      gravity: 0.2,
      mainStar: false,
      meanAnomaly: 12,
      ascendingNode: 3,
      signals: { organics: [{ lat: 1, lon: 2 }] },
      codex: [{ entryId: 2430207 }],
      keepReason: "bio",
      surfacePressure: null,
    });
    expect(Object.keys(b).sort()).toEqual(["gravity", "isMainStar", "name"]);
  });
});

describe("matching names to corpus labels", () => {
  it("matches on the set of words, so word order does not matter", () => {
    const r = labelResolver(["Albidum Sinuous Tubers", "Bacterium Aurasus"]);
    expect(r("Sinuous Tubers Albidum")).toBe("Albidum Sinuous Tubers");
    expect(r("bacterium aurasus")).toBe("Bacterium Aurasus");
    expect(r("Seed")).toBeNull();
  });
});
