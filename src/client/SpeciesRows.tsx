import { codexMarkTitle } from "./codexMark";
import { useState, type ReactNode } from "react";
import type { BodyComputed, PlanetScan } from "@shared/types";
import { settledMultiplier } from "@shared/footfallValue";
import {
  candidateMorphColorShortLabel,
  candidateMorphColorShortLabelForHosts,
} from "@shared/candidateSpawnHints";
import { infoGatherReasons } from "@shared/infoGather";
import { fmtCrExact, fmtCrShort } from "./credits";
import { useFootfallCertainty } from "./footfallContext";
import { useRowContext, type LiveRun, type RowContextValue } from "./rowContext";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { heroPhotoUrlFor, titleCaseSpeciesWords } from "./speciesMatchHelpers";

type Match = BodyComputed["matches"][number];

export type RowProgress = { text: string; cls: "live" | "done" | "seen"; rank: number } | null;

/**
 * Scan progress for a row, the HUD's rule (3/3 analysed, n/3 for the run in progress, "seen" for a
 * species the commander logged on this body without finishing). Only the active genus can carry
 * 1/3 or 2/3, because the game's sampler holds one genus at a time.
 */
export function rowProgress(m: Match, ctx: RowContextValue): RowProgress {
  const name = m.entry.displayName.trim().toLowerCase();
  if (m.organicAnalysisComplete) return { text: "3/3", cls: "done", rank: 1 };
  const live: LiveRun | null = ctx.live;
  if (live && live.speciesDisplay.trim().toLowerCase() === name) {
    const n = Math.max(0, Math.min(3, live.sampleCount));
    return { text: `${n}/3`, cls: "live", rank: 0 };
  }
  if (ctx.locks.some((l) => l.speciesLocalised.trim().toLowerCase() === name)) {
    return { text: "seen", cls: "seen", rank: 2 };
  }
  return null;
}

