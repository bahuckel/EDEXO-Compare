/**
 * A throw on a timer path is logged and survived (code review 2026-10-10, A1): the server process exits on
 * any uncaught exception, and the desktop app closes with it.
 */
import { describe, expect, it, vi } from "vitest";
import { guarded } from "../src/server/guarded.js";

describe("guarded timer callbacks", () => {
  it("log a failure instead of throwing it, and run again next time", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const tick = guarded("test tick", () => {
      calls++;
      if (calls === 1) throw new Error("bad body record");
    });
    expect(() => tick()).not.toThrow();
    expect(() => tick()).not.toThrow();
    expect(calls).toBe(2);
    expect(err).toHaveBeenCalledWith("[edexo-compare] test tick failed (skipped):", expect.any(Error));
    err.mockRestore();
  });
});
