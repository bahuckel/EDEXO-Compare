/**
 * Achievement notices (owner, 2026-10-05: "we should only add a notice in Notices — do not print all
 * achievements at once from the journal, only new ones received after the start of the launcher").
 *
 * The steps (bronze, silver, gold) every achievement stands at are taken once, before the first live
 * journal line; after each live line a step that went up is a notice. The historical replay never
 * reaches here, so nothing earned before this start is announced. Progress is read again only when
 * one of the sets it counts from has grown (a sampled plant, a codex line, a new system).
 */
import type { AchievementDTO } from "../shared/dto/achievements.js";

export interface AchievementWatch {
  /** Takes the steps as they stand, once (before the first live line). */
  prime(): void;
  /** After a live line: the achievements whose step went up since the last look. */
  check(): AchievementDTO[];
}

export function createAchievementWatch(opts: {
  /** Every achievement with its step; null when this build has no codex catalogue. */
  read: () => AchievementDTO[] | null;
  /** Changes whenever progress could have: the sizes of the sets it counts from. */
  version: () => string;
}): AchievementWatch {
  let steps: Map<string, number> | null = null;
  let seen = "";
  const take = (list: AchievementDTO[]) => new Map(list.map((a) => [a.id, a.step]));
  return {
    prime() {
      if (steps) return;
      const list = opts.read();
      if (!list) return;
      steps = take(list);
      seen = opts.version();
    },
    check() {
      if (!steps) return [];
      const v = opts.version();
      if (v === seen) return [];
      seen = v;
      const list = opts.read() ?? [];
      const up = list.filter((a) => a.step > (steps!.get(a.id) ?? 0));
      steps = take(list);
      return up;
    },
  };
}

const STEP = ["", "Bronze", "Silver", "Gold"] as const;

/** The notice's words: "Gold: Fonticulua (The Veils)", "12 of 12". */
export function achievementNoticeText(a: AchievementDTO): { title: string; text: string } {
  return {
    title: `${STEP[a.step]}: ${a.name}${a.region && !a.name.includes(a.region) ? ` (${a.region})` : ""}`,
    text: `${a.done.toLocaleString("en-US")} of ${a.total.toLocaleString("en-US")}${a.step < 3 ? ` · ${STEP[a.step + 1]} at ${a.thresholds[a.step as 0 | 1 | 2].toLocaleString("en-US")}` : ""}`,
  };
}
