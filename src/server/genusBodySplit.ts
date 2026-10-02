/**
 * Which species of a genus, for the genera the ranking model could not tell apart (Phase A.6, owner
 * 2026-10-02: "one species per genus at the end of this"): Sinuous Tubers and Brain Trees.
 *
 * The ranking model (`speciesLikelihood.ts`) is tuned to rank across genera: every term is damped to
 * 0.11, and the legacy plants have thin profiles. Inside Sinuous Tubers and Brain Trees it could not
 * say which: measured on 2,960 confirmed bodies (one per species per region), the right species came
 * first in its genus on 36 % and 47 %, against 96 % and 94 % that the body facts allow (a
 * cross-validated tree on 1.7 M confirmed bodies). Recepta was tried and left out: nothing in its
 * bodies separates the three, and the ranking model already orders them by region.
 *
 * This keeps the genus's total chance as the model computed it and splits it between the genus's
 * candidates by
 *
 *   P(species | body, region)  ∝  Π P(fact | species)  ×  P(species | genus, region)
 *
 * - the facts: planet type, volcanism kind, 25 K temperature band, atmosphere, counted on the
 *   confirmed bodies (`data/exomastery/genus-body-split.json`, Laplace 0.5, undamped: four facts,
 *   not twenty-seven, and not three views of one);
 * - the region term: the species' share of the genus's EDSM codex systems in the body's region
 *   (`data/rarity/species-rarity.json`), only where the genus has 100 systems there. The confirmed
 *   bodies are skewed by where players went (1,744 of 2,709 Sinuous Tubers in Empyrean Straits); the
 *   codex shares are not, so the region term is the prior and the bodies only say how each species
 *   relates to the facts. Where the region is unknown or thin, the galaxy-wide shares stand in: four
 *   facts on their own over-read a rare species that matches each fact separately but never together
 *   (Viride on rocky bodies, Viride with rocky volcanism, never both).
 *
 * Held out and balanced by region, top-1 in genus went to 79 % for both Sinuous Tubers and Brain
 * Trees (`docs/perf/nb_genus.py`). The floor is per genus, in the table: 1 % for both since 2026-10-03
 * (owner: "give 3 results if needed ... without any misses"), the right one among those shown on
 * 97.4 % of held-out Sinuous Tubers bodies (2.99 shown) and 99.0 % of Brain Trees (2.29). It was 15 %
 * and 10 %, at 92.6 % and 95.9 %, and that cost five known spawns their place after a DSS.
 *
 * Below the floor a row goes to "unlikely" — collapsed, never deleted — except the genus's best row,
 * a row with no score, and anything the commander has sampled here.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PlanetScan, SpeciesMatch } from "../shared/types.js";
import { codexGalaxySystems, codexRegionSystems } from "./speciesRarityData.js";

interface SpeciesCounts {
  n: number;
  [feature: string]: number | Record<string, number>;
}
interface GenusTable {
  features: string[];
  floor: number;
  valueCounts: Record<string, number>;
  species: Record<string, SpeciesCounts>;
}
interface SplitFile {
  formatVersion: number;
  genera: Record<string, GenusTable>;
}

/** The genus needs this many codex systems in a region before its shares there are believed. */
export const REGION_GENUS_MIN_SYSTEMS = 100;

let cache: { root: string; file: SplitFile | null } | null = null;

export function genusBodySplitPath(root: string): string {
  return path.join(root, "data", "exomastery", "genus-body-split.json");
}

function load(root: string): SplitFile | null {
  if (cache?.root === root) return cache.file;
  let file: SplitFile | null = null;
  try {
    const p = genusBodySplitPath(root);
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as SplitFile;
      if (j?.formatVersion === 1 && j.genera && typeof j.genera === "object") file = j;
    }
  } catch {
    file = null;
  }
  cache = { root, file };
  return file;
}

/** For tests: forget the loaded table. */
export function resetGenusBodySplitCache(): void {
  cache = null;
}

const PLANET_TYPES: Record<string, string> = {
  "high metal content body": "hmc",
  "high metal content world": "hmc",
  "rocky body": "rocky",
  "metal rich body": "metal-rich",
  "metal-rich body": "metal-rich",
  "rocky ice body": "rocky-ice",
  "rocky ice world": "rocky-ice",
  "icy body": "icy",
};

/** The volcanism kind, as the table counts it (the first named material). */
export function volcanismKind(v: string | null | undefined): string {
  const s = (v ?? "").toLowerCase();
  if (!s.trim() || s === "no volcanism") return "none";
  for (const k of ["water", "nitrogen", "ammonia", "methane", "carbon dioxide", "silicate", "metallic", "rocky"]) {
    if (s.includes(k)) return k;
  }
  return "other";
}

/**
 * The atmosphere's gas, as the table counts it: the journal's `SulphurDioxide` / `NeonRich` and
 * Spansh's `Thin Sulphur dioxide` / `Thin Neon-rich` both come out as `sulphur dioxide` / `neon-rich`.
 */
export function atmosphereKey(a: string | null | undefined): string {
  const s = (a ?? "").trim();
  if (!s || /^(none|no atmosphere)$/i.test(s)) return "none";
  if (!/\s/.test(s)) {
    const rich = /Rich$/.test(s) && s !== "Rich";
    const base = rich ? s.slice(0, -4) : s;
    const words = base.split(/(?<=[a-z])(?=[A-Z])/).map((w) => w.toLowerCase());
    return (words.join(" ") + (rich ? "-rich" : "")).trim() || "none";
  }
  const words = s
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "thin" && w !== "thick" && w !== "hot");
  return words.join(" ") || "none";
}

