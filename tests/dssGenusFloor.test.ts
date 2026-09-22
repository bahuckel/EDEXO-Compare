/**
 * A genus the surface scan named always keeps a row on the shown list.
 *
 * The DSS is the game saying what is down there. Every gate in `matchSpecies.ts` is an inference
 * from a corpus of a few thousand bodies, so when the two disagree it is the corpus that is wrong —
 * and a genus with every row demoted is the app contradicting the scanner with nothing on screen to
 * say so.
 *
 * The body here is real: Myiesue CH-L d8-10 body 45, 2026-09-22. Seven signals, seven genera named,
 * five shown. Concha and Tubus were demoted by a 190 K ceiling on a 193 K body — 1.6 % over — and
 * the commander then landed and found Concha labiata exactly where the scanner said it was.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";
import type { GenusHint, PlanetScan } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

/** Myiesue CH-L d8-10 body 45, straight off the commander's own scan. */
const BODY = {
  BodyName: "Myiesue CH-L d8-10 7 a",
  BodyID: 45,
  StarSystem: "Myiesue CH-L d8-10",
  SystemAddress: 357899802443,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  SurfaceTemperature: 192.965118,
  SurfaceGravity: 0.523966,
  SurfacePressure: 7204.72998,
  Volcanism: "",
  Landable: true,
} as unknown as PlanetScan;

const DSS = ["Aleoida", "Bacterium", "Clypeus", "Concha", "Fungoida", "Osseus", "Tubus"];
const hints = DSS.map((g) => ({ Genus_Localised: g }) as unknown as GenusHint);

const shownGenera = (scan: PlanetScan, genera: string[], signals: number | null) => {
  const run = matchDatabaseToScan(
    db,
    scan,
    genera.map((g) => ({ Genus_Localised: g }) as unknown as GenusHint),
    null,
    { includeBacterium: true, biologicalSignals: signals },
  );
  return new Set(shownSpeciesMatches(run.matches).map((m) => m.entry.displayName.split(" ")[0]!));
};

describe("every genus the scan named", () => {
  it("has at least one row a commander can see, on the body that found this", () => {
    /*
      THE ONE THAT MATTERS. Before this, Concha and Tubus had rows — all of them flagged unlikely and
      folded away behind "show unlikely", so the panel offered five genera for seven signals with no
      hint that two were hidden.
    */
    const shown = shownGenera(BODY, DSS, 7);
    for (const genus of DSS) expect(shown, `${genus} was named by the DSS`).toContain(genus);
  });

  it("holds even with no signal count, because the scan named them either way", () => {
    // `FSSBodySignals` is not always in hand; the genus list from the DSS is the harder fact and it
    // stands on its own.
    const shown = shownGenera(BODY, DSS, null);
    expect(shown).toContain("Concha");
    expect(shown).toContain("Tubus");
  });

  it("restores one row, not the whole genus", () => {
    /*
      A floor under the shown list, not a reprieve. Tubus has five rows and the corpus really does
      say most of them are a poor fit for a 193 K body — promoting all five would trade a hidden
      genus for a list that argues with itself.
    */
    const run = matchDatabaseToScan(db, BODY, hints, null, {
      includeBacterium: true,
      biologicalSignals: 7,
    });
    const shown = shownSpeciesMatches(run.matches).filter((m) => m.entry.displayName.startsWith("Tubus "));
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length, "the rest stay behind show-unlikely").toBeLessThan(5);
  });

  it("does not invent a genus the scan did not name", () => {
    // The floor is under the DSS list and nothing else. Osseus is absent from this scan, so no row
    // of it may be rescued onto the shown list.
    const scanned = DSS.filter((g) => g !== "Osseus");
    expect(shownGenera(BODY, scanned, 6)).not.toContain("Osseus");
  });
});

describe("the ceiling this body disproved", () => {
  it("lets Concha labiata and the three Tubus species reach 195 K", () => {
    /*
      Raised from 190 on the commander's own landing at 192.97 K, backed by the corpus: labiata runs
      to 194.6 over 932 bodies, cavas to 194.7 over 1447. Rosarium (176.4) and sororibus (190.0) were
      left alone — their ceilings look real.
    */
    const capOf = (name: string) =>
      db.species.find((e) => e.displayName.toLowerCase() === name.toLowerCase())!.criteria.surfaceTemperatureK
        ?.max ?? null;
    expect(capOf("Concha labiata")).toBe(195);
    expect(capOf("Tubus cavas")).toBe(195);
    expect(capOf("Tubus compagibus")).toBe(195);
    expect(capOf("Tubus conifer")).toBe(195);
    expect(capOf("Tubus rosarium"), "never recorded above 176.4 K").toBe(190);
    expect(capOf("Tubus sororibus"), "stops exactly at 190.0 K").toBe(190);
  });
});
