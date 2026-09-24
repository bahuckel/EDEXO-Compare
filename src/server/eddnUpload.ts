/**
 * Sending live exploration and exobiology events to EDDN, if the commander asks for it.
 *
 * EDDN (the Elite Dangerous Data Network) is the community relay every other tool listens to:
 * EDSM, Spansh, Inara, EDAstro and the rest build their galaxy from what players' clients post
 * there. This app reads from it (`server/eddn/`); this is the other direction.
 *
 * ## What is sent
 *
 * The exploration and exobiology events, each on the schema EDDN defines for it:
 *
 * - `journal/1` — `FSDJump`, `Location`, `CarrierJump`, `Docked`, `Scan`, `SAASignalsFound`
 * - `scanorganic/1` — `ScanOrganic` (Log and Sample only; see below)
 * - `codexentry/1`, `fssbodysignals/1`, `fssdiscoveryscan/1`, `fssallbodiesfound/1`,
 *   `scanbarycentre/1`, `navbeaconscan/1`
 * - `navroute/1` — the plotted route, read from `NavRoute.json` when the journal says it changed
 *
 * Not market, outfitting, shipyard or fleet-carrier data: this app does not read those files, and a
 * sender that half-understands a schema is worse than none.
 *
 * ## The rules, from EDCD's `docs/Developers.md` and the per-schema READMEs
 *
 * - **Live game only.** Nothing is sent until a `Fileheader` has named the game version, and never
 *   for a Legacy (3.x) or beta client. `EDEXO_EDDN_TEST=1` sends to the `/test` schemas instead,
 *   which EDDN asks senders to use while testing.
 * - **No commander data.** `_Localised` keys go, and so does everything each schema lists as
 *   personal (fuel, fines, reputation, codex "new entry" flags, scan progress…). Schemas that take
 *   no extra keys are built from their allowed list, not by deleting from the event.
 * - **Augmentations are cross-checked.** `StarSystem` / `StarPos` are added only when the event's
 *   `SystemAddress` (and its system name, when it has one) match the last `FSDJump`, `Location` or
 *   `CarrierJump`. A mismatch drops the message — the game has been known to stop writing the
 *   journal and resume with lines missing, and a wrong position is worse than none.
 * - **Body names follow EDDN's codex rule**: `BodyName` from `Status.json` only, and `BodyID` only
 *   when that name matches the last `ApproachBody` / `Location`.
 * - **`ScanOrganic` with `ScanType: "Analyse"` is not sent.** It can fire at a different body once
 *   the commander has flown off, which is why the schema excludes it.
 * - **`uploaderID` is the commander name**, as EDDN asks. The relay replaces it with a salted hash
 *   before anyone downstream sees it.
 * - **Retries**: never after a 400 or 426 (the message is wrong, sending it again will not fix it),
 *   and otherwise not before a minute has passed, a few times at most. One bad message never holds
 *   up the rest.
 *
 * ## Being a good guest
 *
 * The same terms as the Canonn upload: live lines only (the historical replay only primes the game
 * version and location this needs, it never sends), one request in flight, never blocks the journal
 * path, off by default.
 */
import type { JournalLine } from "../shared/types.js";

export const EDDN_UPLOAD_URL = "https://eddn.edcd.io:4430/upload/";

/** What EDDN sees in `softwareName`. EDDN asks for a unique, self-consistent name. */
export const EDDN_SOFTWARE_NAME = "EDEXO-Compare";

/**
 * What EDDN sees in `softwareVersion` — kept equal to `package.json` by a test.
 *
 * EDDN asks for the version to change whenever the messages do, so listeners can tell a fixed
 * sender from a broken one. A release that forgets to bump this fails the suite.
 */
export const EDDN_SOFTWARE_VERSION = "1.1.4";

/** Between requests: a burst of FSS scans drains steadily instead of all at once. */
export const EDDN_MIN_GAP_MS = 250;

/** EDDN: wait at least a minute before retrying a failed message. */
export const EDDN_RETRY_DELAY_MS = 60_000;

/** Attempts per message, the first included. */
export const EDDN_MAX_ATTEMPTS = 3;

