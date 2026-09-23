/**
 * A planet class in the journal's words, whoever wrote it.
 *
 * The species data, and so every `planetClassAnyOf`, is written the way the journal's `Scan` writes
 * `PlanetClass`. Spansh and EDSM write several classes their own way, and the matcher's planet-class
 * test is an exact comparison — so a body arriving under the other spelling fails every species that
 * lists its class, and survives only where an observation rescue happens to overrule the gate.
 *
 * The galaxy-dump path fixed two of these in 2026-09 (806,020 High metal content bodies in Inner
 * Orion Spur alone). The EDSM/Spansh system hydration never had the fix at all, and the dump path's
 * table left out `Metal-rich body` in the belief that it was already the journal's spelling: the
 * journal writes `Metal rich body`, with no hyphen, in all 256 of one commander's scans of one.
 *
 * Read off both sides: the journal's values from 283 of a commander's journals, the other side from
 * an EDDN collector export and EDSM system dumps.
 */
const TO_JOURNAL: Record<string, string> = {
  "high metal content world": "High metal content body",
  "rocky ice world": "Rocky ice body",
  "metal-rich body": "Metal rich body",
  "earth-like world": "Earthlike body",
  "gas giant with water-based life": "Gas giant with water based life",
  "gas giant with ammonia-based life": "Gas giant with ammonia based life",
  "helium-rich gas giant": "Helium rich gas giant",
  "class i gas giant": "Sudarsky class I gas giant",
  "class ii gas giant": "Sudarsky class II gas giant",
  "class iii gas giant": "Sudarsky class III gas giant",
  "class iv gas giant": "Sudarsky class IV gas giant",
  "class v gas giant": "Sudarsky class V gas giant",
};

/** `High metal content world` → `High metal content body`; the journal's own spelling passes through. */
export function journalPlanetClass(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  return TO_JOURNAL[v.toLowerCase()] ?? v;
}
