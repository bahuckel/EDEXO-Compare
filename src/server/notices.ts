/**
 * The notices behind the mail icon (shared/notices.ts has the what and why).
 *
 * Fed with **live** journal lines only, before the store applies them — the historical replay never
 * reaches it, so a first run or a re-merge cannot flood the list. Each line is looked at for:
 *
 * - `Scan` of a body not seen before: a notable type (Earth-like, water, ammonia, terraformable,
 *   Helium gas giant), and a personal record — the largest or smallest radius of its star type or
 *   planet class among everything the commander has scanned. The bests are seeded from the store
 *   the first time a scan needs them, silently; only a record broken live is announced and marked.
 * - A notable stellar phenomenon: the FSS signal (`$Fixed_Event_Life_…`, type Codex) says one is in
 *   the system, and the `CodexEntry` that follows a drop at it names it.
 * - Green gas giants (shared/greenGasGiant.ts): a scan that is a candidate, a codex entry that
 *   confirms one, a K10-Type Anomaly that says one is in the system. And the body features the
 *   commander switched on (shared/bodyFeatures.ts), plus the void cross on a jump.
 * - `FSDJump`: points of interest (EDAstro's catalogue, if fetched) and, beyond 2,000 ly of Sol,
 *   carriers, within N of the ship's average jumps. Each POI is announced once, ever; a carrier once
 *   per system it is parked in. At most three of each per jump, nearest first, so switching a group
 *   on in a crowded area does not bury the list.
 *
 * Kept in `edexo-notices.json` beside the user settings: the unread list, the ids already announced
 * (so the same body never comes back after being read), the records, and the settings.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExplorationScanRecord } from "../shared/types.js";
import { BODY_FEATURES, bodyFeatures, directParent, featureRecordFromScan, inVoidCross } from "../shared/bodyFeatures.js";
import { createGreenCodexMatcher } from "../shared/greenCodexMatch.js";
import { greenCodexId, greenGiantLabel, isK10CodexName, type GreenGiantVerdict } from "../shared/greenGasGiant.js";
import { carrierServiceLabel } from "../shared/carrierServices.js";
import { bodyKey as toBodyKey } from "../shared/bodyKey.js";
import {
  CARRIER_NOTICE_MIN_FROM_SOL_LY,
  DEFAULT_NOTIFY_PREFS,
  mergeNotifyPrefs,
  formatRadius,
  notableKindFor,
  recordTypeLabel,
  type NotableKind,
  type NoticeDTO,
  type NoticesSnapshotDTO,
  type RecordRowDTO,
  type NotifyPrefsDTO,
  type RecordMarkDTO,
  type RecordSubject,
} from "../shared/notices.js";

type Line = Record<string, unknown>;

interface NoticesFile {
  formatVersion: 1;
  prefs: NotifyPrefsDTO;
  items: NoticeDTO[];
  seen: string[];
  records: RecordMarkDTO[];
}

/** What the service needs to know about the store, at the moment a line arrives (before it is applied). */
export interface NoticesContext {
  /** Whether the store already has a scan of this body — a re-scan is not a find. */
  isKnownBody(bodyKey: string): boolean;
  /** Every scan the commander made, for seeding the records. */
  allScans(): Iterable<ExplorationScanRecord>;
  currentSystem(): { name: string; address: number | null };
  /** Loadout `MaxJumpRange`, the fallback until a few jumps have been flown. */
  loadoutJumpLy?(): number | null;
  /** EDAstro POIs in the given groups within the radius, nearest first. */
  nearbyPois?(origin: Vec3, radiusLy: number, groups: readonly string[]): NearbyPoi[];
  /** EDAstro carriers within the radius, nearest first. */
  nearbyCarriers?(origin: Vec3, radiusLy: number): NearbyCarrier[];
  /** EDAstro's galactic record for a record key, when downloaded (galacticRecords.ts). */
  galacticRecord?(key: string): { largest: { radius: number; body: string }; smallest: { radius: number; body: string } } | null;
  /** Notable stellar phenomena (EDAstro's codex file) within the radius, by system, nearest first. */
  nearbyNsps?(origin: Vec3, radiusLy: number): NearbyNsp[];
  /** The green gas giant verdict for a body being scanned (server/greenGiants.ts). */
  greenGiant?(
    rec: Pick<
      ExplorationScanRecord,
      "systemAddress" | "bodyId" | "bodyName" | "planetClass" | "surfaceTemperature" | "massEM" | "radius"
    >,
  ): GreenGiantVerdict | null;
  /** A body the store already has, by `system:body` key — a moon's parent, for the ring features. */
  scanOf?(bodyKey: string): ExplorationScanRecord | null;
}