/** The body's facts in the table's terms; null where the scan does not say. */
export function bodyFacts(scan: PlanetScan): Record<string, string | null> {
  const cls = (scan.PlanetClass ?? "").trim().toLowerCase();
  const t = scan.SurfaceTemperature;
  return {
    type: cls ? (PLANET_TYPES[cls] ?? cls) : null,
    volc: volcanismKind(scan.Volcanism),
    temp25: t != null && Number.isFinite(t) ? String(Math.floor(t / 25)) : null,
    atmo: scan.AtmosphereType != null ? atmosphereKey(scan.AtmosphereType) : null,
  };
}

/**
 * Each candidate's share of its genus, from the body and the region. Null when the genus is not
 * one this split covers, or there is nothing to split.
 */
export function genusBodyShares(
  root: string,
  genusDataDir: string,
  speciesIds: string[],
  scan: PlanetScan,
  regionName: string | null,
): Map<string, number> | null {
  const table = load(root)?.genera[genusDataDir];
  if (!table || speciesIds.length === 0) return null;
  const facts = bodyFacts(scan);
  const regional = speciesIds.map((id) => (regionName ? codexRegionSystems(root, regionName, id) : null));
  const regionTotal = regional.reduce<number>((a, n) => a + (n ?? 0), 0);
  const galaxy = speciesIds.map((id) => codexGalaxySystems(root, id));
  const galaxyTotal = galaxy.reduce<number>((a, n) => a + (n ?? 0), 0);
  const useRegion = regionName != null && regionTotal >= REGION_GENUS_MIN_SYSTEMS;
  const prior = useRegion ? regional : galaxyTotal >= REGION_GENUS_MIN_SYSTEMS ? galaxy : null;
  const priorTotal = useRegion ? regionTotal : galaxyTotal;
  const logs = speciesIds.map((id, i) => {
    const row = table.species[id];
    let lp = 0;
    if (row) {
      for (const f of table.features) {
        const v = facts[f];
        if (v == null) continue;
        const counts = (row[f] as Record<string, number> | undefined) ?? {};
        const values = table.valueCounts[f] ?? 1;
        lp += Math.log(((counts[v] ?? 0) + 0.5) / (row.n + 0.5 * (values + 1)));
      }
    }
    if (prior) lp += Math.log(((prior[i] ?? 0) + 0.5) / (priorTotal + 0.5 * speciesIds.length));
    return lp;
  });
  const top = Math.max(...logs);
  const w = logs.map((l) => Math.exp(l - top));
  const z = w.reduce((a, x) => a + x, 0);
  return new Map(speciesIds.map((id, i) => [id, w[i]! / z]));
}

/**
 * Split each covered genus's chance between its shown candidates, and send the ones under the
 * genus's floor to "unlikely".
 *
 * Runs after `attachPresenceProbability`: the genus's total presence stays what the ranking model
 * said; only how it divides changes. `genusSharePercent` becomes the split itself, which is the
 * number the panel orders a genus by and the post-DSS floor reads.
 */
export function applyGenusBodySplit(
  matches: SpeciesMatch[],
  scan: PlanetScan | null,
  regionName: string | null,
  root: string,
  confirmedIds: ReadonlySet<string>,
): void {
  if (!scan) return;
  const file = load(root);
  if (!file) return;
  const byGenus = new Map<string, SpeciesMatch[]>();
  for (const m of matches) {
    if (m.unlikely || !file.genera[m.entry.genusDataDir]) continue;
    byGenus.set(m.entry.genusDataDir, [...(byGenus.get(m.entry.genusDataDir) ?? []), m]);
  }
  for (const [genus, rows] of byGenus) {
    if (rows.length < 2) continue;
    const shares = genusBodyShares(
      root,
      genus,
      rows.map((m) => m.entry.id),
      scan,
      regionName,
    );
    if (!shares) continue;
    const measured = rows.filter((m) => m.presenceProbabilityPercent != null && Number.isFinite(m.presenceProbabilityPercent));
    const genusPct = measured.length ? measured.reduce((a, m) => a + m.presenceProbabilityPercent!, 0) : null;
    for (const m of rows) {
      const s = shares.get(m.entry.id) ?? 0;
      m.genusSharePercent = Math.round(s * 1000) / 10;
      if (genusPct != null) m.presenceProbabilityPercent = Math.round(Math.min(100, genusPct * s) * 10) / 10;
    }
    const floor = file.genera[genus]!.floor;
    if (!(floor > 0)) continue;
    const best = rows.reduce((b, m) => ((shares.get(m.entry.id) ?? 0) > (shares.get(b.entry.id) ?? 0) ? m : b));
    for (const m of rows) {
      const s = shares.get(m.entry.id) ?? 0;
      if (m === best || s >= floor) continue;
      if (m.organicAnalysisComplete === true || confirmedIds.has(m.entry.id)) continue;
      m.unlikely = true;
      m.unlikelyReasons = [
        ...(m.unlikelyReasons ?? []),
        {
          field: "Which " + m.entry.genus,
          detail: `${(s * 100).toFixed(1)} % of its genus on this body (planet type, volcanism, temperature, atmosphere${
            regionName ? `, and how often it is logged in ${regionName}` : ""
          }) — under the ${Math.round(floor * 100)} % this panel shows.`,
        },
      ];
    }
  }
}
