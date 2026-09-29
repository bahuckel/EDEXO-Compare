/**
 * Is Elite running (src/server/gamePresence.ts)? For the HUD overlays, which stayed on top of the
 * desktop after the game closed (guild tester report, 2026-09-30).
 */
import { describe, expect, it } from "vitest";
import { createGamePresence } from "../src/server/gamePresence.js";

function setup(answer: boolean | null) {
  let t = 1_000_000;
  let alive: boolean | null = answer;
  const seen: boolean[] = [];
  const p = createGamePresence({ isGameRunning: async () => alive, autoStart: false, now: () => t });
  p.onChange((r) => seen.push(r));
  return { p, seen, advance: (ms: number) => (t += ms), setAlive: (v: boolean | null) => (alive = v) };
}

describe("game presence", () => {
  it("follows the journal: Shutdown is gone, any other line is back", () => {
    const { p, seen } = setup(null);
    expect(p.running()).toBeNull();
    p.onJournalLine("Music");
    p.onJournalLine("Scan");
    p.onJournalLine("Shutdown");
    p.onJournalLine("Fileheader");
    expect(seen).toEqual([true, false, true]); // changes only, no repeats
  });

  it("catches a crash through the process list, and says nothing when it cannot ask", async () => {
    const { p, seen, setAlive } = setup(true);
    await p.check();
    setAlive(false);
    await p.check();
    setAlive(null);
    await p.check();
    expect(seen).toEqual([true, false]);
  });

  it("does not let the process list undo a Shutdown while the game is still closing", async () => {
    const { p, seen, advance } = setup(true);
    p.onJournalLine("Music");
    p.onJournalLine("Shutdown");
    await p.check(); // the process is still there for a few seconds
    expect(p.running()).toBe(false);
    advance(61_000);
    await p.check(); // a minute on and still there: it really is running (a restart)
    expect(seen).toEqual([true, false, true]);
  });
});
