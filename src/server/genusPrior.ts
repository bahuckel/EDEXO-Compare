/**
 * Which genera a body carries, before a DSS (Phase A.8, owner 2026-10-02: "build and measure").
 *
 * The ranking model's chance for a genus is the sum of its species' chances, and those come from
 * each species' prevalence over the whole corpus. Nothing asked "on a body like this one, which
 * genera are there?". On one-signal HMC planets that sent Stratum to 40-50 % where it is really
 * there 15 % of the time.
 *
 * `data/exomastery/genus-prior.json` answers it from every landable bio body in the Spansh dump
 * (2,832,823 with a DSS genus list, export of 2026-10-03; was 2,810,046): P(genus present | planet type, signal count, atmosphere, 20 K
 * band, host star class, volcanism), backing off to coarser cells (dropping volcanism, then the star,
 * then the temperature, the atmosphere, the planet type) until one holds 100 bodies
 * (`docs/perf/genus_prior_eval.py`). Before a DSS each shown genus's total chance becomes
 *
 *   model^(1 - w) × prior^w,  w = 0.75
 *
 * scaled so the body's total stays what the model said; the genus's species keep their shares
 * inside it. Measured on 6,566 bodies in 4,000 sampled systems through the app's own path: the right
 * genus first on one-signal bodies 79.9 → 91.0 %, the true genera among the top n on 3 and 4+
 * signals 81.7 → 92.1 % and 86.6 → 93.3 %, calibration error (Brier) about halved.
 *
 * Left alone: genera whose spawn depends on where the system is (Electricae radialem, Bark Mounds,
 * Brain Trees, Sinuous Tubers — `spatialGates.ts`); their chance stays the model's, and the others
 * share what is left. After a DSS the game has named the genera and this does nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hostStarClassKey } from "../shared/hostStarClass.js";
import type { BodyExoState, PlanetScan, SpeciesMatch, SpeciesMatchContext } from "../shared/types.js";
import { gateForSpeciesId } from "../shared/spatialGates.js";
import { atmosphereKey, bodyFacts, volcanismKind } from "./genusBodySplit.js";

/** How hard the dump's genus frequencies pull against the ranking model (0 = model only, 1 = prior only). */
export const GENUS_PRIOR_WEIGHT = 0.75;

interface PriorFile {
  formatVersion: number;
  min: number;
  cells: Record<string, { n: number; p: Record<string, number> }>;
  /** Per genus key: the cell share below which it is hidden before a DSS (see {@link vetoUnseenGenera}). */
  veto?: Record<string, number>;
}

let cache: { root: string; file: PriorFile | null } | null = null;

function load(root: string): PriorFile | null {
  if (cache?.root === root) return cache.file;
  let file: PriorFile | null = null;
  try {
    const p = path.join(root, "data", "exomastery", "genus-prior.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as PriorFile;
      if (j?.formatVersion === 1 && j.cells && typeof j.cells === "object") file = j;
    }
  } catch {
    file = null;
  }
  cache = { root, file };
  return file;
}

/** One key for a genus however it is spelt ("Brain Tree" / "Brain Trees", "Sinuous Tuber(s)"). */
export function genusPriorKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6);
}

/** The table's cells for a body, finest first — the same keys docs/perf/genus_prior_eval.py writes. */
export function genusPriorCells(
  scan: PlanetScan,
  signals: number,
  hostStar: string | null | undefined,
): string[] {
  const type = bodyFacts(scan).type ?? "?";
  const n = String(Math.min(Math.trunc(signals), 5));
  const atmo = atmosphereKey(scan.AtmosphereType);
  const t = scan.SurfaceTemperature;
  const temp = t != null && Number.isFinite(t) ? String(Math.floor(t / 20)) : "?";
  const star = hostStarClassKey(hostStar) ?? "?";
  const volc = volcanismKind(scan.Volcanism);
  return [
    ["L0", type, n, atmo, temp, star, volc],
    ["L1", type, n, atmo, temp, star],
    ["L2", type, n, atmo, temp],
    ["L3", type, n, atmo],
    ["L4", type, n],
    ["L5", n],
  ].map((c) => c.join("|"));
}

