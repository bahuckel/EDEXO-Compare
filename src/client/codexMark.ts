import type { AchievementAdvanceDTO, SpeciesMatch } from "@shared/types";

/** The tracked achievement's mark (★): which variants, here, would count toward it. */
export function achievementMarkTitle(a: AchievementAdvanceDTO): string {
  const list =
    a.variants.length > 4
      ? `${a.variants.slice(0, 4).join(", ")} and ${a.variants.length - 4} more`
      : a.variants.join(", ");
  return `Advances “${a.name}” — ${list} ${a.variants.length === 1 ? "is" : "are"} not done yet.`;
}

/**
 * The [CODEX] mark's tooltip (owner, 2026-09-26): which colour would be a new codex entry, and where.
 * The game keeps a codex page per galactic region and every colour variant is an entry of its own.
 */
/** The tooltip for [CODEX FIRST]. */
export function codexFirstTitle(
  m: Pick<
    SpeciesMatch,
    "codexFirstColours" | "codexRegion" | "codexFirstAsOf" | "codexFirstEdastroAsOf" | "codexFirstEdastroSpeciesOnly"
  >,
): string {
  const where = m.codexRegion ? ` in ${m.codexRegion}` : " in this region";
  const colours = m.codexFirstColours ?? [];
  const what =
    colours.length === 0
      ? "No colour of this species has been logged"
      : colours.length === 1
        ? `${colours[0]} has not been logged`
        : `Neither ${colours.join(" nor ")} has been logged`;
  const edsm = m.codexFirstAsOf ? `EDSM's codex, ${m.codexFirstAsOf}` : "EDSM's codex";
  const sources = m.codexFirstEdastroAsOf ? `${edsm}, and EDAstro's, fetched ${m.codexFirstEdastroAsOf}` : edsm;
  const note = m.codexFirstEdastroSpeciesOnly
    ? " Note: EDAstro has this species logged here without its colour, so this colour may already be taken."
    : "";
  const missing = m.codexFirstEdastroAsOf
    ? "Commanders who send to neither, and finds since then, are not counted."
    : "Commanders who do not send to EDSM, and finds since then, are not counted (Options → Notify me → NSP data adds EDAstro's).";
  return `${what}${where} by anyone yet (${sources}) — logging it could make you its first discoverer here.${note} ${missing}`;
}

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
