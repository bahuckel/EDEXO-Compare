/**
 * The `Status.json` and journal poll rates are settings, and the point of them is that they take
 * effect **now**.
 *
 * Both were compiled-in constants — `STATUS_POLL_MS = 1000` inside the bootstrap's timer closure
 * and `POLL_MS = 2000` at the top of `journalWatcher.ts`. Changing either meant a rebuild, which for
 * a packaged app means the owner cannot change them at all. The failure this guards against is the
 * easy half-implementation: store the number, persist it, show it in the launcher, and leave the
 * already-armed `setInterval` ticking at the old rate until the next relaunch. That version passes
 * every test you would write about the *value* and does nothing the commander asked for.
 *
 * So the watcher assertions are about the armed timer, not about the field.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JOURNAL_POLL_DEFAULT_MS,
  JOURNAL_POLL_MAX_MS,
  JOURNAL_POLL_MIN_MS,
  STATUS_POLL_DEFAULT_MS,
  STATUS_POLL_MAX_MS,
  STATUS_POLL_MIN_MS,
  clampJournalPollMs,
  clampStatusPollMs,
  pollRatesDto,
} from "../src/shared/pollRates.js";
import { startJournalWatcher, type JournalWatcherHandle } from "../src/server/journalWatcher.js";
import { GameStateStore } from "../src/server/gameState.js";

describe("poll-rate bounds", () => {
  it("clamps rather than refusing, because a timer must always have a number", () => {
    expect(clampStatusPollMs(5)).toBe(STATUS_POLL_MIN_MS);
    expect(clampStatusPollMs(999_999)).toBe(STATUS_POLL_MAX_MS);
    expect(clampJournalPollMs(1)).toBe(JOURNAL_POLL_MIN_MS);
    expect(clampJournalPollMs(999_999)).toBe(JOURNAL_POLL_MAX_MS);
  });

  it("falls back to the default for anything that is not a number", () => {
    /*
      `setInterval(fn, NaN)` fires continuously and `setInterval(fn, undefined)` is a 1 ms loop, so
      a bad value must never reach the timer. The settings file is hand-editable and the route takes
      JSON from a window; both can carry nonsense.
    */
    for (const bad of [NaN, Infinity, null, undefined, "soon", {}, []]) {
      expect(clampStatusPollMs(bad)).toBe(STATUS_POLL_DEFAULT_MS);
      expect(clampJournalPollMs(bad)).toBe(JOURNAL_POLL_DEFAULT_MS);
    }
  });

  it("rounds, so a slider or a pasted float cannot arm a fractional interval", () => {
    expect(clampStatusPollMs(1499.6)).toBe(1500);
    expect(clampJournalPollMs(2499.4)).toBe(2499);
  });

  it("ships the bounds to the launcher so its inputs cannot offer a rejected value", () => {
    const dto = pollRatesDto(1000, 2000);
    expect(dto.statusMinMs).toBe(STATUS_POLL_MIN_MS);
    expect(dto.journalMaxMs).toBe(JOURNAL_POLL_MAX_MS);
    expect(dto.statusDefaultMs).toBe(STATUS_POLL_DEFAULT_MS);
    expect(dto.journalDefaultMs).toBe(JOURNAL_POLL_DEFAULT_MS);
  });
});

describe("the store's pair setter", () => {
  it("reports whether anything moved, so a no-op costs no timer churn and no file write", () => {
    const store = new GameStateStore();
    expect(store.statusPollMs).toBe(STATUS_POLL_DEFAULT_MS);
    expect(store.journalPollMs).toBe(JOURNAL_POLL_DEFAULT_MS);
    expect(store.setPollRates(STATUS_POLL_DEFAULT_MS, JOURNAL_POLL_DEFAULT_MS)).toBe(false);
    expect(store.setPollRates(500, JOURNAL_POLL_DEFAULT_MS)).toBe(true);
    expect(store.statusPollMs).toBe(500);
    expect(store.setPollRates(500, 5000)).toBe(true);
    expect(store.journalPollMs).toBe(5000);
  });

  it("clamps on the way in, so an out-of-range value is stored as what will actually run", () => {
    /*
      The launcher shows what came back from the server, so storing 5 and running 100 would put a
      number on screen that nothing honours.
    */
    const store = new GameStateStore();
    store.setPollRates(1, 10_000_000);
    expect(store.statusPollMs).toBe(STATUS_POLL_MIN_MS);
    expect(store.journalPollMs).toBe(JOURNAL_POLL_MAX_MS);
  });
});

describe("the journal watcher's interval follows the setting", () => {
  let dir: string;
  let watcher: JournalWatcherHandle | null = null;
  let rate = JOURNAL_POLL_DEFAULT_MS;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-poll-"));
    writeFileSync(path.join(dir, "Journal.2026-09-17T100000.01.log"), "");
    rate = JOURNAL_POLL_DEFAULT_MS;
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = null;
    rmSync(dir, { recursive: true, force: true });
  });

  const start = (): JournalWatcherHandle =>
    startJournalWatcher(
      dir,
      () => {},
      async () => {},
      null,
      () => ({ minFileStartUtcMs: null }),
      () => rate,
    );

  it("arms at the rate the getter returns, not at the old module constant", async () => {
    rate = 4321;
    watcher = start();
    await new Promise((r) => setTimeout(r, 30));
    expect(watcher.currentPollMs()).toBe(4321);
  });

  it("re-arms on retimePoll — this is the whole feature", async () => {
    watcher = start();
    await new Promise((r) => setTimeout(r, 30));
    expect(watcher.currentPollMs()).toBe(JOURNAL_POLL_DEFAULT_MS);
    rate = 750;
    watcher.retimePoll();
    expect(watcher.currentPollMs()).toBe(750);
  });

  it("leaves the running timer alone when the number has not moved", async () => {
    /*
      The launcher sends both rates whenever either changes, so `retimePoll` is called for the
      journal even when only the status rate moved. Clearing and re-setting the interval each time
      would throw away whatever part of it had already elapsed, and a commander nudging the status
      field could hold the journal poll off indefinitely.
    */
    watcher = start();
    await new Promise((r) => setTimeout(r, 30));
    const before = watcher.currentPollMs();
    watcher.retimePoll();
    watcher.retimePoll();
    expect(watcher.currentPollMs()).toBe(before);
  });

  it("clamps a getter that returns nonsense instead of arming a runaway timer", async () => {
    rate = 1;
    watcher = start();
    await new Promise((r) => setTimeout(r, 30));
    expect(watcher.currentPollMs()).toBe(JOURNAL_POLL_MIN_MS);
  });
});
