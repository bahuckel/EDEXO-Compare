/**
 * INCLUDE-BODY-IDS Phase 4 — the ZMTP frame reader, the message filter, and the register's rules.
 *
 * The transport was proved against the live relay; everything that decides *meaning* is tested here
 * against bytes, because a stream consumer you can only exercise by connecting to the internet is a
 * consumer nobody can debug at 3am.
 *
 * The message bodies are real ones captured from `eddn.edcd.io:9500`.
 */
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { EddnConsumer } from "../src/server/eddn/eddnConsumer.js";
import { decodeEddnFrame, extractBodyObservation } from "../src/server/eddn/eddnMessage.js";
import { isValidGreeting, readFrame, subscribeFrame } from "../src/server/eddn/zmtpSubscriber.js";

const SYS = "353839778283";
const BODY = 41;

const saaSignalsFound = (over: Record<string, unknown> = {}) => ({
  $schemaRef: "https://eddn.edcd.io/schemas/journal/1",
  header: { gatewayTimestamp: "2026-09-06T13:31:09.975536Z", softwareName: "EDDLite" },
  message: {
    timestamp: "2026-09-06T13:31:05Z",
    event: "SAASignalsFound",
    BodyName: "Swoiwns IZ-E d12-10 4 c",
    SystemAddress: Number(SYS),
    BodyID: BODY,
    Signals: [
      { Type: "$SAA_SignalType_Biological;", Count: 1 },
      { Type: "$PlanetaryMiningLocation_Name;", Count: 14 },
    ],
    Genuses: [{ Genus: "$Codex_Ent_Bacterial_Genus_Name;" }],
    StarSystem: "Swoiwns IZ-E d12-10",
    StarPos: [-1180.1875, -486.125, 1292.96875],
    ...over,
  },
});

const scan = (over: Record<string, unknown> = {}) => ({
  $schemaRef: "https://eddn.edcd.io/schemas/journal/1",
  header: { gatewayTimestamp: "2026-09-06T13:40:00Z" },
  message: {
    timestamp: "2026-09-06T13:39:55Z",
    event: "Scan",
    ScanType: "Detailed",
    BodyName: "Swoiwns IZ-E d12-10 4 c",
    SystemAddress: Number(SYS),
    BodyID: BODY,
    StarSystem: "Swoiwns IZ-E d12-10",
    WasMapped: false,
    WasFootfalled: false,
    ...over,
  },
});

const fssGeologicalOnly = {
  $schemaRef: "https://eddn.edcd.io/schemas/fssbodysignals/1",
  header: { gatewayTimestamp: "2026-09-06T13:31:03Z" },
  message: {
    BodyID: 5,
    BodyName: "Ooscs Auf DR-T d4-1 A 3",
    Signals: [{ Count: 3, Type: "$SAA_SignalType_Geological;" }],
    StarSystem: "Ooscs Auf DR-T d4-1",
    SystemAddress: 42841100587,
    event: "FSSBodySignals",
    timestamp: "2026-08-14T14:43:32Z",
  },
};

const frame = (o: unknown) => deflateSync(Buffer.from(JSON.stringify(o), "utf8"));

let corpus: string;
let ctx: FeederContext;

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-eddn-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

describe("ZMTP framing", () => {
  it("reads a short frame, and reports how much it consumed", () => {
    const buf = Buffer.concat([Buffer.from([0x00, 0x03]), Buffer.from("abc"), Buffer.from("trailing")]);
    const f = readFrame(buf)!;
    expect(f.body.toString()).toBe("abc");
    expect(f.size).toBe(5);
    expect(f.isCommand).toBe(false);
  });

  it("waits rather than guessing when a frame is not all there yet", () => {
    expect(readFrame(Buffer.from([0x00]))).toBeNull();
    expect(readFrame(Buffer.concat([Buffer.from([0x00, 0x05]), Buffer.from("ab")]))).toBeNull();
    // Long form declares 9 header bytes before the body.
    expect(readFrame(Buffer.from([0x02, 0, 0, 0, 0]))).toBeNull();
  });

  it("reads a long frame — EDDN payloads routinely exceed 255 bytes", () => {
    const body = Buffer.alloc(400, 0x41);
    const header = Buffer.alloc(9);
    header.writeUInt8(0x02, 0);
    header.writeBigUInt64BE(400n, 1);
    const f = readFrame(Buffer.concat([header, body]))!;
    expect(f.body.length).toBe(400);
    expect(f.size).toBe(409);
  });

  it("distinguishes a command frame from a message", () => {
    expect(readFrame(Buffer.from([0x04, 0x01, 0x41]))!.isCommand).toBe(true);
    expect(readFrame(Buffer.from([0x00, 0x01, 0x41]))!.isCommand).toBe(false);
  });

  it("subscribes to everything with a single 0x01 byte", () => {
    expect([...subscribeFrame()]).toEqual([0x00, 0x01, 0x01]);
    expect([...subscribeFrame("x")]).toEqual([0x00, 0x02, 0x01, 0x78]);
  });

  it("refuses a greeting that is not ZMTP 3.x", () => {
    const good = Buffer.concat([Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0x7f, 0x03]), Buffer.alloc(53)]);
    expect(isValidGreeting(good)).toBe(true);
    expect(isValidGreeting(Buffer.alloc(64))).toBe(false);
    expect(isValidGreeting(Buffer.alloc(10))).toBe(false);
  });
});