/** Queue depth before the oldest are dropped. */
const MAX_QUEUE = 1_000;

const SCHEMA_BASE = "https://eddn.edcd.io/schemas/";

/** What the sender knows about the game session, learnt from the journal. */
export interface EddnSessionState {
  gameversion: string | null;
  gamebuild: string | null;
  /** From `LoadGame` only; absent when it did not say (EDDN: then omit the key). */
  horizons?: boolean;
  odyssey?: boolean;
  /** The last `FSDJump` / `Location` / `CarrierJump`. */
  system: { name: string; address: number; pos: [number, number, number] } | null;
  /** The last `ApproachBody` / `Location` body, cleared by `LeaveBody` and jumps. */
  journalBody: { name: string; id: number } | null;
}

/** The parts of `Status.json` the body-name rule needs, read at the moment the line arrived. */
export interface EddnStatusView {
  BodyName?: string;
  Latitude?: number;
  Longitude?: number;
}

export interface EddnEnvelope {
  $schemaRef: string;
  header: {
    uploaderID: string;
    softwareName: string;
    softwareVersion: string;
    gameversion: string;
    gamebuild: string;
  };
  message: Record<string, unknown>;
}

export function newEddnSessionState(): EddnSessionState {
  return { gameversion: null, gamebuild: null, system: null, journalBody: null };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function starPos(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [v[0], v[1], v[2]];
}

/**
 * Learn from one journal line: game version, expansion flags, where the ship is.
 *
 * Called for every live line and, at boot, for the newest journal file — which is how a commander
 * who starts the app mid-session still gets a version and a position without anything being sent.
 */
export function observeEddnLine(state: EddnSessionState, line: JournalLine): void {
  const e = line as unknown as Record<string, unknown>;
  switch (e.event) {
    case "Fileheader":
      state.gameversion = typeof e.gameversion === "string" ? e.gameversion : null;
      state.gamebuild = typeof e.build === "string" ? e.build : null;
      // A new file is a new session: nothing about the old one's location can be trusted.
      state.system = null;
      state.journalBody = null;
      delete state.horizons;
      delete state.odyssey;
      return;
    case "LoadGame":
      if (typeof e.gameversion === "string") state.gameversion = e.gameversion;
      if (typeof e.build === "string") state.gamebuild = e.build;
      if (typeof e.Horizons === "boolean") state.horizons = e.Horizons;
      else delete state.horizons;
      if (typeof e.Odyssey === "boolean") state.odyssey = e.Odyssey;
      else delete state.odyssey;
      return;
    case "FSDJump":
    case "Location":
    case "CarrierJump": {
      const name = str(e.StarSystem);
      const address = int(e.SystemAddress);
      const pos = starPos(e.StarPos);
      state.system = name && address !== null && pos ? { name, address, pos } : null;
      const bodyName = str(e.Body);
      const bodyId = int(e.BodyID);
      // Location names the body the ship is at; a jump leaves every body behind.
      state.journalBody =
        e.event === "Location" && bodyName && bodyId !== null && e.BodyType === "Planet"
          ? { name: bodyName, id: bodyId }
          : null;
      return;
    }
    case "ApproachBody": {
      const bodyName = str(e.Body);
      const bodyId = int(e.BodyID);
      state.journalBody = bodyName && bodyId !== null ? { name: bodyName, id: bodyId } : null;
      return;
    }
    case "LeaveBody":
      state.journalBody = null;
      return;
    default:
      return;
  }
}

/** Is this session one EDDN's live schemas may hear about? */
export function eddnGameIsLive(state: EddnSessionState): boolean {
  const v = state.gameversion;
  if (!v) return false;
  if (/beta|alpha/i.test(v)) return false;
  const major = Number.parseInt(v, 10);
  return Number.isFinite(major) && major >= 4;
}

/** Remove every `…_Localised` key, at any depth. */
export function stripLocalised(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripLocalised);
  if (!isObj(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k.endsWith("_Localised")) continue;
    out[k] = stripLocalised(val);
  }
  return out;
}

