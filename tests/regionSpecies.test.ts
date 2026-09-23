/**
 * Region is what separates species a codex row cannot.
 *
 * On Blu Thua EM-D d12-25 A 1 a the conditions admitted twenty species for nine biological signals,
 * and against seven of the losers the owner wrote the same two words: region check. He was right
 * about every one.
 */
import { describe, expect, it } from "vitest";
import {
  REGION_ABSENCE_MAX_SHARE,
  REGION_ABSENCE_MIN_BIO_SYSTEMS,
  REGION_GENUS_MIN_RECORDS,
  REGION_GENUS_SHARE_MIN,
  REGION_SIBLING_DEPLETION,
  judgeRegionalGenusShare,
  judgeRegionalPresence,
  regionPresenceDetail,
} from "../src/shared/regionAbsence.js";
import { getProjectRoot } from "../src/server/paths.js";
import { demoteRegionallyRareSiblings } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { SpeciesEntry } from "../src/shared/types.js";
import { regionalGenusEnrichment, regionalGenusShare, regionalPresence } from "../src/server/regionSpeciesData.js";

/** Inner Orion Spur — where the owner was, and the best-sampled region in the corpus. */
const INNER_ORION_SPUR = 18;

describe("judging one species against one region", () => {
  it("calls a species absent when it is below the cut in a well-sampled region", () => {
    const v = judgeRegionalPresence(5, 560_598);
    expect(v.presence).toBe("absent");
  });

  it("calls it present at the cut", () => {
    const d = 560_598;
    expect(judgeRegionalPresence(Math.ceil(d * REGION_ABSENCE_MAX_SHARE), d).presence).toBe("present");
  });

  it("says nothing at all about a region the corpus has barely touched", () => {
    // Aquila's Halo holds 1,629 recorded bio systems. Zero there means zero evidence, not absence.
    expect(judgeRegionalPresence(0, 1_629).presence).toBe("unknown");
    expect(REGION_ABSENCE_MIN_BIO_SYSTEMS).toBe(25_000);
  });

  it("writes a line the commander can check", () => {
    const v = judgeRegionalPresence(5, 560_598);
    const s = regionPresenceDetail("Inner Orion Spur", v, true);
    expect(s).toContain("Inner Orion Spur");
    expect(s).toContain("5");
    expect(s).toContain("low-probability");
  });
});

describe("the shipped table, on the body that prompted it", () => {
  const root = getProjectRoot();
  const at = (id: string) => regionalPresence(root, INNER_ORION_SPUR, id);

  it("keeps the nine species the owner actually walked", () => {
    const found = [
      "tussock_tussock_caputus",
      "bacterium_bacterium_aurasus",
      "fungoida_fungoida_stabitis",
      "aleoida_aleoida_coronamus",
      "cactoida_cactoida_cortexum",
      "stratum_stratum_excutitus",
      "concha_concha_renibus",
      "osseus_osseus_fractus",
      "frutexa_frutexa_acus",
    ];
    for (const id of found) expect(at(id)?.presence, id).toBe("present");
  });

  it("demotes the ones he called out as region misses", () => {
    const misses = [
      "cactoida_cactoida_pullulanta",
      "frutexa_frutexa_fera",
      "fungoida_fungoida_gelata",
      "osseus_osseus_cornibus",
      "stratum_stratum_limaxus",
      "tussock_tussock_pennatis",
      "tussock_tussock_propagito",
    ];
    for (const id of misses) expect(at(id)?.presence, id).toBe("absent");
  });

  it("makes no claim about a species the rollup has never heard of", () => {
    // Brain Trees and Sinuous Tubers are outside the index's 102-species vocabulary.
    expect(at("brain-tree_brain_tree_roseum")?.presence).toBe("unknown");
  });

  it("makes no claim without a region", () => {
    expect(regionalPresence(root, null, "tussock_tussock_caputus")).toBeNull();
    expect(regionalPresence(root, 0, "tussock_tussock_caputus")).toBeNull();
  });
});

/** Galactic Centre in the klightspeed map. */
const GALACTIC_CENTRE = 1;

describe("the rare one of its genus", () => {
  it("is rare under the cut, where the genus has records enough to say so", () => {
    expect(judgeRegionalGenusShare(12, 20_000).rare).toBe(true);
    expect(judgeRegionalGenusShare(Math.ceil(20_000 * REGION_GENUS_SHARE_MIN), 20_000).rare).toBe(false);
    // Too few records of the genus in the region: silence, not a verdict.
    expect(judgeRegionalGenusShare(0, REGION_GENUS_MIN_RECORDS - 1).rare).toBe(false);
  });

  const root = getProjectRoot();
  it("sees divisa beside cultro in Galactic Centre, which the absolute rule could not", () => {
    // Galaxy-wide, divisa is "present" there — 0.022 % of bio systems, just over the absence cut.
    expect(regionalPresence(root, GALACTIC_CENTRE, "tussock_tussock_divisa")?.presence).toBe("present");
    expect(regionalGenusShare(root, GALACTIC_CENTRE, "tussock_tussock_divisa")?.rare).toBe(true);
    expect(regionalGenusShare(root, GALACTIC_CENTRE, "tussock_tussock_cultro")?.rare).toBe(false);
  });

  it("leaves every species the owner walked on Blu Thua alone", () => {
    for (const id of [
      "bacterium_bacterium_aurasus",
      "fungoida_fungoida_stabitis",
      "aleoida_aleoida_coronamus",
      "cactoida_cactoida_cortexum",
      "stratum_stratum_excutitus",
      "concha_concha_renibus",
      "osseus_osseus_fractus",
      "frutexa_frutexa_acus",
      "tussock_tussock_caputus",
    ]) {
      expect(regionalGenusShare(root, INNER_ORION_SPUR, id)?.rare, id).toBe(false);
    }
  });

  it("abstains for a species outside the rollup", () => {
    expect(regionalGenusShare(root, INNER_ORION_SPUR, "brain_trees_brain_tree_roseum")).toBeNull();
  });
});

