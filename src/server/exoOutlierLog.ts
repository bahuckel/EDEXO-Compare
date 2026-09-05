import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { BodyExoState, SpeciesDatabase, SpeciesEntry, SpeciesMatch } from "../shared/types.js";
import { speciesMatchesExcludingTempPressure } from "./matchSpecies.js";
import { collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import { resolveExoOutlierLogPath } from "./paths.js";

/**
 * Species the commander found where the app did not offer them.
 *
 * The accuracy probe can only re-measure 233 bodies from one journal history, and it will only ever
 * describe the past. This grows every time the app is wrong about a body the commander actually
 * visited, wherever they happen to be flying, and it keeps working after the harness has been tuned
 * against — which makes it the only feedback channel that does not go stale.
 *
 * Append-only JSONL beside the user settings, so it survives a cache rebuild and diffs cleanly.
 * Nothing here changes what the app shows; it is evidence for the next gate fix.
 */
export interface ExoOutlierRecord {
  /** ISO timestamp of the moment the miss was noticed. */
  at: string;
  bodyKey: string;
  bodyName: string;
  starSystem: string;
  speciesId: string;
  speciesName: string;
  /**
   * `absent` — the species was not in the candidate list at all.
   *
   * `unlikelyOnly` — offered, but only in the demoted tier behind "show unlikely (N)". The commander
   * would not have seen it without asking, so it is still a failure, just a smaller one than being
   * excluded outright. This is the case the no-walls change created.
   *
   * Once ranking lands (queue step 6) a species can instead be present but sorted below whatever the
   * UI shows, which is the same failure to the reader. That case will be recorded as `rankedLow`
   * with its position, so the log stays meaningful when nothing is ever strictly excluded any more.
   */
  severity: "absent" | "unlikelyOnly" | "rankedLow";
  /** Position in the candidate list when `rankedLow`, else null. */
  rank: number | null;
  /** The criterion that rejected it, from the matcher's own reasons — usually the thing to fix. */
  blockedBy: string | null;
  blockedDetail: string | null;
  /** Body parameters, so the record stands alone without the journal. */
  scan: {
    planetClass: string | null;
    atmosphereType: string | null;
    surfaceTemperatureK: number | null;
    surfaceGravity: number | null;
    surfacePressure: number | null;
    volcanism: string | null;
  };
  /** How many candidates the commander was offered, and what they were. */
  candidateCount: number;
  candidates: string[];
  /** Biological signals the game reported, when known. */
  biologicalSignals: number | null;
}

/**
 * Keys already written, so a snapshot recomputed a hundred times appends nothing new. Seeded from
 * the file on first use because the app restarts far more often than it finds an outlier.
 */
let seen: Set<string> | null = null;

/**
 * How many of each kind have been recorded, for the count B6 asked to surface.
 *
 * Counted from the file once and incremented on every append, because a log the commander never sees
 * is evidence nobody reads.
 */
export interface ExoOutlierTally {
  total: number;
  absent: number;
  unlikelyOnly: number;
  rankedLow: number;
}

let tally: ExoOutlierTally | null = null;

function outlierKey(bodyKey: string, speciesId: string): string {
  return `${bodyKey}|${speciesId}`;
}

function loadSeen(): Set<string> {
  if (seen) return seen;
  const set = new Set<string>();
  const counts: ExoOutlierTally = { total: 0, absent: 0, unlikelyOnly: 0, rankedLow: 0 };
  const p = resolveExoOutlierLogPath();
  if (existsSync(p)) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const rec = JSON.parse(t) as Partial<ExoOutlierRecord>;
          if (!rec.bodyKey || !rec.speciesId) continue;
          set.add(outlierKey(rec.bodyKey, rec.speciesId));
          counts.total++;
          if (rec.severity === "absent") counts.absent++;
          else if (rec.severity === "unlikelyOnly") counts.unlikelyOnly++;
          else if (rec.severity === "rankedLow") counts.rankedLow++;
        } catch {
          /* a truncated final line is not worth failing over */
        }
      }
    } catch {
      /* unreadable log: start fresh rather than lose the session */
    }
  }
  seen = set;
  tally = counts;
  return set;
}

/** What the log holds, for the Options panel. Reads the file once per run, then counts in memory. */
export function exoOutlierTally(): ExoOutlierTally {
  loadSeen();
  return { ...(tally ?? { total: 0, absent: 0, unlikelyOnly: 0, rankedLow: 0 }) };
}

