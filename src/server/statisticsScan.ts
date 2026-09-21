/**
 * Three years of journals, reduced to the handful of rows a statistics panel needs.
 *
 * The owner's journal folder is **303 MB across 277 files, 352,820 lines**, and only **14.3 %** of
 * those lines mention an event this cares about. So the scan tests each raw line against a short
 * list of event names before `JSON.parse` — the same trick that made the Spansh dump pass tractable
 * — and what comes out is small enough to cache whole.
 *
 * The cache lives beside the user's settings and is keyed on a manifest of file name, size and
 * mtime. A finished journal never changes, so a re-open re-reads only the file being written to.
 * There is no incremental-offset cleverness here on purpose: the whole scan is a few seconds, and
 * §3 of `docs/archive/session-notes-19092026-opus.md` is what happens when this app gets clever
 * about partial journal reads.
 *
 * ### What it keeps, and what it deliberately drops
 *
 * Income rows carry a timestamp, a category and a signed credit figure — see
 * `shared/incomeCategories.ts` for the three counting rules, each of which is wrong in a plausible
 * way if taken naively. Activity is counted, not listed. Balances are sampled where the journal
 * states one outright.
 *
 * Nothing here retains a system name, a body, a faction or a commander. The panel shows totals, and
 * a cache of the owner's movements is not something this app needs on disk to draw a bar chart.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { incomeFromJournalLine, INCOME_EVENT_NAMES, type IncomeEvent } from "../shared/incomeCategories.js";
import type { CarrierLedgerBreak } from "../shared/carrierUpkeep.js";
import { resolveUserSettingsJsonPath } from "./paths.js";

/** Counted rather than listed: the panel wants "how many", never "which". */
export interface ActivityCounts {
  bodiesScanned: number;
  jumps: number;
  systemsHonked: number;
  bodiesMapped: number;
  organicSamples: number;
}

/**
 * Activity counted per calendar day, `YYYY-MM-DD` -> counts.
 *
 * Bucketed rather than kept as rows: 37,780 `Scan` events over three years is 37,780 timestamps to
 * cache, where the panel only ever asks "how many since a date". Days are the finest window it
 * offers divided by 24, so a day bucket answers every window it has and costs about 1,100 entries.
 *
 * It also keeps the cache free of the owner's movements. A bar chart does not need a list of every
 * body he has ever scanned written to disk, and this way it never exists.
 */
export type ActivityByDay = Record<string, ActivityCounts>;

/** A balance the journal stated outright, rather than one inferred from movements. */
export interface BalanceSample {
  at: string;
  /** The commander's credits, from `LoadGame` or a carrier transfer. */
  commander: number | null;
  /** What the carrier holds. */
  carrier: number | null;
  /** Set aside for upkeep and services. */
  carrierReserve: number | null;
  /** `carrier - carrierReserve`. Negative means the reserve is not covered. */
  carrierAvailable: number | null;
  /**
   * Which carrier this reading is about, from the event's `CarrierID`.
   *
   * A commander can own a fleet carrier and a squadron carrier at once, and every carrier event
   * names its own. Without this the two accounts interleave into one series and the weekly upkeep is
   * measured across the gap between them — a confident, wrong number.
   */
  carrierId: number | null;
}

/** What the journals know about a carrier besides its money. */
export interface CarrierIdentity {
  carrierId: number;
  /** As the commander named it. Empty when no event has said. */
  name: string;
  callsign: string;
  /** Raw `CarrierType`, e.g. `FleetCarrier`. Kept verbatim rather than mapped to an enum here. */
  type: string;
}

export interface JournalScan {
  income: IncomeEvent[];
  activity: ActivityByDay;
  balances: BalanceSample[];
  /** Session spans, for the credits-per-hour denominator. */
  sessions: { from: string; to: string }[];
  /**
   * Moments the carrier account moved for a reason that is not upkeep.
   *
   * `estimateCarrierUpkeep` measures the weekly charge from the gap between two balance readings,
   * which only works when nothing else touched the account in between. A transfer spoils the pair;
   * a service change spoils every pair before it, because it changes what the charge *is*.
   */
  carrierBreaks: CarrierLedgerBreak[];
  /** Name, callsign and type per `CarrierID`, newest wins. */
  carrierIdentities: Record<string, CarrierIdentity>;
  filesRead: number;
  linesRead: number;
}

