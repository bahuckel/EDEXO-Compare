import type { ExomasteryProfileV1 } from "./profileBuilder.js";

/**
 * Strip identity and metadata paths from profiles shipped to ED Exo Compare — ids, timestamps,
 * discoverer, and the body name itself. None of them can influence where a species spawns, and the
 * consumer already ignores every one of them (`exomasteryPathHygiene.shouldOmitExomasterySciencePath`),
 * so shipping them costs storage and parse time for nothing.
 *
 * `body.name` alone was **29.4% of the 2.91 MB** of profile JSON the app ships — one categorical key
 * per observed body, up to 1,328 of them for a single species.
 *
 * The fat `<slug>_exomastery_profile.json` in the feeder keeps them: that copy is the audit trail,
 * and distinct body names are how dedup is verified (C3). Only the exported copy is stripped.
 */
const OMIT_EXACT = new Set(["body.id", "body.id64", "body.bodyId", "body.updateTime", "body.name"]);

function shouldOmitProfilePath(path: string): boolean {
  if (path.startsWith("body.discovery.")) return true;
  if (OMIT_EXACT.has(path)) return true;
  return false;
}

/** Drop keys from numerics / categorical / summaryLines; keep {@link ExomasteryProfileV1.materials} and atmosphere tables (not under `body.`). */
export function sanitizeExomasteryProfileForEdexo<P extends ExomasteryProfileV1>(profile: P): P {
  const numerics = { ...profile.numerics };
  for (const k of Object.keys(numerics)) {
    if (shouldOmitProfilePath(k)) delete numerics[k];
  }
  const categorical = { ...profile.categorical };
  for (const k of Object.keys(categorical)) {
    if (shouldOmitProfilePath(k)) delete categorical[k];
  }
  const summaryLines = (profile.summaryLines ?? []).filter((line) => {
    const path = line.split(":")[0]?.trim() ?? "";
    return path.length > 0 && !shouldOmitProfilePath(path);
  });
  return { ...profile, numerics, categorical, summaryLines };
}
