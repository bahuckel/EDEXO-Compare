/**
 * A full journal re-merge must never run twice at once.
 *
 * `resyncAllJournalFiles` starts with `store.resetAll()` and then spends roughly fifteen seconds
 * reading 271 logs back into that store. Two of them overlapping is not merely slow — the second
 * wipes what the first has built, and whichever finishes last saves the remains as a **complete**
 * cache. That is how the commander's 19,000-body history was written back as 215 bodies carrying a
 * single codex species, with the meta still claiming all 271 files merged.
 *
 * The watcher is where it started. A rotation sends `pulse` into a resync; the interval keeps
 * firing; `currentPath` is already the new file so later pulses skip the rotation branch and fall
 * into the `identity !== lastListIdentity` branch instead — stale, because that is only updated
 * once the first resync returns — and each starts a resync of its own. It was always possible. A
 * poll of 500 ms against a 15 s merge made it near-certain, because that ratio is how many pile up.
 *
 * Both halves are tested here: the watcher must not re-enter, and the resync must serialise itself
 * for the callers that are not the watcher at all (`restartJournalPipeline`, a journal-folder
 * change), which a guard living only in the watcher would leave free to collide.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startJournalWatcher, type JournalWatcherHandle } from "../src/server/journalWatcher.js";

let dir: string;
let watcher: JournalWatcherHandle | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logName = (stamp: string) => `Journal.${stamp}.01.log`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-resync-"));
});

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("the watcher", () => {
  it("does not start a second resync while one is running", async () => {
    /*
      The exact shape of the bug: a rotation, a resync that takes far longer than the poll, and a
      poll fast enough to fire many times inside it. Before the guard this recorded 5-6 calls.
    */
    const first = path.join(dir, logName("2026-09-18T100000"));
    writeFileSync(first, "");
    let calls = 0;
    let finished = 0;
    const slowResync = async () => {
      calls += 1;
      await wait(400);
      finished += 1;
    };

    watcher = startJournalWatcher(
      dir,
      () => {},
      slowResync,
      // Seeded, so the watcher does not do its own startup resync and the count is the rotation's.
      { path: first, size: 0 },
      () => ({ minFileStartUtcMs: null }),
      () => 250,
    );

    // Rotate: a newer log appears, which is what sends the first pulse into a resync.
    await wait(60);
    writeFileSync(path.join(dir, logName("2026-09-18T110000")), "");
    await wait(900);

    expect(calls, "one rotation must cause one resync").toBe(1);
    expect(finished).toBe(1);
  });

  it("resyncs again once the first has finished, so a later rotation is not swallowed", async () => {
    /*
      The guard must be a "not now", not a "never". Dropping the second rotation would trade a
      corrupted cache for a stale one.
    */
    const first = path.join(dir, logName("2026-09-18T100000"));
    writeFileSync(first, "");
    let calls = 0;
    const resync = async () => {
      calls += 1;
      await wait(120);
    };

    watcher = startJournalWatcher(
      dir,
      () => {},
      resync,
      { path: first, size: 0 },
      () => ({ minFileStartUtcMs: null }),
      () => 100,
    );

    await wait(60);
    writeFileSync(path.join(dir, logName("2026-09-18T110000")), "");
    await wait(500);
    const afterFirst = calls;
    writeFileSync(path.join(dir, logName("2026-09-18T120000")), "");
    await wait(500);

    expect(afterFirst).toBe(1);
    expect(calls, "a rotation after the resync finished must still resync").toBe(2);
  });
});

describe("serialising the resync itself", () => {
  /**
   * The bootstrap's guard, reproduced exactly: callers share the in-flight promise rather than
   * starting a rival. The real one lives in `edexoBootstrap.resyncAllJournalFiles`; this pins the
   * property, because the failure it prevents is silent and expensive.
   */
  function serialised(inner: () => Promise<void>): () => Promise<void> {
    let inFlight: Promise<void> | null = null;
    return () => {
      if (inFlight) return inFlight;
      const run = inner().finally(() => {
        inFlight = null;
      });
      inFlight = run;
      return run;
    };
  }

  it("runs the merge once however many callers ask at the same time", async () => {
    let started = 0;
    let wipes = 0;
    const merge = serialised(async () => {
      started += 1;
      wipes += 1; // stands for store.resetAll()
      await wait(120);
    });

    await Promise.all([merge(), merge(), merge(), merge(), merge()]);
    expect(started).toBe(1);
    expect(wipes, "the store must be reset once, not once per caller").toBe(1);
  });

  it("lets every caller wait for the same finished merge", async () => {
    // They all want one thing: a store that has finished merging. Sharing the promise gives it.
    const order: string[] = [];
    const merge = serialised(async () => {
      await wait(80);
      order.push("merged");
    });
    await Promise.all([merge().then(() => order.push("a")), merge().then(() => order.push("b"))]);
    expect(order[0]).toBe("merged");
    expect(order.slice(1).sort()).toEqual(["a", "b"]);
  });

  it("starts a fresh merge after the previous one settled", async () => {
    let started = 0;
    const merge = serialised(async () => {
      started += 1;
      await wait(30);
    });
    await merge();
    await merge();
    expect(started).toBe(2);
  });

  it("clears the guard when the merge throws, or nothing could ever resync again", async () => {
    /*
      `.finally()` rather than `.then()`: a resync that fails once must not wedge the app into
      never merging again, which would be a worse bug than the one being fixed.
    */
    let started = 0;
    const merge = serialised(async () => {
      started += 1;
      await wait(10);
      throw new Error("disk went away");
    });
    await expect(merge()).rejects.toThrow("disk went away");
    await expect(merge()).rejects.toThrow("disk went away");
    expect(started).toBe(2);
  });
});
