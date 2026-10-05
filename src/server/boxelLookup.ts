/**
 * Look up a boxel on Spansh (owner, 2026-10-05, plan Q1: "blank until Look up — a Look up button per
 * boxel fetches the rest from Spansh, spaced like Check EDSM").
 *
 * The systems not flown are blank in the table unless the galaxy index has them, and the index never
 * has Class I–V or Helium gas giants (it keeps only bodies that matter for biology). Spansh's system
 * search does: `POST /api/systems/search` with the boxel's prefix as the name lists the boxel's
 * systems first, 100 a page, each with every body's type, its terraforming state and the species
 * commanders logged there (`landmarks`). A boxel is a few pages, five seconds apart.
 *
 * The answer is kept per boxel for 30 days in `edexo-boxel-lookups.json` beside the user settings:
 * its own file, never the journal merge, the discoveries or the visited list. A system of the boxel
 * Spansh does not list is "not on Spansh" — undiscovered as far as anyone uploaded.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { boxelIndexOf, parseBoxel, type BoxelLookupStatus, type BoxelNotableDTO } from "../shared/boxel.js";
import {
  BODY_TRAITS,
  isGiantStar,
  planetClassIndex,
  STAR_CLASSES,
  starClassIndex,
} from "../shared/galaxyTraits.js";
import { NOTABLE_KINDS, notableKindFor, type NotableKind } from "../shared/notices.js";
import { toJournalPlanetClass } from "../shared/normalise/planetClass.js";
import { isTerraformableState } from "../shared/terraformState.js";
import { classifyGreenGiant } from "../shared/greenGasGiant.js";
import { APP_USER_AGENT } from "./appVersion.js";

const SEARCH_URL = "https://spansh.co.uk/api/systems/search";
/** Check EDSM's spacing (navRouteLog.ts): one request every five seconds. */
export const LOOKUP_GAP_MS = 5_000;
const PAGE = 100;
/** 3,000 systems: past any boxel anyone flies by hand. */
const MAX_PAGES = 30;
export const LOOKUP_CACHE_DAYS = 30;

/** What Spansh says about one system of the boxel. */
export interface LookupSystemFacts {
  /** Spansh's id64 (= the journal's SystemAddress), so Spansh opens it without a name search. */
  id64?: number;
  mainStar: string | null;
  otherStars: string[];
  starClasses: string[];
  bodyCount: number;
  notables: BoxelNotableDTO[];
  bodyTypes: string[];
  /** Species commanders logged there (Spansh landmarks of the exobiology genera). */
  species: string[];
}

export interface BoxelLookupRecord {
  prefix: string;
  fetchedAt: string;
  /** Every page was read: a system missing from `systems` is not on Spansh. */
  complete: boolean;
  systems: Record<string, LookupSystemFacts>;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "F (White) Star" → "F"; a giant counts under its class and under SG, as in the galaxy index. */
function starKeys(subtype: string): string[] {
  const i = starClassIndex(subtype);
  const out = i >= 0 ? [STAR_CLASSES[i]!.key] : [];
  if (isGiantStar(subtype)) out.push("SG");
  return out;
}

/** "F (White) Star" → "F", "Neutron Star" → "Neutron Star", "M (Red giant) Star" → "M giant". */
function starLabel(subtype: string): string {
  const m = /^([OBAFGKMLTY]) \(([^)]*)\) Star$/.exec(subtype);
  if (m)
    return /giant/i.test(m[2]!)
      ? `${m[1]} ${m[2]!.toLowerCase().includes("super") ? "supergiant" : "giant"}`
      : m[1]!;
  return subtype.replace(/ Star$/, "") || subtype;
}

/**
 * One Spansh search result → its facts. Exported for tests. `isPlant` says which landmark types are
 * exobiology genera (Spansh lists geology and space life as landmarks too).
 */
export function spanshSearchSystemFacts(
  sys: unknown,
  isPlant: (genus: string) => boolean,
): LookupSystemFacts | null {
  const s = obj(sys);
  if (!s) return null;
  const bodies = Array.isArray(s.bodies)
    ? s.bodies.map(obj).filter((b): b is Record<string, unknown> => !!b)
    : [];
  const stars = bodies.filter((b) => str(b.type) === "Star");
  const main =
    stars.find((b) => b.is_main_star === true) ??
    stars.find((b) => Number(b.distance_to_arrival) === 0) ??
    null;
  const others = stars.filter((b) => b !== main);
  const starClasses = [...new Set([main, ...others].flatMap((b) => (b ? starKeys(str(b.subtype)) : [])))];
  const count = new Map<NotableKind, number>();
  const bodyTypes = new Set<string>();
  const species = new Set<string>();
  for (const b of bodies) {
    for (const l of Array.isArray(b.landmarks) ? b.landmarks : []) {
      const lm = obj(l);
      if (lm && isPlant(str(lm.type)) && str(lm.subtype)) species.add(str(lm.subtype));
    }
    if (str(b.type) !== "Planet") continue;
    const pc = toJournalPlanetClass(str(b.subtype)) ?? str(b.subtype);
    // Exact class only (owner): "Helium-rich gas giant" normalises to "Helium rich gas giant", never this.
    const kind = notableKindFor(pc, str(b.terraforming_state));
    if (kind) count.set(kind, (count.get(kind) ?? 0) + 1);
    if (classifyGreenGiant({ planetClass: pc, surfaceTemperatureK: null, bodyName: str(b.name) }))
      count.set("green", (count.get("green") ?? 0) + 1);
    const ti = planetClassIndex(str(b.subtype));
    if (ti >= 0) bodyTypes.add(BODY_TRAITS[ti]!.key);
    if (isTerraformableState(str(b.terraforming_state))) bodyTypes.add("terraformable");
  }
  return {
    ...(typeof s.id64 === "number" && Number.isSafeInteger(s.id64) ? { id64: s.id64 } : {}),
    mainStar: main ? starLabel(str(main.subtype)) : null,
    otherStars: others.map((b) => starLabel(str(b.subtype))),
    starClasses,
    bodyCount: typeof s.body_count === "number" ? Math.max(s.body_count, bodies.length) : bodies.length,
    notables: NOTABLE_KINDS.filter((k) => count.has(k.key)).map((k) => ({
      kind: k.key,
      n: count.get(k.key)!,
    })),
    bodyTypes: [...bodyTypes],
    species: [...species].sort(),
  };
}

