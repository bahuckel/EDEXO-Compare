/**
 * What has been done to each genus on a body, at a glance (guild request via the owner, 2026-09-24).
 *
 * One row per genus, with the tag the guild asked for:
 *
 * - `Genus` — the DSS (or a sibling moon) says it is here; nothing done to it yet.
 * - `Genus [CS]` — named by the ship's composition scanner, not sampled on foot.
 * - `Genus [SEEN]` — sampled on foot (`Log` / `Sample`) but never analysed, and not the plant being
 *   sampled right now. The same condition the candidate cards use: a scan without an `Analyse`.
 * - `Genus [1/3]`, `[2/3]`, `[3/3]` — the sampling run in progress on this body, or a finished one.
 *
 * Species and colour ride along for the rows that know them. Pure, so the web app, the second
 * screen and the tests all read the same answer.
 */
import type { GenusHint, OrganicGenusLock } from "./types.js";

export type GenusProgressStatus = "dss" | "cs" | "seen" | "active" | "done";

export interface GenusProgressRow {
  /** Display genus, e.g. "Stratum". */
  genus: string;
  /** e.g. "Stratum Limaxus", when a scan named it. */
  species: string | null;
  /** Journal variant, e.g. "Stratum Limaxus - Green", when known. */
  variant: string | null;
  status: GenusProgressStatus;
  /** 1–3 for `active` and `done`; null otherwise. */
  samples: number | null;
  /** The raw DSS hint, for callers that mark DSS genera with no candidate. */
  hint: GenusHint | null;
  /** Journal time of the latest scan on this genus here; null when never scanned (or unknown). */
  at: string | null;
}

/** The sampling run happening right now, if it is on this body. */
export interface LiveSamplingRun {
  speciesDisplay: string;
  sampleCount: number;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** "$Codex_Ent_Stratum_Genus_Name;" and "Stratum" both come down to "stratum". */
function genusKeyOf(localised: string | null | undefined, symbol: string | null | undefined): string {
  const l = norm(localised);
  if (l) return l;
  const m = /codex_ent_([a-z]+)_genus/i.exec(symbol ?? "");
  return m ? m[1]!.toLowerCase() : norm(symbol);
}

function lockGenusDisplay(l: OrganicGenusLock): string {
  const g = (l.genusLocalised || "").trim();
  if (g) return g;
  return (l.speciesLocalised || "").trim().split(/\s+/)[0] ?? "";
}

/** Is `live` the run for this lock's species? The overlay names it by variant or by species. */
function isLiveFor(lock: OrganicGenusLock, live: LiveSamplingRun | null): boolean {
  if (!live) return false;
  const shown = norm(live.speciesDisplay);
  const sp = norm(lock.speciesLocalised);
  const v = norm(lock.variantLocalised);
  if (!shown) return false;
  return (
    (sp !== "" && (shown === sp || shown.startsWith(`${sp} `) || shown.startsWith(`${sp}-`))) ||
    (v !== "" && shown === v)
  );
}

function statusOf(
  lock: OrganicGenusLock,
  live: LiveSamplingRun | null,
): { status: GenusProgressStatus; samples: number | null } {
  if (lock.fromSibling) return { status: "dss", samples: null };
  if (lock.source === "codex") return { status: "cs", samples: null };
  if (lock.analysed) return { status: "done", samples: 3 };
  if (isLiveFor(lock, live)) {
    const n = Math.max(1, Math.min(3, Math.round(live!.sampleCount || lock.samples || 1)));
    return { status: "active", samples: n };
  }
  return { status: "seen", samples: null };
}

/** How far each status got, so the strongest lock on a genus wins. */
const RANK: Record<GenusProgressStatus, number> = { dss: 0, cs: 1, seen: 2, active: 3, done: 4 };

export function bodyGenusProgress(
  genusHints: readonly GenusHint[] | null | undefined,
  locks: readonly OrganicGenusLock[] | null | undefined,
  live: LiveSamplingRun | null,
): GenusProgressRow[] {
  const rows: GenusProgressRow[] = [];
  const byGenus = new Map<string, GenusProgressRow>();

  for (const h of genusHints ?? []) {
    const key = genusKeyOf(h.Genus_Localised, h.Genus);
    if (!key || byGenus.has(key)) continue;
    const row: GenusProgressRow = {
      genus: (h.Genus_Localised || "").trim() || key,
      species: null,
      variant: null,
      status: "dss",
      samples: null,
      hint: h,
      at: null,
    };
    byGenus.set(key, row);
    rows.push(row);
  }

  for (const lock of locks ?? []) {
    const genus = lockGenusDisplay(lock);
    const key = genusKeyOf(genus, lock.genusSymbol);
    if (!key) continue;
    const { status, samples } = statusOf(lock, live);
    let row = byGenus.get(key);
    if (!row) {
      row = { genus, species: null, variant: null, status: "dss", samples: null, hint: null, at: null };
      byGenus.set(key, row);
      rows.push(row);
    }
    // A sibling moon's scan suggests the genus, never names this body's species.
    if (lock.fromSibling) continue;
    if (lock.at && (!row.at || lock.at > row.at)) row.at = lock.at;
    // One species per genus on a body; the lock that got furthest names the row.
    if (row.species === null || RANK[status] > RANK[row.status]) {
      row.species = (lock.speciesLocalised || "").trim() || null;
      row.variant = (lock.variantLocalised || "").trim() || null;
      row.status = status;
      row.samples = samples;
    }
  }
  return rows;
}

/**
 * The genera scanned here, oldest first, newest last — the glance bar shows the last three.
 *
 * "Scanned" is anything with a tag: a comp scan, a foot scan, the run in progress. The live run is
 * always newest, whatever the clock says. Rows with no time (older data) keep their list order and
 * sort before the timed ones.
 */
export function scannedGenusRowsByTime(rows: readonly GenusProgressRow[]): GenusProgressRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status !== "dss")
    .sort((a, b) => {
      if ((a.r.status === "active") !== (b.r.status === "active")) return a.r.status === "active" ? 1 : -1;
      const ta = a.r.at ?? "";
      const tb = b.r.at ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ r }) => r);
}

/** The tag after a genus: `[CS]`, `[SEEN]`, `[2/3]` — or nothing for a genus only the DSS has named. */
export function genusProgressTag(row: Pick<GenusProgressRow, "status" | "samples">): string {
  switch (row.status) {
    case "cs":
      return "[CS]";
    case "seen":
      return "[SEEN]";
    case "active":
    case "done":
      return `[${row.samples ?? 0}/3]`;
    default:
      return "";
  }
}

/** Plain-words meaning of each tag, for tooltips. */
export const GENUS_PROGRESS_TITLE: Record<GenusProgressStatus, string> = {
  dss: "Reported by the DSS — not scanned yet.",
  cs: "Comp Scan — named by the ship's composition scanner, not sampled on foot.",
  seen: "Seen — sampled on foot but never analysed, and not the plant you are sampling now.",
  active: "Sampling now — samples taken of 3.",
  done: "Analysed — all three samples taken.",
};
