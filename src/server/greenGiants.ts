/**
 * Green gas giants on the server (shared/greenGasGiant.ts has the what and why): the commander's own
 * calls, kept in `edexo-ggg-marks.json` beside the user settings, and the verdict for a scanned body
 * from everything the app knows — the codex, the edGGG catalogue, the temperature and density (the cloud
 * ladder), a K10 anomaly in the system (from the journals or EDAstro's codex file), and the commander's
 * call.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ExplorationScanRecord } from "../shared/types.js";
import { bodyKey } from "../shared/bodyKey.js";
import {
  classifyGreenGiant,
  greenCodexFits,
  greenQuestionWorthAsking,
  isGggClass,
  type GreenGiantMark,
  type GreenGiantVerdict,
} from "../shared/greenGasGiant.js";

export interface GreenGiantMarkRow {
  mark: GreenGiantMark;
  at: string;
  /** Names kept with the call, so the file reads on its own. */
  body: string;
  system: string;
}

export interface GreenGiantMarksService {
  get(bodyKey: string): GreenGiantMark | null;
  /** Sets or (with null) clears the commander's call. Returns whether anything changed. */
  set(bodyKey: string, mark: GreenGiantMark | null, names: { body: string; system: string }): boolean;
  all(): ReadonlyMap<string, GreenGiantMarkRow>;
}

export function createGreenGiantMarks(opts: { filePath: string | null; now?: () => number }): GreenGiantMarksService {
  const now = opts.now ?? Date.now;
  const marks = load(opts.filePath);

  function persist(): void {
    if (!opts.filePath) return;
    const tmp = `${opts.filePath}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ formatVersion: 1, marks: Object.fromEntries(marks) }, null, 1)}\n`, "utf8");
      renameSync(tmp, opts.filePath);
    } catch {
      /* kept in memory; the next call tries again */
    }
  }

  return {
    get: (k) => marks.get(k)?.mark ?? null,
    set(k, mark, names) {
      const prev = marks.get(k)?.mark ?? null;
      if (prev === mark) return false;
      if (mark == null) marks.delete(k);
      else marks.set(k, { mark, at: new Date(now()).toISOString(), body: names.body, system: names.system });
      persist();
      return true;
    },
    all: () => marks,
  };
}

function load(filePath: string | null): Map<string, GreenGiantMarkRow> {
  const m = new Map<string, GreenGiantMarkRow>();
  if (!filePath || !existsSync(filePath)) return m;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { marks?: Record<string, GreenGiantMarkRow> };
    for (const [k, v] of Object.entries(raw.marks ?? {})) {
      if (v && (v.mark === "yes" || v.mark === "no")) m.set(k, v);
    }
  } catch {
    /* a broken file starts empty rather than stopping the app */
  }
  return m;
}

/** What the verdict reads from the store and the downloads. */
export interface GreenGiantSources {
  greenCodexBodies: ReadonlyMap<string, string>;
  /** Systems with a K10 anomaly logged in the journals. */
  k10Systems: ReadonlySet<number>;
  /** Systems with a K10 anomaly in EDAstro's codex file (empty until downloaded). */
  k10FromEdastro?: () => ReadonlySet<number>;
  /** EDAstro's green codex ids for a system (empty until downloaded). */
  edastroGreenFor?: (systemAddress: number) => readonly string[];
  /** Every body scanned in a system, to tell which body an EDAstro report means. */
  bodiesInSystem?: (systemAddress: number) => Iterable<{ bodyId: number; planetClass?: string }>;
  marks: Pick<GreenGiantMarksService, "get">;
}

/**
 * The commander's "green?" call on a gas giant, when the question is worth asking there
 * (greenQuestionWorthAsking); undefined when it is not, which hides the question.
 */
export function greenMarkToAsk(
  rec: Pick<ExplorationScanRecord, "systemAddress" | "bodyId" | "planetClass" | "surfaceTemperature" | "massEM" | "radius">,
  verdict: GreenGiantVerdict | null,
  marks: Pick<GreenGiantMarksService, "get">,
): GreenGiantMark | null | undefined {
  if (!isGggClass(rec.planetClass)) return undefined;
  const mark = marks.get(bodyKey(rec.systemAddress, rec.bodyId));
  const ask = greenQuestionWorthAsking(
    { planetClass: rec.planetClass, surfaceTemperatureK: rec.surfaceTemperature, massEM: rec.massEM, radiusM: rec.radius },
    verdict,
    mark,
  );
  return ask ? mark : undefined;
}

/** The verdict for one scanned body, or null when it is not a green gas giant candidate at all. */
export function greenGiantForRecord(
  rec: Pick<
    ExplorationScanRecord,
    "systemAddress" | "bodyId" | "bodyName" | "planetClass" | "surfaceTemperature" | "massEM" | "radius"
  >,
  src: GreenGiantSources,
): GreenGiantVerdict | null {
  if (!isGggClass(rec.planetClass)) return null;
  const key = bodyKey(rec.systemAddress, rec.bodyId);
  let edastroReport: "only" | "shared" | null = null;
  let edastroCandidates: number | undefined;
  const ids = (src.edastroGreenFor?.(rec.systemAddress) ?? []).filter((id) => greenCodexFits(id, rec.planetClass));
  if (ids.length) {
    // Pinned to this body only when no other body of the class is known there.
    let others = 1;
    if (src.bodiesInSystem) {
      others = 0;
      for (const b of src.bodiesInSystem(rec.systemAddress)) {
        if (b.bodyId !== rec.bodyId && ids.some((id) => greenCodexFits(id, b.planetClass))) others++;
      }
    }
    edastroReport = others === 0 ? "only" : "shared";
    if (src.bodiesInSystem && others > 0) edastroCandidates = others + 1;
  }
  return classifyGreenGiant({
    planetClass: rec.planetClass,
    surfaceTemperatureK: rec.surfaceTemperature,
    massEM: rec.massEM,
    radiusM: rec.radius,
    bodyName: rec.bodyName,
    codex: src.greenCodexBodies.has(key),
    k10InSystem: src.k10Systems.has(rec.systemAddress) || (src.k10FromEdastro?.().has(rec.systemAddress) ?? false),
    mark: src.marks.get(key),
    edastroReport,
    edastroCandidates,
  });
}
