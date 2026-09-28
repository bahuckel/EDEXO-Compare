/**
 * One planet class, whoever spells it (code review B7, 2026-09-28).
 *
 * Four vocabularies name the same classes: the journal (`High metal content body`, `Earthlike body`,
 * `Sudarsky class I gas giant`), Spansh / EDSM (`High metal content world`, `Earth-like world`,
 * `Class I gas giant`), the species files (`High Metal Content`, `Metal-Rich`, `Rocky Ice`) and the
 * codex / companion lists (`Earth-Like World`, `Gas Giant with water-based life`). Five functions
 * folded them five ways, and `docs/perf/normaliser-table.mts` found where they disagreed:
 *
 *  - the species-file reader dropped `Metal-Rich` (hyphen) — five rows lost the class they list;
 *  - the observation key read `Earthlike body` and `Earth-like world` as two classes, and the same
 *    for every Sudarsky gas giant.
 *
 * Every spelling now reduces to one id, and the journal's own spelling is the one the matcher compares.
 */
export type PlanetClassId =
  | "rocky"
  | "icy"
  | "rockyice"
  | "hmc"
  | "metalrich"
  | "earthlike"
  | "water"
  | "ammonia"
  | "watergiant"
  | "watergiantlife"
  | "ggwater"
  | "ggammonia"
  | "heliumrich"
  | "helium"
  | "gg1"
  | "gg2"
  | "gg3"
  | "gg4"
  | "gg5";

/** The journal's `PlanetClass`, the spelling the species data and the matcher use. */
export const JOURNAL_PLANET_CLASS: Record<PlanetClassId, string> = {
  rocky: "Rocky body",
  icy: "Icy body",
  rockyice: "Rocky ice body",
  hmc: "High metal content body",
  metalrich: "Metal rich body",
  earthlike: "Earthlike body",
  water: "Water world",
  ammonia: "Ammonia world",
  watergiant: "Water giant",
  watergiantlife: "Water giant with life",
  ggwater: "Gas giant with water based life",
  ggammonia: "Gas giant with ammonia based life",
  heliumrich: "Helium rich gas giant",
  helium: "Helium gas giant",
  gg1: "Sudarsky class I gas giant",
  gg2: "Sudarsky class II gas giant",
  gg3: "Sudarsky class III gas giant",
  gg4: "Sudarsky class IV gas giant",
  gg5: "Sudarsky class V gas giant",
};

/** Letters only, lower case, with the nouns that carry no class ("body", "world", "planet") dropped. */
function squash(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\b(body|world|planet|sudarsky)\b/g, " ")
    .replace(/\s+/g, "");
}

/** Any spelling → its class, or null for a label that names none ("Airless", a star, empty). */
export function planetClassId(value: string | null | undefined): PlanetClassId | null {
  const s = squash(value ?? "");
  if (!s) return null;
  if (s.startsWith("rockyice")) return "rockyice";
  if (s.startsWith("highmetal")) return "hmc";
  if (s.startsWith("metalrich")) return "metalrich";
  if (s === "rocky") return "rocky";
  if (s === "icy") return "icy";
  if (s.startsWith("earthlike")) return "earthlike";
  if (s === "water") return "water";
  if (s === "ammonia" || s === "ammoniac") return "ammonia";
  if (s === "watergiantwithlife") return "watergiantlife";
  if (s === "watergiant") return "watergiant";
  if (s.includes("gasgiantwithwater")) return "ggwater";
  if (s.includes("gasgiantwithammonia")) return "ggammonia";
  if (s.startsWith("heliumrich")) return "heliumrich";
  if (s.startsWith("heliumgas")) return "helium";
  const m = /^class(i{1,3}|iv|v)gasgiant$/.exec(s);
  if (m)
    return ({ i: "gg1", ii: "gg2", iii: "gg3", iv: "gg4", v: "gg5" } as const)[
      m[1] as "i" | "ii" | "iii" | "iv" | "v"
    ];
  return null;
}

/** Any spelling in the journal's words; a label naming no known class is returned unchanged. */
export function toJournalPlanetClass(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  const id = planetClassId(v);
  return id ? JOURNAL_PLANET_CLASS[id] : v;
}
