/**
 * The NavRoute star finder (owner, 2026-10-04): every route the commander plots is a free survey of the
 * star classes along it — `NavRoute.json` names each system's `StarClass`. Plot a long route in the
 * galaxy map, and every neutron star, Wolf-Rayet or black hole on the way is listed, whether or not
 * the commander flies it.
 *
 * Each new route is kept (system, address, position, star class, when seen), merged into one list of
 * systems, and saved beside the settings. "Check EDSM" asks whether EDSM knows a system — the ones it
 * does not are candidates nobody has reported — politely: forty names a request, five seconds apart,
 * a minute's pause after a rate limit, and only the systems the commander asked about. The answers
 * are kept: a system does not stop being known.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EDSM_USER_AGENT } from "./edsmSystemHydration.js";
import type { NavRouteWaypointDTO } from "./navRouteFuel.js";
import { resolveUserSettingsJsonPath } from "./paths.js";

export interface NavRouteSystem {
  address: number;
  name: string;
  /** NavRoute `StarClass` as the game writes it ("N", "DA", "K", "W", "H"...). */
  starClass: string;
  pos: [number, number, number];
  firstSeen: string;
  lastSeen: string;
  /** How many kept routes passed through it. */
  routes: number;
  /** EDSM's answer: true it knows the system, false it does not, absent not asked. */
  edsm?: boolean;
  edsmAt?: string;
}

export interface NavRouteRecord {
  at: string;
  from: string;
  to: string;
  /** Addresses in route order. */
  systems: number[];
}

interface FileShape {
  formatVersion: 1;
  routes: NavRouteRecord[];
  systems: NavRouteSystem[];
}

/** Routes kept; the oldest go first. Systems seen only on dropped routes go with them. */
export const MAX_ROUTES = 200;
/** EDSM politeness, the same as the route strip's first-footfall lookup. */
const NAMES_PER_REQUEST = 40;
const REQUEST_GAP_MS = 5_000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const EDSM_SYSTEMS_URL = "https://www.edsm.net/api-v1/systems";

let routes: NavRouteRecord[] = [];
const systems = new Map<number, NavRouteSystem>();
let loadedFrom: string | null = null;
let lastKey = "";

function filePath(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-navroutes.json");
}

function ensureLoaded(): void {
  const f = filePath();
  if (loadedFrom === f) return;
  loadedFrom = f;
  routes = [];
  systems.clear();
  if (!existsSync(f)) return;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as FileShape;
    routes = Array.isArray(j.routes) ? j.routes : [];
    for (const s of j.systems ?? []) if (typeof s?.address === "number") systems.set(s.address, s);
    lastKey = routes.length ? routes[routes.length - 1]!.systems.join(":") : "";
  } catch {
    /* unreadable: start a new list */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 1500);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}
function saveNow(): void {
  try {
    const f = filePath();
    const body: FileShape = { formatVersion: 1, routes, systems: [...systems.values()] };
    writeFileSync(`${f}.tmp`, JSON.stringify(body));
    renameSync(`${f}.tmp`, f);
  } catch {
    /* a later save tries again */
  }
}

/**
 * Keep a route the game just wrote. The same route seen again (a re-read, a replot to the same place)
 * is not a new one. Returns true when something was added.
 */
export function recordNavRoute(waypoints: NavRouteWaypointDTO[] | null, nowIso = new Date().toISOString()): boolean {
  if (!waypoints || waypoints.length < 2) return false;
  ensureLoaded();
  const key = waypoints.map((w) => w.systemAddress).join(":");
  if (key === lastKey) return false;
  lastKey = key;
  routes.push({
    at: nowIso,
    from: waypoints[0]!.starSystem,
    to: waypoints[waypoints.length - 1]!.starSystem,
    systems: waypoints.map((w) => w.systemAddress),
  });
  for (const w of waypoints) {
    const s = systems.get(w.systemAddress);
    if (s) {
      s.lastSeen = nowIso;
      s.routes += 1;
      if (w.starClass) s.starClass = w.starClass;
    } else {
      systems.set(w.systemAddress, {
        address: w.systemAddress,
        name: w.starSystem,
        starClass: w.starClass ?? "",
        pos: w.starPos,
        firstSeen: nowIso,
        lastSeen: nowIso,
        routes: 1,
      });
    }
  }
  while (routes.length > MAX_ROUTES) {
    const old = routes.shift()!;
    for (const a of old.systems) {
      const s = systems.get(a);
      if (s && --s.routes <= 0) systems.delete(a);
    }
  }
  saveSoon();
  return true;
}

