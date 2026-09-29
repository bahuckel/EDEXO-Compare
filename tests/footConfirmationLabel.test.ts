import { describe, expect, it } from "vitest";
import { footConfirmationLabel } from "../src/shared/footConfirmationLabel.js";

describe("foot catalog source label", () => {
  it("says how far the commander got; old rows without a source count as analysed", () => {
    expect(footConfirmationLabel("log")).toBe("Logged");
    expect(footConfirmationLabel("sample")).toBe("Sampled");
    expect(footConfirmationLabel("analyse")).toBe("Analysed");
    expect(footConfirmationLabel(undefined)).toBe("Analysed");
  });
});
