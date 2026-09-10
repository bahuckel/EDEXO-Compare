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
  judgeRegionalPresence,
  regionPresenceDetail,
} from "../src/shared/regionAbsence.js";
import { getProjectRoot } from "../src/server/paths.js";
import { regionalPresence } from "../src/server/regionSpeciesData.js";

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