export interface BoxelLookupService {
  /** The kept answer for a boxel (by prefix), or null when never looked up or older than 30 days. */
  get(prefix: string): BoxelLookupRecord | null;
  status(): BoxelLookupStatus | null;
  /** Starts looking a boxel up (one at a time). False when another is running or the name is no boxel. */
  start(prefix: string): boolean;
  stop(): void;
}

type FetchLike = typeof fetch;

export function createBoxelLookups(opts: {
  filePath: string | null;
  isPlant: (genus: string) => boolean;
  fetchImpl?: FetchLike;
  gapMs?: number;
  now?: () => number;
}): BoxelLookupService {
  const now = opts.now ?? Date.now;
  const gapMs = opts.gapMs ?? LOOKUP_GAP_MS;
  let records = load(opts.filePath);
  let state: BoxelLookupStatus | null = null;
  let stopAsked = false;

  const fresh = (r: BoxelLookupRecord) => now() - Date.parse(r.fetchedAt) < LOOKUP_CACHE_DAYS * 86_400_000;

  function persist(): void {
    if (!opts.filePath) return;
    records = records.filter(fresh);
    const tmp = `${opts.filePath}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ formatVersion: 1, boxels: records })}\n`, "utf8");
      renameSync(tmp, opts.filePath);
    } catch {
      /* kept in memory */
    }
  }

  async function run(prefix: string): Promise<void> {
    const systems: Record<string, LookupSystemFacts> = {};
    let complete = false;
    const same = (r: BoxelLookupRecord) => r.prefix.toLowerCase() === prefix.toLowerCase();
    const before = records.find(same) ?? null;
    // Kept page by page, so the table fills while it runs.
    const keep = () => {
      records = [
        { prefix, fetchedAt: new Date(now()).toISOString(), complete, systems: { ...systems } },
        ...records.filter((r) => !same(r)),
      ];
    };
    try {
      for (let page = 0; page < MAX_PAGES && !stopAsked; page++) {
        if (page > 0) await new Promise((r) => setTimeout(r, gapMs));
        if (stopAsked) break;
        const res = await (opts.fetchImpl ?? fetch)(SEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": APP_USER_AGENT },
          body: JSON.stringify({ filters: { name: { value: prefix } }, size: PAGE, page }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`Spansh answered HTTP ${res.status}`);
        const j = obj(await res.json());
        const results = Array.isArray(j?.results) ? j.results : [];
        let left = false;
        for (const r of results) {
          const n = boxelIndexOf(str(obj(r)?.name), prefix);
          if (n == null) {
            // Spansh lists the boxel's own systems first; the first stranger ends it.
            left = true;
            continue;
          }
          const f = spanshSearchSystemFacts(r, opts.isPlant);
          if (f) systems[String(n)] = f;
        }
        state = { ...state!, pages: page + 1, systems: Object.keys(systems).length };
        keep();
        const total = typeof j?.count === "number" ? j.count : 0;
        if (left || results.length < PAGE || (page + 1) * PAGE >= total) {
          complete = true;
          break;
        }
      }
      keep();
      persist();
      state = {
        ...state!,
        running: false,
        note: stopAsked
          ? `Stopped: ${Object.keys(systems).length} systems so far.`
          : Object.keys(systems).length
            ? `${Object.keys(systems).length} systems on Spansh; the rest are not there.`
            : "Spansh lists none of its systems (none uploaded yet, or its search missed them).",
      };
    } catch (e) {
      // A failed look-up leaves the last whole one in place.
      records = [...(before ? [before] : []), ...records.filter((r) => !same(r))];
      state = {
        ...state!,
        running: false,
        note: `Spansh could not be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  return {
    get(prefix) {
      const r = records.find((x) => x.prefix.toLowerCase() === prefix.toLowerCase());
      return r && fresh(r) ? r : null;
    },
    status: () => state,
    start(prefix) {
      if (state?.running) return false;
      const b = parseBoxel(prefix);
      if (!b) return false;
      stopAsked = false;
      state = { prefix: b.prefix, boxel: b.boxel, running: true, pages: 0, systems: 0, note: null };
      void run(b.prefix);
      return true;
    },
    stop() {
      stopAsked = true;
    },
  };
}

function load(filePath: string | null): BoxelLookupRecord[] {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const j = JSON.parse(readFileSync(filePath, "utf8")) as { boxels?: BoxelLookupRecord[] };
    return (j.boxels ?? []).filter(
      (r) => r && typeof r.prefix === "string" && typeof r.fetchedAt === "string" && obj(r.systems),
    );
  } catch {
    return [];
  }
}
