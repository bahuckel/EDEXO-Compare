/**
 * [CODEX FIRST] (owner, 2026-09-30): a candidate nobody has logged in this region yet — logging it
 * would make the commander its first discoverer there, not just fill his own codex page.
 *
 * "Nobody" as far as EDSM's nightly codex dump knows: `data/codex/edsm-codex-regions.json` holds, per
 * region, at least one system for every codex entry EDSM has there (its `source.method`), so the union
 * of a region's entries is everything logged in it that reached EDSM. Commanders who never send to EDSM
 * and anything logged after the dump (`source.generated`) are not in it, so the mark is "first as far
 * as anyone reported", and the tooltip says so.
 *
 * Per species and colour, like the game's codex and like [CODEX]: "Aleoida Arcus - Green" is its own
 * entry. With no colour to go on, first means no colour of the species at all in the region.
 *
 * EDAstro too, when the phenomena data is downloaded (owner, 2026-10-01): its codex file lists every
 * plant logged per region (edastroNsp.ts `edastroBioRegionIds`), and a first needs neither source to
 * have it. EDAstro's ids are read through EDSM's own id table (`types`): 99.9 % of its plant rows name
 * the exact colour variant; the rest name only the species (a base id, or a variant EDSM never saw).
 * Such a species-only row cannot rule a colour out, so the gold mark stays, with a note (owner: "keep
 * gold with a note").
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { codexSpeciesKey, gameOrderSpeciesName } from "../shared/codexLog.js";
import { regionJoinKey } from "../shared/regionMap.js";

interface RegionsFile {
  source?: { generated?: string };
  types: [string, string, string][];
  regions: Record<string, { bio?: [string, string, number, number, number[]][] }>;
}

interface Loaded {
  logged: Set<string>;
  regions: Set<string>;
  generated: string | null;
  /** codex id → [species key, colour] for every biological entry EDSM knows. */
  byId: Map<string, [string, string]>;
  /** A variant's base id ("codex_ent_stratum_07") → species key. */
  byBase: Map<string, string>;
}

let memo: ({ root: string } & Loaded) | null = null;

/** "Stratum Paleas - Indigo" → ["stratum paleas", "indigo"]. */
function speciesAndColour(name: string): [string, string] {
  const dash = name.indexOf(" - ");
  return [codexSpeciesKey(name), dash >= 0 ? name.slice(dash + 3).trim().toLowerCase() : ""];
}

function load(projectRoot: string): Loaded | null {
  if (memo?.root === projectRoot) return memo;
  const file = path.join(projectRoot, "data", "codex", "edsm-codex-regions.json");
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as RegionsFile;
    const logged = new Set<string>();
    const regions = new Set<string>();
    for (const [regionName, kinds] of Object.entries(j.regions ?? {})) {
      const r = regionJoinKey(regionName);
      if (kinds.bio?.length) regions.add(r);
      for (const sys of kinds.bio ?? []) {
        for (const i of sys[4] ?? []) {
          const t = j.types[i];
          if (!t || t[2] !== "bio") continue;
          const [species, colour] = speciesAndColour(t[1]);
          logged.add(`${r}|${species}|${colour}`);
          logged.add(`${r}|${species}|*`);
        }
      }
    }
    const byId = new Map<string, [string, string]>();
    const byBase = new Map<string, string>();
    for (const [id, name, kind] of j.types ?? []) {
      if (kind !== "bio") continue;
      const sc = speciesAndColour(name);
      byId.set(id, sc);
      const base = id.replace(/_[a-z0-9]+$/, "");
      if (!byBase.has(base)) byBase.set(base, sc[0]);
    }
    memo = { root: projectRoot, logged, regions, generated: j.source?.generated ?? null, byId, byBase };
    return memo;
  } catch {
    return null;
  }
}

/** EDAstro's plants per region, read through EDSM's id table: full keys, and species-only keys. */
export interface EdastroBio {
  ids: ReadonlySet<string>;
  fetchedAtMs: number;
}
let edMemo: { ids: ReadonlySet<string>; root: string; logged: Set<string>; speciesOnly: Set<string> } | null = null;