/** Which criterion rejected this species on this body, asked of the matcher rather than guessed. */
function blockingReason(
  entry: SpeciesEntry,
  body: BodyExoState,
): { field: string | null; detail: string | null } {
  if (!body.scan) return { field: null, detail: null };
  try {
    const r = speciesMatchesExcludingTempPressure(entry, body.scan, null);
    if (r.ok) {
      // Everything else passed, so it fell to the temperature or pressure band.
      return { field: "SurfaceTemperature/SurfacePressure", detail: "passed every other criterion" };
    }
    const first = r.reasons[0];
    return { field: first?.field ?? null, detail: first?.detail ?? null };
  } catch {
    return { field: null, detail: null };
  }
}

/**
 * Record any confirmed species on this body that the candidate list failed to offer.
 *
 * Safe to call on every snapshot: writes only the first time a given (body, species) pair is seen,
 * and never throws — a read-only disk must not take the app down.
 */
export function recordExoOutliersForBody(input: {
  body: BodyExoState;
  matches: SpeciesMatch[];
  db: SpeciesDatabase;
}): number {
  const { body, matches, db } = input;
  if (!body.scan?.PlanetClass?.trim()) return 0;

  const truth = collectResolvedOrganicLockSpeciesIds(body.organicGenusLocks, db);
  if (!truth.length) return 0;

  const shownMatches = matches.filter((m) => !m.unlikely);
  const shown = new Set(shownMatches.map((m) => m.entry.id));
  const demoted = new Set(matches.filter((m) => m.unlikely).map((m) => m.entry.id));

  /**
   * Where the ranking put each shown candidate.
   *
   * The comment on `severity` predicted this case and it has arrived: since the ranking model landed
   * a species is rarely excluded outright — it is offered and sorted below the ones the commander
   * reads. The game names `k` genera, so a truth species outside the top `k` is one the panel's own
   * headline would not have named, and that is a miss with a rank rather than an absence.
   */
  const byRank = [...shownMatches].sort(
    (a, b) => (b.presenceProbabilityPercent ?? -1) - (a.presenceProbabilityPercent ?? -1),
  );
  const rankOf = new Map(byRank.map((m, i) => [m.entry.id, i + 1]));
  const k = body.biologicalSignals ?? 0;
  const rankedLow = (id: string): boolean => {
    if (!shown.has(id) || k <= 0) return false;
    const r = rankOf.get(id);
    return r != null && r > k;
  };

  const missing = truth.filter((id) => !shown.has(id) || rankedLow(id));
  if (!missing.length) return 0;

  const set = loadSeen();
  const lines: string[] = [];
  for (const id of missing) {
    const key = outlierKey(body.key, id);
    if (set.has(key)) continue;
    const entry = db.species.find((e) => e.id === id);
    if (!entry) continue;
    const blocked = blockingReason(entry, body);
    const rec: ExoOutlierRecord = {
      at: new Date().toISOString(),
      bodyKey: body.key,
      bodyName: body.bodyName,
      starSystem: body.starSystem ?? "",
      speciesId: id,
      speciesName: entry.displayName,
      severity: shown.has(id) ? "rankedLow" : demoted.has(id) ? "unlikelyOnly" : "absent",
      rank: rankOf.get(id) ?? null,
      blockedBy: blocked.field,
      blockedDetail: blocked.detail,
      scan: {
        planetClass: body.scan.PlanetClass ?? null,
        atmosphereType: body.scan.AtmosphereType ?? null,
        surfaceTemperatureK: body.scan.SurfaceTemperature ?? null,
        surfaceGravity: body.scan.SurfaceGravity ?? null,
        surfacePressure: body.scan.SurfacePressure ?? null,
        volcanism: body.scan.Volcanism ?? null,
      },
      candidateCount: shown.size,
      candidates: [...shown],
      biologicalSignals: body.biologicalSignals ?? null,
    };
    set.add(key);
    if (tally) {
      tally.total++;
      tally[rec.severity]++;
    }
    lines.push(JSON.stringify(rec));
  }
  if (!lines.length) return 0;

  try {
    appendFileSync(resolveExoOutlierLogPath(), `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* best-effort: the log is evidence, not state the app depends on */
  }
  return lines.length;
}

/** Test seam: forget what has been written so a fresh file can be exercised. */
export function resetExoOutlierLogCacheForTests(): void {
  seen = null;
  tally = null;
}
