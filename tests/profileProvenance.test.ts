import { describe, expect, it } from "vitest";
import { hashProfileInput } from "../src/feeder/profileProvenance.js";

/**
 * C3's property: *"the difference between 'the numbers changed' and 'the numbers changed because the
 * input changed'."* These pin the two halves of that — same input hashes the same however it is
 * presented, and any real change to the input moves the hash.
 */
const A = { id: 101, name: "Sol 3", gravity: 1.0, materials: { Iron: 20.1, Carbon: 5 } };
const B = { id: 102, name: "Sol 4", gravity: 0.38, materials: { Carbon: 5, Iron: 20.1 } };

describe("hashProfileInput", () => {
  it("is stable for the same bodies", () => {
    expect(hashProfileInput([A, B])).toBe(hashProfileInput([A, B]));
  });

  /**
   * §46 changed the order samples are read in and moved float summation in the last digit. The hash
   * has to say "same input" across that, or it reports noise instead of news.
   */
  it("does not depend on the order the bodies were read in", () => {
    expect(hashProfileInput([A, B])).toBe(hashProfileInput([B, A]));
  });

  /** JSON key order is an artefact of how a record was built, not a fact about the body. */
  it("does not depend on key order within a body", () => {
    const reordered = { materials: { Iron: 20.1, Carbon: 5 }, gravity: 1.0, name: "Sol 3", id: 101 };
    expect(hashProfileInput([reordered])).toBe(hashProfileInput([A]));
  });

  it("moves when a value changes", () => {
    expect(hashProfileInput([{ ...A, gravity: 1.01 }])).not.toBe(hashProfileInput([A]));
  });

  /**
   * The whole record is hashed, not just the fields the builder reads today. A field that is
   * currently ignored may be read tomorrow, and keeping a read-list in step with the builder for
   * ever is the maintenance trap this deliberately avoids.
   */
  it("moves when a field the builder does not currently read changes", () => {
    expect(hashProfileInput([{ ...A, updateTime: "2026-01-01" }])).not.toBe(hashProfileInput([A]));
  });

  it("moves when a body is added or removed", () => {
    expect(hashProfileInput([A])).not.toBe(hashProfileInput([A, B]));
  });

  it("ignores nulls and non-objects rather than throwing", () => {
    expect(hashProfileInput([A, null, undefined, 7, "x"])).toBe(hashProfileInput([A]));
  });

  it("has a stable answer for no bodies at all", () => {
    expect(hashProfileInput([])).toBe(hashProfileInput([]));
    expect(hashProfileInput([])).not.toBe(hashProfileInput([A]));
  });

  /** Two anonymous bodies with no id and no name still have to order deterministically. */
  it("orders records that carry no identity at all", () => {
    const x = { gravity: 1 };
    const y = { gravity: 2 };
    expect(hashProfileInput([x, y])).toBe(hashProfileInput([y, x]));
  });
});
