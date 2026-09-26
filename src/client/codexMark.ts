import type { SpeciesMatch } from "@shared/types";

/**
 * The [CODEX] mark's tooltip (owner, 2026-09-26): which colour would be a new codex entry, and where.
 * The game keeps a codex page per galactic region and every colour variant is an entry of its own.
 */
export function codexMarkTitle(
  m: Pick<SpeciesMatch, "codexNewColours" | "codexRegion" | "notInCodex">,
): string {
  const where = m.codexRegion ? ` in ${m.codexRegion}` : "";
  const colours = m.codexNewColours ?? [];
  const what =
    colours.length === 0
      ? "No colour of this species is in your codex"
      : colours.length === 1
        ? `${colours[0]} is not in your codex`
        : `Neither ${colours.join(" nor ")} is in your codex`;
  const never = m.notInCodex ? " You have never logged this species anywhere." : "";
  return `${what}${where} yet — logging it here fills a new codex entry.${never} From your journals; entries in journals you no longer have count as new.`;
}
