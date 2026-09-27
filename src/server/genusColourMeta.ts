/**
 * What a genus file's colour tables say: null classes, preferred stellar classes, per-species colour rules. Split out of speciesTreeLoader.ts (code review D, 2026-09-27).
 */
import {
  isStellarSpectralMappingKey,
  normalizeStellarMappingKey,
  sortStellarSpectralKeysForDisplay,
} from "../shared/starSpectralKeys.js";
import { asRecord } from "./speciesCriterionParser.js";

export function collectColorVariantNullSpectralKeys(metaRec: Record<string, unknown> | null): string[] | undefined {
  if (!metaRec) return undefined;
  const cv = asRecord(metaRec.color_variants);
  const mapping = asRecord(cv?.mapping);
  if (!mapping) return undefined;
  const out: string[] = [];
  for (const [k, v] of Object.entries(mapping)) {
    if (v !== null) continue;
    const key = k.trim();
    if (key) out.push(key);
  }
  return out.length ? out : undefined;
}

/** Stellar spectral keys (`TTS` or single-letter) whose mapping value is not JSON `null` — for soft UI hints. */
export function collectColorVariantPreferredStellarSpectralKeys(
  metaRec: Record<string, unknown> | null,
): string[] | undefined {
  if (!metaRec) return undefined;
  const cv = asRecord(metaRec.color_variants);
  const mapping = asRecord(cv?.mapping);
  if (!mapping) return undefined;
  const acc = new Set<string>();
  for (const [kRaw, v] of Object.entries(mapping)) {
    if (v === null) continue;
    const kTrim = kRaw.trim();
    if (!isStellarSpectralMappingKey(kTrim)) continue;
    acc.add(normalizeStellarMappingKey(kTrim));
  }
  if (!acc.size) return undefined;
  return sortStellarSpectralKeysForDisplay([...acc]);
}

/**
 * A species' own `color_rules`, kept whole.
 *
 * Deliberately not flattened into a colour: the mapping is a rule, and which colour it yields
 * depends on the body the commander is looking at. Flattening here would need a body, which the
 * loader does not have and should not want.
 */
export function readSpeciesColourRules(
  r: Record<string, unknown>,
): { type?: string; mapping?: Record<string, string> } | undefined {
  const cr = asRecord(r.color_rules);
  if (!cr) return undefined;
  const mapping = asRecord(cr.mapping);
  if (!mapping) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (typeof v === "string" && v.trim() && k.trim()) out[k.trim()] = v.trim();
  }
  if (!Object.keys(out).length) return undefined;
  const type = typeof cr.type === "string" ? cr.type.trim() : undefined;
  return { ...(type ? { type } : {}), mapping: out };
}

export function collectGenusColorVariantRich(meta: Record<string, unknown> | null): {
  rule?: string;
  stellarMap?: Record<string, string>;
  materialDriven?: boolean;
} | null {
  if (!meta) return null;
  const cv = asRecord(meta.color_variants);
  const mapping = asRecord(cv?.mapping);
  const ruleRaw = cv?.rule;
  const rule = typeof ruleRaw === "string" && ruleRaw.trim() ? ruleRaw.trim() : undefined;
  if (!mapping) {
    return rule ? { rule } : null;
  }
  let nonStellar = 0;
  const stellarMap: Record<string, string> = {};
  for (const [kRaw, v] of Object.entries(mapping)) {
    const kTrim = kRaw.trim();
    if (!kTrim) continue;
    if (v === null) continue;
    const vs = typeof v === "string" ? v.trim() : "";
    if (!vs) continue;
    if (isStellarSpectralMappingKey(kTrim)) {
      stellarMap[normalizeStellarMappingKey(kTrim)] = vs;
    } else {
      nonStellar++;
    }
  }
  /*
   * Material-driven means the mapping names materials *instead of* star classes, not as well as.
   *
   * This used to be `nonStellar > 0`, which let one stray key veto a whole star table: Fonticulua
   * maps fourteen spectral classes and `Ae/Be`, Tussock maps fourteen and `Black Hole`, and both
   * genera reported "(unknown)" for every candidate in the game because of that one entry. Those two
   * keys are spectral classes now (see `starSpectralKeys.ts`), and this is the second lock: a table
   * that names any star class at all is a star table, whatever else is in it.
   */
  const materialDriven = nonStellar > 0 && Object.keys(stellarMap).length === 0;
  const out: { rule?: string; stellarMap?: Record<string, string>; materialDriven?: boolean } = {};
  if (rule) out.rule = rule;
  if (Object.keys(stellarMap).length) out.stellarMap = stellarMap;
  if (materialDriven) out.materialDriven = true;
  return Object.keys(out).length ? out : null;
}
