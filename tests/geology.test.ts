/**
 * The Volcanism field's prediction (src/shared/geology.ts, data/exomastery/geology-by-volcanism.json;
 * owner, 2026-10-05). The owner's own geology codex lines, joined to the body's scan, are the check.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bodyGeology,
  geologyCandidates,
  volcanismKind,
  volcanismLabel,
  type GeologyTable,
} from "../src/shared/geology.js";

const table = JSON.parse(readFileSync("data/exomastery/geology-by-volcanism.json", "utf8")) as GeologyTable;
const names = (v: string, pc: string) => geologyCandidates(table, v, pc).map((c) => c.name);

describe("volcanism words", () => {
  it("reads the kind and the label", () => {
    expect(volcanismKind("minor metallic magma volcanism")).toBe("metallic magma");
    expect(volcanismKind("major silicate vapour geysers volcanism")).toBe("silicate vapour geysers");
    expect(volcanismKind("No volcanism")).toBeNull();
    expect(volcanismKind("")).toBeNull();
    expect(volcanismLabel("minor silicate vapour geysers volcanism")).toBe("Minor silicate vapour geysers");
  });
});

describe("what could be down there", () => {
  it("lists every geology the owner logged, on the body it was logged on", () => {
    // His journals' ten geology codex lines (2026-10-05), as volcanism + body type → entry.
    const logged: [string, string, string][] = [
      ["minor nitrogen magma volcanism", "Icy body", "Nitrogen Ice Fumarole"],
      ["minor nitrogen magma volcanism", "Icy body", "Nitrogen Ice Geyser"],
      ["major silicate vapour geysers volcanism", "High metal content body", "Silicate Magma Lava Spout"],
      ["major silicate vapour geysers volcanism", "High metal content body", "Silicate Vapour Fumarole"],
      ["major silicate vapour geysers volcanism", "High metal content body", "Silicate Vapour Gas Vent"],
      ["minor metallic magma volcanism", "High metal content body", "Sulphur Dioxide Fumarole"],
      ["minor water magma volcanism", "Icy body", "Water Ice Fumarole"],
    ];
    for (const [v, pc, entry] of logged) expect(names(v, pc), `${v} on ${pc}`).toContain(entry);
  });

  it("keeps ice geology to icy bodies and rock geology off them", () => {
    expect(names("minor water geysers volcanism", "Icy body")).toEqual([
      "Water Ice Fumarole",
      "Water Ice Geyser",
    ]);
    expect(names("major metallic magma volcanism", "Metal rich body")).toEqual([
      "Sulphur Dioxide Fumarole",
      "Sulphur Dioxide Gas Vent",
    ]);
    expect(names("minor metallic magma volcanism", "Rocky body")).toContain("Iron Magma Lava Spout");
    expect(names("No volcanism", "Rocky body")).toEqual([]);
  });

  it("marks each Scanned on the body, New Codex, or Already in Codex for the region", () => {
    const g = bodyGeology({
      table,
      volcanism: "minor metallic magma volcanism",
      planetClass: "High metal content body",
      signals: 2,
      loggedHere: ["codex_ent_fumarole_sulphurdioxidemagma"],
      region: "Inner Orion Spur",
      regionLogged: (id) => id === "codex_ent_gas_vents_sulphurdioxidemagma",
    })!;
    expect(g.volcanism).toBe("Minor metallic magma");
    expect(g.signals).toBe(2);
    expect(g.candidates.map((c) => [c.name, c.status])).toEqual([
      ["Sulphur Dioxide Fumarole", "scanned"],
      ["Iron Magma Lava Spout", "new"],
      ["Sulphur Dioxide Gas Vent", "region"],
    ]);
    // No region: nothing is called new or already logged.
    const noRegion = bodyGeology({
      table,
      volcanism: "minor metallic magma volcanism",
      planetClass: "Rocky body",
      signals: 1,
      loggedHere: [],
      region: null,
      regionLogged: () => true,
    })!;
    expect(new Set(noRegion.candidates.map((c) => c.status))).toEqual(new Set(["unknown"]));
    // No volcanism, no signals, nothing logged: no field.
    expect(
      bodyGeology({
        table,
        volcanism: "",
        planetClass: "Icy body",
        signals: 0,
        loggedHere: [],
        region: "Inner Orion Spur",
        regionLogged: () => false,
      }),
    ).toBeNull();
  });
});
