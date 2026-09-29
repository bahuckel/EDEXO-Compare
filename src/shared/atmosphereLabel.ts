/**
 * The journal's `AtmosphereType` as a player reads it (UI review V4, 2026-09-29): `SulphurDioxide` →
 * "Sulphur dioxide", `NeonRich` → "Neon-rich", `EarthLike` → "Earth-like", `None` → "None".
 */
export function readableAtmosphereType(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return t;
  if (t === "AmmoniaOxygen") return "Ammonia and oxygen";
  if (t === "EarthLike") return "Earth-like";
  const rich = /Rich$/.test(t) && t !== "Rich";
  const base = rich ? t.slice(0, -4) : t;
  const words = base.split(/(?<=[a-z])(?=[A-Z])/);
  const text = words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ");
  return rich ? `${text}-rich` : text;
}