export interface CodexFirstFind {
  bodyKey: string;
  systemAddress: number;
  system: string;
  body: string;
  species: string;
  speciesId: string;
  /** The colours that would be firsts; empty when the colour is unknown. */
  colours: string[];
  region: string;
}

export interface NearbyNsp {
  system: string;
  systemAddress: number | null;
  distanceLy: number;
  names: string[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface NearbyPoi {
  key: string;
  name: string;
  system: string;
  typeLabel: string;
  distanceLy: number;
}
export interface NearbyCarrier {
  callsign: string;
  name: string;
  system: string;
  systemAddress: number | null;
  distanceLy: number;
  lastSeenDays: number | null;
  services: readonly string[];
}

/** The last this many jumps make the average. */
const JUMP_SAMPLES = 20;
/** Fewer than this, and the loadout's range stands in. */
const JUMP_SAMPLES_MIN = 3;
const NEARBY_PER_JUMP = 3;

const MAX_ITEMS = 200;
const MAX_SEEN = 20_000;
/** How long after dropping at a phenomenon its codex entry still counts as naming it. */
const NSP_DROP_WINDOW_MS = 3 * 60_000;
const NSP_SIGNAL = /^\$fixed_event_life_/i;

const NOTABLE_TITLE: Partial<Record<NotableKind, string>> = {
  earthlike: "Earth-like world",
  water: "Water world",
  ammonia: "Ammonia world",
  helium: "Helium gas giant",
};

interface Best {
  largest: number;
  smallest: number;
  largestBody: string;
  smallestBody: string;
  count: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** `Blatrimpe 14 e` in `Blatrimpe` → `14 e`. */
export function shortBodyName(bodyName: string, system: string): string {
  const b = bodyName.trim();
  const s = system.trim();
  if (s && b.toLowerCase().startsWith(s.toLowerCase() + " ")) return b.slice(s.length).trim();
  return b;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function recordKey(subject: RecordSubject, type: string): string {
  return `${subject}:${type}`;
}

/** A scan the records may count: the commander's own, with a radius. */
function scanSubject(r: {
  starType?: string;
  planetClass?: string;
  radius?: number;
}): { subject: RecordSubject; type: string; radius: number } | null {
  const radius = r.radius;
  if (radius == null || !Number.isFinite(radius) || radius <= 0) return null;
  if (r.starType) return { subject: "star", type: r.starType, radius };
  if (r.planetClass) return { subject: "planet", type: r.planetClass, radius };
  return null;
}

export interface NoticesService {
  prefs(): NotifyPrefsDTO;
  setPrefs(raw: unknown): NotifyPrefsDTO;
  /** Notices, newest first, read ones included. */
  list(): NoticeDTO[];
  /** Marks the given ids read, or all of them; they stay, to be read again. Returns how many changed. */
  markRead(ids: readonly string[] | "all"): number;
  /** Marks the given ids unread again. Returns how many changed. */
  markUnread(ids: readonly string[]): number;
  /** Deletes the read ones. Returns how many went. */
  clearRead(): number;
  /**
   * Options → Notify me → "Send a test notice" (review F-5.10): one notice through the real list, so
   * the commander sees (and, with the chime on, hears) what a find looks like. A newer test replaces
   * the last one; it is never remembered as seen.
   */
  sendTest(at: string): NoticeDTO;
  /**
   * An achievement step reached live (server/achievementNotices.ts): one notice per achievement and
   * step, ever. True when it was added.
   */
  announceAchievement(a: { id: string; step: number; title: string; text: string }, at: string): boolean;
  /** A gas giant to photograph for the nudge research (server/gggResearch.ts; the developer's PC only). */
  announceGggResearch(n: { bodyKey: string; system: string; systemAddress: number; body: string; title: string; text: string }, at: string): boolean;
  /**
   * Candidates nobody has logged in their region ([CODEX FIRST]), from the snapshot of the system the
   * commander is in. Each species, colour and body is announced once.
   *
   * The bell follows the candidate list (owner, 2026-10-04: Crystalline Shards left the candidates
   * after a full system scan "but remain in the notices"): a [CODEX FIRST] notice for a body in
   * `evaluated` whose candidate is no longer among `finds` is withdrawn, read or not, and may be
   * announced again if the candidate comes back. True when the list changed.
   */
  announceCodexFirst(finds: readonly CodexFirstFind[], at: string, evaluated?: ReadonlySet<string>): boolean;
  snapshot(systemAddress: number | null): NoticesSnapshotDTO;
  /** Call with each live journal line **before** the store applies it. True when a notice was added. */
  observe(line: Line, ctx: NoticesContext): boolean;
  /** The store was rebuilt: seed the records again on the next scan. */
  invalidate(): void;
  /** The ship's average jump in ly: recent jumps, else the loadout's range. */
  jumpLy(ctx: Pick<NoticesContext, "loadoutJumpLy">): number | null;
  /** Every type's records, the commander's and EDAstro's (Statistics → Records). */
  records(ctx: NoticesContext): RecordRowDTO[];
}

function codexFirstId(f: CodexFirstFind): string {
  return `codexfirst:${f.bodyKey}:${f.speciesId}:${f.colours.join("+").toLowerCase()}`;
}

export function createNoticesService(opts: {
  filePath: string | null;
  now?: () => number;
}): NoticesService {
  const now = opts.now ?? Date.now;
  const state = load(opts.filePath);
  const seen = new Set(state.seen);
  let bests: Map<string, Best> | null = null;
  let nspDrop: { systemAddress: number | null; system: string; atMs: number } | null = null;
  /** Inside the void cross after the last jump; null until the first jump of the session (which only sets it). */
  let voidInside: boolean | null = null;
  const jumps: number[] = [];

  function jumpLy(ctx: Pick<NoticesContext, "loadoutJumpLy">): number | null {
    if (jumps.length >= JUMP_SAMPLES_MIN) return jumps.reduce((a, b) => a + b, 0) / jumps.length;
    const l = ctx.loadoutJumpLy?.() ?? null;
    return l != null && l > 0 ? l : null;
  }

  function onJump(line: Line, ctx: NoticesContext): boolean {
    const dist = num(line.JumpDist);
    if (line.event === "FSDJump" && dist != null && dist > 0) {
      jumps.push(dist);
      if (jumps.length > JUMP_SAMPLES) jumps.shift();
    }
    const p = Array.isArray(line.StarPos) ? (line.StarPos as unknown[]) : null;
    const origin = p && p.length >= 3 && p.every((v) => typeof v === "number") ? { x: p[0] as number, y: p[1] as number, z: p[2] as number } : null;
    let voidAdded = false;
    if (origin) {
      const inside = inVoidCross(origin);
      const was = voidInside;
      voidInside = inside;
      if (was != null && was !== inside && state.prefs.features.voidCross) {
        const sys = str(line.StarSystem) || ctx.currentSystem().name;
        voidAdded = add({
          id: `void:${num(line.SystemAddress) ?? sys}:${str(line.timestamp)}`,
          at: str(line.timestamp) || new Date(now()).toISOString(),
          kind: "notable",
          title: inside ? "Entering the void cross" : "Leaving the void cross",
          text: `${sys} — ${Math.round(Math.hypot(origin.x, origin.y, origin.z)).toLocaleString("en-US")} ly from Sol`,
          system: sys,
          systemAddress: num(line.SystemAddress),
          body: null,
          bodyKey: null,
        });
      }
    }
    const perJump = jumpLy(ctx);
    if (!origin || perJump == null) return voidAdded;
    const nearby = state.prefs.nearby ?? DEFAULT_NOTIFY_PREFS.nearby;
    const radius = nearby.jumps * perJump;
    const here = str(line.StarSystem) || ctx.currentSystem().name;
    const at = str(line.timestamp) || new Date(now()).toISOString();
    const ly = (d: number) => `${Math.round(d).toLocaleString("en-US")} ly`;
    let added = false;

    const groups = Object.entries(nearby.poiGroups).filter(([, on]) => on).map(([g]) => g);
    if (groups.length && ctx.nearbyPois) {
      let n = 0;
      for (const poi of ctx.nearbyPois(origin, radius, groups)) {
        if (n >= NEARBY_PER_JUMP) break;
        if (seen.has(`poi:${poi.key}`)) continue;
        n++;
        added =
          add({
            id: `poi:${poi.key}`,
            at,
            kind: "poi",
            title: `Nearby: ${poi.name}`,
            text: `${poi.typeLabel}${poi.system ? ` in ${poi.system}` : ""} — ${ly(poi.distanceLy)} from ${here}`,
            system: poi.system || here,
            systemAddress: null,
            body: null,
            bodyKey: null,
          }) || added;
      }
    }

    if (nearby.nsp && ctx.nearbyNsps) {
      let n = 0;
      for (const s of ctx.nearbyNsps(origin, radius)) {
        if (n >= NEARBY_PER_JUMP) break;
        const id = `nspnear:${s.systemAddress ?? s.system}`;
        if (seen.has(id) || s.systemAddress === num(line.SystemAddress)) continue;
        n++;
        const shown = s.names.slice(0, 3).join(", ") + (s.names.length > 3 ? ` and ${s.names.length - 3} more` : "");
        added =
          add({
            id,
            at,
            kind: "nsp",
            title: `Nearby phenomenon: ${shown}`,
            text: `In ${s.system} — ${ly(s.distanceLy)} from ${here}`,
            system: s.system,
            systemAddress: s.systemAddress,
            body: null,
            bodyKey: null,
          }) || added;
      }
    }

    const fromSol = Math.hypot(origin.x, origin.y, origin.z);
    if (nearby.carriers !== "off" && fromSol > CARRIER_NOTICE_MIN_FROM_SOL_LY && ctx.nearbyCarriers) {
      const wanted = new Set(nearby.carrierServices);
      let n = 0;
      for (const c of ctx.nearbyCarriers(origin, radius)) {
        if (n >= NEARBY_PER_JUMP) break;
        if (nearby.carriers === "services" && !c.services.some((s) => wanted.has(s))) continue;
        const id = `carrier:${c.callsign}@${c.systemAddress ?? c.system}`;
        if (seen.has(id)) continue;
        n++;
        const offers = c.services.filter((s) => wanted.has(s));
        added =
          add({
            id,
            at,
            kind: "carrier",
            title: `Carrier nearby: ${c.name || c.callsign}${c.name ? ` (${c.callsign})` : ""}`,
            text:
              `In ${c.system} — ${ly(c.distanceLy)} from ${here}` +
              (offers.length ? ` · ${offers.map(carrierServiceLabel).join(", ")}` : "") +
              (c.lastSeenDays != null ? ` · last seen ${c.lastSeenDays === 0 ? "today" : `${c.lastSeenDays} day${c.lastSeenDays === 1 ? "" : "s"} ago`}` : ""),
            system: c.system,
            systemAddress: c.systemAddress,
            body: null,
            bodyKey: null,
          }) || added;
      }
    }
    return added;
  }

  function save(): void {
    if (!opts.filePath) return;
    state.seen = [...seen].slice(-MAX_SEEN);
    try {
      writeFileSync(opts.filePath, `${JSON.stringify(state, null, 1)}\n`, "utf8");
    } catch {
      /* best effort: the list is a convenience, the journal is the record */
    }
  }

  function add(n: NoticeDTO): boolean {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    state.items.unshift(n);
    // Over the limit: the oldest read ones go first, then the oldest.
    while (state.items.length > MAX_ITEMS) {
      let i = -1;
      for (let k = state.items.length - 1; k >= 0; k--) if (state.items[k]!.read) { i = k; break; }
      state.items.splice(i >= 0 ? i : state.items.length - 1, 1);
    }
    return true;
  }

  function seed(ctx: NoticesContext): Map<string, Best> {
    const m = new Map<string, Best>();
    for (const r of ctx.allScans()) {
      if (r.edsmHydrated || r.isSynthetic || r.playerScanned === false) continue;
      const s = scanSubject(r);
      if (!s) continue;
      const k = recordKey(s.subject, s.type);
      const name = r.bodyName || r.starSystem || "";
      const b = m.get(k);
      if (!b) m.set(k, { largest: s.radius, smallest: s.radius, largestBody: name, smallestBody: name, count: 1 });
      else {
        b.count++;
        if (s.radius > b.largest) {
          b.largest = s.radius;
          b.largestBody = name;
        }
        if (s.radius < b.smallest) {
          b.smallest = s.radius;
          b.smallestBody = name;
        }
      }
    }
    return m;
  }

  function onScan(line: Line, ctx: NoticesContext): boolean {
    if (str(line.ScanType) === "NavBeaconDetail") return false;
    const addr = num(line.SystemAddress);
    const bodyId = num(line.BodyID);
    if (addr == null || bodyId == null) return false;
    const bodyKey = toBodyKey(addr, bodyId);
    if (ctx.isKnownBody(bodyKey)) return false;
    const system = str(line.StarSystem) || ctx.currentSystem().name;
    const body = shortBodyName(str(line.BodyName), system) || `Body ${bodyId}`;
    const at = str(line.timestamp) || new Date(now()).toISOString();
    const base = { at, system, systemAddress: addr, body, bodyKey };
    let added = false;

    const planetClass = str(line.PlanetClass);
    const kind = str(line.StarType) ? null : notableKindFor(planetClass, str(line.TerraformState));
    if (kind && state.prefs.notable[kind]) {
      const tf = str(line.TerraformState).toLowerCase() === "terraformable";
      added =
        add({
          ...base,
          id: `notable:${bodyKey}`,
          kind: "notable",
          title: `${NOTABLE_TITLE[kind] ?? planetClass}${tf ? " (terraformable)" : ""}`,
          text: `${body} in ${system}`,
        }) || added;
    }

    if (state.prefs.notable.green && !str(line.StarType) && ctx.greenGiant) {
      const v = ctx.greenGiant({
        systemAddress: addr,
        bodyId,
        bodyName: str(line.BodyName),
        planetClass: planetClass || undefined,
        surfaceTemperature: num(line.SurfaceTemperature) ?? undefined,
        massEM: num(line.MassEM) ?? undefined,
        radius: num(line.Radius) ?? undefined,
      });
      if (v) {
        added =
          add({ ...base, id: `ggg:${bodyKey}`, kind: "notable", title: greenGiantLabel(v), text: `${body} in ${system} — ${v.why}` }) ||
          added;
      }
    }

    if (BODY_FEATURES.some((f) => state.prefs.features[f.key])) {
      const dp = directParent(line.Parents);
      const parent = dp && dp.kind !== "Null" ? (ctx.scanOf?.(toBodyKey(addr, dp.id)) ?? null) : null;
      for (const f of bodyFeatures(featureRecordFromScan(line), parent)) {
        if (!state.prefs.features[f.key]) continue;
        added =
          add({ ...base, id: `feature:${f.key}:${bodyKey}`, kind: "notable", title: f.label, text: `${body} in ${system} — ${f.why}` }) ||
          added;
      }
    }

    const s = scanSubject({
      starType: str(line.StarType) || undefined,
      planetClass: planetClass || undefined,
      radius: num(line.Radius) ?? undefined,
    });
    if (s && state.prefs.records) {
      bests ??= seed(ctx);
      const k = recordKey(s.subject, s.type);
      const b = bests.get(k);
      const fullName = str(line.BodyName) || system;
      if (!b) bests.set(k, { largest: s.radius, smallest: s.radius, largestBody: fullName, smallestBody: fullName, count: 1 });
      else {
        b.count++;
        for (const which of ["largest", "smallest"] as const) {
          const beats = which === "largest" ? s.radius > b.largest : s.radius < b.smallest;
          if (!beats) continue;
          const mark: RecordMarkDTO = {
            bodyKey,
            systemAddress: addr,
            bodyId,
            system,
            body,
            subject: s.subject,
            type: s.type,
            which,
            radius: s.radius,
            previous: which === "largest" ? b.largest : b.smallest,
            at,
          };
          if (which === "largest") {
            b.largest = s.radius;
            b.largestBody = fullName;
          } else {
            b.smallest = s.radius;
            b.smallestBody = fullName;
          }
          state.records.push(mark);
          // EDAstro's galactic record, when downloaded: how this one compares.
          const g = ctx.galacticRecord?.(k)?.[which] ?? null;
          const beatsGalaxy = g != null && (which === "largest" ? s.radius > g.radius : s.radius < g.radius);
          added =
            add({
              ...base,
              id: `record:${which}:${k}:${bodyKey}`,
              kind: "record",
              title: beatsGalaxy
                ? `Beyond EDAstro's galactic record: ${which} ${recordTypeLabel(s.subject, s.type)}`
                : `Record: ${which} ${recordTypeLabel(s.subject, s.type)}`,
              text:
                `${body} in ${system} — ${formatRadius(mark.radius, mark.subject)} (was ${formatRadius(mark.previous, mark.subject)})` +
                (g ? ` · galactic ${formatRadius(g.radius, mark.subject)}` : ""),
            }) || added;
        }
      }
    } else if (s && bests) {
      // Records off: keep the bests honest so turning them back on does not announce old news.
      const b = bests.get(recordKey(s.subject, s.type));
      if (b) {
        b.count++;
        const fullName = str(line.BodyName) || system;
        if (s.radius > b.largest) {
          b.largest = s.radius;
          b.largestBody = fullName;
        }
        if (s.radius < b.smallest) {
          b.smallest = s.radius;
          b.smallestBody = fullName;
        }
      }
    }
    return added;
  }

  function onNspSignal(line: Line, ctx: NoticesContext): boolean {
    if (!state.prefs.nsp) return false;
    if (str(line.SignalType) !== "Codex" && !NSP_SIGNAL.test(str(line.SignalName))) return false;
    const cur = ctx.currentSystem();
    const addr = num(line.SystemAddress) ?? cur.address;
    return add({
      id: `nsp:${addr ?? cur.name}`,
      at: str(line.timestamp) || new Date(now()).toISOString(),
      kind: "nsp",
      title: "Notable stellar phenomenon",
      text: `In ${cur.name} — drop in at the signal to see which`,
      system: cur.name,
      systemAddress: addr,
      body: null,
      bodyKey: null,
    });
  }

  /** A green gas giant confirmed by the codex, or a K10 anomaly that says one is in the system. */
  /*
    Green gas giants confirmed by the codex: the codex line names the ship's body, not the scanned one
    (2026-10-08), so the notice waits for the gas giant scanned with it (shared/greenCodexMatch.ts).
  */
  const greenCodex = createGreenCodexMatcher();
  function greenCodexConfirmed(line: Line, ctx: NoticesContext): boolean {
    if (line.event !== "Scan" && line.event !== "CodexEntry") return false;
    let changed = false;
    for (const e of greenCodex.observe(line)) {
      const id = `ggg-codex:${e.bodyKey}`;
      if (e.kind === "retract") {
        const before = state.items.length;
        state.items = state.items.filter((n) => n.id !== id);
        changed = changed || state.items.length !== before;
        continue;
      }
      if (!state.prefs.notable.green) continue;
      const addr = num(e.codex.SystemAddress)!;
      const system = str(e.codex.System) || ctx.currentSystem().name;
      const scanned = line.event === "Scan" ? str(line.BodyName) : (ctx.scanOf?.(e.bodyKey)?.bodyName ?? "");
      const body = shortBodyName(scanned, system) || e.bodyKey;
      changed =
        add({
          id,
          at: str(e.codex.timestamp) || new Date(now()).toISOString(),
          kind: "notable",
          title: "Green gas giant — confirmed by the codex",
          text: `${body} in ${system}`,
          system,
          systemAddress: addr,
          body,
          bodyKey: e.bodyKey,
          codexNew: e.codex.IsNewEntry === true,
        }) || changed;
    }
    return changed;
  }

  function onGreenCodex(line: Line, ctx: NoticesContext): boolean {
    if (!state.prefs.notable.green) return false;
    const addr = num(line.SystemAddress);
    if (addr == null) return false;
    const name = str(line.Name);
    const system = str(line.System) || ctx.currentSystem().name;
    const at = str(line.timestamp) || new Date(now()).toISOString();
    // A green codex entry's notice goes out with its body's scan (greenCodexConfirmed below).
    if (greenCodexId(name)) return false;
    if (isK10CodexName(name)) {
      return add({
        id: `k10:${addr}`,
        at,
        kind: "notable",
        title: "K10-Type Anomaly — a green gas giant is likely here",
        text: `${system}: K10 anomalies spawn only around green gas giants. Look at its gas giants.`,
        system,
        systemAddress: addr,
        body: null,
        bodyKey: null,
      });
    }
    return false;
  }

  function onCodex(line: Line): boolean {
    const drop = nspDrop;
    if (!drop || !state.prefs.nsp) return false;
    const atMs = Date.parse(str(line.timestamp));
    if (!Number.isFinite(atMs) || atMs - drop.atMs > NSP_DROP_WINDOW_MS || atMs < drop.atMs) return false;
    const addr = num(line.SystemAddress) ?? drop.systemAddress;
    if (drop.systemAddress != null && addr !== drop.systemAddress) return false;
    nspDrop = null;
    const name = str(line.Name_Localised) || "Notable stellar phenomenon";
    const codexNew = line.IsNewEntry === true;
    // The general "one is here" notice is answered: drop it if still unread.
    state.items = state.items.filter((n) => n.id !== `nsp:${addr ?? drop.system}`);
    add({
      id: `nsp:${addr ?? drop.system}:${num(line.EntryID) ?? name}`,
      at: str(line.timestamp),
      kind: "nsp",
      title: codexNew ? `${name} — new codex entry` : name,
      text: `Notable stellar phenomenon in ${str(line.System) || drop.system}`,
      system: str(line.System) || drop.system,
      systemAddress: addr,
      body: null,
      bodyKey: null,
      codexNew,
    });
    return true;
  }

  return {
    prefs: () => state.prefs,
    setPrefs(raw) {
      state.prefs = mergeNotifyPrefs(state.prefs, raw);
      save();
      return state.prefs;
    },
    list: () => state.items,
    markRead(ids) {
      const pick = ids === "all" ? null : new Set(ids);
      let changed = 0;
      for (const n of state.items) {
        if (n.read || (pick && !pick.has(n.id))) continue;
        n.read = true;
        changed++;
      }
      if (changed) save();
      return changed;
    },
    markUnread(ids) {
      const pick = new Set(ids);
      let changed = 0;
      for (const n of state.items) {
        if (!n.read || !pick.has(n.id)) continue;
        delete n.read;
        changed++;
      }
      if (changed) save();
      return changed;
    },
    announceCodexFirst(finds, at, evaluated) {
      if (!state.prefs.codexFirst) return false;
      let added = false;
      if (evaluated?.size) {
        const keep = new Set(finds.map(codexFirstId));
        const before = state.items.length;
        state.items = state.items.filter((n) => {
          const gone = n.kind === "codex" && n.id.startsWith("codexfirst:") && n.bodyKey != null && evaluated.has(n.bodyKey) && !keep.has(n.id);
          if (gone) seen.delete(n.id);
          return !gone;
        });
        added = state.items.length !== before;
      }
      for (const f of finds) {
        const what = f.colours.length ? `${f.species} (${f.colours.join(" or ")})` : f.species;
        added =
          add({
            id: codexFirstId(f),
            at,
            kind: "codex",
            title: `Codex first possible: ${what}`,
            text: `${f.body} in ${f.system} — nobody has logged it in ${f.region} yet (EDSM)`,
            system: f.system,
            systemAddress: f.systemAddress,
            body: f.body,
            bodyKey: f.bodyKey,
          }) || added;
      }
      if (added) save();
      return added;
    },
    sendTest(at) {
      const n: NoticeDTO = {
        id: `test:${at}`,
        at,
        // A record, so the chime rings when it is on: the one notice kind that has a sound.
        kind: "record",
        title: "Test notice",
        text: "This is how a find appears. Mark it read, or clear read notices, to remove it.",
        system: "",
        systemAddress: null,
        body: null,
        bodyKey: null,
      };
      state.items = [n, ...state.items.filter((x) => !x.id.startsWith("test:"))];
      save();
      return n;
    },
    announceAchievement(a, at) {
      const added = add({
        id: `achievement:${a.id}:${a.step}`,
        at,
        kind: "achievement",
        title: a.title,
        text: a.text,
        system: "",
        systemAddress: null,
        body: null,
        bodyKey: null,
      });
      if (added) save();
      return added;
    },
    announceGggResearch(n, at) {
      const added = add({ ...n, id: `ggg-research:${n.bodyKey}`, at, kind: "notable" });
      if (added) save();
      return added;
    },
    clearRead() {
      const before = state.items.length;
      state.items = state.items.filter((n) => !n.read);
      const gone = before - state.items.length;
      if (gone) save();
      return gone;
    },
    snapshot(systemAddress) {
      return {
        items: state.items,
        unread: state.items.filter((n) => !n.read).length,
        chime: state.prefs.chime,
        recordMarks:
          systemAddress == null || !state.prefs.records
            ? []
            : state.records.filter((r) => r.systemAddress === systemAddress),
      };
    },
    observe(line, ctx) {
      let changed = greenCodexConfirmed(line, ctx);
      switch (line.event) {
        case "Scan":
          changed = onScan(line, ctx);
          break;
        case "FSSSignalDiscovered":
          changed = onNspSignal(line, ctx);
          break;
        case "SupercruiseDestinationDrop":
          if (NSP_SIGNAL.test(str(line.Type))) {
            const cur = ctx.currentSystem();
            const atMs = Date.parse(str(line.timestamp));
            nspDrop = { systemAddress: cur.address, system: cur.name, atMs: Number.isFinite(atMs) ? atMs : now() };
          }
          break;
        case "CodexEntry": {
          const green = onGreenCodex(line, ctx);
          changed = onCodex(line) || green;
          break;
        }
        case "FSDJump":
        case "CarrierJump":
          nspDrop = null;
          changed = onJump(line, ctx);
          break;
      }
      if (changed) save();
      return changed;
    },
    invalidate() {
      bests = null;
    },
    jumpLy,
    records(ctx) {
      bests ??= seed(ctx);
      const rows: RecordRowDTO[] = [];
      for (const [key, b] of bests) {
        const colon = key.indexOf(":");
        const subject = key.slice(0, colon) as RecordSubject;
        const type = key.slice(colon + 1);
        rows.push({
          key,
          subject,
          type,
          label: capitalise(recordTypeLabel(subject, type)),
          count: b.count,
          largest: { radius: b.largest, body: b.largestBody },
          smallest: { radius: b.smallest, body: b.smallestBody },
          galactic: ctx.galacticRecord?.(key) ?? null,
        });
      }
      return rows.sort((a, b) => (a.subject === b.subject ? a.label.localeCompare(b.label) : a.subject === "star" ? -1 : 1));
    },
  };
}

function load(filePath: string | null): NoticesFile {
  const fresh: NoticesFile = {
    formatVersion: 1,
    prefs: structuredClone(DEFAULT_NOTIFY_PREFS),
    items: [],
    seen: [],
    records: [],
  };
  if (!filePath || !existsSync(filePath)) return fresh;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<NoticesFile>;
    return {
      formatVersion: 1,
      prefs: mergeNotifyPrefs(fresh.prefs, raw.prefs),
      items: Array.isArray(raw.items) ? raw.items.filter((n) => n && typeof n.id === "string").slice(0, MAX_ITEMS) : [],
      seen: Array.isArray(raw.seen) ? raw.seen.filter((x): x is string => typeof x === "string") : [],
      records: Array.isArray(raw.records) ? raw.records.filter((r) => r && typeof r.bodyKey === "string") : [],
    };
  } catch {
    // A broken file costs the unread list, not the app.
    return fresh;
  }
}
