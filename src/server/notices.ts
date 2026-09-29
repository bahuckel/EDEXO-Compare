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
 *
 * Kept in `edexo-notices.json` beside the user settings: the unread list, the ids already announced
 * (so the same body never comes back after being read), the records, and the settings.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExplorationScanRecord } from "../shared/types.js";
import {
  DEFAULT_NOTIFY_PREFS,
  mergeNotifyPrefs,
  formatRadius,
  notableKindFor,
  recordTypeLabel,
  type NotableKind,
  type NoticeDTO,
  type NoticesSnapshotDTO,
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
}

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
  /** Unread notices, newest first. */
  list(): NoticeDTO[];
  /** Marks read (removes) the given ids, or all of them. Returns how many went. */
  markRead(ids: readonly string[] | "all"): number;
  snapshot(systemAddress: number | null): NoticesSnapshotDTO;
  /** Call with each live journal line **before** the store applies it. True when a notice was added. */
  observe(line: Line, ctx: NoticesContext): boolean;
  /** The store was rebuilt: seed the records again on the next scan. */
  invalidate(): void;
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
    if (state.items.length > MAX_ITEMS) state.items.length = MAX_ITEMS;
    return true;
  }

  function seed(ctx: NoticesContext): Map<string, Best> {
    const m = new Map<string, Best>();
    for (const r of ctx.allScans()) {
      if (r.edsmHydrated || r.isSynthetic || r.playerScanned === false) continue;
      const s = scanSubject(r);
      if (!s) continue;
      const k = recordKey(s.subject, s.type);
      const b = m.get(k);
      if (!b) m.set(k, { largest: s.radius, smallest: s.radius });
      else {
        if (s.radius > b.largest) b.largest = s.radius;
        if (s.radius < b.smallest) b.smallest = s.radius;
      }
    }
    return m;
  }

  function onScan(line: Line, ctx: NoticesContext): boolean {
    if (str(line.ScanType) === "NavBeaconDetail") return false;
    const addr = num(line.SystemAddress);
    const bodyId = num(line.BodyID);
    if (addr == null || bodyId == null) return false;
    const bodyKey = `${addr}:${bodyId}`;
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

    const s = scanSubject({
      starType: str(line.StarType) || undefined,
      planetClass: planetClass || undefined,
      radius: num(line.Radius) ?? undefined,
    });
    if (s && state.prefs.records) {
      bests ??= seed(ctx);
      const k = recordKey(s.subject, s.type);
      const b = bests.get(k);
      if (!b) bests.set(k, { largest: s.radius, smallest: s.radius });
      else {
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
          if (which === "largest") b.largest = s.radius;
          else b.smallest = s.radius;
          state.records.push(mark);
          added =
            add({
              ...base,
              id: `record:${which}:${k}:${bodyKey}`,
              kind: "record",
              title: `Record: ${which} ${recordTypeLabel(s.subject, s.type)}`,
              text: `${body} in ${system} — ${formatRadius(mark.radius, mark.subject)} (was ${formatRadius(mark.previous, mark.subject)})`,
            }) || added;
        }
      }
    } else if (s && bests) {
      // Records off: keep the bests honest so turning them back on does not announce old news.
      const b = bests.get(recordKey(s.subject, s.type));
      if (b) {
        b.largest = Math.max(b.largest, s.radius);
        b.smallest = Math.min(b.smallest, s.radius);
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
      const before = state.items.length;
      if (ids === "all") state.items = [];
      else {
        const drop = new Set(ids);
        state.items = state.items.filter((n) => !drop.has(n.id));
      }
      const gone = before - state.items.length;
      if (gone) save();
      return gone;
    },
    snapshot(systemAddress) {
      return {
        items: state.items,
        chime: state.prefs.chime,
        recordMarks:
          systemAddress == null || !state.prefs.records
            ? []
            : state.records.filter((r) => r.systemAddress === systemAddress),
      };
    },
    observe(line, ctx) {
      let changed = false;
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
        case "CodexEntry":
          changed = onCodex(line);
          break;
        case "FSDJump":
        case "CarrierJump":
          nspDrop = null;
          break;
      }
      if (changed) save();
      return changed;
    },
    invalidate() {
      bests = null;
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
