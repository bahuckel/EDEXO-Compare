/**
 * Achievement notices (src/server/achievementNotices.ts; owner, 2026-10-05): only steps reached after
 * the start, never the whole journal's worth at once.
 */
import { describe, expect, it } from "vitest";
import { achievementNoticeText, createAchievementWatch } from "../src/server/achievementNotices.js";
import type { AchievementDTO } from "../src/shared/dto/achievements.js";

const a = (id: string, step: 0 | 1 | 2 | 3, done: number): AchievementDTO =>
  ({ id, name: `Set ${id}`, kind: "galaxy", done, total: 12, step, thresholds: [4, 8, 12] }) as AchievementDTO;

describe("achievement notices", () => {
  it("announces nothing earned before the start, then each step reached once", () => {
    let list = [a("x", 2, 9), a("y", 0, 1)];
    let version = 1;
    const w = createAchievementWatch({ read: () => list, version: () => String(version) });
    w.prime();
    expect(w.check()).toEqual([]);
    // Nothing grew: not even read again.
    list = [a("x", 3, 12), a("y", 0, 1)];
    expect(w.check()).toEqual([]);
    version = 2;
    expect(w.check().map((x) => [x.id, x.step])).toEqual([["x", 3]]);
    version = 3;
    list = [a("x", 3, 12), a("y", 1, 4)];
    expect(w.check().map((x) => [x.id, x.step])).toEqual([["y", 1]]);
    version = 4;
    expect(w.check()).toEqual([]);
  });

  it("says the step, the count and the next step", () => {
    expect(achievementNoticeText(a("x", 1, 4))).toEqual({ title: "Bronze: Set x", text: "4 of 12 · Silver at 8" });
    expect(achievementNoticeText(a("x", 3, 12))).toEqual({ title: "Gold: Set x", text: "12 of 12" });
  });
});