function pick(src: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function withFlags(state: EddnSessionState, msg: Record<string, unknown>): Record<string, unknown> {
  if (state.horizons !== undefined) msg.horizons = state.horizons;
  if (state.odyssey !== undefined) msg.odyssey = state.odyssey;
  return msg;
}

/**
 * The tracked system, if it is the one the event names — the cross-check EDDN makes mandatory.
 * `name` is checked only when the event carries one.
 */
function sameSystem(state: EddnSessionState, address: unknown, name?: unknown): EddnSessionState["system"] {
  const sys = state.system;
  if (!sys) return null;
  if (int(address) !== sys.address) return null;
  if (name !== undefined && str(name) !== sys.name) return null;
  return sys;
}

/**
 * `BodyName` / `BodyID` by the codex README's rule: the name from Status.json, the id only when
 * that name is also the journal's current body. Returns nothing when Status.json names no body.
 */
function bodyFromStatus(
  state: EddnSessionState,
  status: EddnStatusView | null,
): { BodyName?: string; BodyID?: number } {
  const statusName = str(status?.BodyName);
  if (!statusName) return {};
  const jb = state.journalBody;
  return jb && jb.name === statusName ? { BodyName: statusName, BodyID: jb.id } : { BodyName: statusName };
}

const JOURNAL_PERSONAL = [
  "ActiveFine",
  "CockpitBreach",
  "BoostUsed",
  "FuelLevel",
  "FuelUsed",
  "JumpDist",
  "Latitude",
  "Longitude",
  "Wanted",
  "IsNewEntry",
  "NewTraitsDiscovered",
  "Traits",
  "VoucherAmount",
  // The commander's own situation rather than the system's. Not in the schema's list, but EDDN's
  // rule is "no Cmdr-specific data", and these say how this commander travels.
  "Taxi",
  "Multicrew",
  "InSRV",
  "OnFoot",
];

const FACTION_PERSONAL = ["HappiestSystem", "HomeSystem", "MyReputation", "SquadronFaction"];

const CODEX_KEYS = [
  "timestamp",
  "event",
  "System",
  "SystemAddress",
  "Name",
  "Region",
  "EntryID",
  "Category",
  "SubCategory",
  "Latitude",
  "Longitude",
  "NearestDestination",
  "VoucherAmount",
  "Traits",
] as const;

const ORGANIC_KEYS = [
  "timestamp",
  "event",
  "ScanType",
  "Genus",
  "Species",
  "Variant",
  "SystemAddress",
] as const;

const BARYCENTRE_KEYS = [
  "timestamp",
  "event",
  "StarSystem",
  "SystemAddress",
  "BodyID",
  "SemiMajorAxis",
  "Eccentricity",
  "OrbitalInclination",
  "Periapsis",
  "OrbitalPeriod",
  "AscendingNode",
  "MeanAnomaly",
] as const;

/**
 * Turn one live journal line into the EDDN message it becomes — or null when it is not one EDDN
 * takes, or the cross-checks fail. Pure: the whole of EDDN's rulebook as this app applies it.
 */
export function buildEddnMessage(
  state: EddnSessionState,
  line: JournalLine,
  status: EddnStatusView | null,
): { schema: string; message: Record<string, unknown> } | null {
  const e = stripLocalised(line) as Record<string, unknown>;
  switch (e.event) {
    case "FSDJump":
    case "Location":
    case "CarrierJump": {
      // The event is its own location source: it must carry all three.
      if (!str(e.StarSystem) || int(e.SystemAddress) === null || !starPos(e.StarPos)) return null;
      const msg = { ...e };
      for (const k of JOURNAL_PERSONAL) delete msg[k];
      if (Array.isArray(msg.Factions)) {
        msg.Factions = msg.Factions.map((f) => {
          if (!isObj(f)) return f;
          const g = { ...f };
          for (const k of FACTION_PERSONAL) delete g[k];
          return g;
        });
      }
      return { schema: "journal/1", message: withFlags(state, msg) };
    }
    case "Docked":
    case "Scan": {
      const sys = sameSystem(state, e.SystemAddress, e.StarSystem);
      if (!sys) return null;
      const msg = { ...e };
      for (const k of JOURNAL_PERSONAL) delete msg[k];
      msg.StarSystem = sys.name;
      msg.StarPos = sys.pos;
      return { schema: "journal/1", message: withFlags(state, msg) };
    }
    case "SAASignalsFound": {
      const sys = sameSystem(state, e.SystemAddress);
      if (!sys) return null;
      const msg: Record<string, unknown> = { ...e, StarSystem: sys.name, StarPos: sys.pos };
      for (const k of JOURNAL_PERSONAL) delete msg[k];
      return { schema: "journal/1", message: withFlags(state, msg) };
    }
    case "ScanOrganic": {
      if (e.ScanType !== "Log" && e.ScanType !== "Sample") return null;
      const bodyId = int(e.Body);
      const sys = sameSystem(state, e.SystemAddress);
      if (!sys || bodyId === null || !str(e.Genus) || !str(e.Species)) return null;
      const msg: Record<string, unknown> = {
        ...pick(e, ORGANIC_KEYS),
        StarSystem: sys.name,
        StarPos: sys.pos,
        BodyID: bodyId,
      };
      if (!str(msg.Variant)) delete msg.Variant;
      // Name and position only when Status.json and the journal agree this is the body scanned.
      const jb = state.journalBody;
      const statusName = str(status?.BodyName);
      if (jb && jb.id === bodyId && statusName === jb.name) {
        msg.BodyName = jb.name;
        if (typeof status?.Latitude === "number" && typeof status?.Longitude === "number") {
          msg.Latitude = status.Latitude;
          msg.Longitude = status.Longitude;
        }
      }
      return { schema: "scanorganic/1", message: withFlags(state, msg) };
    }
    case "CodexEntry": {
      const sys = sameSystem(state, e.SystemAddress, e.System);
      if (!sys || int(e.EntryID) === null) return null;
      // The event's own BodyID is not used: EDDN's rule is Status.json + journal, cross-checked.
      const msg: Record<string, unknown> = {
        ...pick(e, CODEX_KEYS),
        StarPos: sys.pos,
        ...bodyFromStatus(state, status),
      };
      return { schema: "codexentry/1", message: withFlags(state, msg) };
    }
    case "FSSBodySignals": {
      const sys = sameSystem(state, e.SystemAddress);
      if (!sys || int(e.BodyID) === null || !Array.isArray(e.Signals)) return null;
      const signals = e.Signals.filter(isObj).map((s) => pick(s, ["Type", "Count"]));
      const msg: Record<string, unknown> = {
        ...pick(e, ["timestamp", "event", "SystemAddress", "BodyID", "BodyName"]),
        StarSystem: sys.name,
        StarPos: sys.pos,
        Signals: signals,
      };
      if (!str(msg.BodyName)) delete msg.BodyName;
      return { schema: "fssbodysignals/1", message: withFlags(state, msg) };
    }
    case "FSSDiscoveryScan": {
      const sys = sameSystem(state, e.SystemAddress, e.SystemName);
      if (!sys) return null;
      const msg = {
        ...pick(e, ["timestamp", "event", "SystemName", "SystemAddress", "BodyCount", "NonBodyCount"]),
        StarPos: sys.pos,
      };
      return { schema: "fssdiscoveryscan/1", message: withFlags(state, msg) };
    }
    case "FSSAllBodiesFound": {
      const sys = sameSystem(state, e.SystemAddress, e.SystemName);
      if (!sys) return null;
      const msg = {
        ...pick(e, ["timestamp", "event", "SystemName", "SystemAddress", "Count"]),
        StarPos: sys.pos,
      };
      return { schema: "fssallbodiesfound/1", message: withFlags(state, msg) };
    }
    case "ScanBaryCentre": {
      const sys = sameSystem(state, e.SystemAddress, e.StarSystem);
      if (!sys || int(e.BodyID) === null) return null;
      const msg = { ...pick(e, BARYCENTRE_KEYS), StarSystem: sys.name, StarPos: sys.pos };
      return { schema: "scanbarycentre/1", message: withFlags(state, msg) };
    }
    case "NavBeaconScan": {
      const sys = sameSystem(state, e.SystemAddress);
      if (!sys) return null;
      const msg = {
        ...pick(e, ["timestamp", "event", "SystemAddress", "NumBodies"]),
        StarSystem: sys.name,
        StarPos: sys.pos,
      };
      return { schema: "navbeaconscan/1", message: withFlags(state, msg) };
    }
    default:
      return null;
  }
}

/**
 * The `navroute/1` message from a freshly written `NavRoute.json`.
 *
 * Only when the file's timestamp is the journal event's — otherwise the file is not the route the
 * event announced (read too early, or already replaced) — and never for an empty (cleared) route.
 */
export function buildEddnNavRoute(
  state: EddnSessionState,
  event: JournalLine,
  navRouteJson: unknown,
): { schema: string; message: Record<string, unknown> } | null {
  if (!isObj(navRouteJson) || !Array.isArray(navRouteJson.Route)) return null;
  if (navRouteJson.timestamp !== (event as unknown as Record<string, unknown>).timestamp) return null;
  const route: Record<string, unknown>[] = [];
  for (const hop of navRouteJson.Route) {
    if (!isObj(hop)) return null;
    const name = str(hop.StarSystem);
    const address = int(hop.SystemAddress);
    const pos = starPos(hop.StarPos);
    const cls = str(hop.StarClass);
    if (!name || address === null || !pos || !cls) return null;
    route.push({ StarSystem: name, SystemAddress: address, StarPos: pos, StarClass: cls });
  }
  if (route.length === 0) return null;
  return {
    schema: "navroute/1",
    message: withFlags(state, { timestamp: navRouteJson.timestamp, event: "NavRoute", Route: route }),
  };
}

export interface EddnPostResult {
  /** HTTP status, or 0 when the request never got an answer (offline, refused, timed out). */
  status: number;
  body: string;
}

export interface EddnUploadDeps {
  /** Is the toggle on? Checked again before each request, so turning it off stops a draining queue. */
  isEnabled: () => boolean;
  /** The commander's name — EDDN's `uploaderID`. Null means the journal has not said; nothing is sent. */
  cmdrName: () => string | null;
  /** `Status.json`, as it is now. Null when it cannot be read. */
  readStatus?: () => EddnStatusView | null;
  /** `NavRoute.json`, parsed. Null when it cannot be read. */
  readNavRoute?: () => unknown;
  /** Send to EDDN's `/test` schemas (EDDN asks senders to while testing). */
  testMode?: boolean;
  /** Injected so tests neither sleep nor talk to EDDN. */
  post?: (url: string, body: string) => Promise<EddnPostResult>;
  onResult?: (ok: boolean) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Where a rejection is reported. Defaults to one console line per distinct reason. */
  log?: (msg: string) => void;
}

export interface EddnUploadStats {
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
  dropped: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function defaultPost(url: string, body: string): Promise<EddnPostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.text().catch(() => "") };
  } catch {
    return { status: 0, body: "" };
  }
}

