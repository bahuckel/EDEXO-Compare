/**
 * Sending the commander's journal to EDSM, the way EDMC and EDDiscovery do.
 *
 * Until now every EDSM feature in this app read and nothing wrote: `edsmSystemHydration.ts` asks for
 * bodies, and the API key it carries authenticates nothing, because the endpoints it touches are
 * public (see the note at the top of `edsmCredentials.ts`). **This is the first thing in the project
 * that sends the commander's own journal anywhere**, which is why every part of it is off until
 * asked for, and why what it sends is described in the Options panel in plain words.
 *
 * ## The protocol
 *
 * `POST https://www.edsm.net/api-journal-v1`, form-encoded, with `commanderName`, `apiKey`,
 * `fromSoftware`, `fromSoftwareVersion`, `fromGameVersion`, `fromGameBuild` and `message` — the last
 * being a JSON **array** of journal lines. The reply carries a top-level `msgnum` and an `events`
 * array holding one `msgnum` per line, in order. The hundreds digit is the class:
 *
 *   1xx  accepted
 *   4xx  this event was not stored, and will not be if sent again (unknown event, bad data)
 *   5xx  EDSM's problem, not ours — it kept the event for later, so treat as accepted
 *   2xx  fatal: the credentials or the client are wrong. Stop, do not retry, tell the commander.
 *
 * Getting the 2xx class wrong is the failure that matters. A client that treats a rejected API key
 * as "try again later" retries forever against a volunteer service, which is exactly the behaviour
 * that gets a client blocked.
 *
 * ## The discard list
 *
 * EDSM publishes the events it has no use for at `api-journal-v1/discard`, and asks clients to fetch
 * it on startup and skip those events rather than send them to be thrown away. It is roughly 250
 * event names and it moves, so it is fetched rather than hard-coded, cached for a day, and a failure
 * to fetch it means **nothing is sent** — sending the whole journal because a list did not load
 * would put four years of `Music` and `ReceiveText` events on someone else's server.
 *
 * ## The transient fields
 *
 * Journal lines do not name the system they happened in; the game says that once, on arrival, and
 * everything after is implicitly there. EDSM cannot store an event it cannot place, so clients add
 * `_systemName`, `_systemCoordinates`, `_stationName` and `_shipId` to every event from the state
 * they have been tracking. {@link EdsmTransientTracker} is that state, and it is fed from the same
 * lines that are being sent, so a catch-up run over an old journal reconstructs it exactly as the
 * live tail would.
 */
import { JOURNAL_UPLOAD_SOFTWARE, JOURNAL_UPLOAD_VERSION } from "./edsmUploadIdentity.js";
import type { EdsmCredentials } from "./edsmCredentials.js";
import type { JournalLine } from "../shared/types.js";

const JOURNAL_URL = "https://www.edsm.net/api-journal-v1";
const DISCARD_URL = "https://www.edsm.net/api-journal-v1/discard";

/** EDSM asks for a User-Agent that says who is calling. Same one the read side uses. */
export const EDSM_UPLOAD_USER_AGENT = `${JOURNAL_UPLOAD_SOFTWARE}/${JOURNAL_UPLOAD_VERSION} (+https://github.com/bahuckel/EDEXO-Compare)`;

/**
 * How many events go in one request.
 *
 * EDMC does not cap it because it sends what the game just produced — a handful. A catch-up run has
 * four years of them, and one request with 200,000 events in it is a request that times out, fails
 * and has to be repeated in full. A hundred is small enough to retry cheaply and large enough that
 * the round trips are not the bottleneck.
 */
export const EDSM_BATCH_SIZE = 100;

/** Politeness gap between catch-up batches. EDSM is volunteer-funded; this is not a race. */
export const EDSM_BATCH_GAP_MS = 1200;

const DISCARD_TTL_MS = 24 * 60 * 60 * 1000;

/** What one upload attempt did. */
export interface EdsmUploadResult {
  ok: boolean;
  /** Events the server accepted (1xx or 5xx — stored, or stored for later). */
  accepted: number;
  /** Events the server refused and will refuse again (4xx). Counted, not retried. */
  rejected: number;
  /** Set when the whole request failed. */
  error: string | null;
  /**
   * True when the failure is the commander's credentials or this client, not the network.
   *
   * The caller must stop on this rather than retry, and say so where the commander will see it.
   */
  fatal: boolean;
}

