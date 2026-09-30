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

let memo: { root: string; logged: Set<string>; regions: Set<string>; generated: string | null } | null = null;

function load(projectRoot: string): { logged: Set<string>; regions: Set<string>; generated: string | null } | null {
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
          const name = t[1];
          const species = codexSpeciesKey(name);
          const dash = name.indexOf(" - ");
          const colour = dash >= 0 ? name.slice(dash + 3).trim().toLowerCase() : "";
          logged.add(`${r}|${species}|${colour}`);
          logged.add(`${r}|${species}|*`);
        }
      }
    }
    memo = { root: projectRoot, logged, regions, generated: j.source?.generated ?? null };
    return memo;
  } catch {
    return null;
  }
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
  const d = load(projectRoot);
  if (!d || !region) return null;
  const r = regionJoinKey(region);
  // A region the data does not have (or spells differently) says nothing: never "first" by default.
  if (!d.regions.has(r)) return null;
  const species = codexSpeciesKey(gameOrderSpeciesName(displayName));
  if (!r || !species) return null;
  const label = (colourLabel ?? "").trim();
  const colours =
    !label || label.startsWith("(")
      ? []
      : label
          .split(" or ")
          .map((c) => c.trim())
          .filter(Boolean);
  if (colours.length === 0) return d.logged.has(`${r}|${species}|*`) ? null : [];
  const fresh = colours.filter((c) => !d.logged.has(`${r}|${species}|${c.toLowerCase()}`));
  return fresh.length ? fresh : null;
}

/** The date of the EDSM dump the marks are from, for the tooltip. */
export function codexFirstDataDate(projectRoot: string): string | null {
  return load(projectRoot)?.generated ?? null;
}

/** For tests. */
export function resetCodexFirst(): void {
  memo = null;
}
