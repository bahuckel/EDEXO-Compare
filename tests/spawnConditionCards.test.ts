/**
 * The encyclopedia's spawn-condition cards, and whether they still describe the matcher.
 *
 * These cards are a **second reading** of the same species data: the matcher decides, and the cards
 * explain. Nothing makes them agree except care, and on 2026-09-20 they had drifted far enough that
 * five conditions the matcher acts on were drawn nowhere at all — including one that *excludes* a
 * species, so the encyclopedia showed a single blue "Match" on bodies the panel had just removed it
 * from.
 *
 * The audit at the bottom is the part that matters. Everything above it is one case per card, so a
 * failure says which card rather than only that something moved.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { buildEncyclopediaSpawnConditionCards } from "../src/shared/speciesSpawnConditionCards.js";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { REQUIRED_GAS_MIN_SHARE_PCT } from "../src/shared/atmosphereGasShare.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesCriterion, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const species = (name: string): SpeciesEntry => db.species.find((e) => e.displayName === name)!;

function cardsFor(entry: SpeciesEntry, scan: PlanetScan | null = null) {
  const t = scan?.SurfaceTemperature;
  return buildEncyclopediaSpawnConditionCards({
    entry,
    scan,
    estimatedSurfaceTempK: typeof t === "number" ? ({ minK: t, maxK: t, midK: t } as never) : null,
    speciesMatchContext: null,
  });
}
const card = (entry: SpeciesEntry, id: string, scan: PlanetScan | null = null) =>
  cardsFor(entry, scan).find((c) => c.id === id);

const ICY: PlanetScan = {
  BodyName: "test",
  BodyID: 1,
  StarSystem: "t",
  SystemAddress: 1,
  PlanetClass: "Icy body",
  AtmosphereType: "Oxygen",
  SurfaceGravity: 2,
  SurfaceTemperature: 213,
  SurfacePressure: 120,
  Landable: true,
  Volcanism: "",
} as unknown as PlanetScan;

describe("the Presence card", () => {
  const tela = species("Bacterium tela");

  it("states the rule rather than leaving the reader to guess it", () => {
    const c = card(tela, "presence")!;
    expect(c.lines.join(" ")).toContain("volcanism present");
    expect(c.lines.join(" ")).toContain("300 K");
  });

  it("agrees with the matcher on a body the species is excluded from", () => {
    /*
      THE ONE THAT MATTERS. Before this card existed the encyclopedia drew a single blue "Planet
      class · Match" here while the matcher removed tela from the body entirely — the panel and the
      reference disagreeing about the same species on the same rock.
    */
    const verdict = speciesMatchesCriteria(
      tela,
      ICY,
      { minK: 213, maxK: 213 },
      estimatedTemperatureRangeForScan(ICY),
      { surfacePressureAtm: 0.002 },
    );
    expect(verdict.ok).toBe(false);
    const c = card(tela, "presence", ICY)!;
    expect(c.tier).toBe("red");
    expect(c.caption).toContain("No volcanism");
    expect(c.caption).toContain("213.0 K");
  });

  it("agrees with the matcher on each branch in turn", () => {
    const hot = { ...ICY, SurfaceTemperature: 402 };
    const volcanic = { ...ICY, Volcanism: "minor water magma volcanism" };
    for (const scan of [hot, volcanic]) {
      const t = scan.SurfaceTemperature!;
      const verdict = speciesMatchesCriteria(
        species("Bacterium tela"),
        scan,
        { minK: t, maxK: t },
        estimatedTemperatureRangeForScan(scan),
        { surfacePressureAtm: 0.002 },
      );
      expect(verdict.ok).toBe(true);
      expect(card(species("Bacterium tela"), "presence", scan)!.tier).toBe("blue");
    }
  });

  it("is drawn for bacterium, unlike the cards suppressed as clutter", () => {
    // Atmosphere and pressure are hidden for bacterium on purpose. An exclusion is not clutter, and
    // tela is a bacterium, so a blanket suppression would have hidden the only rule it has.
    expect(card(tela, "presence")).toBeTruthy();
  });
});

