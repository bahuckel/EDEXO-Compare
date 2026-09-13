/**
 * Sending the journal to EDSM.
 *
 * This is the first thing in the project that sends the commander's own journal anywhere, so the
 * tests are about the ways that goes wrong rather than the way it goes right: a discard list that
 * did not load must send nothing, a rejected API key must stop instead of retrying against a
 * volunteer service, and a run interrupted halfway must resume where it stopped rather than at the
 * beginning or past the gap.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmp: string;
let ledgerPath: string;
vi.mock("../src/server/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/paths.js")>("../src/server/paths.js");
  return { ...actual, resolveEdsmUploadLedgerPath: () => ledgerPath };
});

const {
  EdsmTransientTracker,
  edsmMsgClass,
  postEdsmJournalBatch,
  resetEdsmDiscardCacheForTests,
  seedEdsmDiscardCacheForTests,
} = await import("../src/server/edsmUpload.js");
const { runEdsmCatchUp } = await import("../src/server/edsmCatchUp.js");
const { readEdsmUploadLedger, resetEdsmUploadLedgerForTests } = await import(
  "../src/server/edsmUploadLedger.js"
);

const creds = { commanderName: "TESTCMDR", apiKey: "0123456789abcdef0123456789abcdef01234567" };

/** A journal file, one JSON object per line, as the game writes them. */
function writeJournal(dir: string, name: string, lines: Record<string, unknown>[]): string {
  const p = path.join(dir, name);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return p;
}