function edastroKeys(d: Loaded, root: string, ed: EdastroBio): { logged: Set<string>; speciesOnly: Set<string> } {
  if (edMemo?.ids === ed.ids && edMemo.root === root) return edMemo;
  const logged = new Set<string>();
  const speciesOnly = new Set<string>();
  for (const key of ed.ids) {
    const bar = key.indexOf("|");
    const r = key.slice(0, bar);
    const id = key.slice(bar + 1);
    const full = d.byId.get(id);
    if (full) {
      logged.add(`${r}|${full[0]}|${full[1]}`);
      logged.add(`${r}|${full[0]}|*`);
      continue;
    }
    // A base id, or a variant EDSM never listed: the species, not the colour.
    const species = d.byBase.get(id) ?? d.byBase.get(id.replace(/_[a-z0-9]+$/, ""));
    if (!species) continue;
    logged.add(`${r}|${species}|*`);
    speciesOnly.add(`${r}|${species}`);
  }
  edMemo = { ids: ed.ids, root, logged, speciesOnly };
  return edMemo;
}

/** What makes a [CODEX FIRST]: the colours that would be firsts, and whether EDAstro was asked. */
export interface CodexFirstResult {
  colours: string[];
  /** EDAstro's list was checked too (downloaded, with plants). */
  edastro: boolean;
  /** EDAstro has this species in the region but not which colour: gold stays, with a note. */
  edastroSpeciesOnly: boolean;
}

/**
 * [CODEX FIRST] against EDSM and, when given, EDAstro: null when either has it (or the region is not
 * in EDSM's data); else the colours nobody has logged ([] = colour unknown, no colour logged).
 */
export function codexFirstCheck(
  projectRoot: string,
  region: string | null | undefined,
  displayName: string,
  colourLabel: string | null | undefined,
  edastro: EdastroBio | null,
): CodexFirstResult | null {
  const d = load(projectRoot);
  if (!d || !region) return null;
  const r = regionJoinKey(region);
  // A region the data does not have (or spells differently) says nothing: never "first" by default.
  if (!d.regions.has(r)) return null;
  const species = codexSpeciesKey(gameOrderSpeciesName(displayName));
  if (!r || !species) return null;
  const ed = edastro ? edastroKeys(d, projectRoot, edastro) : null;
  const has = (k: string) => d.logged.has(k) || (ed?.logged.has(k) ?? false);
  const label = (colourLabel ?? "").trim();
  const colours =
    !label || label.startsWith("(")
      ? []
      : label
          .split(" or ")
          .map((c) => c.trim())
          .filter(Boolean);
  let fresh: string[];
  if (colours.length === 0) {
    if (has(`${r}|${species}|*`)) return null;
    fresh = [];
  } else {
    fresh = colours.filter((c) => !has(`${r}|${species}|${c.toLowerCase()}`));
    if (!fresh.length) return null;
  }
  return { colours: fresh, edastro: !!ed, edastroSpeciesOnly: ed?.speciesOnly.has(`${r}|${species}`) ?? false };
}

/**
 * The colours of this species nobody has logged in this region ("Green", or both of "Cyan or Orange");
 * [] when the colour is unknown and no colour of it is logged there; null when it is not a first (or
 * the region is not in the data).
 */
export function codexFirstColours(
  projectRoot: string,
  region: string | null | undefined,
  displayName: string,
  colourLabel: string | null | undefined,
): string[] | null {
  return codexFirstCheck(projectRoot, region, displayName, colourLabel, null)?.colours ?? null;
}

/** The date of the EDSM dump the marks are from, for the tooltip. */
export function codexFirstDataDate(projectRoot: string): string | null {
  return load(projectRoot)?.generated ?? null;
}

/** For tests. */
export function resetCodexFirst(): void {
  memo = null;
  edMemo = null;
}
