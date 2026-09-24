/**
 * Sending live events to EDDN.
 *
 * What is pinned: nothing leaves without the toggle, a commander name and a live (4.x, non-beta)
 * game version; every message drops the commander's own data; `StarSystem` / `StarPos` are added
 * only when the event's system matches the last jump; body names follow EDDN's Status.json +
 * journal rule; and the retry rules EDDN spells out (never after 400/426, a minute between tries).
 */
import { describe, expect, it } from "vitest";
import {
  buildEddnMessage,
  buildEddnNavRoute,
  EDDN_RETRY_DELAY_MS,
  EDDN_SOFTWARE_NAME,
  EDDN_SOFTWARE_VERSION,
  EDDN_UPLOAD_URL,
  EddnUploader,
  eddnGameIsLive,
  newEddnSessionState,
  observeEddnLine,
  stripLocalised,
  type EddnPostResult,
  type EddnSessionState,
} from "../src/server/eddnUpload.js";
import type { JournalLine } from "../src/shared/types.js";

const line = (over: Record<string, unknown>): JournalLine =>
  ({ timestamp: "2026-09-24T12:00:00Z", ...over }) as unknown as JournalLine;

const FILEHEADER = line({
  event: "Fileheader",
  part: 1,
  Odyssey: true,
  gameversion: "4.4.1.1",
  build: "r332841/r0 ",
});
const LOADGAME = line({
  event: "LoadGame",
  Commander: "TestCmdr",
  FuelLevel: 32,
  Horizons: true,
  Odyssey: true,
  gameversion: "4.4.1.1",
  build: "r332841/r0 ",
});
const SYS = { name: "Tegnae DG-X d1-9", address: 323523254163 };
const POS = [-1234.5, 56.25, 7890.125];
const JUMP = line({
  event: "FSDJump",
  StarSystem: SYS.name,
  SystemAddress: SYS.address,
  StarPos: POS,
  JumpDist: 55.2,
  FuelUsed: 4.1,
  FuelLevel: 20,
  BoostUsed: 0,
  Wanted: false,
  SystemEconomy_Localised: "None",
  Factions: [
    {
      Name: "A faction",
      MyReputation: 12,
      HomeSystem: false,
      SquadronFaction: false,
      HappiestSystem: false,
      Influence: 0.5,
    },
  ],
});

function session(...lines: JournalLine[]): EddnSessionState {
  const s = newEddnSessionState();
  for (const l of [FILEHEADER, LOADGAME, JUMP, ...lines]) observeEddnLine(s, l);
  return s;
}

describe("the session the sender learns from the journal", () => {
  it("takes the game version from Fileheader and the expansion flags from LoadGame", () => {
    const s = session();
    expect(s.gameversion).toBe("4.4.1.1");
    expect(s.gamebuild).toBe("r332841/r0 "); // passed through as-is, trailing space included
    expect(s.horizons).toBe(true);
    expect(s.odyssey).toBe(true);
    expect(s.system).toEqual({ name: SYS.name, address: SYS.address, pos: POS });
  });

  it("omits the odyssey flag entirely when LoadGame does not carry one", () => {
    const s = newEddnSessionState();
    observeEddnLine(s, FILEHEADER);
    observeEddnLine(s, line({ event: "LoadGame", Horizons: true }));
    expect("odyssey" in s).toBe(false);
  });

  it("counts only 4.x non-beta clients as live", () => {
    const s = newEddnSessionState();
    expect(eddnGameIsLive(s)).toBe(false);
    s.gameversion = "3.8.0.407";
    expect(eddnGameIsLive(s)).toBe(false);
    s.gameversion = "4.0.0.1500 Beta";
    expect(eddnGameIsLive(s)).toBe(false);
    s.gameversion = "4.4.1.1";
    expect(eddnGameIsLive(s)).toBe(true);
  });

  it("forgets the body on LeaveBody and on a jump", () => {
    const s = session(
      line({
        event: "ApproachBody",
        StarSystem: SYS.name,
        SystemAddress: SYS.address,
        Body: "Tegnae DG-X d1-9 2 c",
        BodyID: 17,
      }),
    );
    expect(s.journalBody).toEqual({ name: "Tegnae DG-X d1-9 2 c", id: 17 });
    observeEddnLine(s, line({ event: "LeaveBody", Body: "Tegnae DG-X d1-9 2 c", BodyID: 17 }));
    expect(s.journalBody).toBeNull();
  });
});

