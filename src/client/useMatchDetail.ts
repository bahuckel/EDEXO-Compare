/**
 * A candidate's habitat detail and "other matching details" cards. Pushes leave them out and mark the
 * match with `lazyDetail` (UI review P1b, 2026-09-29: they were ~95 % of a rich system's bodies), so
 * they are fetched when the habitat modal or the drawer first opens — a local request of a few
 * milliseconds — and kept while the match is unchanged. A match that still carries them (another
 * source, an older server) is used as is.
 */
import type {
  BodyComputed,
  ExomasteryDetailDTO,
  ExomasteryVarietyItemDTO,
  OtherMatchDetailCardDTO,
} from "@shared/types";
import { useEffect, useMemo, useState } from "react";
import { exomasteryDetailHasContent } from "./speciesMatchHelpers";

type Match = BodyComputed["matches"][number];

export interface MatchDetail {
  detail: ExomasteryDetailDTO | null;
  varietyHints: ExomasteryVarietyItemDTO[] | null;
  otherCards: OtherMatchDetailCardDTO[];
}

/** Does this match have a habitat breakdown to open, here or on the server? */
export function matchHasDetail(m: Match): boolean {
  return m.lazyDetail?.habitat === true || exomasteryDetailHasContent(m.exomasteryDetail);
}

/** How many "other matching details" cards the match has, here or on the server. */
export function matchOtherCardCount(m: Match): number {
  return m.lazyDetail?.otherCards ?? m.otherMatchDetailCards?.length ?? 0;
}

/** `want`: the modal or the drawer is open. The answer stays until the match itself changes. */
export function useMatchDetail(m: Match, want: boolean): { data: MatchDetail | null; error: string | null } {
  const [got, setGot] = useState<{ for: Match; data: MatchDetail | null; error: string | null } | null>(null);
  const lazy = m.lazyDetail;
  const have = got?.for === m ? got : null;
  const inline = useMemo(
    (): MatchDetail => ({
      detail: exomasteryDetailHasContent(m.exomasteryDetail) ? (m.exomasteryDetail ?? null) : null,
      varietyHints: m.exomasteryVarietyHints ?? null,
      otherCards: m.otherMatchDetailCards ?? [],
    }),
    [m.exomasteryDetail, m.exomasteryVarietyHints, m.otherMatchDetailCards],
  );

  useEffect(() => {
    if (!want || !lazy || have) return;
    let live = true;
    void fetch(
      `/api/match-detail?body=${encodeURIComponent(lazy.body)}&species=${encodeURIComponent(m.entry.id)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as {
          exomasteryDetail?: ExomasteryDetailDTO | null;
          exomasteryVarietyHints?: ExomasteryVarietyItemDTO[] | null;
          otherMatchDetailCards?: OtherMatchDetailCardDTO[] | null;
          error?: string;
        } | null;
        if (!r.ok || !j) throw new Error(j?.error || "The match details could not be loaded.");
        const data: MatchDetail = {
          detail: exomasteryDetailHasContent(j.exomasteryDetail) ? (j.exomasteryDetail ?? null) : null,
          varietyHints: j.exomasteryVarietyHints ?? null,
          otherCards: j.otherMatchDetailCards ?? [],
        };
        if (live) setGot({ for: m, data, error: null });
      })
      .catch((e: unknown) => {
        if (live) setGot({ for: m, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [want, lazy, have, m]);

  if (!lazy) return { data: inline, error: null };
  return have ? { data: have.data, error: have.error } : { data: null, error: null };
}
