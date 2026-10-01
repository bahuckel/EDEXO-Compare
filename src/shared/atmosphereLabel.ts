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

/**
 * A display line that may start with the journal's type (Fable review 1.3): the body card and the
 * species quad print `AtmosphereType`, or a match reason that starts with it ("SulphurDioxide · any
 * thin atmosphere"). A leading CamelCase compound is made readable; anything else — Spansh's "Sulphur
 * dioxide", the journal's "thin sulphur dioxide atmosphere", "Neon" — is left as it is.
 */
export function readableAtmosphereLead(text: string): string {
  return text.replace(/^[A-Z][a-z]+(?:[A-Z][a-z]+)+(?=$|[\s·,(])/, (m) => readableAtmosphereType(m) ?? m);
}
