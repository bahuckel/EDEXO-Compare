/**
 * The Codex map (owner, 2026-09-27): EDSM's codex sightings, a few systems per region, coloured by
 * what this commander has already logged there.
 *
 * `data/codex/edsm-codex-regions.json` (built by `docs/perf/codex_region_extract.py` from EDSM's
 * nightly codex dump) holds, per region and kind, at least one system for every codex entry EDSM has
 * in that region plus systems spread across it, each with the entries EDSM has for it.
 *
 * A system is **done** when every one of its entries is in the commander's codex for that region,
 * **partial** when some are, **todo** when none are. The region is what counts, not the system: the
 * game's codex is kept per region, so an entry logged anywhere in the region is logged for all of it
 * (his words: "if someone scanned a body or plant somewhere else … it should show as yellow/green").
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CodexMapKind,
  CodexMapKindSummaryDTO,
  CodexMapRegionDTO,
  CodexMapRegionsDTO,
  CodexMapStatus,
  CodexMapSystemDTO,
} from "../shared/types.js";
import { regionJoinKey } from "../shared/regionMap.js";

export interface CodexRegionsFile {
  source: { note: string };
  types: [string, string, CodexMapKind][];
  regions: Record<string, Partial<Record<CodexMapKind, [string, string, number, number, number[]][]>>>;
}

let cached: { file: string; data: CodexRegionsFile | null } | null = null;

export function codexRegionsPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "codex", "edsm-codex-regions.json");
}

function load(projectRoot: string): CodexRegionsFile | null {
  const file = codexRegionsPath(projectRoot);
  if (cached?.file === file) return cached.data;
  let data: CodexRegionsFile | null = null;
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as CodexRegionsFile;
      data = Array.isArray(j?.types) && j.regions && typeof j.regions === "object" ? j : null;
    } catch {
      data = null;
    }
  }
  cached = { file, data };
  return data;
}

/** The catalogue itself, for the achievements (null when this build has no file). */
export function codexRegionsData(projectRoot: string): CodexRegionsFile | null {
  return load(projectRoot);
}

/** Test seam. */
export function resetCodexMapCacheForTests(): void {
  cached = null;
}

const KINDS: CodexMapKind[] = ["bodies", "bio"];

function statusOf(logged: number, total: number): CodexMapStatus {
  return logged === 0 ? "todo" : logged >= total ? "done" : "partial";
}

function systemsFor(
  data: CodexRegionsFile,
  region: string,
  kind: CodexMapKind,
  logged: ReadonlySet<string>,
): CodexMapSystemDTO[] {
  const rk = regionJoinKey(region);
  const rows = data.regions[region]?.[kind] ?? [];
  return rows.map(([id, name, x, z, idx]) => {
    const entries = idx
      .map((i) => data.types[i])
      .filter((t): t is [string, string, CodexMapKind] => t != null)
      .map(([key, entryName]) => ({ key, name: entryName, logged: logged.has(`${rk}|${key}`) }));
    const n = entries.filter((e) => e.logged).length;
    return { systemAddress: id, name, x, z, status: statusOf(n, entries.length), entries };
  });
}

export function codexMapRegions(projectRoot: string, logged: ReadonlySet<string>): CodexMapRegionsDTO {
  const data = load(projectRoot);
  if (!data) return { available: false, source: "", regions: [] };
  const regions = Object.keys(data.regions)
    .sort()
    .map((name) => {
      const rk = regionJoinKey(name);
      const kinds = {} as Record<CodexMapKind, CodexMapKindSummaryDTO>;
      for (const kind of KINDS) {
        const systems = systemsFor(data, name, kind, logged);
        const keys = new Set(systems.flatMap((s) => s.entries.map((e) => e.key)));
        kinds[kind] = {
          systems: systems.length,
          entries: keys.size,
          logged: [...keys].filter((k) => logged.has(`${rk}|${k}`)).length,
          todo: systems.filter((s) => s.status === "todo").length,
          partial: systems.filter((s) => s.status === "partial").length,
          done: systems.filter((s) => s.status === "done").length,
        };
      }
      return { name, joinKey: rk, kinds };
    });
  return { available: true, source: data.source.note, regions };
}

/** One region's systems, the region named in any spelling ("Formidine Rift" finds EDSM's "The …"). */
export function codexMapRegion(
  projectRoot: string,
  logged: ReadonlySet<string>,
  regionName: string,
  kind: CodexMapKind,
): CodexMapRegionDTO | null {
  const data = load(projectRoot);
  if (!data) return null;
  const want = regionJoinKey(regionName);
  const region = Object.keys(data.regions).find((r) => regionJoinKey(r) === want);
  if (!region) return null;
  return { region, kind, systems: systemsFor(data, region, kind, logged) };
}