const ACTIVITY_EVENTS = ["Scan", "FSDJump", "FSSDiscoveryScan", "SAAScanComplete", "ScanOrganic"];
const BALANCE_EVENTS = ["LoadGame", "CarrierStats", "CarrierFinance", "CarrierBankTransfer"];
/** Names a carrier the moment it is bought, before any stats event has been opened. */
const CARRIER_ID_EVENTS = ["CarrierBuy"];
/** Not balances themselves — they say when a balance moved for a reason other than upkeep. */
const CARRIER_BREAK_EVENTS = ["CarrierCrewServices"];
/** Every event name worth parsing. Tested as a substring against the raw line first. */
const WANTED = [
  ...INCOME_EVENT_NAMES,
  ...ACTIVITY_EVENTS,
  ...BALANCE_EVENTS,
  ...CARRIER_BREAK_EVENTS,
  ...CARRIER_ID_EVENTS,
].map((e) => `"${e}"`);

/**
 * Remember what a carrier is called, from any event that says.
 *
 * `CarrierStats` carries the name and callsign; `CarrierBuy` names it at purchase; the rest carry
 * only the id. Newest wins, because a carrier can be renamed.
 */
function noteCarrierIdentity(scan: JournalScan, line: Record<string, unknown>, id: number | null): void {
  if (id == null) return;
  const key = String(id);
  const prev = scan.carrierIdentities[key];
  const name = typeof line.Name === "string" ? line.Name : (prev?.name ?? "");
  const callsign = typeof line.Callsign === "string" ? line.Callsign : (prev?.callsign ?? "");
  const type = typeof line.CarrierType === "string" ? line.CarrierType : (prev?.type ?? "");
  scan.carrierIdentities[key] = { carrierId: id, name, callsign, type };
}

function emptyScan(): JournalScan {
  return {
    income: [],
    activity: {},
    balances: [],
    sessions: [],
    carrierBreaks: [],
    carrierIdentities: {},
    filesRead: 0,
    linesRead: 0,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Fold one parsed journal line into the scan. Exported so a test can drive it without a file. */
export function applyScanLine(scan: JournalScan, line: Record<string, unknown>): void {
  const event = typeof line.event === "string" ? line.event : "";
  const at = typeof line.timestamp === "string" ? line.timestamp : "";

  for (const row of incomeFromJournalLine(line)) scan.income.push(row);

  const bump = (field: keyof ActivityCounts): void => {
    const day = at.slice(0, 10);
    if (day.length !== 10) return;
    const bucket = (scan.activity[day] ??= {
      bodiesScanned: 0,
      jumps: 0,
      systemsHonked: 0,
      bodiesMapped: 0,
      organicSamples: 0,
    });
    bucket[field] += 1;
  };

  switch (event) {
    case "Scan":
      bump("bodiesScanned");
      return;
    case "FSDJump":
      bump("jumps");
      return;
    case "FSSDiscoveryScan":
      bump("systemsHonked");
      return;
    case "SAAScanComplete":
      bump("bodiesMapped");
      return;
    case "ScanOrganic":
      /*
        Counted per event, and the panel must say so. A single plant emits three -- Log, Sample,
        Analyse -- so this is "scans taken", not "plants found". Dividing by three would be worse: a
        run can be abandoned after one.
      */
      bump("organicSamples");
      return;
    case "LoadGame":
      if (at && num(line.Credits) != null) {
        scan.balances.push({
          at,
          commander: num(line.Credits),
          carrier: null,
          carrierReserve: null,
          carrierAvailable: null,
          carrierId: null,
        });
      }
      return;
    case "CarrierStats":
    case "CarrierFinance": {
      const f = (event === "CarrierStats" ? line.Finance : line) as Record<string, unknown> | undefined;
      if (!at || !f) return;
      const carrier = num(f.CarrierBalance);
      const carrierId = num(line.CarrierID);
      noteCarrierIdentity(scan, line, carrierId);
      if (carrier == null) return;
      scan.balances.push({
        at,
        commander: null,
        carrier,
        carrierReserve: num(f.ReserveBalance),
        carrierAvailable: num(f.AvailableBalance),
        carrierId,
      });
      return;
    }
    case "CarrierBuy":
      noteCarrierIdentity(scan, line, num(line.CarrierID));
      return;
    case "CarrierCrewServices": {
      // Activating, pausing or dismissing a service changes the weekly charge from here on.
      if (at) scan.carrierBreaks.push({ at, kind: "service", carrierId: num(line.CarrierID) });
      return;
    }
    case "CarrierBankTransfer": {
      // States both sides at once, so it samples two series from one line.
      if (!at) return;
      const transferId = num(line.CarrierID);
      noteCarrierIdentity(scan, line, transferId);
      scan.carrierBreaks.push({ at, kind: "transfer", carrierId: transferId });
      scan.balances.push({
        at,
        commander: num(line.PlayerBalance),
        carrier: num(line.CarrierBalance),
        carrierReserve: null,
        carrierAvailable: null,
        carrierId: transferId,
      });
      return;
    }
    default:
      return;
  }
}

async function scanOneFile(path: string, scan: JournalScan): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let first = "";
  let last = "";
  for await (const raw of rl) {
    scan.linesRead += 1;
    const i = raw.indexOf('"timestamp":"');
    if (i >= 0) {
      const ts = raw.slice(i + 13, i + 33);
      if (!first) first = ts;
      last = ts;
    }
    // The prefilter: 85.7 % of lines leave here without being parsed.
    let wanted = false;
    for (const w of WANTED) {
      if (raw.includes(w)) {
        wanted = true;
        break;
      }
    }
    if (!wanted) continue;
    try {
      applyScanLine(scan, JSON.parse(raw) as Record<string, unknown>);
    } catch {
      /* a truncated last line is normal on a journal being written to */
    }
  }
  if (first && last) scan.sessions.push({ from: first, to: last });
  scan.filesRead += 1;
}

/** File name, size and mtime for every journal, so a cache knows when it is stale. */
function manifestOf(files: readonly string[]): string {
  const parts: string[] = [];
  for (const f of files) {
    try {
      const st = statSync(f);
      parts.push(`${f}:${st.size}:${Math.trunc(st.mtimeMs)}`);
    } catch {
      parts.push(`${f}:missing`);
    }
  }
  return parts.join("|");
}

function cachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-statistics.json");
}

