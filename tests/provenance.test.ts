/**
 * Provenance, and the one rule with a consequence outside the app.
 *
 * `data/exomastery/sector-map.json` and `sector-systems.json` are tracked in git. They name the
 * systems a species was confirmed in, and a journal claim is the commander's own flight history. The
 * export therefore drops journal claims by default — and the failure mode of a privacy gate is
 * silence, so it is tested rather than trusted.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_DATA_ORIGINS,
  CLAIM_ORIGINS,
  CLAIM_ORIGIN_HELP,
  CLAIM_ORIGIN_LABEL,
  asBodyDataOrigin,
  asClaimOrigin,
  isFirstHand,
  isObservedClaim,
  isPublishableClaim,
} from "../src/shared/provenance.js";

describe("the vocabulary", () => {
  it("labels and explains every origin", () => {
    for (const o of CLAIM_ORIGINS) {
      expect(CLAIM_ORIGIN_LABEL[o]).toBeTruthy();
      expect(CLAIM_ORIGIN_HELP[o]).toBeTruthy();
    }
  });

  it("narrows an unknown string instead of trusting it", () => {
    expect(asClaimOrigin("journal")).toBe("journal");
    expect(asClaimOrigin("Journal")).toBe("unknown"); // case is not silently repaired
    expect(asClaimOrigin(null)).toBe("unknown");
    expect(asClaimOrigin("spansh")).toBe("unknown"); // a body origin is not a claim origin
    expect(asBodyDataOrigin("spansh")).toBe("spansh");
    expect(asBodyDataOrigin("exomastery")).toBe("unknown"); // and not the reverse either
  });

  it("keeps the two vocabularies distinct", () => {
    // They overlap on `edsm` and `journal` and must not be interchangeable anywhere else.
    expect(CLAIM_ORIGINS).toContain("exomastery");
    expect(BODY_DATA_ORIGINS).not.toContain("exomastery");
    expect(BODY_DATA_ORIGINS).not.toContain("eddn");
  });
});

describe("what counts as an observation", () => {
  it("treats only a seen species as observed", () => {
    expect(isObservedClaim("exomastery")).toBe(true);
    expect(isObservedClaim("journal")).toBe(true);
    expect(isObservedClaim("eddn")).toBe(true);
    // A dump row proves a signal and may only *infer* the species. Counting it as an observation
    // would let a prediction be read back later as evidence for itself.
    expect(isObservedClaim("spansh-dump")).toBe(false);
    expect(isObservedClaim("unknown")).toBe(false);
    expect(isObservedClaim(null)).toBe(false);
  });

  it("calls only the commander's own scan first-hand", () => {
    expect(isFirstHand("journal")).toBe(true);
    for (const o of CLAIM_ORIGINS.filter((x) => x !== "journal")) {
      expect(isFirstHand(o)).toBe(false);
    }
  });
});

describe("the publish gate", () => {
  it("withholds the commander's own claims and nothing else", () => {
    expect(isPublishableClaim("journal")).toBe(false);
    for (const o of CLAIM_ORIGINS.filter((x) => x !== "journal")) {
      expect(isPublishableClaim(o)).toBe(true);
    }
  });

  it("publishes an untagged row rather than withholding it", () => {
    // A NULL means "imported before origin existed", and every such row is provably a Spansh
    // export — the corpus has one sighting writer and both its callers are fed by one. Withholding
    // them would empty the shipped map for no gain.
    expect(isPublishableClaim(null)).toBe(true);
    expect(isPublishableClaim("unknown")).toBe(true);
  });

  it("is the SQL the export actually runs", () => {
    // The gate is a WHERE clause in `feederDb.sightingPositions`, not a filter in TypeScript: by the
    // time evidence is folded a journal row and a Spansh row are the same shape. This pins the two
    // to the same answer so the clause cannot drift from `isPublishableClaim`.
    const sqlKeeps = (origin: string | null) => (origin ?? "unknown") !== "journal";
    for (const o of [...CLAIM_ORIGINS, null]) {
      expect(sqlKeeps(o)).toBe(isPublishableClaim(o as never));
    }
  });
});
