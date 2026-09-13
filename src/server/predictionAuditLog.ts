/**
 * What the app said about a body, at each moment it knew more.
 *
 * The outlier log (`exoOutlierLog.ts`) records the app being *wrong* — a species confirmed on a body
 * it was never offered on. That answers "did we miss it" and nothing else. It cannot answer the
 * question the owner actually asks when a suggestion looks wrong: **why was that plant on the list,
 * and should it have been higher or lower?** For that you need what the app believed *before* the
 * answer arrived, and the app throws that away the instant the next event narrows it.
 *
 * The game hands the answer over in three steps, and this records the list at each one:
 *
 *   1. **FSS** — a biological count, sometimes a genus hint. The widest guess the app ever makes.
 *   2. **DSS** — `SAASignalsFound` names the genera outright. Everything else should fall away, and
 *      what fell away is the interesting part: a genus dropped here was a guess that was wrong.
 *   3. **ScanOrganic** — the species itself, for a genus that had more than one candidate.
 *
 * A stage is written when the app's answer *changes*, not on every recompute, so the file is a
 * narrowing and not a log of the snapshot loop.
 *
 * ## Why it waits for the commander to leave
 *
 * The conditions at each plant — local temperature, local gravity — live in `edexo-surface-marks.json`
 * and only exist because the app was running when the scan landed. They are merged in on departure,
 * matched by body, so a finished record stands on its own: the guess, the narrowing, the truth, and
 * the ground the plant was actually standing on. Until then the record stays open and is rewritten in
 * place, because a commander who hops out to orbit and back has not finished with the body.
 *
 * Private, like every other observation file: it lives beside the user settings and never ships.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePredictionAuditPath } from "./paths.js";
import { collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import type { BodyExoState, SpeciesDatabase, SpeciesMatch } from "../shared/types.js";
import type { SurfaceMark } from "./surfaceMarksFile.js";

/** Which of the game's three narrowings produced this list. */
export type PredictionStageName = "fss" | "dss" | "organic";

/** One candidate as the commander would have read it. */
export interface PredictionOffer {
  speciesId: string;
  name: string;
  /** 1-based position among the shown candidates, best first. Null for a demoted one. */
  rank: number | null;
  /** The app's own "chance here", when it had one. */
  percent: number | null;
  /** True when it was behind "show unlikely (N)" and the commander would not have seen it. */
  unlikely: boolean;
}

export interface PredictionStage {
  stage: PredictionStageName;
  at: string;
  biologicalSignals: number | null;
  /** Genera the game had named by this point, in its own words. */
  genusHints: string[];
  /** Everything on offer, shown first and in rank order. */
  offered: PredictionOffer[];
  /**
   * Species that were on the previous stage's list and are not on this one.
   *
   * The whole point of the file: after a DSS these are the guesses the game just disproved, and a
   * species that keeps appearing here across many bodies is one the matcher is too generous with.
   */
  dropped: string[];
  /**
   * Genera the game named here that the app offered nothing for.
   *
   * The app being wrong while saying nothing. A DSS naming a genus is proof it grows on this body,
   * so a genus in this list is a miss as real as a species confirmed on foot — and unlike that one
   * it costs nothing to notice, because the game volunteers it before the commander lands.
   */
  unofferedGenera: string[];
}

/** Where a confirmed species sat in the last list offered before it was confirmed. */
export interface PredictionOutcome {
  speciesId: string;
  name: string;
  rank: number | null;
  percent: number | null;
  /**
   * `top` — first on the list, the app got it right.
   * `shown` — offered and visible, but not first; the rank says how far down.
   * `unlikelyOnly` — offered only behind the demoted tier.
   * `absent` — never offered at all. Also recorded in the outlier log.
   */
  verdict: "top" | "shown" | "unlikelyOnly" | "absent";
}

/** The conditions a plant was actually standing in, carried over from the radar's own file. */
export interface PredictionConditions {
  atIso: string;
  label: string;
  temperatureK: number | null;
  gravityG: number | null;
}

export interface PredictionRecord {
  bodyKey: string;
  bodyName: string;
  starSystem: string;
  firstSeenAt: string;
  updatedAt: string;
  scan: {
    planetClass: string | null;
    atmosphereType: string | null;
    surfaceTemperatureK: number | null;
    surfaceGravity: number | null;
    surfacePressure: number | null;
    volcanism: string | null;
  };
  stages: PredictionStage[];
  /** Species confirmed by `ScanOrganic`, resolved to ids. */
  truth: string[];
  /** How each confirmed species was ranked just before it was confirmed. */
  outcomes: PredictionOutcome[];
  /** Merged from `edexo-surface-marks.json` when the commander leaves. Null until then. */
  conditions: PredictionConditions[] | null;
  /** True once the commander has left and the record has had its conditions merged. */
  final: boolean;
}

