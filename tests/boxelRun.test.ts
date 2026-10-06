/**
 * Boxel scanning from the keyboard (server/boxelRun.ts; owner, 2026-10-06): start / finish a run, the
 * next system copied after each jump, previous / next through the systems still to fly.
 */
import { describe, expect, it } from "vitest";
import { createBoxelRun } from "../src/server/boxelRun.js";
import { createSavedBoxels } from "../src/server/savedBoxels.js";

function setup(opts: { autoCopy?: boolean } = {}) {
  const saved = createSavedBoxels({ filePath: null });
  if (opts.autoCopy === false) saved.setAutoCopyNext(false);
  const visited: string[] = [];
  let current: string | null = null;
  const copied: string[] = [];
  const run = createBoxelRun({
    saved,
    visited: () => visited,
    sightings: () => [],
    currentSystem: () => current,
    deliver: (n) => copied.push(n),
  });
  const jump = (to: string) => {
    visited.push(to);
    current = to;
    return run.onJump();
  };
  return { saved, run, copied, jump, at: (s: string) => ((current = s), visited.push(s)) };
}

describe("a boxel run", () => {
  it("starts on the boxel he is in (saving it), copies the next system after every jump, and ends with the last", () => {
    const t = setup();
    t.at("Eol Prou AB-C d1-0");
    // Saved to -0 and -0 flown: the next is the one after it, which likely exists.
    expect(t.run.toggle()).toEqual({
      running: true,
      boxel: "AB-C d1 Eol Prou",
      copied: "Eol Prou AB-C d1-1",
    });
    t.saved.add("Eol Prou AB-C d1-3");
    expect(t.run.copyNext()).toBe("Eol Prou AB-C d1-1");
    // Jumping out of the boxel still copies the run's next system.
    expect(t.jump("Sol")).toBe("Eol Prou AB-C d1-1");
    expect(t.jump("Eol Prou AB-C d1-1")).toBe("Eol Prou AB-C d1-2");
    expect(t.jump("Eol Prou AB-C d1-2")).toBe("Eol Prou AB-C d1-3");
    // Past the end: the probe, until Not there marks it.
    expect(t.jump("Eol Prou AB-C d1-3")).toBe("Eol Prou AB-C d1-4");
    t.saved.confirmEnd(t.saved.runId()!, 3);
    expect(t.jump("Sol")).toBeNull();
    expect(t.saved.runId()).toBeNull();
  });

  it("finishes on the key, and then copies only on a jump into a saved boxel", () => {
    const t = setup();
    t.saved.add("Eol Prou AB-C d1-5");
    t.at("Eol Prou AB-C d1-0");
    t.run.toggle();
    expect(t.saved.list([])[0]).toMatchObject({ run: true });
    expect(t.run.toggle()).toMatchObject({ running: false, boxel: "AB-C d1 Eol Prou" });
    expect(t.jump("Sol")).toBeNull();
    expect(t.jump("Eol Prou AB-C d1-4")).toBe("Eol Prou AB-C d1-1");
  });

  it("does not start outside a boxel system, and copies nothing on jumps with the setting off", () => {
    const t = setup({ autoCopy: false });
    t.at("Sol");
    expect(t.run.toggle()).toBeNull();
    t.saved.add("Eol Prou AB-C d1-5");
    expect(t.jump("Eol Prou AB-C d1-0")).toBeNull();
    expect(t.copied).toEqual([]);
  });
});

describe("previous / next system", () => {
  it("steps through the systems still to fly, skipping flown and skipped ones, and stops at either end", () => {
    const t = setup();
    const { id } = t.saved.add("Eol Prou AB-C d1-6")!;
    t.saved.setSkipped(id, 3, true);
    t.at("Eol Prou AB-C d1-2");
    // Still to fly: 0, 1, 4, 5, 6, then the probe -7.
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-1");
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-4");
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-5");
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-6");
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-7");
    expect(t.run.step(1)).toBe("Eol Prou AB-C d1-7");
    expect(t.run.step(-1)).toBe("Eol Prou AB-C d1-6");
    expect(t.run.copyNext()).toBe("Eol Prou AB-C d1-0");
    expect(t.run.step(-1)).toBe("Eol Prou AB-C d1-0");
    expect(t.copied.at(-1)).toBe("Eol Prou AB-C d1-0");
  });

  it("has nothing to step through outside a saved boxel with no run", () => {
    const t = setup();
    t.at("Sol");
    expect(t.run.step(1)).toBeNull();
    expect(t.run.copyNext()).toBeNull();
  });
});
