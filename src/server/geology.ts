/**
 * The Volcanism field's server half (shared/geology.ts): the measured table, and one body's answer
 * from its scan, its signal count, the geology logged on it and the commander's codex for its region.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bodyGeology, type BodyGeologyDTO, type GeologyTable } from "../shared/geology.js";
import type { BodyExoState, PlanetScan } from "../shared/types.js";
import { regionJoinKey } from "../shared/regionMap.js";
import { getProjectRoot } from "./paths.js";

let memo: { root: string; table: GeologyTable | null } | null = null;

/** `data/exomastery/geology-by-volcanism.json`, read once; null when the build has none. */
export function geologyTable(root = getProjectRoot()): GeologyTable | null {
  if (memo?.root === root) return memo.table;
  const file = path.join(root, "data", "exomastery", "geology-by-volcanism.json");
  let table: GeologyTable | null = null;
  try {
    if (existsSync(file)) table = JSON.parse(readFileSync(file, "utf8")) as GeologyTable;
  } catch {
    table = null;
  }
  memo = { root, table };
  return table;
}

export function geologyForBody(opts: {
  body: BodyExoState;
  scan: PlanetScan | null;
  region: string | null | undefined;
  /** `regionJoinKey|entryKey` for every codex entry he logged (GameStateStore.codexMapLogged). */
  codexLogged: ReadonlySet<string>;
}): BodyGeologyDTO | null {
  const region = opts.region?.trim() || null;
  const rk = region ? regionJoinKey(region) : "";
  return bodyGeology({
    table: geologyTable(),
    volcanism: opts.scan?.Volcanism,
    planetClass: opts.scan?.PlanetClass,
    signals: opts.body.geologicalSignals,
    loggedHere: opts.body.geologyLogged ?? [],
    region,
    regionLogged: (id) => opts.codexLogged.has(`${rk}|${id}`),
  });
}
