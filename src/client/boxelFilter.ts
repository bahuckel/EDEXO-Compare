/**
 * The Boxels screen's one filter (owner, 2026-10-05: "one filter search bar + a dropdown for what it
 * searches — no long lists"): System name, Body type, Star type or Exobio species, over every
 * system of every ticked boxel.
 *
 * Plain substring matching, never a scattered fuzzy one: a filter has to say yes or no, and "helium
 * gas giant" must never take in a Helium-rich one (the body types name only the exact class).
 */
import type { BoxelTableRowDTO } from "@shared/boxel";
import { BODY_TRAITS, STAR_CLASSES } from "@shared/galaxyTraits";
import { NOTABLE_KINDS, type NotableKind } from "@shared/notices";

export type BoxelFilterKind = "system" | "body" | "star" | "species";

export const BOXEL_FILTER_KINDS: readonly { value: BoxelFilterKind; label: string; hint: string }[] = [
  { value: "system", label: "System name", hint: "e.g. d1-12" },
  { value: "body", label: "Body type", hint: "e.g. Earth-like, Water world, Helium gas giant, green" },
  { value: "star", label: "Star type", hint: "e.g. K, neutron, T Tauri, giant" },
  { value: "species", label: "Exobio species", hint: "e.g. Stratum, Tussock Ignis, Anemone" },
];

/** Short names for the notable kinds, as the table shows them. */
export const NOTABLE_SHORT: Record<NotableKind, string> = {
  earthlike: "ELW",
  water: "WW",
  ammonia: "AW",
  terraformable: "TF",
  helium: "He GG",
  green: "GGG",
};

/** Extra words a notable kind answers to. */
const NOTABLE_WORDS: Record<NotableKind, string[]> = {
  earthlike: ["earth-like", "earthlike", "elw"],
  water: ["water world", "ww"],
  ammonia: ["ammonia world", "aw"],
  terraformable: ["terraformable", "tf"],
  helium: ["helium gas giant", "he gg"],
  green: ["green gas giant", "ggg", "green"],
};

/** Body type keys and notable kinds a query names. */
function bodyQuery(q: string): { traits: Set<string>; kinds: Set<NotableKind> } {
  const traits = new Set(
    BODY_TRAITS.filter((t) => t.key === q || t.label.toLowerCase().includes(q)).map((t) => t.key),
  );
  const kinds = new Set(
    NOTABLE_KINDS.filter(
      (k) => k.label.toLowerCase().includes(q) || NOTABLE_WORDS[k.key].some((w) => w.includes(q)),
    ).map((k) => k.key),
  );
  return { traits, kinds };
}

/** Star class keys a query names: the key itself ("K"), or any class whose name holds it. */
function starQuery(q: string): Set<string> {
  const exact = STAR_CLASSES.filter((c) => c.key.toLowerCase() === q);
  if (exact.length) return new Set(exact.map((c) => c.key));
  return new Set(STAR_CLASSES.filter((c) => c.label.toLowerCase().includes(q)).map((c) => c.key));
}

/** A predicate for one query, built once for the whole table. */
export function boxelRowFilter(kind: BoxelFilterKind, raw: string): (r: BoxelTableRowDTO) => boolean {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return () => true;
  switch (kind) {
    case "system":
      return (r) => r.name.toLowerCase().includes(q);
    case "species":
      return (r) => !!r.bio?.species.some((s) => s.toLowerCase().includes(q));
    case "star": {
      const keys = starQuery(q);
      return (r) =>
        r.starClasses.some((k) => keys.has(k)) ||
        [r.mainStar, ...r.otherStars].some((s) => !!s && s.toLowerCase().includes(q));
    }
    case "body": {
      const { traits, kinds } = bodyQuery(q);
      return (r) => r.bodyTypes.some((k) => traits.has(k)) || r.notables.some((n) => kinds.has(n.kind));
    }
  }
}

/** Suggestions for the search box (a datalist): the names that kind of filter knows. */
export function boxelFilterSuggestions(kind: BoxelFilterKind, rows: readonly BoxelTableRowDTO[]): string[] {
  switch (kind) {
    case "system":
      return [];
    case "body":
      return [...BODY_TRAITS.map((t) => t.label), "Green gas giant"];
    case "star":
      return STAR_CLASSES.map((c) => c.label);
    case "species":
      return [...new Set(rows.flatMap((r) => r.bio?.species ?? []))].sort();
  }
}