/** P(genus present) for each genus key on a body like this one; null without a table or a cell. */
export function genusPriorFor(
  root: string,
  scan: PlanetScan,
  signals: number,
  hostStar: string | null | undefined,
): { cell: string; n: number; p: Record<string, number> } | null {
  const file = load(root);
  if (!file) return null;
  for (const key of genusPriorCells(scan, signals, hostStar)) {
    const c = file.cells[key];
    if (c && c.n >= file.min) return { cell: key, n: c.n, p: c.p };
  }
  return null;
}

/**
 * A genus is hidden before a DSS only on a body of a kind where that genus practically never grows
 * (owner, 2026-10-02, on Weqea DF-L b49-4 C 6: 8 genera for 4 signals).
 *
 * His rule: "rare species should not be compromised and get lower results just because they are
 * rare; if they match the conditions they should be shown, at a lower percent. We need to find the
 * limit where they are real signals vs not real, for every species." So the limit is per genus and
 * measured, not one threshold for all: from every landable bio body in the dump that really carries
 * the genus, how common the genus is in that body's cell; the genus's limit is the share below which
 * only 0.01 % of its own real bodies fall (`veto` in data/exomastery/genus-prior.json, built by
 * docs/perf/genus_veto_limits.py). Each genus may lose at most that share of its own bodies, rare or
 * common alike — Fumerola's limit comes out at 0.003 %, Recepta's 0.008 %, Fungoida's 0.47 %. It was
 * 0.25 % until 2026-10-03 (owner: no misses), which hid a real genus on 0.21 % of bodies.
 *
 * The list the presence floor left is the starting point. Never hidden this way: a genus placed by
 * position (the table cannot see a nebula or a Guardian site), anything sampled here, the last genus
 * on the list. On C 6 (5,332 bodies like it) Osseus 0.3 %, Concha 0.1 % and Fungoida 2.9 % go, and
 * Aleoida (1.4 %, above its 0.28 % limit: a real signal) stays.
 *
 * Measured against 1.2.9's own list on 6,566 bodies, at 0.01 %: genera shown 3.56 → 3.48 per body,
 * the true genera still shown 99.50 → 99.50 % (at 0.25 % it was 3.24 and 99.29 %).
 */
export function vetoUnseenGenera(
  // Any match rows: the body tab's, the system map's and the backlog's (owner, 2026-10-07).
  matches: Pick<SpeciesMatch, "entry" | "unlikely" | "unlikelyReasons" | "organicAnalysisComplete">[],
  b: Pick<BodyExoState, "genusHints" | "biologicalSignals">,
  scan: PlanetScan | null,
  ctx: Pick<SpeciesMatchContext, "parentStarType"> | null | undefined,
  root: string,
  confirmedIds: ReadonlySet<string>,
): void {
  if (!scan || b.genusHints?.length) return;
  const signals = b.biologicalSignals;
  if (signals == null || !Number.isFinite(signals) || signals < 1) return;
  const prior = genusPriorFor(root, scan, signals, ctx?.parentStarType);
  if (!prior) return;
  const shown = matches.filter((m) => !m.unlikely);
  const genera = new Set(shown.map((m) => genusPriorKey(m.entry.genus)));
  const protectedGenera = new Set<string>();
  for (const m of shown) {
    const k = genusPriorKey(m.entry.genus);
    if (
      gateForSpeciesId(m.entry.id) ||
      confirmedIds.has(m.entry.id) ||
      m.organicAnalysisComplete === true
    ) {
      protectedGenera.add(k);
    }
  }
  const limits = load(root)?.veto ?? {};
  const vetoed = [...genera].filter((g) => !protectedGenera.has(g) && (prior.p[g] ?? 0) < (limits[g] ?? 0));
  if (vetoed.length === 0) return;
  // Never empty the list: if every genus would go, the one the dump sees most stays.
  if (vetoed.length === genera.size) vetoed.splice(vetoed.indexOf(vetoed.reduce((a, g) => ((prior.p[g] ?? 0) > (prior.p[a] ?? 0) ? g : a))), 1);
  const out = new Set(vetoed);
  for (const m of shown) {
    const k = genusPriorKey(m.entry.genus);
    if (!out.has(k)) continue;
    m.unlikely = true;
    m.unlikelyReasons = [
      ...(m.unlikelyReasons ?? []),
      {
        field: "Chance here",
        detail:
          `${m.entry.genus} is on ${((prior.p[k] ?? 0) * 100).toFixed(1)} % of ${prior.n.toLocaleString("en-US")} bodies like this one ` +
          `(planet type, signals, atmosphere, temperature, star) in the Spansh galaxy dump. Listed as a ` +
          `low-probability find rather than excluded.`,
      },
    ];
  }
}

