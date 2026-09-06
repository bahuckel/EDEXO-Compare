/**
 * INCLUDE-BODY-IDS Phase 3 — the three rules that footfall and mapping live or die by.
 *
 * Each test names the cost of getting it wrong, because these are not style choices: rule 1 is a ×5
 * payout, rule 2 is telling a commander a walked body is virgin, rule 3 is a 400 ly flight to find
 * boot prints.
 */
import { describe, expect, it } from "vitest";
import {
  ODYSSEY_RELEASE_ISO,
  UNOBSERVED,
  mergeObservation,
  mergeObservations,
  observationAgeLabel,
  observationAgeMs,
  predatesExobiology,
  rungEvidence,
  targetRung,
  type Observation,
} from "../src/shared/observedFlag.js";

const obs = (value: boolean, seenAt: string, source: Observation["source"] = "journal"): Observation => ({
  value,
  source,
  seenAt,
});

const T2019 = "2019-06-01T00:00:00Z";
const T2024 = "2024-06-01T00:00:00Z";
const T2026 = "2026-09-01T00:00:00Z";

describe("rule 1 — unknown is never false", () => {
  it("starts unobserved, and unobserved is a real answer", () => {
    expect(UNOBSERVED).toEqual({ value: null, source: null, seenAt: null });
    expect(mergeObservations([])).toEqual(UNOBSERVED);
  });

  it("a body with no observation is not 'unopened' — that would claim a ×5 we cannot see", () => {
    expect(targetRung(UNOBSERVED, UNOBSERVED)).toBe("unknown");
  });

  it("one flag observed and the other unknown is still unknown, not unopened", () => {
    const footFalse = mergeObservation(UNOBSERVED, obs(false, T2026));
    expect(targetRung(footFalse, UNOBSERVED)).toBe("unknown");
    expect(targetRung(UNOBSERVED, footFalse)).toBe("unknown");
  });
});

describe("rule 2 — true is sticky, whatever arrives later", () => {
  it("a newer false does not clear an older true", () => {
    const walked = mergeObservation(UNOBSERVED, obs(true, T2019));
    const after = mergeObservation(walked, obs(false, T2026));
    expect(after.value).toBe(true);
    expect(after.seenAt).toBe(T2019);
  });

  it("a true from any source beats a false from any source", () => {
    const f = mergeObservation(UNOBSERVED, obs(false, T2026, "journal"));
    expect(mergeObservation(f, obs(true, T2019, "eddn")).value).toBe(true);
    expect(mergeObservation(f, obs(true, T2019, "spansh")).value).toBe(true);
  });

  it("between two trues it keeps the earlier — the more informative claim", () => {
    const late = mergeObservation(UNOBSERVED, obs(true, T2026));
    expect(mergeObservation(late, obs(true, T2019)).seenAt).toBe(T2019);
    const early = mergeObservation(UNOBSERVED, obs(true, T2019));
    expect(mergeObservation(early, obs(true, T2026)).seenAt).toBe(T2019);
  });

  /**
   * The property that makes replaying journals or an EDDN batch safe: the same observations in any
   * order produce the same flag. §C's acceptance rule 5b in the plan asks for exactly this.
   */
  it("is order-independent", () => {
    const all = [obs(false, T2019), obs(true, T2024), obs(false, T2026, "eddn")];
    const forward = mergeObservations(all);
    const backward = mergeObservations([...all].reverse());
    const shuffled = mergeObservations([all[2]!, all[0]!, all[1]!]);
    expect(forward).toEqual(backward);
    expect(forward).toEqual(shuffled);
    expect(forward.value).toBe(true);
  });
});

describe("rule 3 — a false carries its age, and the freshest wins", () => {
  it("keeps the newest false", () => {
    const old = mergeObservation(UNOBSERVED, obs(false, T2019));
    const fresh = mergeObservation(old, obs(false, T2026));
    expect(fresh.seenAt).toBe(T2026);
  });

  it("does not go backwards on a stale false", () => {
    const fresh = mergeObservation(UNOBSERVED, obs(false, T2026));
    expect(mergeObservation(fresh, obs(false, T2019)).seenAt).toBe(T2026);
  });

  it("ages an observation in words a commander can act on", () => {
    const now = Date.parse("2026-09-06T12:00:00Z");
    const at = (iso: string) => observationAgeLabel({ value: false, source: "journal", seenAt: iso }, now);
    expect(at("2026-09-06T06:00:00Z")).toBe("today");
    expect(at("2026-09-05T06:00:00Z")).toBe("yesterday");
    expect(at("2026-08-20T12:00:00Z")).toBe("17 days ago");
    expect(at("2026-05-06T12:00:00Z")).toBe("4 months ago");
    expect(at("2019-06-01T00:00:00Z")).toBe("7 years ago");
    expect(observationAgeLabel(UNOBSERVED, now)).toBeNull();
    expect(observationAgeMs(UNOBSERVED, now)).toBeNull();
  });
});

describe("the Odyssey trap — a 2019 map says nothing about plants", () => {
  it("flags a map made before exobiology existed", () => {
    expect(predatesExobiology({ value: true, source: "eddn", seenAt: T2019 })).toBe(true);
    expect(predatesExobiology({ value: true, source: "eddn", seenAt: T2024 })).toBe(false);
  });

  it("says nothing about a false or an unknown — the trap is about maps that exist", () => {
    expect(predatesExobiology({ value: false, source: "eddn", seenAt: T2019 })).toBe(false);
    expect(predatesExobiology(UNOBSERVED)).toBe(false);
  });

  it("Odyssey's date is the boundary", () => {
    expect(Date.parse(ODYSSEY_RELEASE_ISO)).toBeLessThan(Date.parse(T2024));
    expect(Date.parse(ODYSSEY_RELEASE_ISO)).toBeGreaterThan(Date.parse(T2019));
  });
});

describe("the target ladder", () => {
  const F = (v: boolean, t: string) => mergeObservation(UNOBSERVED, obs(v, t));

  it("walked outranks everything, because footfall is permanent", () => {
    expect(targetRung(F(true, T2019), F(false, T2026))).toBe("walked");
    expect(targetRung(F(true, T2019), F(true, T2026))).toBe("walked");
  });

  /**
   * The owner's inversion: a map is evidence somebody looked at the genera and declined, not a
   * head start. So mapped-not-walked sits *below* unopened.
   */
  it("mapped-but-not-walked ranks below unopened", () => {
    expect(targetRung(F(false, T2026), F(true, T2024))).toBe("mapped-not-walked");
    expect(targetRung(F(false, T2026), F(false, T2026))).toBe("unopened");
  });

  it("unopened rests on the older of its two falses, because that one has had longest to rot", () => {
    const foot = F(false, T2026);
    const mapped = F(false, T2019);
    expect(targetRung(foot, mapped)).toBe("unopened");
    expect(rungEvidence("unopened", foot, mapped).seenAt).toBe(T2019);
  });

  it("names the evidence behind each rung, and none for unknown", () => {
    expect(rungEvidence("walked", F(true, T2024), UNOBSERVED).seenAt).toBe(T2024);
    expect(rungEvidence("mapped-not-walked", UNOBSERVED, F(true, T2024)).seenAt).toBe(T2024);
    expect(rungEvidence("unknown", UNOBSERVED, UNOBSERVED)).toEqual(UNOBSERVED);
  });
});