describe("what the filter keeps", () => {
  it("keeps a genus-bearing SAASignalsFound, and reads the identity as a string", () => {
    const o = extractBodyObservation(decodeEddnFrame(frame(saaSignalsFound()))!)!;
    expect(o.systemId64).toBe(SYS);
    expect(typeof o.systemId64).toBe("string");
    expect(o.bodyId).toBe(BODY);
    expect(o.bioSignalCount).toBe(1);
    expect(o.genuses).toEqual(["$Codex_Ent_Bacterial_Genus_Name;"]);
    expect(o.mapped).toBe(true); // genera are proof of a DSS
    expect(o.createsRow).toBe(true);
    expect(o.coords).toEqual({ x: -1180.1875, y: -486.125, z: 1292.96875 });
  });

  it("drops a body whose only signals are geological — biology is the whole filter", () => {
    expect(extractBodyObservation(decodeEddnFrame(frame(fssGeologicalOnly))!)).toBeNull();
  });

  it("drops the traffic that is not about bodies at all", () => {
    for (const ref of ["commodity/3", "outfitting/2", "navroute/1", "fsssignaldiscovered/1"]) {
      const env = { $schemaRef: `https://eddn.edcd.io/schemas/${ref}`, message: { event: "X" } };
      expect(extractBodyObservation(env)).toBeNull();
    }
  });

  it("keeps a Scan for its flags, but never lets it create a row", () => {
    const o = extractBodyObservation(decodeEddnFrame(frame(scan()))!)!;
    expect(o.footfall).toBe(false);
    expect(o.mapped).toBe(false);
    expect(o.createsRow).toBe(false);
  });

  it("survives a frame that is not deflated JSON at all", () => {
    expect(decodeEddnFrame(Buffer.from("not zlib"))).toBeNull();
    expect(decodeEddnFrame(deflateSync(Buffer.from("{not json")))).toBeNull();
  });
});

describe("the register", () => {
  const feed = (c: EddnConsumer, o: unknown) => c.handleFrame(frame(o));
  const row = () =>
    (ctx.store as unknown as { db: { prepare: (s: string) => { bind: (p: unknown[]) => void; step: () => boolean; get: () => unknown[]; free: () => void } } }).db;

  function readBody() {
    const st = row().prepare(
      "SELECT is_footfalled, footfall_seen_at, is_mapped, mapped_seen_at, bio_signal_count, genuses FROM eddn_bodies WHERE system_id64 = ? AND body_id = ?",
    );
    st.bind([SYS, BODY]);
    if (!st.step()) {
      st.free();
      return null;
    }
    const [f, fAt, m, mAt, bio, gen] = st.get() as [number | null, string | null, number | null, string | null, number | null, string | null];
    st.free();
    return { footfall: f, footfallSeenAt: fAt, mapped: m, mappedSeenAt: mAt, bio, genuses: gen };
  }

  it("a Scan alone creates nothing — the index only grows on evidence of biology", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    feed(c, scan());
    expect(ctx.store.eddnStats().bodies).toBe(0);
    expect(c.stats.ignored).toBe(1);
  });

  it("biology creates the row, and a later Scan enriches it", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    feed(c, saaSignalsFound());
    expect(ctx.store.eddnStats().bodies).toBe(1);
    feed(c, scan());
    const r = readBody()!;
    expect(r.footfall).toBe(0);
    expect(r.mapped).toBe(1); // the genus list already proved it; the Scan's false must not win
    expect(r.bio).toBe(1);
  });

  it("is idempotent — replaying the same batch changes no count", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    for (const m of [saaSignalsFound(), scan()]) feed(c, m);
    const first = ctx.store.eddnStats();
    for (const m of [saaSignalsFound(), scan(), saaSignalsFound()]) feed(c, m);
    expect(ctx.store.eddnStats()).toEqual(first);
  });

  it("a true is sticky: a later WasFootfalled false never clears it", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    feed(c, saaSignalsFound());
    feed(c, scan({ WasFootfalled: true, timestamp: "2026-09-06T14:00:00Z" }));
    expect(readBody()!.footfall).toBe(1);
    feed(c, scan({ WasFootfalled: false, timestamp: "2026-09-06T15:00:00Z" }));
    expect(readBody()!.footfall).toBe(1);
    // …and the timestamp still describes the claim beside it, not the last message seen.
    expect(readBody()!.footfallSeenAt).toBe("2026-09-06T14:00:00Z");
  });

  it("silence overwrites nothing", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    feed(c, saaSignalsFound());
    // A Scan says nothing about genera; they must survive it.
    feed(c, scan());
    expect(readBody()!.genuses).toBe(JSON.stringify(["$Codex_Ent_Bacterial_Genus_Name;"]));
  });

  it("counts the target ladder's top rung: biology, unmapped, unwalked", () => {
    const c = new EddnConsumer({ store: ctx.store, persistEvery: 1 });
    // A body with a bio count but no genera — nobody has mapped it.
    feed(c, {
      $schemaRef: "https://eddn.edcd.io/schemas/fssbodysignals/1",
      header: { gatewayTimestamp: "2026-09-06T13:00:00Z" },
      message: {
        BodyID: 7,
        BodyName: "Test 1 a",
        Signals: [{ Count: 2, Type: "$SAA_SignalType_Biological;" }],
        StarSystem: "Test",
        SystemAddress: 12345,
        event: "FSSBodySignals",
        timestamp: "2026-09-06T13:00:00Z",
      },
    });
    feed(c, scan({ SystemAddress: 12345, BodyID: 7, WasMapped: false, WasFootfalled: false }));
    const s = ctx.store.eddnStats();
    expect(s.withBio).toBe(1);
    expect(s.unopened).toBe(1);
  });
});
