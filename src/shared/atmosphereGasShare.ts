/**
 * How much of a body's air is a given gas — read once, for everyone who asks.
 *
 * `AtmosphereType` names only the **dominant** gas, so it cannot answer either of the two questions
 * the species data asks about composition:
 *
 * - **Is the required gas actually there?** Recepta needs sulphur dioxide. Blu Thua EM-D d12-25 A 1 a
 *   is a carbon dioxide world — 99.01 % CO₂ — carrying 0.99 % SO₂ in the mix. The gas is present and
 *   a trace is not a habitat, so {@link REQUIRED_GAS_MIN_SHARE_PCT} is the floor.
 * - **How much of it?** `NeonRich` air is not neon-rich; it averages 5.5 % neon. Bacterium acies sits
 *   at 85-100 % neon and Fonticulua segmentatus at 0.24-0.53 %, two ranges that do not touch on a
 *   label that cannot tell them apart.
 *
 * Shared because the matcher gates on these and the encyclopedia's spawn-condition cards explain
 * them, and for a while only the matcher could read them — the cards showed "Allowed: Argon" for
 * both Fonticulua campestris and upupam, which is the same sentence for two species the model
 * separates. One reader, both surfaces.
 */
import type { PlanetScan, SpeciesCriterion } from "./types.js";
import { atmosphereCompositionKey } from "./scanAtmosphereMatch.js";

/**
 * How much of the air a required gas has to be before it counts as habitat rather than a trace.
 *
 * Five per cent. Below it the gas is in the mix by accident of chemistry, not as the thing living
 * there feeds on.
 */
export const REQUIRED_GAS_MIN_SHARE_PCT = 5;

type CompositionRow = { Name?: unknown; name?: unknown; Percent?: unknown; percent?: unknown };

/**
 * The largest share of `gas` in the scan's composition, or null when the scan carries none.
 *
 * **Null is "no opinion", never zero.** Every measured scan carries `AtmosphereComposition`, but a
 * cached or pre-Odyssey one may not, and a rejection invented from missing data is worse than a rare
 * body let through.
 */
export function gasSharePercent(scan: PlanetScan, gas: string): number | null {
  const comp = scan.atmosphereComposition as CompositionRow[] | undefined;
  if (!Array.isArray(comp) || comp.length === 0) return null;
  const wantKey = atmosphereCompositionKey(gas);
  let best: number | null = null;
  for (const row of comp) {
    const name = String(row?.Name ?? row?.name ?? "").trim();
    if (!name || atmosphereCompositionKey(name) !== wantKey) continue;
    const raw = row?.Percent ?? row?.percent;
    const pct = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    if (best === null || pct > best) best = pct;
  }
  return best;
}

/** One `atmosphereGasSharePct` band against one body. `pct` is null when the scan cannot say. */
export function gasBandVerdict(
  scan: PlanetScan,
  band: { gas: string; min?: number; max?: number },
): { ok: boolean; pct: number | null } {
  const pct = gasSharePercent(scan, band.gas) ?? 0;
  const hasComposition = Array.isArray(scan.atmosphereComposition) && scan.atmosphereComposition.length > 0;
  if (!hasComposition) return { ok: true, pct: null };
  const belowMin = band.min !== undefined && pct < band.min;
  const aboveMax = band.max !== undefined && pct > band.max;
  return { ok: !belowMin && !aboveMax, pct };
}

/** How a band reads on its own: `85–100 %`, `≥ 5 %`, `≤ 0.53 %`. */
export function describeGasBand(band: { gas: string; min?: number; max?: number }): string {
  if (band.min !== undefined && band.max !== undefined) return `${band.gas} ${band.min}–${band.max} %`;
  if (band.min !== undefined) return `${band.gas} ≥ ${band.min} %`;
  if (band.max !== undefined) return `${band.gas} ≤ ${band.max} %`;
  return band.gas;
}

/**
 * Is the required gas present in usable quantity?
 *
 * Three answers, because they read differently to a commander: the gas is the atmosphere (`ok`), it
 * is in the mix but a trace (`trace`, with the number), or it is not there at all (`absent`).
 *
 * `AtmosphereType` naming the gas is enough on its own — that is the game saying this *is* a sulphur
 * dioxide world — and it is the only path open for a scan that predates `AtmosphereComposition` or
 * arrived from a cache that dropped it.
 */
export function requiredAtmosphereShare(
  scan: PlanetScan,
  atmoNorm: string,
  required: readonly string[],
): { kind: "ok" | "trace" | "absent"; pct: number | null; gas: string } {
  const wanted = required.filter((r) => r?.trim());
  const scanKey = atmosphereCompositionKey(atmoNorm);
  for (const w of wanted) {
    if (
      w === atmoNorm ||
      w.toLowerCase() === atmoNorm.toLowerCase() ||
      atmosphereCompositionKey(w) === scanKey
    ) {
      return { kind: "ok", pct: null, gas: w };
    }
  }
  const comp = scan.atmosphereComposition as CompositionRow[] | undefined;
  if (!Array.isArray(comp) || comp.length === 0) return { kind: "absent", pct: null, gas: wanted[0] ?? "" };
  let best: { pct: number; gas: string } | null = null;
  for (const row of comp) {
    const name = String(row?.Name ?? row?.name ?? "").trim();
    if (!name) continue;
    const key = atmosphereCompositionKey(name);
    const hit = wanted.find(
      (w) => w.toLowerCase() === name.toLowerCase() || atmosphereCompositionKey(w) === key,
    );
    if (!hit) continue;
    const pctRaw = row?.Percent ?? row?.percent;
    const pct = typeof pctRaw === "number" && Number.isFinite(pctRaw) ? pctRaw : 0;
    if (!best || pct > best.pct) best = { pct, gas: name };
  }
  if (!best) return { kind: "absent", pct: null, gas: wanted[0] ?? "" };
  return best.pct >= REQUIRED_GAS_MIN_SHARE_PCT
    ? { kind: "ok", pct: best.pct, gas: best.gas }
    : { kind: "trace", pct: best.pct, gas: best.gas };
}

/** Does this criterion say anything about composition at all? */
export function hasCompositionRule(c: SpeciesCriterion): boolean {
  return !!(c.atmosphereGasSharePct?.length || c.atmosphereTypeRequiredAnyOf?.length);
}
