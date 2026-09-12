/**
 * Small blocks the species card and the options modal share (7.3).
 */
import type { FootScanMatchPayload, MatchReason, OtherMatchDetailCardDTO, SpeciesProvenance } from "@shared/types";

export function FootScanHitBlock({ hit }: { hit: FootScanMatchPayload["hits"][number] }) {
  const src = hit.confirmationSource === "analyse" ? "FOOT CATALOG — Analyse" : "FOOT CATALOG — Sample";
  return (
    <div className="foot-scan-hit-block">
      <div className="foot-scan-hit-header">
        <span className="foot-scan-body-name">{hit.bodyName}</span>
        <span className="foot-scan-hit-meta dim tiny">
          {hit.starSystem || "—"} · {hit.recordedAt.slice(0, 19).replace("T", " ")}
        </span>
        <span className="foot-scan-hit-source">{src}</span>
      </div>
      <div className="foot-scan-field-grid">
        {hit.fieldRows.map((row) => {
          const optionalMismatch = !row.matches && !row.speciesCriteriaIncludes;
          const criteriaMismatch = !row.matches && row.speciesCriteriaIncludes;
          const sectionClass =
            "foot-scan-section" +
            (row.matches ? " foot-scan-section--ok" : "") +
            (optionalMismatch ? " foot-scan-section--optional-mismatch" : "") +
            (criteriaMismatch ? " foot-scan-section--criteria-mismatch" : "");
          return (
            <div key={row.key} className={sectionClass}>
              <div className="foot-scan-section-label">{row.label}</div>
              <div className="foot-scan-section-pair">
                <div className="foot-scan-section-col">
                  <span className="foot-scan-section-tag">This body</span>
                  <span className="foot-scan-section-val">{row.currentDisplay}</span>
                </div>
                <div className="foot-scan-section-col">
                  <span className="foot-scan-section-tag">Catalog</span>
                  <span className="foot-scan-section-val">{row.catalogDisplay}</span>
                </div>
              </div>
              {!row.matches && row.speciesCriteriaIncludes ? (
                <p className="foot-scan-section-note tiny foot-scan-section-note--warn">
                  Mismatch on a field listed in <code>data/species/…</code> criteria — verify manually.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Spectral classes for codex morph colours — O→M “main sequence” order for the mini rail. */
const MORPH_SPECTRAL_ORDER = ["O", "B", "A", "F", "G", "K", "M", "TTS", "L", "Y", "T"] as const;

export function sortMorphSpectralKeys(listCsv: string): string[] {
  const keys = [
    ...new Set(
      listCsv
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const rank = (k: string) => {
    const i = MORPH_SPECTRAL_ORDER.indexOf(k as (typeof MORPH_SPECTRAL_ORDER)[number]);
    if (i >= 0) return i;
    const one = k.length
      ? MORPH_SPECTRAL_ORDER.indexOf(k.charAt(0) as (typeof MORPH_SPECTRAL_ORDER)[number])
      : -1;
    if (one >= 0) return one + 0.15;
    return 40 + (k.charCodeAt(0) % 40);
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

export function hostHitsMorphSpectralChip(hostSummary: string, chip: string): boolean {
  const h = hostSummary.trim().toUpperCase();
  const c = chip.toUpperCase();
  if (!h || h === "—") return false;
  if (c === "TTS") return h.includes("TTS");
  if (h === c) return true;
  if (c.length === 1 && h.startsWith(c)) return true;
  return c.length > 1 && h.startsWith(c.slice(0, Math.min(c.length, h.length)));
}

export function morphSpectralChipHeatClass(chip: string): string {
  const c = chip.toUpperCase();
  if (c === "O" || c === "B") return "species-spectral-chip--oob";
  if (c === "A" || c === "F") return "species-spectral-chip--af";
  if (c === "G" || c === "K") return "species-spectral-chip--gk";
  if (c === "M" || c === "L" || c === "T" || c === "Y") return "species-spectral-chip--cool";
  return "species-spectral-chip--x";
}

/**
 * What a percentage rests on, when it rests on very little.
 *
 * §15.2, in the owner's framing: a low sample count is rarity, not unreliability. Fonticulua fluctus
 * has been recorded on one body — that is the best estimate of where it grows, and for a codex hunter
 * it is the opposite of a warning. Under ten bodies the note says so plainly and adds what §16.1
 * asked the app to state — that the body clears the species' codex requirements, which is true of
 * every row the panel shows and is why a one-body species is listed at all:
 *
 *   "Found Fonticulua fluctus, low sample size (1), but planet matches species parameters."
 *
 * Between ten and fifty it says only that the numbers rest on a thin sample. It does **not** claim
 * the codex range is doing work inside the score: §16.1's envelope was built, measured and removed —
 * blending the codex range into the likelihood moved the ranking by nothing (mean rank 3.284 →
 * 3.291, top-1 and top-3 identical), because Laplace smoothing over sixteen shared bins already
 * gives a one-body species a spread rather than a spike.
 *
 * Only on rows the panel is actually showing. A demoted row disagreed with a gate, so telling the
 * reader it clears its requirements there would be false.
 */
const THIN_SAMPLE_BELOW = 50;

const RARE_SAMPLE_BELOW = 10;

export function ThinSampleNote({ sampleN, unlikely }: { sampleN: number | null | undefined; unlikely: boolean }) {
  if (unlikely) return null;
  if (sampleN == null || !Number.isFinite(sampleN) || sampleN <= 0) return null;
  if (sampleN >= THIN_SAMPLE_BELOW) return null;

  const rare = sampleN < RARE_SAMPLE_BELOW;
  const bodies = `${sampleN} ${sampleN === 1 ? "body" : "bodies"}`;
  return (
    <div
      className={`species-thin-sample${rare ? " species-thin-sample--rare" : ""}`}
      title={
        `Every percentage on this row comes from a profile built on ${bodies}. ` +
        "That is what the feeder corpus holds for this species — a rare find, not a doubtful one. " +
        "The body still clears this species' codex requirements, which is why it is listed here at all."
      }
    >
      {rare ? "Rarely found — " : ""}seen on {bodies}
      {rare ? ", and this body clears its codex requirements" : " — these percentages rest on a thin sample"}
    </div>
  );
}

export function OtherMatchDetailCardsGrid({ cards }: { cards: OtherMatchDetailCardDTO[] }) {
  return (
    <div className="species-other-match-cards-grid species-other-match-cards-grid--in-shell species-other-match-cards-grid--balanced">
      {cards.map((c) => {
        const tier = c.highlight ?? "neutral";
        return (
          <div
            key={c.id}
            className={`species-other-match-mini exo-neon-duplex--tier-${tier}`}
            title={c.tooltip}
          >
            <span className="species-other-match-mini-title">{c.shortTitle}</span>
            <div className="species-other-match-mini-line">
              <span className="species-other-match-mini-legend">{c.topLegend}</span>
              <span>{c.topValue || "—"}</span>
            </div>
            <div className="species-other-match-mini-line">
              <span className="species-other-match-mini-legend">{c.bottomLegend}</span>
              <span>{c.bottomValue || "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Stable empty list, so a card with nothing demoting it does not churn a new array each render. */
export const EMPTY_REASONS: MatchReason[] = [];

/**
 * Who says this species is here, said in the fewest words that stay true.
 *
 * Three states, and the difference between the last two is the whole reason provenance exists:
 *
 *  - **you scanned it** — your journal names this exact body. First-hand, and the only evidence in
 *    the app that is.
 *  - **in system (n)** — the shipped corpus confirms it somewhere in this system. It cannot say
 *    which body, because the corpus ships as per-system aggregates, so the badge does not pretend
 *    to. On a system with nine landable bodies "confirmed here" would be eight lies.
 *  - **nothing** — no badge. Not an assertion of absence: the corpus only covers where commanders
 *    have flown, and most of the galaxy is unvisited rather than barren.
 *
 * A row can be both: your own scan and a corpus record are different claims, and the first-hand one
 * is shown because it is the stronger.
 */
export function SpeciesProvenanceBadge({ p }: { p?: SpeciesProvenance }) {
  if (!p) return null;
  if (p.firstHand) {
    const when = p.firstHandAt ? new Date(p.firstHandAt).toLocaleDateString() : null;
    return (
      <span
        className="species-prov species-prov--mine"
        title={`Your own journal records this species on this body${when ? ` on ${when}` : ""}. First-hand evidence — nothing else in the app is.`}
      >
        you scanned it
      </span>
    );
  }
  if (p.corpusInSystem > 0) {
    return (
      <span
        className="species-prov species-prov--corpus"
        title={`Spansh's exobiology data confirms this species on ${p.corpusInSystem} ${p.corpusInSystem === 1 ? "body" : "bodies"} in this system — another commander scanned it here. The shipped data records the system, not which body, so this does not say it is on this one.`}
      >
        in system{p.corpusInSystem > 1 ? ` (${p.corpusInSystem})` : ""}
      </span>
    );
  }
  return null;
}