describe("the Gas share card", () => {
  it("separates two species whose atmosphere label is identical", () => {
    /*
      Fonticulua campestris and upupam both read "Allowed: Argon" and nothing else, so the
      encyclopedia presented the same species twice. The model separates them on how much argon:
      51.97-100 % against 0.36-49.68 %, two ranges that do not touch.
    */
    const a = card(species("Fonticulua campestris"), "gas-share")!.lines.join(" ");
    const b = card(species("Fonticulua upupam"), "gas-share")!.lines.join(" ");
    expect(a).not.toEqual(b);
    expect(a).toContain("Argon");
    expect(b).toContain("Argon");
  });

  it("is drawn for bacterium too — acies keys entirely on it", () => {
    expect(card(species("Bacterium acies"), "gas-share")).toBeTruthy();
  });

  it("says it cannot tell rather than failing a scan with no composition", () => {
    // A cached or pre-Odyssey scan carries no AtmosphereComposition. Inventing a rejection from
    // missing data is worse than letting a rare body through, and the matcher abstains here too.
    const c = card(species("Bacterium acies"), "gas-share", ICY)!;
    expect(c.tier).toBe("yellow");
    expect(c.caption).toContain("No AtmosphereComposition");
  });

  it("reads the share and judges it when the scan does carry composition", () => {
    const withComp = {
      ...ICY,
      AtmosphereType: "Neon",
      atmosphereComposition: [{ Name: "Neon", Percent: 92.4 }],
    } as unknown as PlanetScan;
    const c = card(species("Bacterium acies"), "gas-share", withComp)!;
    expect(c.tier).toBe("blue");
    expect(c.caption).toContain("92.40");

    const trace = {
      ...withComp,
      atmosphereComposition: [{ Name: "Neon", Percent: 5.5 }],
    } as unknown as PlanetScan;
    expect(card(species("Bacterium acies"), "gas-share", trace)!.tier).toBe("red");
  });
});

describe("the Required gas card", () => {
  it("states the floor, not just the gas", () => {
    // Read from the constant rather than written out: the floor moved from 5 % to 1 % once the
    // corpus was counted, and a literal here would have to be edited every time it moves again.
    const c = card(species("Recepta umbrux"), "required-gas")!;
    expect(c.lines.join(" ")).toContain("SulphurDioxide");
    expect(c.lines.join(" ")).toContain(`${REQUIRED_GAS_MIN_SHARE_PCT} %`);
  });

  it("calls a trace a trace", () => {
    /*
      Blu Thua EM-D d12-25 A 1 a: a 99.01 % carbon dioxide body carrying 0.99 % SO2. Both Recepta
      species were offered there once. The gas is present; a trace is not a habitat.
    */
    const traceBody = {
      ...ICY,
      AtmosphereType: "CarbonDioxide",
      atmosphereComposition: [
        { Name: "Carbon dioxide", Percent: 99.01 },
        { Name: "Sulphur dioxide", Percent: 0.99 },
      ],
    } as unknown as PlanetScan;
    const c = card(species("Recepta umbrux"), "required-gas", traceBody)!;
    expect(c.tier).toBe("red");
    expect(c.caption).toContain("trace");
  });
});

describe("the system-body card", () => {
  it("states the requirement for the species that carry it", () => {
    const c = card(species("Amphora plant"), "system-bodies")!;
    expect(c.lines.join(" ")).toContain("system must also hold");
  });

  it("stays neutral, because one scan cannot answer a question about the system", () => {
    // A verdict here would be a guess: the builder is handed one body and the gate reads all of them.
    expect(card(species("Amphora plant"), "system-bodies")!.tier).toBe("neutral");
  });
});

describe("the atmosphere-linked temperature card", () => {
  it("draws both halves of the band", () => {
    // It said "cap <= 195 K" while the rule is 180-195 K for carbon dioxide. Half a rule reads as
    // "anything colder is fine", and the floor is the half that excludes.
    const c = card(species("Concha renibus"), "linked-temp-cap")!;
    expect(c.lines.join(" ")).toContain("180");
    expect(c.lines.join(" ")).toContain("195");
  });
});

describe("the measured temperature band card", () => {
  it("states the band, and is yellow — a demotion, not an exclusion — outside it", () => {
    const hot = { SurfaceTemperature: 193, PlanetClass: "Rocky body", AtmosphereType: "CarbonDioxide" } as unknown as PlanetScan;
    const labiata = species("Concha labiata");
    const banded = { ...labiata, criteria: { ...labiata.criteria, softTemperatureK: { max: 190 } } };
    const c = card(banded, "soft-temp", hot)!;
    expect(c.lines.join(" ")).toContain("190");
    expect(c.tier).toBe("yellow");
  });
});

