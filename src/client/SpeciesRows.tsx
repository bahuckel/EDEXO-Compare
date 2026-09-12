import { useState, type ReactNode } from "react";
import type { BodyComputed, PlanetScan } from "@shared/types";
import { settledMultiplier } from "@shared/footfallValue";
import { candidateMorphColorShortLabel, candidateMorphColorShortLabelForHosts } from "@shared/candidateSpawnHints";
import { fmtCrExact, fmtCrShort } from "./credits";
import { useFootfallCertainty } from "./footfallContext";
import { useRowContext, type LiveRun, type RowContextValue } from "./rowContext";
import { speciesPhotoVariant } from "./speciesPhotoVariant";
import { titleCaseSpeciesWords } from "./speciesMatchHelpers";

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
    genus && full.toLowerCase().startsWith(genus.toLowerCase() + " ") ? full.slice(genus.length + 1).trim() : full;
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
  const colourRaw = hostStarType
    ? candidateMorphColorShortLabel(m.entry, hostStarType, scan?.materials)
    : candidateMorphColorShortLabelForHosts(m.entry, hostStarTypes, scan?.materials);
  const colourUnknown = !colourRaw || colourRaw === "(unknown)";
  const chance = m.presenceProbabilityPercent;
  const chancePct = typeof chance === "number" && Number.isFinite(chance) ? Math.max(0, Math.min(100, chance)) : null;
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
          className={`srow-thumb${thumbMissing || !m.photoUrl ? " srow-thumb--missing" : ""}`}
          src={m.photoUrl ? speciesPhotoVariant(m.photoUrl, "thumb") : undefined}
          alt=""
          loading="lazy"
          onError={() => setThumbMissing(true)}
        />
        <span className="srow-name">
          {genus ? <em>{genus} </em> : null}
          {epithet}
          <span className={`srow-colour${colourUnknown ? " srow-colour--unknown" : ""}`}> - {colourUnknown ? "colour unknown" : colourRaw}</span>
          {m.notInCodex ? (
            <span className="srow-tag srow-tag--new" title="No codex entry for this species in your journals yet">
              new to you
            </span>
          ) : null}
          {m.entry.predictionUnsupported ? (
            <span className="srow-tag srow-tag--notpredicted" title={m.entry.predictionUnsupported.reason}>
              not predicted
            </span>
          ) : null}
          {m.unlikely ? (
            <span className="srow-tag srow-tag--unlikely" title={(m.unlikelyReasons ?? []).map((r) => r.detail).join("\n\n")}>
              unlikely
            </span>
          ) : null}
        </span>
        <span className="srow-prog-slot">
          {prog ? <span className={`srow-prog srow-prog--${prog.cls}`}>{prog.text}</span> : null}
        </span>
        <span className="srow-metric srow-fit" title="Habitat fit: how closely this body resembles the bodies this species was found on">
          {typeof fit === "number" && Number.isFinite(fit) ? (
            <>
              <small>fit</small>
              {Math.round(fit)}%
            </>
          ) : null}
        </span>
        <span className="srow-metric srow-dist" title="Minimum distance between the three samples for this genus">
          {dist != null && dist > 0 ? (
            <>
              <small>gap</small>
              {dist} m
            </>
          ) : null}
        </span>
        <span className="srow-chance" title="Chance here: the probability this species is one of the ones actually on this body">
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
