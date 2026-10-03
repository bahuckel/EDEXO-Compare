/**
 * Outside a species' observed-temperature envelope: the corpus factor (see below).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

/*
  Outside a species' observed-temperature envelope (`data/exomastery/observed-temperature.json`, built by
  docs/perf/build_observed_temperature.py; owner 2026-10-03: no misses first): how much less likely it is
  there than its genus siblings, from the corpus — the share of its own bodies outside over theirs. The
  matcher used to demote every row outside; Recepta umbrux's envelope ends at 253 K, the corpus has it to
  274 K, and 1.9 % of its bodies sit outside against 1.6 % of its siblings', so for umbrux the envelope
  says nothing (factor 1). For most species it says a lot (Tussock triticum: 0.4 % against 98 %; 0.02).
*/
let envelopeCache: Map<string, number> | null = null;

/** The factor for a row outside its envelope, or undefined when the corpus has no figure for it. */
export function observedEnvelopeFactor(speciesId: string): number | undefined {
  if (!envelopeCache) {
    envelopeCache = new Map();
    const file = path.join(getProjectRoot(), "data", "exomastery", "observed-temperature.json");
    try {
      if (existsSync(file)) {
        const doc = JSON.parse(readFileSync(file, "utf8")) as {
          species?: Record<string, { factor?: number }>;
        };
        for (const [id, v] of Object.entries(doc.species ?? {})) {
          if (typeof v.factor === "number" && Number.isFinite(v.factor)) envelopeCache.set(id, v.factor);
        }
      }
    } catch {
      /* no file: the envelope demotes as before */
    }
  }
  return envelopeCache.get(speciesId);
}

export function clearObservedEnvelopeCache(): void {
  envelopeCache = null;
}