/** EDDN: 400 and 426 must never be retried; 413 is not worth it. Everything else may be, later. */
export function eddnStatusIsRetryable(status: number): boolean {
  return status !== 400 && status !== 426 && status !== 413;
}

interface Queued {
  envelope: EddnEnvelope;
  attempts: number;
  notBefore: number;
}

export class EddnUploader {
  readonly state: EddnSessionState = newEddnSessionState();
  readonly stats: EddnUploadStats = { sent: 0, failed: 0, retried: 0, skipped: 0, dropped: 0 };
  private queue: Queued[] = [];
  private running = false;
  private lastRequestAt = -Infinity;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reported = new Set<string>();

  constructor(private readonly deps: EddnUploadDeps) {}

  /** Learn from a line without sending anything — the boot-time priming path. */
  observe(line: JournalLine): void {
    observeEddnLine(this.state, line);
  }

  /** Forget the session, before priming again from a fresh replay. */
  resetSession(): void {
    Object.assign(this.state, newEddnSessionState());
    delete this.state.horizons;
    delete this.state.odyssey;
  }

  /**
   * Offer one **live** journal line. Returns immediately; the sending happens on its own.
   *
   * The line is observed first, so a jump updates the location before anything after it is checked
   * against it. The historical replay must never reach this — see the header.
   */
  offer(line: JournalLine): void {
    observeEddnLine(this.state, line);
    if (!this.deps.isEnabled()) return;
    if (!eddnGameIsLive(this.state)) return;
    let built: { schema: string; message: Record<string, unknown> } | null;
    if (line.event === "NavRoute") {
      built = buildEddnNavRoute(this.state, line, this.deps.readNavRoute?.() ?? null);
    } else {
      const status =
        line.event === "ScanOrganic" || line.event === "CodexEntry"
          ? (this.deps.readStatus?.() ?? null)
          : null;
      built = buildEddnMessage(this.state, line, status);
    }
    if (!built) return;
    const cmdr = this.deps.cmdrName();
    if (!cmdr) {
      this.stats.skipped++;
      return;
    }
    this.enqueue(this.envelope(built.schema, built.message, cmdr));
  }