export interface EdsmCheckProgress {
  done: number;
  total: number;
  /** Set while paused by EDSM's rate limit, or after a failure. */
  note: string | null;
}
let checking: EdsmCheckProgress | null = null;

export function navRouteLog(): {
  routes: (Omit<NavRouteRecord, "systems"> & { count: number })[];
  systems: NavRouteSystem[];
  checking: EdsmCheckProgress | null;
} {
  ensureLoaded();
  return {
    routes: routes.map((r) => ({ at: r.at, from: r.from, to: r.to, count: r.systems.length })),
    systems: [...systems.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    checking,
  };
}

/** The last route kept, in order, for drawing on the map. */
export function lastNavRoute(): NavRouteSystem[] {
  ensureLoaded();
  const r = routes[routes.length - 1];
  return r ? r.systems.map((a) => systems.get(a)).filter((s): s is NavRouteSystem => !!s) : [];
}

export function clearNavRouteLog(): void {
  ensureLoaded();
  routes = [];
  systems.clear();
  lastKey = "";
  saveNow();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask EDSM about these systems, in the background. Systems already answered are skipped. One check at
 * a time: a second call while one runs is ignored.
 */
export async function checkNavRouteSystemsOnEdsm(addresses: number[], fetchImpl: typeof fetch = fetch, gapMs = REQUEST_GAP_MS): Promise<void> {
  ensureLoaded();
  if (checking) return;
  const todo = [...new Set(addresses)]
    .map((a) => systems.get(a))
    .filter((s): s is NavRouteSystem => !!s && s.edsm === undefined);
  checking = { done: 0, total: todo.length, note: null };
  try {
    for (let i = 0; i < todo.length; i += NAMES_PER_REQUEST) {
      const batch = todo.slice(i, i + NAMES_PER_REQUEST);
      const qs = batch.map((s) => `systemName[]=${encodeURIComponent(s.name)}`).join("&");
      let r: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await fetchImpl(`${EDSM_SYSTEMS_URL}?${qs}&showId=1`, {
          headers: { Accept: "application/json", "User-Agent": EDSM_USER_AGENT },
        });
        if (r.status !== 429) break;
        checking = { ...checking, note: "EDSM rate limit — waiting a minute" };
        await sleep(RATE_LIMIT_PAUSE_MS);
        checking = { ...checking, note: null };
      }
      if (!r || !r.ok) throw new Error(`EDSM answered HTTP ${r?.status ?? "?"}`);
      const j = (await r.json().catch(() => [])) as unknown;
      const known = new Set(
        (Array.isArray(j) ? j : [])
          .map((x) => (x && typeof x === "object" ? String((x as { name?: unknown }).name ?? "") : ""))
          .map((n) => n.trim().toLowerCase()),
      );
      const at = new Date().toISOString();
      for (const s of batch) {
        s.edsm = known.has(s.name.trim().toLowerCase());
        s.edsmAt = at;
      }
      checking = { ...checking, done: Math.min(todo.length, i + batch.length) };
      saveSoon();
      if (i + NAMES_PER_REQUEST < todo.length) await sleep(gapMs);
    }
    checking = null;
  } catch (e) {
    checking = { ...(checking ?? { done: 0, total: 0 }), note: e instanceof Error ? e.message : String(e) };
    // Leave the note up a moment for the panel, then clear so the next check can start.
    setTimeout(() => {
      checking = null;
    }, 15_000).unref?.();
  }
}

/** Test seam. */
export function resetNavRouteLogForTests(): void {
  loadedFrom = null;
  routes = [];
  systems.clear();
  lastKey = "";
  checking = null;
}
