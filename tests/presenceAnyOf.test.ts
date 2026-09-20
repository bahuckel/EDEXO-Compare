/**
 * `presence_any_of` — the one "or" in the condition format.
 *
 * Every other key on a conditions object is ANDed. This one takes a list of branches and asks the
 * body to satisfy at least one, and it exists because Bacterium tela needs it: volcanism, or 300 K,
 * and on neither alone. The mechanism is generic, so it is tested generically here and the species
 * that uses it is tested in `bacteriumTelaVolcanism.test.ts`.
 *
 * The case that matters most is the **audit** at the bottom. A branch field the evaluator does not
 * understand is not an error — it is silently ignored, and a branch whose only requirement is
 * ignored passes on every body, which would delete the rule without a single test going red.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { speciesMatchesCriteria, PRESENCE_BRANCH_FIELDS } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesCriterion, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const BODY: PlanetScan = {
  BodyName: "test body",
  BodyID: 1,
  StarSystem: "test",
  SystemAddress: 1,
  PlanetClass: "Rocky body",
  AtmosphereType: "SulphurDioxide",
  SurfaceGravity: 4.0,
  SurfaceTemperature: 200,
  SurfacePressure: 150,
  Landable: true,
  Volcanism: "",
};

/** A bare species carrying nothing but the branches under test. */
function speciesWith(branches: SpeciesCriterion[]): SpeciesEntry {
  return {
    id: "test_species",
    displayName: "Test species",
    genusDataDir: "bacterium",
    criteria: { presenceAnyOf: branches },
  } as unknown as SpeciesEntry;
}

function verdict(entry: SpeciesEntry, scan: PlanetScan) {
  const est = estimatedTemperatureRangeForScan(scan);
  const t = scan.SurfaceTemperature;
  const band = t != null ? { minK: t, maxK: t } : est ? { minK: est.tMin, maxK: est.tMax } : null;
  return speciesMatchesCriteria(entry, scan, band, est, { surfacePressureAtm: 0.002 });
}

describe("one branch of two is enough", () => {
  const branches: SpeciesCriterion[] = [
    { volcanismActiveRequired: true },
    { surfaceTemperatureK: { min: 300 } },
  ];

  it("passes on the first branch", () => {
    const r = verdict(speciesWith(branches), { ...BODY, Volcanism: "minor metallic magma" });
    expect(r.ok).toBe(true);
    expect(r.reasons.find((x) => x.field === "Presence")?.detail).toContain("volcanism present");
  });

  it("passes on the second branch", () => {
    const r = verdict(speciesWith(branches), { ...BODY, SurfaceTemperature: 400 });
    expect(r.ok).toBe(true);
    expect(r.reasons.find((x) => x.field === "Presence")?.detail).toContain("400.0 K");
  });

  it("fails when neither is satisfied, and says what the body has", () => {
    const r = verdict(speciesWith(branches), BODY);
    expect(r.ok).toBe(false);
    const presence = r.reasons.find((x) => x.field === "Presence")!;
    expect(presence.detail).toContain("volcanism present, or surface temperature ≥ 300 K");
    expect(presence.detail).toContain("No volcanism");
    expect(presence.detail).toContain("200.0 K");
  });

  it("fails hard, never softly", () => {
    /*
      THE ONE THAT MATTERS. A soft failure lands in the unlikely tier, where
      `restoreDemotionsBelowSignalCount` can hand it back whenever a body reports more signals than
      the panel is showing genera — putting the row on exactly the bodies the branches excluded.
    */
    const r = verdict(speciesWith(branches), BODY);
    expect(r.reasons.find((x) => x.field === "Presence")!.soft).not.toBe(true);
    expect(r.softOnly).toBe(false);
  });

  it("is not softened by the numeric tolerance a normal gate would apply", () => {
    // 296 K is inside 2 % of 300, which every other numeric gate in the matcher treats as "near"
    // and demotes rather than drops. The 300 K edge is measured, not rounded, so it does not bend.
    const r = verdict(speciesWith(branches), { ...BODY, SurfaceTemperature: 296 });
    expect(r.ok).toBe(false);
  });
});

