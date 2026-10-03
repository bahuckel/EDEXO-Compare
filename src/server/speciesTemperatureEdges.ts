/**
 * Codex temperature edges the game's own bodies run past (2026-10-03).
 *
 * `data/exomastery/temperature-edges.json`, built by `docs/perf/build_temperature_edges.py` from the
 * Spansh galaxy dump's bodies with the species confirmed by the EDSM and EDAstro codex.
 *
 * Why: the near-edge check in the matcher asks the feeder profile, which is a sample. Tussock
 * triticum's is 464 bodies and none above its codex 195 K, so a triticum at 195.1 K (EDDN ScanOrganic
 * set, Col 285 Sector DL-X d1-74) was demoted as "0 of 464 within 3 K". The corpus holds 6,491
 * triticum bodies and 397 of them sit between 195 and 195.4 K — a third of the 1,210 in the kelvin
 * below — and none further out.
 *
 * A rounded edge looks like that: bodies piling up just past it, then nothing. A real edge has an
 * empty kelvin past it and a few strays further out (Tussock albata: 0 against 2,466, then 12 bodies
 * 1–3 K below), and is not in the file. Every edge the file holds today is the same one: codex 195 K,
 * observed 195.4 K, for eight Osseus, Tubus and Tussock species.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

export interface ObservedEdge {
  codexK: number;
  /** The farthest confirmed body past the codex edge, within 1 K of it. */
  observedK: number;
  /** Bodies in the kelvin past the edge, and in the kelvin inside it. */
  past: number;
  inside: number;
}

interface SpeciesEdges {
  bodies: number;
  lo?: ObservedEdge;
  hi?: ObservedEdge;
}

let cache: Map<string, SpeciesEdges> | null = null;

function load(): Map<string, SpeciesEdges> {
  if (cache) return cache;
  cache = new Map();
  const file = path.join(getProjectRoot(), "data", "exomastery", "temperature-edges.json");
  if (!existsSync(file)) return cache;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { species?: Record<string, SpeciesEdges> };
    for (const [id, e] of Object.entries(doc.species ?? {})) cache.set(id, e);
  } catch {
    /* no file: the matcher answers as before */
  }
  return cache;
}

/**
 * The observed edge this temperature is past the codex one by, when the game's bodies reach it;
 * null inside the codex band, beyond the observed edge, or for a species with no such edge.
 */
export function observedTemperatureEdge(
  speciesId: string,
  kelvin: number,
): (ObservedEdge & { bodies: number }) | null {
  const e = load().get(speciesId);
  if (!e || !Number.isFinite(kelvin)) return null;
  if (e.hi && kelvin > e.hi.codexK && kelvin <= e.hi.observedK) return { ...e.hi, bodies: e.bodies };
  if (e.lo && kelvin < e.lo.codexK && kelvin >= e.lo.observedK) return { ...e.lo, bodies: e.bodies };
  return null;
}

export function clearTemperatureEdgesCache(): void {
  cache = null;
}