describe("building messages", () => {
  it("strips _Localised keys at every depth", () => {
    expect(stripLocalised({ a_Localised: 1, b: [{ c_Localised: 2, d: 3 }] })).toEqual({ b: [{ d: 3 }] });
  });

  it("removes the commander's own data from a jump", () => {
    const built = buildEddnMessage(session(), JUMP, null)!;
    expect(built.schema).toBe("journal/1");
    for (const k of ["JumpDist", "FuelUsed", "FuelLevel", "BoostUsed", "Wanted", "SystemEconomy_Localised"]) {
      expect(built.message).not.toHaveProperty(k);
    }
    expect(built.message.Factions).toEqual([{ Name: "A faction", Influence: 0.5 }]);
    expect(built.message.horizons).toBe(true);
    expect(built.message.odyssey).toBe(true);
  });

  it("adds StarPos to a Scan in the current system, and drops a Scan from any other", () => {
    const scan = { event: "Scan", ScanType: "Detailed", BodyName: "Tegnae DG-X d1-9 2 c", BodyID: 17 };
    const here = buildEddnMessage(
      session(),
      line({ ...scan, StarSystem: SYS.name, SystemAddress: SYS.address }),
      null,
    )!;
    expect(here.message.StarPos).toEqual(POS);
    expect(here.message.StarSystem).toBe(SYS.name);
    expect(
      buildEddnMessage(session(), line({ ...scan, StarSystem: "Elsewhere", SystemAddress: 42 }), null),
    ).toBeNull();
    // Same address, different name: the journal has lost lines somewhere. Drop it.
    expect(
      buildEddnMessage(
        session(),
        line({ ...scan, StarSystem: "Elsewhere", SystemAddress: SYS.address }),
        null,
      ),
    ).toBeNull();
  });

  it("sends nothing before a jump or Location has said where the ship is", () => {
    const s = newEddnSessionState();
    observeEddnLine(s, FILEHEADER);
    const signals = line({
      event: "FSSBodySignals",
      SystemAddress: SYS.address,
      BodyID: 17,
      BodyName: "x",
      Signals: [],
    });
    expect(buildEddnMessage(s, signals, null)).toBeNull();
  });

  it("sends Log and Sample organic scans, renames Body to BodyID, and never sends Analyse", () => {
    const organic = {
      event: "ScanOrganic",
      SystemAddress: SYS.address,
      Body: 17,
      Genus: "$Codex_Ent_Bacterial_Genus_Name;",
      Genus_Localised: "Bacterium",
      Species: "$Codex_Ent_Bacterial_04_Name;",
      Variant: "$Codex_Ent_Bacterial_04_Yttrium_Name;",
      WasLogged: true,
    };
    const built = buildEddnMessage(session(), line({ ...organic, ScanType: "Log" }), null)!;
    expect(built.schema).toBe("scanorganic/1");
    expect(built.message).toMatchObject({ BodyID: 17, StarSystem: SYS.name, StarPos: POS });
    expect(built.message).not.toHaveProperty("Body");
    expect(built.message).not.toHaveProperty("WasLogged");
    expect(built.message).not.toHaveProperty("Genus_Localised");
    expect(buildEddnMessage(session(), line({ ...organic, ScanType: "Analyse" }), null)).toBeNull();
  });

  it("names the organic scan's body and position only when Status.json and the journal agree", () => {
    const approach = line({
      event: "ApproachBody",
      StarSystem: SYS.name,
      SystemAddress: SYS.address,
      Body: "Tegnae DG-X d1-9 2 c",
      BodyID: 17,
    });
    const scan = line({
      event: "ScanOrganic",
      ScanType: "Sample",
      SystemAddress: SYS.address,
      Body: 17,
      Genus: "g",
      Species: "s",
    });
    const agreed = buildEddnMessage(session(approach), scan, {
      BodyName: "Tegnae DG-X d1-9 2 c",
      Latitude: 1.5,
      Longitude: -2,
    })!;
    expect(agreed.message).toMatchObject({ BodyName: "Tegnae DG-X d1-9 2 c", Latitude: 1.5, Longitude: -2 });
    const other = buildEddnMessage(session(approach), scan, {
      BodyName: "Tegnae DG-X d1-9 2 d",
      Latitude: 1.5,
      Longitude: -2,
    })!;
    expect(other.message).not.toHaveProperty("BodyName");
    expect(other.message).not.toHaveProperty("Latitude");
  });

  it("follows EDDN's codex rule for BodyName and BodyID", () => {
    const codex = line({
      event: "CodexEntry",
      EntryID: 2420101,
      Name: "$Codex_Ent_Bacterial_04_Yttrium_Name;",
      Region: "$Codex_RegionName_18;",
      System: SYS.name,
      SystemAddress: SYS.address,
      BodyID: 99,
      Latitude: 1,
      Longitude: 2,
      IsNewEntry: true,
      NewTraitsDiscovered: false,
    });
    const approach = line({
      event: "ApproachBody",
      StarSystem: SYS.name,
      SystemAddress: SYS.address,
      Body: "Tegnae DG-X d1-9 2 c",
      BodyID: 17,
    });
    // No body in Status.json: neither key, not even the event's own BodyID.
    const inSpace = buildEddnMessage(session(approach), codex, null)!;
    expect(inSpace.schema).toBe("codexentry/1");
    expect(inSpace.message).not.toHaveProperty("BodyID");
    expect(inSpace.message).not.toHaveProperty("BodyName");
    expect(inSpace.message).not.toHaveProperty("IsNewEntry");
    expect(inSpace.message).not.toHaveProperty("NewTraitsDiscovered");
    expect(inSpace.message.StarPos).toEqual(POS);
    // Status agrees with the journal: both.
    expect(
      buildEddnMessage(session(approach), codex, { BodyName: "Tegnae DG-X d1-9 2 c" })!.message,
    ).toMatchObject({
      BodyName: "Tegnae DG-X d1-9 2 c",
      BodyID: 17,
    });
    // A close binary: Status names the other body. Name, but no id.
    const binary = buildEddnMessage(session(approach), codex, { BodyName: "Tegnae DG-X d1-9 2 d" })!.message;
    expect(binary.BodyName).toBe("Tegnae DG-X d1-9 2 d");
    expect(binary).not.toHaveProperty("BodyID");
  });

  it("drops FSS scan progress, which is the commander's", () => {
    const built = buildEddnMessage(
      session(),
      line({
        event: "FSSDiscoveryScan",
        Progress: 0.4,
        BodyCount: 12,
        NonBodyCount: 3,
        SystemName: SYS.name,
        SystemAddress: SYS.address,
      }),
      null,
    )!;
    expect(built.schema).toBe("fssdiscoveryscan/1");
    expect(built.message).not.toHaveProperty("Progress");
    expect(built.message.StarPos).toEqual(POS);
  });

  it("keeps only Type and Count on body signals", () => {
    const built = buildEddnMessage(
      session(),
      line({
        event: "FSSBodySignals",
        SystemAddress: SYS.address,
        BodyID: 17,
        BodyName: "Tegnae DG-X d1-9 2 c",
        Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 3 }],
      }),
      null,
    )!;
    expect(built.message.Signals).toEqual([{ Type: "$SAA_SignalType_Biological;", Count: 3 }]);
    expect(built.message.StarSystem).toBe(SYS.name);
  });

  it("sends the route only when NavRoute.json is the one the event announced", () => {
    const hop = { StarSystem: SYS.name, SystemAddress: SYS.address, StarPos: POS, StarClass: "M" };
    const ev = line({ event: "NavRoute" });
    const file = { timestamp: "2026-09-24T12:00:00Z", event: "NavRoute", Route: [hop, hop] };
    expect(buildEddnNavRoute(session(), ev, file)!.message.Route).toHaveLength(2);
    expect(buildEddnNavRoute(session(), ev, { ...file, timestamp: "2026-09-24T11:00:00Z" })).toBeNull();
    expect(buildEddnNavRoute(session(), ev, { ...file, Route: [] })).toBeNull();
  });

  it("ignores events EDDN has no schema for", () => {
    expect(buildEddnMessage(session(), line({ event: "Music", MusicTrack: "Exploration" }), null)).toBeNull();
  });
});