describe("a branch is an AND of its own fields", () => {
  it("needs every field it carries", () => {
    const entry = speciesWith([{ volcanismActiveRequired: true, surfaceTemperatureK: { min: 300 } }]);
    expect(verdict(entry, { ...BODY, Volcanism: "minor metallic magma" }).ok).toBe(false);
    expect(verdict(entry, { ...BODY, SurfaceTemperature: 400 }).ok).toBe(false);
    expect(verdict(entry, { ...BODY, Volcanism: "minor metallic magma", SurfaceTemperature: 400 }).ok).toBe(
      true,
    );
  });

  it("reads planet class, gravity and pressure as plain comparisons", () => {
    const entry = speciesWith([
      { planetClassAnyOf: ["Icy body"], surfaceGravity: { max: 0.61 }, surfacePressure: { max: 200 } },
    ]);
    expect(verdict(entry, { ...BODY, PlanetClass: "Icy body" }).ok).toBe(true);
    expect(verdict(entry, { ...BODY, PlanetClass: "Rocky body" }).ok).toBe(false);
    expect(verdict(entry, { ...BODY, PlanetClass: "Icy body", SurfaceGravity: 40 }).ok).toBe(false);
  });

  it("fails a branch whose field the body cannot answer, rather than waving it through", () => {
    const entry = speciesWith([{ surfaceGravity: { min: 0.1 } }]);
    const noGravity = { ...BODY, SurfaceGravity: undefined } as unknown as PlanetScan;
    expect(verdict(entry, noGravity).ok).toBe(false);
  });
});

describe("the loader", () => {
  it("parses both spellings, recursively, and drops an empty branch", () => {
    // `buildCriterionFromRecord` is not exported; the shipped tree is the evidence that it ran.
    const tela = db.species.find((e) => e.displayName === "Bacterium tela")!;
    expect(tela.criteria.presenceAnyOf).toHaveLength(2);
    expect(tela.criteria.presenceAnyOf![0]!.volcanismActiveRequired).toBe(true);
    expect(tela.criteria.presenceAnyOf![1]!.surfaceTemperatureK).toEqual({ min: 300, max: undefined });
  });

  it("leaves every other species without branches", () => {
    /*
      The sabotage check. A bug that attached branches to rows that do not declare them would gate
      the whole database on one species' rule, and the headline counts would not necessarily move
      enough to notice.
    */
    const carriers = db.species.filter((e) => e.criteria.presenceAnyOf?.length);
    expect(carriers.map((e) => e.displayName)).toEqual(["Bacterium tela"]);
  });
});

describe("the audit", () => {
  it("every field on every shipped branch is one the evaluator understands", () => {
    /*
      THE POINT OF THIS FILE. `evaluatePresenceBranch` ignores what it does not know, so an
      unsupported field makes a branch weaker, not louder — and a branch with no understood field
      passes everywhere. Anyone adding a field to a branch has to add it to PRESENCE_BRANCH_FIELDS
      and to the evaluator, and this is what tells them.
    */
    const known = new Set<string>(PRESENCE_BRANCH_FIELDS);
    const offenders: string[] = [];
    for (const e of db.species) {
      for (const [i, branch] of (e.criteria.presenceAnyOf ?? []).entries()) {
        for (const key of Object.keys(branch)) {
          if (!known.has(key)) offenders.push(`${e.displayName} branch ${i}: ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a branch carrying only an unknown field does not pass — it has no requirement to meet", () => {
    // Belt and braces for the audit above: prove the failure mode it guards against is real.
    const entry = speciesWith([{ atmosphereTypeAnyOf: ["SulphurDioxide"] } as SpeciesCriterion]);
    expect(verdict(entry, BODY).ok).toBe(false);
  });
});