describe("the measured orbit card", () => {
  it("states the ceiling, blue on a close moon and yellow on a planet round a star", () => {
    const moon = { SemiMajorAxis: 4 * 299_792_458, PlanetClass: "Rocky body", AtmosphereType: "CarbonDioxide" } as unknown as PlanetScan;
    const planet = { SemiMajorAxis: 900 * 299_792_458, PlanetClass: "Rocky body", AtmosphereType: "CarbonDioxide" } as unknown as PlanetScan;
    const near = card(species("Concha labiata"), "soft-orbit", moon)!;
    expect(near.lines.join(" ")).toContain("20 ls");
    expect(near.tier).toBe("blue");
    expect(card(species("Concha labiata"), "soft-orbit", planet)!.tier).toBe("yellow");
  });
});

describe("the audit — every gate the matcher applies is drawn somewhere", () => {
  it("leaves no criterion field unrendered", () => {
    /*
      THE POINT OF THIS FILE.

      The cards and the matcher read the same data through different code, so a condition can be
      added to one and not the other and nothing fails. That is exactly how five of these went
      missing. This walks the criterion fields that actually appear on shipped species and asserts
      that a species carrying one produces at least one card mentioning it.

      When this fails, the fix is a card — not an entry in the allowlist below.
    */
    const KNOWN_UNDRAWN: Readonly<Record<string, string>> = {
      // Read by shared/atmospherePreference.ts as a demotion. No species carries it since tela's row
      // changed on 2026-09-20; if one ever does again, it needs a card and this line goes.
      atmosphereUnfavouredAnyOf: "no species carries it",
      // Prose, rendered by the species card itself rather than as a condition.
      matchContextNotes: "shown as terrain notes",
    };

    /**
     * Suppressed for bacterium only, on purpose, and still required of every other genus.
     *
     * The card builder hides these two for bacterium as clutter — every bacterium row says "Any thin
     * atmosphere" and "thin", so the cards would repeat the same two sentences 24 times. That is a
     * judgement about a *preference* with nothing to distinguish; it is not licence to hide a gate,
     * which is why `presence` and `gas-share` are drawn for bacterium and these are not. Scoped
     * rather than allowlisted outright, so the audit still fails if they go missing for a Fonticulua.
     */
    const UNDRAWN_FOR_BACTERIUM = new Set(["atmosphereTypeAnyOf", "atmospherePressureCategory"]);

    const offenders: string[] = [];
    for (const entry of db.species) {
      const c = entry.criteria as unknown as Record<string, unknown>;
      const drawn = cardsFor(entry);
      const text = drawn
        .map((x) => `${x.id} ${x.label} ${x.lines.join(" ")}`)
        .join(" ")
        .toLowerCase();
      for (const [field, value] of Object.entries(c)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (field in KNOWN_UNDRAWN) continue;
        if (entry.genusDataDir === "bacterium" && UNDRAWN_FOR_BACTERIUM.has(field)) continue;
        if (drawn.length === 0) {
          offenders.push(`${entry.displayName}: ${field} — no cards at all`);
          continue;
        }
        // A field is "drawn" when some card's id or text refers to it. The mapping is deliberately
        // loose: the test is about a condition reaching the reader, not about wording.
        const hints: Record<string, string[]> = {
          presenceAnyOf: ["presence"],
          atmosphereGasSharePct: ["gas-share"],
          atmosphereTypeRequiredAnyOf: ["required-gas"],
          systemBodyClassesAnyOf: ["system-bodies"],
          whenAtmosphereLinkedMinTempK: ["linked-temp-cap"],
          whenAtmosphereLinkedMaxTempK: ["linked-temp-cap"],
          whenAtmosphereLinkedAtmosphereAnyOf: ["linked-temp-cap"],
          planetClassAnyOf: ["planet-class"],
          atmosphereTypeAnyOf: ["atmosphere-type", "genus-airless"],
          atmospherePressureCategory: ["pressure-category"],
          surfaceGravity: ["gravity"],
          surfaceTemperatureK: ["temp", "linked-temp-cap"],
          softTemperatureK: ["soft-temp"],
          softMaxSemiMajorAxisLs: ["soft-orbit"],
          surfacePressure: ["pressure"],
          volcanismIncludes: ["volcanism"],
          volcanismActiveRequired: ["volcanism", "presence"],
          landable: ["landable"],
          parentStarTypeIncludesAnyOf: ["star"],
          orbitDistanceFromParentStarLs: ["orbit"],
          geologicalSignalIncludes: ["geo"],
        };
        const wanted = hints[field];
        if (!wanted) {
          offenders.push(`${entry.displayName}: ${field} — no card mapping declared`);
          continue;
        }
        if (!wanted.some((w) => text.includes(w))) {
          offenders.push(`${entry.displayName}: ${field} — nothing drawn`);
        }
      }
    }
    expect([...new Set(offenders.map((o) => o.split(": ")[1]))].sort()).toEqual([]);
  });
});
