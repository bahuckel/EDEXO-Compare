/**
 * The Planetary body card's Volcanism field (owner, 2026-10-05): the body's volcanism, its geological
 * signal count, and the surface geology that could be down there, each marked Scanned (logged on this
 * body), New Codex (not in the commander's codex for this region) or Already in Codex for this region.
 *
 * "What could be down there" is measured, not read off the names: a geology entry's name does not
 * follow the volcanism's (a Sulphur Dioxide Fumarole stands on metallic or rocky magma bodies, a Water
 * Geyser on water magma ones). `data/exomastery/geology-by-volcanism.json` holds, for each of the 23
 * geology codex entries, the volcanism and body types of the bodies Spansh lists it on
 * (docs/perf/geology_from_spansh.py); an entry is a candidate when both this body's volcanism and its
 * type each make up at least {@link GEOLOGY_MIN_SHARE} of that entry's bodies.
 */
import { planetClassId } from "./normalise/planetClass.js";

/** One geology codex entry's measured hosts. */
export interface GeologyHosts {
  codexId: string;
  /** Bodies sampled. */
  bodies: number;
  /** Volcanism kind ("metallic magma") → bodies. */
  volcanism: Record<string, number>;
  /** Planet class (any spelling) → bodies. */
  body: Record<string, number>;
}

export interface GeologyTable {
  source: string;
  geology: Record<string, GeologyHosts>;
}

/** A host making up less than this of an entry's bodies is noise (a mis-filed landmark, a moon mix-up). */
export const GEOLOGY_MIN_SHARE = 0.03;

/** Scanned on this body · New Codex · Already in Codex for this region · region unknown. */
export type GeologyStatus = "scanned" | "new" | "region" | "unknown";

export interface GeologyCandidateDTO {
  codexId: string;
  name: string;
  status: GeologyStatus;
}

export interface BodyGeologyDTO {
  /** The journal's volcanism as the game words it ("Minor silicate vapour geysers"), null when none. */
  volcanism: string | null;
  /** Geological signals from the FSS / DSS, null when not counted. */
  signals: number | null;
  /** What could be down there, Scanned first, then New Codex, then the rest; [] when nothing fits. */
  candidates: GeologyCandidateDTO[];
  /** Codex region the statuses were read against; null when unknown (every status "unknown" then). */
  region: string | null;
}

/** "minor metallic magma volcanism" → "metallic magma"; null for none. */
export function volcanismKind(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v.includes("no volcanism")) return null;
  const k = v
    .replace(/^(major|minor)\s+/, "")
    .replace(/\s*volcanism$/, "")
    .trim();
  return k || null;
}

/** "minor metallic magma volcanism" → "Minor metallic magma", for the field. */
export function volcanismLabel(raw: string | null | undefined): string | null {
  if (!volcanismKind(raw)) return null;
  const t = (raw ?? "").trim().replace(/\s*volcanism$/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const share = (part: number | undefined, whole: number) => (whole > 0 ? (part ?? 0) / whole : 0);

/** The geology entries that fit a body's volcanism and type, by name. */
export function geologyCandidates(
  table: GeologyTable,
  volcanism: string | null | undefined,
  planetClass: string | null | undefined,
): { codexId: string; name: string }[] {
  const kind = volcanismKind(volcanism);
  if (!kind) return [];
  const cls = planetClassId(planetClass ?? "");
  const out: { codexId: string; name: string }[] = [];
  for (const [name, g] of Object.entries(table.geology)) {
    if (share(g.volcanism[kind], g.bodies) < GEOLOGY_MIN_SHARE) continue;
    if (cls) {
      let onType = 0;
      for (const [t, n] of Object.entries(g.body)) if (planetClassId(t) === cls) onType += n;
      if (share(onType, g.bodies) < GEOLOGY_MIN_SHARE) continue;
    }
    out.push({ codexId: g.codexId, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const ORDER: Record<GeologyStatus, number> = { scanned: 0, new: 1, unknown: 2, region: 3 };

/**
 * The field's whole answer. `regionLogged(codexId)` says whether the commander's codex has the entry
 * in this body's region (null when the region is unknown).
 */
export function bodyGeology(opts: {
  table: GeologyTable | null;
  volcanism: string | null | undefined;
  planetClass: string | null | undefined;
  signals: number | null | undefined;
  loggedHere: readonly string[];
  region: string | null;
  regionLogged: (codexId: string) => boolean;
}): BodyGeologyDTO | null {
  const label = volcanismLabel(opts.volcanism);
  const signals = opts.signals ?? null;
  if (!label && !signals && !opts.loggedHere.length) return null;
  const here = new Set(opts.loggedHere);
  const fit = opts.table ? geologyCandidates(opts.table, opts.volcanism, opts.planetClass) : [];
  // Logged on this body but outside the measured fit (a rare host): it is there, so it is listed.
  const names = new Map(Object.entries(opts.table?.geology ?? {}).map(([n, g]) => [g.codexId, n]));
  for (const id of here)
    if (!fit.some((c) => c.codexId === id)) fit.push({ codexId: id, name: names.get(id) ?? id });
  const candidates = fit
    .map((c) => ({
      ...c,
      status: (here.has(c.codexId)
        ? "scanned"
        : !opts.region
          ? "unknown"
          : opts.regionLogged(c.codexId)
            ? "region"
            : "new") as GeologyStatus,
    }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  return { volcanism: label, signals, candidates, region: opts.region };
}