export interface PredictionAuditFile {
  formatVersion: 1;
  records: PredictionRecord[];
}

/**
 * How many bodies to keep.
 *
 * A guard against a file that grows for four years, not a policy. Oldest finished record goes first;
 * open records are never evicted, because the body the commander is standing on is the one they care
 * about.
 */
const MAX_RECORDS = 2000;

const SAVE_DEBOUNCE_MS = 1500;

let store: Map<string, PredictionRecord> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

function load(): Map<string, PredictionRecord> {
  if (store) return store;
  const m = new Map<string, PredictionRecord>();
  const p = resolvePredictionAuditPath();
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<PredictionAuditFile>;
      for (const r of parsed.records ?? []) {
        if (r?.bodyKey) m.set(r.bodyKey, r);
      }
    } catch {
      /* unreadable file: start fresh rather than lose the session over an audit log */
    }
  }
  store = m;
  return m;
}

function saveNow(): void {
  const m = store;
  if (!m) return;
  const file = resolvePredictionAuditPath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ formatVersion: 1, records: [...m.values()] } satisfies PredictionAuditFile, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* the app does not fail because its notebook could not be written */
  }
}

function saveSoon(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
  pending.unref?.();
}

/** Test seam — a debounce that outlives a test leaks into the next one. */
export function flushPredictionAuditForTests(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  saveNow();
}

/** Test seam — the module holds the file in memory for the life of the process. */
export function resetPredictionAuditForTests(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  store = null;
}

/**
 * Which narrowing the body is at.
 *
 * Read off the body's own state rather than from an event, so this needs no new journal wiring and
 * cannot disagree with what the panel is showing: the panel reads the same fields.
 */
function stageOf(body: BodyExoState): PredictionStageName {
  if (body.organicGenusLocks.length > 0) return "organic";
  if (body.dssComplete || (body.genusHints?.length ?? 0) > 0) return "dss";
  return "fss";
}

function offersFrom(matches: SpeciesMatch[]): PredictionOffer[] {
  const shown = matches.filter((m) => !m.unlikely);
  const ranked = [...shown].sort(
    (a, b) => (b.presenceProbabilityPercent ?? -1) - (a.presenceProbabilityPercent ?? -1),
  );
  const out: PredictionOffer[] = ranked.map((m, i) => ({
    speciesId: m.entry.id,
    name: m.entry.displayName,
    rank: i + 1,
    percent: m.presenceProbabilityPercent ?? null,
    unlikely: false,
  }));
  for (const m of matches) {
    if (!m.unlikely) continue;
    out.push({
      speciesId: m.entry.id,
      name: m.entry.displayName,
      rank: null,
      percent: m.presenceProbabilityPercent ?? null,
      unlikely: true,
    });
  }
  return out;
}

/** The same list twice over is not a narrowing, and writing it would bury the ones that are. */
function sameOffer(a: PredictionOffer[], b: PredictionOffer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.speciesId !== b[i]!.speciesId) return false;
    if (a[i]!.unlikely !== b[i]!.unlikely) return false;
  }
  return true;
}

function scanOf(body: BodyExoState): PredictionRecord["scan"] {
  const s = body.scan;
  return {
    planetClass: s?.PlanetClass ?? null,
    atmosphereType: s?.Atmosphere ?? s?.AtmosphereType ?? null,
    surfaceTemperatureK: s?.SurfaceTemperature ?? null,
    surfaceGravity: s?.SurfaceGravity ?? null,
    surfacePressure: s?.SurfacePressure ?? null,
    volcanism: s?.Volcanism ?? null,
  };
}

/**
 * Record what the app is offering for this body right now.
 *
 * Called from the snapshot build, beside the outlier log, so it sees exactly the list the commander
 * sees. Never throws: an audit file is not worth a failed snapshot.
 */
