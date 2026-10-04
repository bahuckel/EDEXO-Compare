/**
 * One spelling per value in the species files (plan 4.3, Fable F6, 2026-10-04): planet types and
 * atmospheres were spelt several ways ("Metal-Rich" / "Metal Rich", "Carbon dioxide" / "CarbonDioxide"
 * / "Carbon Dioxide", "Sulfur" / "Sulphur") and held together by normalisers, and Amphora's "Airless"
 * sat in planet_types where the parser skips it. The cleanup changed no parsed criterion (checked by
 * dumping every species' criteria before and after); this keeps new rows on the allow-list.
 *
 * "CO2-rich", "Carbon dioxide-rich" and "Carbon dioxide rich (thin)" stay as they are: they parse to the
 * CarbonDioxideRich match the journal uses, and a respelling the normaliser reads differently would
 * change which bodies match.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(process.cwd(), "data", "species");
const files = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(root, d.name, `${d.name}_new.json`))
  .filter((f) => {
    try {
      readFileSync(f);
      return true;
    } catch {
      return false;
    }
  });

const PLANET_TYPES = new Set(["Rocky", "High Metal Content", "Icy", "Rocky Ice", "Metal Rich"]);
const GASES = ["Carbon Dioxide", "Sulphur Dioxide", "Ammonia", "Methane", "Water", "Nitrogen", "Oxygen", "Helium", "Neon", "Argon"];
const ATMOSPHERES = new Set([
  "None",
  "Any thin atmosphere",
  ...GASES,
  ...GASES.map((g) => `${g} (thin)`),
  ...["Neon", "Argon", "Methane", "Water"].map((g) => `${g}-rich`),
  "Water-rich (thin)",
  // Kept spellings: they parse to CarbonDioxideRich (see above).
  "CO2-rich",
  "Carbon dioxide-rich",
  "Carbon dioxide rich (thin)",
]);

describe("the species files' vocabulary", () => {
  const rows = files.flatMap((f) => {
    const j = JSON.parse(readFileSync(f, "utf8")) as { species?: { displayName?: string; conditions?: Record<string, unknown> }[] };
    return (j.species ?? []).map((s) => ({ file: path.basename(f), name: s.displayName ?? "?", c: s.conditions ?? {} }));
  });

  it("finds the species rows", () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it("spells every planet type one way, and no 'Airless' among them", () => {
    const bad = rows.flatMap((r) =>
      ((r.c.planet_types as string[] | undefined) ?? []).filter((p) => !PLANET_TYPES.has(p)).map((p) => `${r.name}: ${p}`),
    );
    expect(bad).toEqual([]);
  });

  it("spells every atmosphere one way", () => {
    const bad = rows.flatMap((r) => {
      const a = r.c.atmosphere;
      const list = Array.isArray(a) ? (a as string[]) : typeof a === "string" ? [a] : [];
      return list.filter((x) => !ATMOSPHERES.has(x)).map((x) => `${r.name}: ${x}`);
    });
    expect(bad).toEqual([]);
  });
});