/** Confirmed rows first (live, done, seen), then by chance, then as delivered (3.6). */
export function orderRows(items: readonly Match[], ctx: RowContextValue): Match[] {
  return items
    .map((m, i) => ({ m, i, p: rowProgress(m, ctx) }))
    .sort((a, b) => {
      const ra = a.p ? a.p.rank : 9;
      const rb = b.p ? b.p.rank : 9;
      if (ra !== rb) return ra - rb;
      const ca = a.m.presenceProbabilityPercent ?? -1;
      const cb = b.m.presenceProbabilityPercent ?? -1;
      if (ca !== cb) return cb - ca;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

function splitName(m: Match): { genus: string; epithet: string } {
  const genus = (m.entry.genus || "").trim();
  const full = (m.entry.displayName || "").trim();
  const epithet =
    genus && full.toLowerCase().startsWith(genus.toLowerCase() + " ")
      ? full.slice(genus.length + 1).trim()
      : full;
  return { genus: titleCaseSpeciesWords(genus), epithet: titleCaseSpeciesWords(epithet) };
}

/**
 * One candidate as a row (3.1, 3.4, 3.5): thumbnail, name, colour, progress, fit, spacing, chance
 * (also the bar behind the row), the value here. Click → the children (the full card) unfold.
 * Attribute pills stay in the card (3.2): a row that fits says nothing, a row that does not says
 * "unlikely".
 */
export function SpeciesRow({
  m,
  open,
  onToggle,
  scan,
  hostStarType,
  hostStarTypes,
  children,
}: {
  m: Match;
  open: boolean;
  onToggle: () => void;
  scan: PlanetScan | null;
  hostStarType?: string;
  hostStarTypes?: string[];
  children: ReactNode;
}) {
  const footfall = useFootfallCertainty();
  const ctx = useRowContext();
  const prog = rowProgress(m, ctx);
  const mult: 1 | 5 = settledMultiplier(footfall) ?? 1;
  const { genus, epithet } = splitName(m);
  // What was actually logged here beats any prediction (bug report 2026-09-26: scanning did not fix it).
  const colourRaw =
    m.confirmedColour ??
    (hostStarType
      ? candidateMorphColorShortLabel(m.entry, hostStarType, scan?.materials)
      : candidateMorphColorShortLabelForHosts(m.entry, hostStarTypes, scan?.materials));
  const colourUnknown = !colourRaw || colourRaw === "(unknown)";
  /*
    "We cannot tell you what you would find here."

    Two different gaps, one flag, because to the commander deciding whether to land they are the same
    question. **Thin data**: the corpus has few bodies for this species and he has confirmed it few
    times, which is the existing collection marker. **Undecided colour**: either no rule resolves
    (`(unknown)`) or two of them do and the answer is genuinely "A or B" — the grade-4 material
    precedence that ~40 observations would settle, and the reason this tag was asked for.

    Sampling any of these teaches the app something, which is the whole point of marking them.
  */
  const gatherReasons = infoGatherReasons({ collectionFocus: m.collectionFocus, colourLabel: colourRaw });
  const infoGather = gatherReasons.length > 0;
  const gatherRemaining = gatherReasons.includes("thin-data") ? m.collectionFocusNote?.remaining : null;
  const gatherWhy = [
    gatherReasons.includes("thin-data")
      ? `Thin data: the corpus has ${m.collectionFocusNote?.corpusBodies ?? 0} bodies for this species and ` +
        `you have confirmed it on ${m.collectionFocusNote?.ownScans ?? 0}.`
      : null,
    gatherReasons.includes("colour-unknown")
      ? "The colour rule does not resolve on this body, so the variant is unknown."
      : gatherReasons.includes("colour-ambiguous")
        ? `The evidence allows more than one colour here (${colourRaw}), so the variant is undecided.`
        : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  /*
    The thumbnail has to be the colour the row is claiming.

    This row prints the predicted variant beside the name, and it used to sit next to `m.photoUrl` —
    whichever photograph of the species came first. So a row read "Cactoida Peperatis - Amethyst"
    over a picture of the Teal one, which is a different plant, and the row was the thing saying so.
    Falls back to the species' own photograph when no variant matches.
  */
  const thumbUrl = heroPhotoUrlFor(m, colourRaw);
  const chance = m.presenceProbabilityPercent;
  const chancePct =
    typeof chance === "number" && Number.isFinite(chance) ? Math.max(0, Math.min(100, chance)) : null;
  const fit = m.exomasterySimilarityPercent;
  const dist = m.entry.genusMinSampleDistanceM;
  const [thumbMissing, setThumbMissing] = useState(false);
  const priceTag = footfall === "unwalked" ? "×5" : footfall === "walked" ? "×1" : "×1 ?";
  const priceTitle =
    m.priceCredits == null
      ? ""
      : footfall === "unwalked"
        ? `${fmtCrExact(m.priceCredits * 5)} — first footfall ×5 (list ${fmtCrExact(m.priceCredits)})`
        : footfall === "walked"
          ? `${fmtCrExact(m.priceCredits)} — list price; this body has been walked`
          : `${fmtCrExact(m.priceCredits)} list; ${fmtCrExact(m.priceCredits * 5)} if you take first footfall here`;

  const cls = [
    "srow",
    open ? "srow--open" : "",
    prog ? `srow--${prog.cls}` : "",
    m.unlikely ? "srow--unlikely" : "",
    footfall === "unwalked" ? "srow--unwalked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <button
        type="button"
        className="srow-main"
        onClick={onToggle}
        aria-expanded={open}
        style={{ ["--chance" as string]: chancePct != null ? `${chancePct}%` : "0%" }}
        title={open ? "Fold the card" : "Unfold the full card"}
      >
        <img
          className={`srow-thumb${thumbMissing || !thumbUrl ? " srow-thumb--missing" : ""}`}
          src={thumbUrl ? speciesPhotoVariant(thumbUrl, "thumb") : undefined}
          alt=""
          loading="lazy"
          onError={() => setThumbMissing(true)}
        />
        <span className="srow-name">
          {genus ? <em>{genus} </em> : null}
          {epithet}
          <span className={`srow-colour${colourUnknown ? " srow-colour--unknown" : ""}`}>
            {" "}
            - {colourUnknown ? "colour unknown" : colourRaw}
          </span>
          {m.colourMismatchPredicted ? (
            <span
              className="srow-tag srow-tag--colour-miss"
              title={`Logged ${m.confirmedColour}, predicted ${m.colourMismatchPredicted} — recorded in the miss log (edexo-outliers.jsonl).`}
            >
              ⚑
            </span>
          ) : null}
          {m.codexNew ? (
            <span className="srow-tag srow-tag--codex" title={codexMarkTitle(m)}>
              [CODEX]
            </span>
          ) : m.notInCodex ? (
            <span
              className="srow-tag srow-tag--new"
              title="No codex entry for this species in your journals yet"
            >
              new to you
            </span>
          ) : null}
          {m.entry.predictionUnsupported ? (
            <span className="srow-tag srow-tag--notpredicted" title={m.entry.predictionUnsupported.reason}>
              not predicted
            </span>
          ) : null}
          {m.unlikely ? (
            <span
              className="srow-tag srow-tag--unlikely"
              title={(m.unlikelyReasons ?? []).map((r) => r.detail).join("\n\n")}
            >
              unlikely
            </span>
          ) : null}
          {/*
            Named by the ship rather than found on foot.

            The owner asked for this to count as a confirmation — *"some plants are hard to land
            near"* — and the badge is what keeps the two apart afterwards: a comp scan settles what
            grows here and says nothing about whether you can get down to it.
          */}
          {m.loggedBy === "others" ? (
            <span
              className="srow-tag srow-tag--others"
              title="Logged on this body by other commanders (Spansh). Not from your journal."
            >
              logged by other commanders
            </span>
          ) : m.loggedBy === "you" ? (
            <span
              className="srow-tag srow-tag--you"
              title="Logged on this body in your own journal: a foot scan or the composition scanner."
            >
              logged by you
            </span>
          ) : null}
          {m.confirmedByCompositionScan ? (
            <span
              className="srow-tag srow-tag--compscan"
              title="Confirmed here by the composition scanner. Counts as a confirmation; you have not sampled it on foot."
              aria-label="Confirmed by composition scan"
            >
              comp scan
            </span>
          ) : null}
          {infoGather ? (
            <span
              className="srow-tag srow-tag--gather"
              title={`${gatherWhy}\n\nSampling this one would teach the app something.`}
              aria-label="Information gathering: the app cannot fully predict this species here"
            >
              info gather
            </span>
          ) : null}
          {/*
            How many more of his own confirmations this species wants.

            Analyse, Sample and Log all count — a species he logged once is one we can stop asking
            about — so this is usually 3, 2 or 1 and vanishes at zero. The number comes from the
            server rather than `3 - ownScans` computed here, because the target lives in a local
            config the commander can edit.
          */}
          {gatherRemaining != null && gatherRemaining > 0 ? (
            <span
              className="srow-focus"
              title={
                `${gatherRemaining} more scan${gatherRemaining === 1 ? "" : "s"} of this species would clear the mark. ` +
                `A Log counts — you do not have to finish a run.`
              }
              aria-label={`${gatherRemaining} more scans wanted for this species`}
            >
              ⌖{gatherRemaining}
            </span>
          ) : null}
        </span>
        <span className="srow-prog-slot">
          {prog ? <span className={`srow-prog srow-prog--${prog.cls}`}>{prog.text}</span> : null}
        </span>
        <span
          className="srow-metric srow-fit"
          title="Habitat fit: how closely this body resembles the bodies this species was found on"
        >
          {typeof fit === "number" && Number.isFinite(fit) ? (
            <>
              <small>fit</small>
              {Math.round(fit)}%
            </>
          ) : null}
        </span>
        <span
          className="srow-metric srow-dist"
          title="Minimum distance between the three samples for this genus"
        >
          {dist != null && dist > 0 ? (
            <>
              <small>gap</small>
              {dist} m
            </>
          ) : null}
        </span>
        <span
          className="srow-chance"
          title="Chance here: the probability this species is one of the ones actually on this body"
        >
          {chancePct != null ? `${Math.round(chancePct)}%` : "—"}
        </span>
        <span className="srow-price" title={priceTitle}>
          {m.priceCredits != null ? (
            <>
              {fmtCrShort(m.priceCredits * mult)}
              <span className={`price-tag price-tag--${footfall}`}>{priceTag}</span>
            </>
          ) : (
            "—"
          )}
        </span>
        <span className="srow-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="srow-card">
          <div className="srow-card-inner">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