/** Live state every event needs before EDSM can place it. */
export interface EdsmTransientState {
  systemName: string | null;
  systemCoordinates: [number, number, number] | null;
  stationName: string | null;
  shipId: number | null;
  /** From `Fileheader`, which EDSM wants alongside the events it introduced. */
  gameVersion: string | null;
  gameBuild: string | null;
}

/**
 * Where the commander was, rebuilt from the journal as it streams past.
 *
 * Deliberately fed from the lines being uploaded rather than from `GameStateStore`: a catch-up run
 * replays a journal from 2023 and must stamp those events with where the commander was *then*. The
 * live store knows where they are *now*, which would file four years of scans under today's system.
 */
export class EdsmTransientTracker {
  private state: EdsmTransientState = {
    systemName: null,
    systemCoordinates: null,
    stationName: null,
    shipId: null,
    gameVersion: null,
    gameBuild: null,
  };

  snapshot(): EdsmTransientState {
    return { ...this.state };
  }

  /** Feed every line, including the discarded ones — position comes from events EDSM does not want. */
  observe(line: JournalLine): void {
    const l = line as unknown as Record<string, unknown>;
    const event = typeof l.event === "string" ? l.event : "";

    if (event === "Fileheader") {
      // The game's own version, which EDSM uses to interpret events whose shape changed between
      // updates. `gameversion` is lowercase in the journal; `Odyssey` is not what it wants.
      const v = l.gameversion ?? l.gameVersion;
      const b = l.build ?? l.Build;
      if (typeof v === "string" && v.trim()) this.state.gameVersion = v.trim();
      if (typeof b === "string" && b.trim()) this.state.gameBuild = b.trim();
      return;
    }

    if (event === "Location" || event === "FSDJump" || event === "CarrierJump") {
      const name = l.StarSystem;
      if (typeof name === "string" && name.trim()) this.state.systemName = name.trim();
      const pos = l.StarPos;
      if (Array.isArray(pos) && pos.length === 3 && pos.every((n) => typeof n === "number")) {
        this.state.systemCoordinates = [pos[0] as number, pos[1] as number, pos[2] as number];
      }
      // A jump leaves any station behind; `Location` names one only when docked.
      const docked = l.Docked === true;
      const station = l.StationName;
      this.state.stationName =
        docked && typeof station === "string" && station.trim() ? station.trim() : null;
      return;
    }

    if (event === "Docked") {
      const station = l.StationName;
      if (typeof station === "string" && station.trim()) this.state.stationName = station.trim();
      const name = l.StarSystem;
      if (typeof name === "string" && name.trim()) this.state.systemName = name.trim();
      return;
    }

    if (event === "Undocked") {
      this.state.stationName = null;
      return;
    }

    if (event === "LoadGame" || event === "Loadout" || event === "ShipyardSwap" || event === "ShipyardNew") {
      const id = l.ShipID;
      if (typeof id === "number" && Number.isFinite(id)) this.state.shipId = id;
      return;
    }
  }

  /** The line as EDSM wants it: the game's own object plus the four fields it cannot infer. */
  stamp(line: JournalLine): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(line as unknown as Record<string, unknown>) };
    if (this.state.systemName != null) out._systemName = this.state.systemName;
    if (this.state.systemCoordinates != null) out._systemCoordinates = this.state.systemCoordinates;
    if (this.state.stationName != null) out._stationName = this.state.stationName;
    if (this.state.shipId != null) out._shipId = this.state.shipId;
    return out;
  }
}

let discardCache: { at: number; events: Set<string> } | null = null;

/** Test seam — the list is cached for a day and a test must not inherit another test's. */
export function resetEdsmDiscardCacheForTests(): void {
  discardCache = null;
}

/** Test seam — lets a test supply the list without a network call. */
export function seedEdsmDiscardCacheForTests(events: string[]): void {
  discardCache = { at: Date.now(), events: new Set(events) };
}

/**
 * The events EDSM does not want, or null when the list could not be fetched.
 *
 * **Null means send nothing.** The alternative is deciding that an unreachable list is the same as
 * an empty one, which turns one failed request into a journal's worth of events the service asked
 * not to receive.
 */