  envelope(schema: string, message: Record<string, unknown>, cmdr: string): EddnEnvelope {
    return {
      $schemaRef: `${SCHEMA_BASE}${schema}${this.deps.testMode ? "/test" : ""}`,
      header: {
        uploaderID: cmdr,
        softwareName: EDDN_SOFTWARE_NAME,
        softwareVersion: EDDN_SOFTWARE_VERSION,
        gameversion: this.state.gameversion ?? "",
        gamebuild: this.state.gamebuild ?? "",
      },
      message,
    };
  }

  /**
   * Resolves when nothing is in flight and nothing is due — tests await this; nothing in the app
   * does. Retries still waiting out their minute do not count.
   */
  async idle(): Promise<void> {
    const now = this.deps.now ?? Date.now;
    while (this.running || this.queue.some((q) => q.notBefore <= now())) {
      await (this.deps.sleep ?? defaultSleep)(1);
    }
  }

  /** Send whatever has come due. The app relies on its own timer; tests call this after moving the clock. */
  kick(): void {
    void this.drain();
  }

  /** How many messages are waiting, retries included. */
  get pending(): number {
    return this.queue.length;
  }

  private enqueue(envelope: EddnEnvelope): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.stats.dropped++;
    }
    this.queue.push({ envelope, attempts: 0, notBefore: -Infinity });
    void this.drain();
  }

  private report(msg: string): void {
    if (this.reported.has(msg)) return;
    this.reported.add(msg);
    (this.deps.log ?? ((m: string) => console.warn(m)))(msg);
  }

  private scheduleWake(at: number): void {
    if (this.wakeTimer) return;
    const now = (this.deps.now ?? Date.now)();
    this.wakeTimer = setTimeout(
      () => {
        this.wakeTimer = null;
        void this.drain();
      },
      Math.max(0, at - now),
    );
    this.wakeTimer.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? defaultSleep;
    const post = this.deps.post ?? defaultPost;
    try {
      while (this.queue.length > 0) {
        if (!this.deps.isEnabled()) {
          this.stats.skipped += this.queue.length;
          this.queue = [];
          break;
        }
        // The first message that is due; a waiting retry never holds up a fresh one.
        const t = now();
        const idx = this.queue.findIndex((q) => q.notBefore <= t);
        if (idx < 0) {
          this.scheduleWake(Math.min(...this.queue.map((q) => q.notBefore)));
          break;
        }
        const next = this.queue.splice(idx, 1)[0]!;
        const wait = this.lastRequestAt + EDDN_MIN_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = now();
        next.attempts++;
        const res = await post(EDDN_UPLOAD_URL, JSON.stringify(next.envelope));
        if (res.status === 200) {
          this.stats.sent++;
          this.deps.onResult?.(true);
          continue;
        }
        const schema = next.envelope.$schemaRef.replace(SCHEMA_BASE, "");
        if (eddnStatusIsRetryable(res.status) && next.attempts < EDDN_MAX_ATTEMPTS) {
          this.stats.retried++;
          next.notBefore = now() + EDDN_RETRY_DELAY_MS;
          this.queue.push(next);
          continue;
        }
        this.stats.failed++;
        this.deps.onResult?.(false);
        if (!eddnStatusIsRetryable(res.status)) {
          this.report(
            `EDDN refused a ${schema} message (HTTP ${res.status}): ${res.body.trim().slice(0, 300)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