/** Collects every batch it is given and answers the way EDSM does. */
function fakeEdsm(opts: { failAfter?: number; fatal?: boolean } = {}) {
  const batches: Record<string, unknown>[][] = [];
  const forms: URLSearchParams[] = [];
  let calls = 0;
  const impl = (async (_url: string, init?: RequestInit) => {
    calls++;
    const form = new URLSearchParams(String(init?.body ?? ""));
    forms.push(form);
    const events = JSON.parse(form.get("message") ?? "[]") as Record<string, unknown>[];
    batches.push(events);
    if (opts.failAfter != null && calls > opts.failAfter) {
      const body = opts.fatal
        ? { msgnum: 201, msg: "Commander name/API key not found" }
        : { msgnum: 500, msg: "Server busy" };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(
      JSON.stringify({ msgnum: 100, msg: "OK", events: events.map(() => ({ msgnum: 100 })) }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { impl, batches, forms, get calls() { return calls; } };
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "edexo-edsm-"));
  ledgerPath = path.join(tmp, "edexo-edsm-uploaded.json");
  resetEdsmUploadLedgerForTests();
  resetEdsmDiscardCacheForTests();
  seedEdsmDiscardCacheForTests(["Music", "ReceiveText"]);
});

afterEach(() => {
  resetEdsmUploadLedgerForTests();
  resetEdsmDiscardCacheForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe("reply codes", () => {
  it("reads the class off the hundreds digit", () => {
    expect(edsmMsgClass(100)).toBe("ok");
    expect(edsmMsgClass(201)).toBe("fatal");
    expect(edsmMsgClass(401)).toBe("rejected");
    expect(edsmMsgClass(500)).toBe("deferred");
  });

  it("treats a 2xx as fatal, so a bad key is not retried for ever", async () => {
    const server = fakeEdsm({ failAfter: 0, fatal: true });
    const res = await postEdsmJournalBatch(creds, [{ event: "FSDJump" }], { gameVersion: null, gameBuild: null }, server.impl);
    expect(res.ok).toBe(false);
    expect(res.fatal).toBe(true);
    expect(res.error).toContain("Commander name/API key not found");
  });

  it("counts a 5xx as accepted, because EDSM kept the events", async () => {
    const server = fakeEdsm({ failAfter: 0, fatal: false });
    const res = await postEdsmJournalBatch(creds, [{ event: "FSDJump" }, { event: "Scan" }], { gameVersion: null, gameBuild: null }, server.impl);
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(2);
    expect(res.fatal).toBe(false);
  });

  it("counts a per-event 4xx as rejected rather than accepted", async () => {
    const impl = (async () =>
      new Response(
        JSON.stringify({ msgnum: 100, events: [{ msgnum: 100 }, { msgnum: 401 }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const res = await postEdsmJournalBatch(creds, [{ event: "A" }, { event: "B" }], { gameVersion: null, gameBuild: null }, impl);
    expect(res).toMatchObject({ ok: true, accepted: 1, rejected: 1 });
  });
});

describe("the transient fields", () => {
  it("stamps events with the system the commander was in at the time", () => {
    const t = new EdsmTransientTracker();
    t.observe({ event: "FSDJump", StarSystem: "Sol", StarPos: [0, 0, 0] } as never);
    const stamped = t.stamp({ event: "Scan", BodyName: "Sol 4" } as never);
    expect(stamped._systemName).toBe("Sol");
    expect(stamped._systemCoordinates).toEqual([0, 0, 0]);
  });

  it("forgets the station on undocking, and takes the ship from LoadGame", () => {
    const t = new EdsmTransientTracker();
    t.observe({ event: "Docked", StarSystem: "Sol", StationName: "Abraham Lincoln" } as never);
    t.observe({ event: "LoadGame", ShipID: 7 } as never);
    expect(t.stamp({ event: "X" } as never)._stationName).toBe("Abraham Lincoln");
    t.observe({ event: "Undocked" } as never);
    const after = t.stamp({ event: "X" } as never);
    expect(after._stationName).toBeUndefined();
    expect(after._shipId).toBe(7);
  });

  it("takes the game version from Fileheader, which is what EDSM asks for", () => {
    const t = new EdsmTransientTracker();
    t.observe({ event: "Fileheader", gameversion: "4.0.0.1904", build: "r308767/r0 " } as never);
    expect(t.snapshot()).toMatchObject({ gameVersion: "4.0.0.1904", gameBuild: "r308767/r0" });
  });
});

describe("a catch-up run", () => {
  const journal = (n: number) => [
    { timestamp: "2026-09-01T10:00:0" + n + "Z", event: "Fileheader", gameversion: "4.0", build: "r1" },
    { timestamp: "2026-09-01T10:01:0" + n + "Z", event: "FSDJump", StarSystem: "Sol", StarPos: [0, 0, 0] },
    { timestamp: "2026-09-01T10:02:0" + n + "Z", event: "Music", MusicTrack: "NoTrack" },
    { timestamp: "2026-09-01T10:03:0" + n + "Z", event: "Scan", BodyName: "Sol " + n },
  ];

  it("sends what EDSM wants and skips what it publishes as unwanted", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    const server = fakeEdsm();
    const p = await runEdsmCatchUp({
      journalDir: tmp,
      credentials: creds,
      fetchImpl: server.impl,
      gapMs: 0,
    });
    expect(p.error).toBeNull();
    expect(p.eventsDiscarded).toBe(1);
    const sent = server.batches.flat().map((e) => e.event);
    expect(sent).toEqual(["Fileheader", "FSDJump", "Scan"]);
  });

  it("sends the credentials and this client's identity with every batch", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    const server = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: server.impl, gapMs: 0 });
    const form = server.forms[0]!;
    expect(form.get("commanderName")).toBe("TESTCMDR");
    expect(form.get("apiKey")).toBe(creds.apiKey);
    expect(form.get("fromSoftware")).toBe("ED Exo Compare");
    expect(form.get("fromGameVersion")).toBe("4.0");
    expect(form.get("fromGameBuild")).toBe("r1");
  });

  it("stamps the scan with the system, not with wherever the app is now", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    const server = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: server.impl, gapMs: 0 });
    const scan = server.batches.flat().find((e) => e.event === "Scan")!;
    expect(scan._systemName).toBe("Sol");
  });

  it("sends nothing the second time", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    const first = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: first.impl, gapMs: 0 });
    const second = fakeEdsm();
    const p = await runEdsmCatchUp({
      journalDir: tmp,
      credentials: creds,
      fetchImpl: second.impl,
      gapMs: 0,
    });
    expect(second.calls).toBe(0);
    expect(p.eventsSent).toBe(0);
  });

  it("sends only the new lines when the journal has grown", async () => {
    const name = "Journal.2026-09-01T100000.01.log";
    writeJournal(tmp, name, journal(1));
    const first = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: first.impl, gapMs: 0 });

    writeJournal(tmp, name, [...journal(1), { timestamp: "2026-09-01T11:00:00Z", event: "Scan", BodyName: "Sol 9" }]);
    const second = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: second.impl, gapMs: 0 });
    const sent = second.batches.flat();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.BodyName).toBe("Sol 9");
    // And it still knows where that body was, from lines it had already uploaded.
    expect(sent[0]!._systemName).toBe("Sol");
  });

  it("resumes at the interruption rather than at the start or past the gap", async () => {
    const name = "Journal.2026-09-01T100000.01.log";
    writeJournal(tmp, name, journal(1));
    const broken = fakeEdsm({ failAfter: 0, fatal: true });
    const p1 = await runEdsmCatchUp({
      journalDir: tmp,
      credentials: creds,
      fetchImpl: broken.impl,
      gapMs: 0,
    });
    expect(p1.fatal).toBe(true);
    expect(readEdsmUploadLedger().files[name]).toBeUndefined();

    const good = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: good.impl, gapMs: 0 });
    expect(good.batches.flat().map((e) => e.event)).toEqual(["Fileheader", "FSDJump", "Scan"]);
  });

  it("stops on a fatal reply instead of walking the rest of the history", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    writeJournal(tmp, "Journal.2026-09-02T100000.01.log", journal(2));
    const server = fakeEdsm({ failAfter: 0, fatal: true });
    const p = await runEdsmCatchUp({
      journalDir: tmp,
      credentials: creds,
      fetchImpl: server.impl,
      gapMs: 0,
    });
    expect(p.fatal).toBe(true);
    expect(server.calls).toBe(1);
    expect(p.filesDone).toBe(0);
  });

  it("sends nothing at all when the discard list could not be fetched", async () => {
    // Otherwise one failed request puts four years of Music events on someone else's server.
    resetEdsmDiscardCacheForTests();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    try {
      writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
      const server = fakeEdsm();
      const p = await runEdsmCatchUp({
        journalDir: tmp,
        credentials: creds,
        fetchImpl: server.impl,
        gapMs: 0,
      });
      expect(server.calls).toBe(0);
      expect(p.error).toContain("could not be fetched");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("does not re-read a file whose remaining events are all discarded", async () => {
    const name = "Journal.2026-09-01T100000.01.log";
    writeJournal(tmp, name, [{ timestamp: "2026-09-01T10:00:00Z", event: "Music", MusicTrack: "NoTrack" }]);
    const server = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: server.impl, gapMs: 0 });
    expect(server.calls).toBe(0);
    // The watermark still moved, or this file is re-read in full for ever.
    expect(readEdsmUploadLedger().files[name]?.linesDone).toBe(1);
  });

  it("starts over on a file that got shorter, since the lines are not the ones that were sent", async () => {
    const name = "Journal.2026-09-01T100000.01.log";
    writeJournal(tmp, name, journal(1));
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: fakeEdsm().impl, gapMs: 0 });
    writeJournal(tmp, name, [{ timestamp: "2026-09-01T10:00:00Z", event: "Scan", BodyName: "Fresh" }]);
    const server = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: server.impl, gapMs: 0 });
    expect(server.batches.flat().map((e) => e.BodyName)).toEqual(["Fresh"]);
  });

  it("walks the files oldest first", async () => {
    writeJournal(tmp, "Journal.2026-09-02T100000.01.log", journal(2));
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    const server = fakeEdsm();
    await runEdsmCatchUp({ journalDir: tmp, credentials: creds, fetchImpl: server.impl, gapMs: 0 });
    const bodies = server.batches.flat().filter((e) => e.event === "Scan").map((e) => e.BodyName);
    expect(bodies).toEqual(["Sol 1", "Sol 2"]);
  });

  it("stops when the commander cancels", async () => {
    writeJournal(tmp, "Journal.2026-09-01T100000.01.log", journal(1));
    writeJournal(tmp, "Journal.2026-09-02T100000.01.log", journal(2));
    const server = fakeEdsm();
    let seen = 0;
    const p = await runEdsmCatchUp({
      journalDir: tmp,
      credentials: creds,
      fetchImpl: server.impl,
      gapMs: 0,
      isCancelled: () => ++seen > 1,
    });
    expect(p.running).toBe(false);
    expect(p.filesTotal).toBe(2);
    expect(p.filesDone).toBeLessThan(2);
  });

  describe("how far back a run reaches", () => {
    /** A journal whose last write was `daysAgo`, which is what the scope filter reads. */
    function agedJournal(name: string, daysAgo: number, lines: Record<string, unknown>[]): void {
      const p = writeJournal(tmp, name, lines);
      const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      utimesSync(p, when, when);
    }

    beforeEach(() => {
      agedJournal("Journal.2020-01-01T100000.01.log", 400, journal(1));
      agedJournal("Journal.2026-08-20T100000.01.log", 20, journal(2));
      agedJournal("Journal.2026-09-12T100000.01.log", 1.5, journal(3));
    });

    const bodiesFor = async (scope: "day" | "week" | "month" | "year" | "all") => {
      const server = fakeEdsm();
      await runEdsmCatchUp({
        journalDir: tmp,
        credentials: creds,
        scope,
        fetchImpl: server.impl,
        gapMs: 0,
      });
      return server.batches
        .flat()
        .filter((e) => e.event === "Scan")
        .map((e) => e.BodyName);
    };

    it("sends nothing for a day when nothing was played today", async () => {
      // The newest journal here was last written 36 hours ago, so a one-day window excludes it —
      // an empty run, not an error.
      expect(await bodiesFor("day")).toEqual([]);
    });

    it("reaches back a week", async () => {
      expect(await bodiesFor("week")).toEqual(["Sol 3"]);
    });

    it("reaches back a month", async () => {
      expect(await bodiesFor("month")).toEqual(["Sol 2", "Sol 3"]);
    });

    it("takes everything when asked for everything", async () => {
      expect(await bodiesFor("all")).toEqual(["Sol 1", "Sol 2", "Sol 3"]);
    });

    it("counts only the journals in range, so the progress line means something", async () => {
      const server = fakeEdsm();
      const p = await runEdsmCatchUp({
        journalDir: tmp,
        credentials: creds,
        scope: "month",
        fetchImpl: server.impl,
        gapMs: 0,
      });
      expect(p.filesTotal).toBe(2);
    });

    it("does not stop a longer run later — a short one leaves the older files untouched", async () => {
      await bodiesFor("week");
      // The week run never opened the older journals, so "all" still has them to send.
      expect(await bodiesFor("all")).toEqual(["Sol 1", "Sol 2"]);
    });
  });

  it("reports an empty journal folder as a finished run, not an error", async () => {
    mkdirSync(path.join(tmp, "empty"));
    const p = await runEdsmCatchUp({
      journalDir: path.join(tmp, "empty"),
      credentials: creds,
      fetchImpl: fakeEdsm().impl,
      gapMs: 0,
    });
    expect(p.error).toBeNull();
    expect(p.filesTotal).toBe(0);
    expect(p.running).toBe(false);
  });
});