interface CacheFile {
  version: number;
  manifest: string;
  scan: JournalScan;
}

/** Bumped when the shape or the counting rules change, so a stale cache is discarded not trusted. */
/**
 * Bumped to 2 on 2026-09-21, when `carrierBreaks` joined the scan.
 *
 * A version 1 cache holds a scan with no break list at all, and reading it would measure the weekly
 * upkeep across transfers as if they were upkeep — a wrong number rather than a missing one. The
 * bump discards those caches and rescans, which costs three seconds.
 */
const CACHE_VERSION = 3;

export async function scanJournalsForStatistics(files: readonly string[]): Promise<JournalScan> {
  const manifest = manifestOf(files);
  const path = cachePath();
  if (existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
      if (cached.version === CACHE_VERSION && cached.manifest === manifest && cached.scan) {
        return cached.scan;
      }
    } catch {
      /* a corrupt cache is a rescan, never an error */
    }
  }

  const scan = emptyScan();
  for (const f of files) {
    try {
      await scanOneFile(f, scan);
    } catch {
      /* one unreadable journal must not lose the other 276 */
    }
  }
  scan.income.sort((a, b) => a.at.localeCompare(b.at));
  scan.balances.sort((a, b) => a.at.localeCompare(b.at));
  scan.sessions.sort((a, b) => a.from.localeCompare(b.from));

  try {
    const tmp = `${path}.part`;
    writeFileSync(
      tmp,
      JSON.stringify({ version: CACHE_VERSION, manifest, scan } satisfies CacheFile),
      "utf8",
    );
    renameSync(tmp, path);
  } catch {
    /* a cache that cannot be written costs seconds on the next open, not correctness */
  }
  return scan;
}

/** Drop the cache. Used by tests, and by a version bump that wants a clean rescan. */
export function clearStatisticsCache(): void {
  try {
    const p = cachePath();
    if (existsSync(p)) writeFileSync(p, "", "utf8");
  } catch {
    /* best effort */
  }
}