/**
 * Re-split the body's chance between its shown genera, before a DSS. The total stays; each genus's
 * species are scaled together, so their shares inside the genus do not move.
 */
export function applyGenusPrior(
  matches: SpeciesMatch[],
  b: Pick<BodyExoState, "genusHints" | "biologicalSignals">,
  scan: PlanetScan | null,
  ctx: Pick<SpeciesMatchContext, "parentStarType"> | null | undefined,
  root: string,
): void {
  if (!scan || b.genusHints?.length) return;
  const signals = b.biologicalSignals;
  if (signals == null || !Number.isFinite(signals) || signals < 1) return;
  const prior = genusPriorFor(root, scan, signals, ctx?.parentStarType);
  if (!prior) return;
  // A genus placed by where the system is (a nebula, a Guardian site, the core) keeps the model's
  // chance, all of its species: the table cannot see position, and pulled Electricae under the floor
  // beside nebulae (radialem is gated there, pluma is not, and they are one genus).
  const placed = new Set(matches.filter((m) => gateForSpeciesId(m.entry.id)).map((m) => genusPriorKey(m.entry.genus)));
  const byGenus = new Map<string, SpeciesMatch[]>();
  for (const m of matches) {
    if (m.unlikely || m.presenceProbabilityPercent == null || !Number.isFinite(m.presenceProbabilityPercent)) continue;
    const k = genusPriorKey(m.entry.genus);
    if (placed.has(k)) continue;
    byGenus.set(k, [...(byGenus.get(k) ?? []), m]);
  }
  if (byGenus.size < 2) return;
  const mass = new Map<string, number>();
  for (const [g, rows] of byGenus) mass.set(g, rows.reduce((a, m) => a + m.presenceProbabilityPercent!, 0));
  const total = [...mass.values()].reduce((a, x) => a + x, 0);
  if (!(total > 0)) return;
  // A genus the table never saw on such bodies: half a body's worth, not zero (rank, never wall).
  const floor = 0.5 / prior.n;
  const target = new Map<string, number>();
  for (const [g, mm] of mass) {
    const p = Math.max(prior.p[g] ?? 0, floor);
    target.set(
      g,
      Math.exp((1 - GENUS_PRIOR_WEIGHT) * Math.log(Math.max(mm / 100, 1e-6)) + GENUS_PRIOR_WEIGHT * Math.log(p)),
    );
  }
  const z = [...target.values()].reduce((a, x) => a + x, 0);
  for (const [g, rows] of byGenus) {
    const before = mass.get(g)!;
    const after = (target.get(g)! / z) * total;
    const k = before > 0 ? after / before : 0;
    for (const m of rows) {
      m.presenceProbabilityPercent = Math.round(Math.min(100, m.presenceProbabilityPercent! * k) * 10) / 10;
    }
  }
}
