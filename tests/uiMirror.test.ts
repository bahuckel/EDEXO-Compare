/**
 * The streamer view's settings mirror (owner, 2026-10-04): what it keeps, and when the revision moves.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetUiMirrorForTests, setUiMirror, uiMirror } from "../src/server/uiMirror.js";

describe("uiMirror", () => {
  beforeEach(() => resetUiMirrorForTests());

  it("keeps the edexo.* string settings, and moves the revision only on a change", () => {
    setUiMirror({ "edexo.filters.edexo.candidateView": '"cards"', "other.key": "x", "edexo.fold.body": 1 });
    expect(uiMirror()).toEqual({ rev: 1, values: { "edexo.filters.edexo.candidateView": '"cards"' } });
    setUiMirror({ "edexo.filters.edexo.candidateView": '"cards"' });
    expect(uiMirror().rev).toBe(1);
    setUiMirror({ "edexo.filters.edexo.candidateView": '"rows"' });
    expect(uiMirror().rev).toBe(2);
  });

  it("refuses an oversized value and anything that is not an object", () => {
    setUiMirror({ "edexo.big": "x".repeat(20_001) });
    expect(uiMirror().values).toEqual({});
    setUiMirror("nope");
    expect(uiMirror().values).toEqual({});
  });
});