export function recordPredictionForBody(input: {
  body: BodyExoState;
  matches: SpeciesMatch[];
  db: SpeciesDatabase;
  now?: string;
}): void {
  try {
    const { body, matches, db } = input;
    // Nothing to explain about a body with no biology and no scan to judge it by.
    if (!body.scan?.PlanetClass?.trim()) return;
    if ((body.biologicalSignals ?? 0) <= 0 && body.organicGenusLocks.length === 0) return;

    const at = input.now ?? new Date().toISOString();
    const m = load();
    const stage = stageOf(body);
    const offered = offersFrom(matches);
    const hints = (body.genusHints ?? []).map((h) => h.Genus_Localised ?? h.Genus ?? "").filter(Boolean);

    let rec = m.get(body.key);
    if (!rec) {
      rec = {
        bodyKey: body.key,
        bodyName: body.bodyName,
        starSystem: body.starSystem,
        firstSeenAt: at,
        updatedAt: at,
        scan: scanOf(body),
        stages: [],
        truth: [],
        outcomes: [],
        conditions: null,
        final: false,
      };
      m.set(body.key, rec);
    }

    const last = rec.stages[rec.stages.length - 1] ?? null;
    const changed = !last || last.stage !== stage || !sameOffer(last.offered, offered);
    if (!changed) return;

    const before = new Set((last?.offered ?? []).map((o) => o.speciesId));
    const now = new Set(offered.map((o) => o.speciesId));
    const dropped = [...before].filter((id) => !now.has(id));

    const offeredGenera = new Set(
      matches.map((m) => (m.entry.genus ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const unofferedGenera = hints.filter((g) => !offeredGenera.has(g.trim().toLowerCase()));

    /*
      The verdict is taken against the list *before* the truth arrived, not after.

      By the time `ScanOrganic` has fired, the matcher has the answer and the list is trivially
      right — scoring it then would say the app is always correct. The stage that matters is the last
      one the commander had to choose from.
    */
    const truth = collectResolvedOrganicLockSpeciesIds(body.organicGenusLocks, db);
    if (stage === "organic" && truth.length && rec.outcomes.length === 0 && last) {
      rec.outcomes = truth.map((id) => {
        const o = last.offered.find((x) => x.speciesId === id) ?? null;
        const verdict: PredictionOutcome["verdict"] = !o
          ? "absent"
          : o.unlikely
            ? "unlikelyOnly"
            : o.rank === 1
              ? "top"
              : "shown";
        return {
          speciesId: id,
          name: o?.name ?? id,
          rank: o?.rank ?? null,
          percent: o?.percent ?? null,
          verdict,
        };
      });
    }
    rec.truth = truth;

    rec.stages.push({
      stage,
      at,
      biologicalSignals: body.biologicalSignals ?? null,
      genusHints: hints,
      offered,
      dropped,
      unofferedGenera,
    });
    rec.scan = scanOf(body);
    rec.bodyName = body.bodyName;
    rec.updatedAt = at;
    saveSoon();
  } catch {
    /* an audit log must never be the reason a snapshot fails */
  }
}

/**
 * Close the records for a system the commander has left, and give them their ground truth.
 *
 * The marks carry the only measurement of what it was actually like where the plant grew —
 * `Status.json` reports temperature and gravity on foot and keeps no history, so this is the one
 * chance to attach them. Matched by body key, which both files carry.
 */
export function finalisePredictionsForSystem(systemAddress: number, marks: SurfaceMark[]): number {
  try {
    const m = load();
    const prefix = `${systemAddress}:`;
    let closed = 0;
    for (const rec of m.values()) {
      if (rec.final || !rec.bodyKey.startsWith(prefix)) continue;
      const mine = marks.filter((k) => k.bodyKey === rec.bodyKey);
      rec.conditions = mine.map((k) => ({
        atIso: k.atIso,
        label: k.label,
        temperatureK: k.temperatureK ?? null,
        gravityG: k.gravityG ?? null,
      }));
      rec.final = true;
      closed++;
    }
    if (closed > 0) {
      evict(m);
      saveSoon();
    }
    return closed;
  } catch {
    return 0;
  }
}

/** Oldest finished record first; an open one is the body the commander may still be working on. */
function evict(m: Map<string, PredictionRecord>): void {
  if (m.size <= MAX_RECORDS) return;
  const finished = [...m.values()]
    .filter((r) => r.final)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const r of finished) {
    if (m.size <= MAX_RECORDS) break;
    m.delete(r.bodyKey);
  }
}

/** What the file holds, for the Options panel and for anyone asking whether it is working. */
export function predictionAuditTally(): { bodies: number; final: number; withOutcome: number } {
  const m = load();
  let final = 0;
  let withOutcome = 0;
  for (const r of m.values()) {
    if (r.final) final++;
    if (r.outcomes.length > 0) withOutcome++;
  }
  return { bodies: m.size, final, withOutcome };
}

/** Read access for tests and for anything that wants to report on the file. */
export function predictionRecords(): PredictionRecord[] {
  return [...load().values()];
}
