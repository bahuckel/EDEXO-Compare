/**
 * Journal body names are usually `"<StarSystem> <designation>"` (e.g. `Foo sector AB-A c1-3 A 1`, `Foo … A 1 a`).
 * For map UI, strip the system prefix so labels stay short. The primary star often equals `starSystem` only — show a star glyph.
 */
export function shortBodyLabel(bodyName: string, starSystem: string): string {
  const bn = bodyName.trim();
  const sys = starSystem.trim();
  if (!bn) return "";
  if (!sys) return bn;
  const prefix = `${sys} `;
  if (bn.startsWith(prefix)) {
    const rest = bn.slice(prefix.length).trim();
    return rest || "★";
  }
  if (bn === sys) return "★";
  return bn;
}