describe("the rare sibling, in the matcher", () => {
  const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
  const entry = (id: string) => db.species.find((e) => e.id === id)!;
  const shown = (...ids: string[]) => ids.map((id) => ({ entry: entry(id), reasons: [] as never[] }));
  const ctx = { regionIndex: GALACTIC_CENTRE, regionName: "Galactic Centre" };

  it("demotes the rare one when a sibling is shown beside it", () => {
    const strict = shown("tussock_tussock_divisa", "tussock_tussock_cultro");
    const unlikely: typeof strict = [];
    demoteRegionallyRareSiblings(strict as never, unlikely as never, ctx);
    expect(strict.map((m) => m.entry.id)).toEqual(["tussock_tussock_cultro"]);
    expect(unlikely.map((m) => m.entry.id)).toEqual(["tussock_tussock_divisa"]);
  });

  it("never demotes the last one standing", () => {
    // Alone, a rare species is still the best answer the body has — and demoting it would only
    // invite restoreNamedGenera to put back a different one.
    const strict = shown("tussock_tussock_divisa");
    const unlikely: typeof strict = [];
    demoteRegionallyRareSiblings(strict as never, unlikely as never, ctx);
    expect(strict.map((m) => m.entry.id)).toEqual(["tussock_tussock_divisa"]);
    expect(unlikely).toHaveLength(0);
  });
});

/** Trojan Belt: a cavas region, where compagibus is 0.3 % of Tubus records — over the share cut. */
const TROJAN_BELT = 11;

describe("the sibling out of place", () => {
  const root = getProjectRoot();
  const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
  const entry = (id: string) => db.species.find((e) => e.id === id)!;
  const shown = (...ids: string[]) => ids.map((id) => ({ entry: entry(id), reasons: [] as never[] }));

  it("reads compagibus as hundreds of times depleted beside cavas in the Trojan Belt", () => {
    const cavas = regionalGenusEnrichment(root, TROJAN_BELT, "tubus_tubus_cavas")!;
    const compagibus = regionalGenusEnrichment(root, TROJAN_BELT, "tubus_tubus_compagibus")!;
    expect(regionalGenusShare(root, TROJAN_BELT, "tubus_tubus_compagibus")?.rare).toBe(false);
    expect(compagibus / cavas).toBeLessThan(REGION_SIBLING_DEPLETION);
  });

  it("reads a species that is rare everywhere as in its usual place", () => {
    // Bacterium scopulum is under 1 % of Bacterium in Inner Orion Spur — and about as common as it
    // is anywhere. A share cut of 0.5 % would have demoted it; the enrichment does not.
    const e = regionalGenusEnrichment(root, INNER_ORION_SPUR, "bacterium_bacterium_scopulum")!;
    expect(regionalGenusShare(root, INNER_ORION_SPUR, "bacterium_bacterium_scopulum")!.share).toBeLessThan(0.01);
    expect(e).toBeGreaterThan(0.5);
  });

  it("demotes compagibus beside cavas, and says why", () => {
    const strict = shown("tubus_tubus_cavas", "tubus_tubus_compagibus");
    const unlikely: typeof strict = [];
    demoteRegionallyRareSiblings(strict as never, unlikely as never, { regionIndex: TROJAN_BELT, regionName: "Trojan Belt" });
    expect(strict.map((m) => m.entry.id)).toEqual(["tubus_tubus_cavas"]);
    expect(unlikely.map((m) => m.entry.id)).toEqual(["tubus_tubus_compagibus"]);
    const why = (unlikely[0] as unknown as { unlikelyReasons: { detail: string }[] }).unlikelyReasons[0]!.detail;
    expect(why).toMatch(/Out of place in Trojan Belt: relative to Tubus cavas, Tubus compagibus is [\d,]+× rarer/);
  });

  it("leaves scopulum beside verrata alone in Inner Orion Spur", () => {
    const strict = shown("bacterium_bacterium_verrata", "bacterium_bacterium_scopulum");
    const unlikely: typeof strict = [];
    demoteRegionallyRareSiblings(strict as never, unlikely as never, { regionIndex: INNER_ORION_SPUR, regionName: "Inner Orion Spur" });
    expect(strict).toHaveLength(2);
    expect(unlikely).toHaveLength(0);
  });
});
