/**
 * The starlight each species grows under (owner, 2026-09-27: "every species gets a range of
 * luminosity where it thrives").
 *
 * `data/exomastery/starlight-ranges.json`: per species, the 0.5th–99.5th percentile of the light on
 * its bodies, in the Sun's flux at 1 AU (Earth = 1), measured over 2.82 M DSS-mapped bio bodies in
 * the Spansh dump with the species pinned by the EDSM and EDAstro codex (the only body in its system
 * carrying that genus, with one species of the genus logged there). Built by
 * `docs/perf/star-flux-ranges.mts` + `star-flux-analyse.py`, with `stellarIrradianceFor` itself, so
 * the ranges are in the unit and reading the gate is judged in.
 *
 * ## Why only a few species are gated
 *
 * Every species has a range, and for most of them it says nothing new. On airless bodies the light
 * sets the surface temperature (r = 0.93 between log light and log temperature), and the matcher
 * already gates on temperature and planet type. Of the same genus's other bodies that pass those,
 * a typical range turns away 0.5–3 % — about what it would cost the species' own sightings (~1 %).
 *
 * A range is gated (`gate: true`) where it turns away at least 3 % of those bodies and at least
 * twice its own loss, over ≥ 100 clean bodies: Bacterium volu, Concha labiata, Electricae radialem,
 * Sinuous Tubers prasinum, Stratum araneamus and Brain Tree viride.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";
import type { SpeciesStarlight } from "../shared/starlight.js";

export { formatStarlight } from "../shared/starlight.js";
export type StarlightRange = SpeciesStarlight;

let cache: Map<string, StarlightRange> | null = null;

function load(): Map<string, StarlightRange> {
  if (cache) return cache;
  cache = new Map();
  const file = path.join(getProjectRoot(), "data", "exomastery", "starlight-ranges.json");
  if (!existsSync(file)) return cache;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { species?: Record<string, StarlightRange> };
    for (const [id, r] of Object.entries(doc.species ?? {})) {
      if (Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) cache.set(id, r);
    }
  } catch {
    /* no ranges: the gate stays silent */
  }
  return cache;
}

/** The measured range, gated or not (the Encyclopedia shows both). */
export function starlightRangeFor(speciesId: string): StarlightRange | undefined {
  return load().get(speciesId);
}

export type StarlightVerdict = { passes: true } | { passes: false; side: "dim" | "bright"; range: StarlightRange };

/** Undefined when the species is not gated or the light is unknown: no opinion, never a failure. */
export function evaluateStarlightGate(speciesId: string, irradiance: number | undefined): StarlightVerdict | undefined {
  const r = load().get(speciesId);
  if (!r?.gate || irradiance === undefined || !Number.isFinite(irradiance)) return undefined;
  if (irradiance < r.lo) return { passes: false, side: "dim", range: r };
  if (irradiance > r.hi) return { passes: false, side: "bright", range: r };
  return { passes: true };
}

export function clearStarlightRangesCache(): void {
  cache = null;
}
