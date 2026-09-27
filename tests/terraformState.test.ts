import { describe, expect, it } from "vitest";
import { isTerraformableState } from "../src/shared/terraformState.js";

describe("isTerraformableState", () => {
  it("reads the journal's and EDSM/Spansh's words the same way", () => {
    expect(isTerraformableState("Terraformable")).toBe(true);
    expect(isTerraformableState("Candidate for terraforming")).toBe(true);
    expect(isTerraformableState("Not terraformable")).toBe(false);
    expect(isTerraformableState("")).toBe(false);
    expect(isTerraformableState(undefined)).toBe(false);
    expect(isTerraformableState("Terraformed")).toBe(false);
  });
});
