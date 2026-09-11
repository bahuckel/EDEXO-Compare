/**
 * The overlay radar's memory, on disk.
 *
 * ## Why this cannot live in the journal merge cache
 *
 * That cache is a *replay's result*: delete it and the logs rebuild it. This cannot be rebuilt from
 * anything. `ScanOrganic` carries no coordinates — 0 of 38 in the owner's recent journals — so a
 * plant's position exists only because this app happened to be running and read `Status.json` as
 * the scan landed. Lose this file and those positions are gone for good, which is a different
 * category of loss and deserves a different file.
 *
 * The ship is the exception and is kept here anyway: `Touchdown` does carry latitude and longitude,
 * so it survives on its own, but keeping the two together means the radar has one place to load
 * from rather than two.
 *
 * ## Kept per body, not per session
 *
 * The owner's rule: *"if I enter supercruise they get dropped until I go down on that planet
 * again"*. So nothing is deleted on leaving — the marks are filed under the body they belong to and
 * simply stop matching while he is somewhere else. Walk back onto the same rock and they are there.
 *
 * The cap is a guard against a file that grows for four years, not a policy about how many plants a
 * commander may record. Oldest goes first, which is the right end: the body you are standing on is
 * the one you visited most recently.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveSurfaceMarksPath } from "./paths.js";

/** One recorded position on a surface. */
export interface SurfaceMark {
  /** `systemAddress:bodyId`. */
  bodyKey: string;
  /**
   * The body's name as `Status.json` writes it, normalised.
   *
   * Carried beside the key because `Status.json` names the body but never gives its id, so this is
   * the only field that can answer "am I standing on the rock these marks belong to" from a live
   * fix alone.
   */
  bodyNameNorm: string;
  latDeg: number;
  lonDeg: number;
  label: string;
  /** When it was recorded, so the cap evicts the oldest rather than an arbitrary one. */
  atIso: string;
}

export interface SurfaceMarksFile {
  formatVersion: 1;
  samples: SurfaceMark[];
  ship: SurfaceMark | null;
}

/** Bodies' worth of plants before the oldest are dropped. Generous; this file is tiny. */
export const MAX_SURFACE_MARKS = 400;

export function emptySurfaceMarks(): SurfaceMarksFile {
  return { formatVersion: 1, samples: [], ship: null };
}

function isMark(v: unknown): v is SurfaceMark {
  const m = v as SurfaceMark | null;
  return (
    !!m &&
    typeof m.bodyKey === "string" &&
    typeof m.bodyNameNorm === "string" && // may be "" once repaired — see repairName

    typeof m.latDeg === "number" &&
    Number.isFinite(m.latDeg) &&
    typeof m.lonDeg === "number" &&
    Number.isFinite(m.lonDeg)
  );
}

/**
 * A name that is not a name.
 *
 * Marks written before the body name came from `Status.json` were filed under `"body 22"` — the
 * placeholder produced by a `ScanOrganic` line, which carries no `BodyName`. Nothing else in the
 * app calls a body that, so such a mark could never match the surface it was taken on and was
 * silently invisible on its own map.
 *
 * Clearing the field rather than dropping the mark is the repair: the radar already falls back to
 * the body *key* when a mark has no name, and the key was always right. The position survives,
 * which matters because nothing can recreate it.
 */
const PLACEHOLDER_BODY_NAME = /^body\s*\d+$/i;

function repairName<T extends { bodyNameNorm?: string }>(m: T): T {
  if (m && typeof m.bodyNameNorm === "string" && PLACEHOLDER_BODY_NAME.test(m.bodyNameNorm.trim())) {
    return { ...m, bodyNameNorm: "" };
  }
  return m;
}

/**
 * Read the file, or an empty set.
 *
 * A damaged file is treated as an empty one rather than as an error: the radar is an aid, and the
 * app refusing to start over a corrupt list of dots would be a far worse outcome than a commander
 * seeing an empty map and re-walking a plant.
 */
export function loadSurfaceMarks(): SurfaceMarksFile {
  const file = resolveSurfaceMarksPath();
  if (!existsSync(file)) return emptySurfaceMarks();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SurfaceMarksFile>;
    const samples = Array.isArray(parsed.samples) ? parsed.samples.map(repairName).filter(isMark) : [];
    const ship = isMark(parsed.ship) ? repairName(parsed.ship) : null;
    return { formatVersion: 1, samples, ship };
  } catch {
    return emptySurfaceMarks();
  }
}

/**
 * Write, but not on every call.
 *
 * A full journal rebuild applies every `Touchdown` in the commander's history — hundreds of them —
 * and a naive save wrote the file once per landing, each one immediately obsoleted by the next. The
 * only state worth writing is the one left standing when the replay stops, so the write is deferred
 * and coalesced.
 *
 * `unref` so a pending write can never hold the process open at shutdown; the app exiting a second
 * before a debounce fires costs a file that is rewritten on the next mark anyway.
 */
let pending: NodeJS.Timeout | null = null;
let pendingData: SurfaceMarksFile | null = null;
const SAVE_DEBOUNCE_MS = 400;

export function scheduleSaveSurfaceMarks(data: SurfaceMarksFile): void {
  pendingData = data;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const d = pendingData;
    pendingData = null;
    if (d) saveSurfaceMarks(d);
  }, SAVE_DEBOUNCE_MS);
  pending.unref?.();
}

/** Test seam — a debounce that outlives a test leaks into the next one. */
export function flushSurfaceMarksForTests(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  const d = pendingData;
  pendingData = null;
  if (d) saveSurfaceMarks(d);
}

export function saveSurfaceMarks(data: SurfaceMarksFile): void {
  const file = resolveSurfaceMarksPath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  } catch {
    /* A radar that cannot remember is still a radar; never fail a journal tick over it. */
  }
}