export async function fetchEdsmDiscardList(now = Date.now()): Promise<Set<string> | null> {
  if (discardCache && now - discardCache.at < DISCARD_TTL_MS) return discardCache.events;
  try {
    const res = await fetch(DISCARD_URL, {
      headers: { Accept: "application/json", "User-Agent": EDSM_UPLOAD_USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return discardCache?.events ?? null;
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return discardCache?.events ?? null;
    const events = new Set(body.filter((e): e is string => typeof e === "string"));
    discardCache = { at: now, events };
    return events;
  } catch {
    // A stale list is better than no upload and far better than ignoring the list entirely.
    return discardCache?.events ?? null;
  }
}

/** The class of an EDSM `msgnum`, by its hundreds digit. */
export function edsmMsgClass(msgnum: number): "ok" | "rejected" | "fatal" | "deferred" | "unknown" {
  const c = Math.floor(msgnum / 100);
  if (c === 1) return "ok";
  if (c === 2) return "fatal";
  if (c === 4) return "rejected";
  if (c === 5) return "deferred";
  return "unknown";
}

/**
 * Send one batch. Never throws — the caller decides what a failure means for the ledger.
 *
 * The batch is sent as `application/x-www-form-urlencoded` rather than JSON because that is the shape
 * EDSM's own documentation and every working client use, and the endpoint is stricter about it than
 * the documentation admits.
 */
export async function postEdsmJournalBatch(
  credentials: EdsmCredentials,
  events: Record<string, unknown>[],
  transient: Pick<EdsmTransientState, "gameVersion" | "gameBuild">,
  fetchImpl: typeof fetch = fetch,
): Promise<EdsmUploadResult> {
  if (events.length === 0) return { ok: true, accepted: 0, rejected: 0, error: null, fatal: false };

  const form = new URLSearchParams({
    commanderName: credentials.commanderName,
    apiKey: credentials.apiKey,
    fromSoftware: JOURNAL_UPLOAD_SOFTWARE,
    fromSoftwareVersion: JOURNAL_UPLOAD_VERSION,
    message: JSON.stringify(events),
  });
  if (transient.gameVersion) form.set("fromGameVersion", transient.gameVersion);
  if (transient.gameBuild) form.set("fromGameBuild", transient.gameBuild);

  let res: Response;
  try {
    res = await fetchImpl(JOURNAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": EDSM_UPLOAD_USER_AGENT,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return {
      ok: false,
      accepted: 0,
      rejected: 0,
      error: e instanceof Error ? e.message : "network error",
      fatal: false,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      accepted: 0,
      rejected: 0,
      error: `EDSM returned HTTP ${res.status}`,
      // 4xx from the HTTP layer is a bad request from us and will not fix itself.
      fatal: res.status >= 400 && res.status < 500,
    };
  }

  let body: { msgnum?: number; msg?: string; events?: { msgnum?: number; msg?: string }[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return {
      ok: false,
      accepted: 0,
      rejected: 0,
      error: "EDSM sent a reply that was not JSON",
      fatal: false,
    };
  }

  const top = typeof body.msgnum === "number" ? body.msgnum : 0;
  const topClass = edsmMsgClass(top);
  if (topClass === "fatal") {
    return {
      ok: false,
      accepted: 0,
      rejected: 0,
      error: body.msg ? `${body.msg} (${top})` : `EDSM rejected the request (${top})`,
      fatal: true,
    };
  }
  if (topClass !== "ok" && topClass !== "deferred") {
    return {
      ok: false,
      accepted: 0,
      rejected: 0,
      error: body.msg ? `${body.msg} (${top})` : `EDSM replied ${top}`,
      fatal: false,
    };
  }

  /*
    A per-event reply is not required to exist.

    EDSM answers a well-formed batch with one `events` entry per line, but a 5xx top-level ("saved
    for later") carries none — the events are accepted and not yet processed. Treating a missing
    array as zero accepted would make the ledger replay the same batch forever.
  */
  let accepted = 0;
  let rejected = 0;
  if (Array.isArray(body.events) && body.events.length > 0) {
    for (const e of body.events) {
      const cls = edsmMsgClass(typeof e?.msgnum === "number" ? e.msgnum : 0);
      if (cls === "rejected") rejected++;
      else accepted++;
    }
  } else {
    accepted = events.length;
  }

  return { ok: true, accepted, rejected, error: null, fatal: false };
}
