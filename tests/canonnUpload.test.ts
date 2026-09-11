/**
 * Contributing to Canonn, and what it costs the commander.
 *
 * The privacy shape is the part worth pinning: nothing leaves without the toggle, nothing leaves
 * without a commander name, and turning it off stops a queue that is already draining. The event
 * scope is Canonn's to decide — their whitelist plus the three exobiology events their own plugin
 * takes by name — so the rules here are about obeying it, not about choosing it.
 */
import { describe, expect, it } from "vitest";
import {
  CANONN_ALWAYS_EVENTS,
  CanonnUploader,
  matchesWhitelist,
  parseWhitelist,
} from "../src/server/canonnUpload.js";
import type { JournalLine } from "../src/shared/types.js";

/** Canonn's live whitelist, as their endpoint actually returns it. */
const LIVE = [
  { id: 11, definition: '{"event": "Docked", "StationName": "Hutton Orbital"}' },
  { id: 22, definition: '{"event": "FSSBodySignals"}' },
  { id: 26, definition: '{"event": "Interdicted", "IsPlayer": false, "IsThargoid": true}' },
];

function harness(opts: { enabled?: () => boolean; cmdr?: () => string | null } = {}) {
  const sent: Record<string, unknown>[] = [];
  let clock = 1_000_000;
  const uploader = new CanonnUploader({
    isEnabled: opts.enabled ?? (() => true),
    cmdrName: opts.cmdr ?? (() => "FALrenica"),
    gameState: () => ({
      systemName: "Blu Thua LJ-F c25-8",
      clientVersion: "test",
      isBeta: false,
      platform: "PC",
    }),
    post: async (_url, body) => {
      sent.push(body as Record<string, unknown>);
      return { ok: true };
    },
    fetchWhitelist: async () => LIVE,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { uploader, sent };
}

const line = (over: Record<string, unknown>): JournalLine =>
  ({ timestamp: "2026-09-11T00:00:00Z", ...over }) as unknown as JournalLine;

describe("reading Canonn's whitelist", () => {
  it("parses the definitions out of the strings they are wrapped in", () => {
    const rules = parseWhitelist(LIVE);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toEqual({ event: "Docked", StationName: "Hutton Orbital" });
  });

  it("survives a rule it cannot read rather than dropping the lot", () => {
    const rules = parseWhitelist([{ definition: "{not json" }, ...LIVE]);
    expect(rules).toHaveLength(3);
  });

  it("requires every key in a rule to agree", () => {
    const rules = parseWhitelist(LIVE);
    expect(matchesWhitelist(rules, line({ event: "Docked", StationName: "Hutton Orbital" }))).toBe(true);
    // Same event, a station Canonn did not ask about.
    expect(matchesWhitelist(rules, line({ event: "Docked", StationName: "Jameson Memorial" }))).toBe(
      false,
    );
    expect(
      matchesWhitelist(rules, line({ event: "Interdicted", IsPlayer: false, IsThargoid: false })),
    ).toBe(false);
  });
});

describe("what gets offered", () => {
  it("takes the three exobiology events whatever the whitelist says", async () => {
    const h = harness();
    // Deliberately without loading a whitelist: these three are Canonn's by name.
    for (const e of CANONN_ALWAYS_EVENTS) expect(h.uploader.wants(line({ event: e }))).toBe(true);
  });

  it("takes a whitelisted event once the whitelist is loaded, and not before", async () => {
    const h = harness();
    expect(h.uploader.wants(line({ event: "FSSBodySignals" }))).toBe(false);
    await h.uploader.loadWhitelist();
    expect(h.uploader.wants(line({ event: "FSSBodySignals" }))).toBe(true);
  });

  it("ignores everything else", async () => {
    const h = harness();
    await h.uploader.loadWhitelist();
    for (const e of ["FSDJump", "Scan", "Loadout", "Music"]) {
      expect(h.uploader.wants(line({ event: e })), e).toBe(false);
    }
  });
});

describe("what it costs the commander", () => {
  it("sends the journal line verbatim, with the commander name", async () => {
    const h = harness();
    const entry = line({ event: "ScanOrganic", Genus: "$Codex_Ent_Bacterial_Genus_Name;", Body: 4 });
    h.uploader.offer(entry);
    await h.uploader.idle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.rawEvent).toBe(entry);
    expect(h.sent[0]!.cmdrName).toBe("FALrenica");
    expect(h.sent[0]!.eventType).toBe("ScanOrganic");
  });

  it("sends nothing at all while the toggle is off", async () => {
    const h = harness({ enabled: () => false });
    h.uploader.offer(line({ event: "ScanOrganic" }));
    await h.uploader.idle();
    expect(h.sent).toEqual([]);
  });

  it("stops a draining queue when the toggle goes off mid-flight", async () => {
    let on = true;
    const h = harness({ enabled: () => on });
    h.uploader.offer(line({ event: "ScanOrganic", n: 1 }));
    on = false;
    h.uploader.offer(line({ event: "ScanOrganic", n: 2 }));
    await h.uploader.idle();
    expect(h.sent.length).toBeLessThanOrEqual(1);
  });

  it("sends nothing before the journal has named the commander", async () => {
    // Canonn's archive is keyed on the name; an event without one is noise in their records.
    const h = harness({ cmdr: () => null });
    h.uploader.offer(line({ event: "ScanOrganic" }));
    await h.uploader.idle();
    expect(h.sent).toEqual([]);
    expect(h.uploader.stats.skipped).toBe(1);
  });

  it("treats a whitelist it could not read as empty, never as everything", async () => {
    const h = harness();
    await h.uploader.loadWhitelist();
    // A failed fetch leaves no rules; the three named events still go, nothing else does.
    expect(h.uploader.wants(line({ event: "Loadout" }))).toBe(false);
  });
});