function harness(
  opts: { enabled?: () => boolean; cmdr?: () => string | null; replies?: number[]; testMode?: boolean } = {},
) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const replies = [...(opts.replies ?? [])];
  const logs: string[] = [];
  const clock = { t: 1_000_000 };
  const uploader = new EddnUploader({
    isEnabled: opts.enabled ?? (() => true),
    cmdrName: opts.cmdr ?? (() => "TestCmdr"),
    testMode: opts.testMode,
    post: async (url, body): Promise<EddnPostResult> => {
      sent.push({ url, body: JSON.parse(body) as Record<string, unknown> });
      const status = replies.length ? replies.shift()! : 200;
      return { status, body: status === 200 ? "OK" : "FAIL: Schema Validation: nope" };
    },
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    log: (m) => logs.push(m),
  });
  for (const l of [FILEHEADER, LOADGAME]) uploader.observe(l);
  return { uploader, sent, clock, logs };
}

const SCAN = line({
  event: "Scan",
  ScanType: "Detailed",
  StarSystem: SYS.name,
  SystemAddress: SYS.address,
  BodyName: "b",
  BodyID: 3,
});

describe("the uploader", () => {
  it("sends a well-formed envelope as EDEXO-Compare", async () => {
    const { uploader, sent } = harness();
    uploader.offer(JUMP);
    await uploader.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(EDDN_UPLOAD_URL);
    expect(sent[0]!.body.$schemaRef).toBe("https://eddn.edcd.io/schemas/journal/1");
    expect(sent[0]!.body.header).toEqual({
      uploaderID: "TestCmdr",
      softwareName: EDDN_SOFTWARE_NAME,
      softwareVersion: EDDN_SOFTWARE_VERSION,
      gameversion: "4.4.1.1",
      gamebuild: "r332841/r0 ",
    });
    expect(EDDN_SOFTWARE_NAME).toBe("EDEXO-Compare");
  });

  it("uses the /test schemas in test mode", async () => {
    const { uploader, sent } = harness({ testMode: true });
    uploader.offer(JUMP);
    await uploader.idle();
    expect(sent[0]!.body.$schemaRef).toBe("https://eddn.edcd.io/schemas/journal/1/test");
  });

  it("sends nothing while the toggle is off, but still learns where the ship is", async () => {
    let on = false;
    const { uploader, sent } = harness({ enabled: () => on });
    uploader.offer(JUMP);
    await uploader.idle();
    expect(sent).toHaveLength(0);
    on = true;
    uploader.offer(SCAN);
    await uploader.idle();
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body.message as Record<string, unknown>).StarPos).toEqual(POS);
  });

  it("sends nothing without a commander name or a live game version", async () => {
    const noName = harness({ cmdr: () => null });
    noName.uploader.offer(JUMP);
    await noName.uploader.idle();
    expect(noName.sent).toHaveLength(0);

    const legacy = harness();
    legacy.uploader.observe(line({ event: "Fileheader", gameversion: "3.8.0.407", build: "r1" }));
    legacy.uploader.offer(JUMP);
    await legacy.uploader.idle();
    expect(legacy.sent).toHaveLength(0);
  });

  it("never retries a 400, and reports it once", async () => {
    const { uploader, sent, clock, logs } = harness({ replies: [400, 400] });
    uploader.offer(JUMP);
    uploader.offer(JUMP);
    await uploader.idle();
    clock.t += EDDN_RETRY_DELAY_MS * 5;
    uploader.kick();
    await uploader.idle();
    expect(sent).toHaveLength(2);
    expect(uploader.stats.failed).toBe(2);
    expect(logs).toHaveLength(1);
  });

  it("retries a 503 after a minute, without holding up the next message", async () => {
    const { uploader, sent, clock } = harness({ replies: [503] });
    uploader.offer(JUMP);
    uploader.offer(SCAN);
    await uploader.idle();
    // The jump failed and waits; the scan behind it went through.
    expect(sent.map((s) => (s.body.message as Record<string, unknown>).event)).toEqual(["FSDJump", "Scan"]);
    expect(uploader.pending).toBe(1);
    clock.t += EDDN_RETRY_DELAY_MS - 1_000;
    uploader.kick();
    await uploader.idle();
    expect(sent).toHaveLength(2);
    clock.t += 1_000;
    uploader.kick();
    await uploader.idle();
    expect(sent).toHaveLength(3);
    expect(uploader.stats.sent).toBe(2);
    expect(uploader.pending).toBe(0);
  });

  it("gives up after three attempts", async () => {
    const { uploader, sent, clock } = harness({ replies: [0, 0, 0, 0] });
    uploader.offer(JUMP);
    for (let i = 0; i < 5; i++) {
      await uploader.idle();
      clock.t += EDDN_RETRY_DELAY_MS;
      uploader.kick();
    }
    await uploader.idle();
    expect(sent).toHaveLength(3);
    expect(uploader.stats.failed).toBe(1);
    expect(uploader.pending).toBe(0);
  });
});
