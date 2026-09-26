/**
 * Small blocks the species card and the options modal share (7.3).
 */
import type { BodyComputed } from "@shared/types";
import type {
  FootScanMatchPayload,
  MatchReason,
  OtherMatchDetailCardDTO,
  SpeciesProvenance,
} from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";

export function FootScanHitBlock({ hit }: { hit: FootScanMatchPayload["hits"][number] }) {
  const src = hit.confirmationSource === "analyse" ? "FOOT CATALOG — Analyse" : "FOOT CATALOG — Sample";
  return (
    <div className="foot-scan-hit-block">
      <div className="foot-scan-hit-header">
        <span className="foot-scan-body-name">{hit.bodyName}</span>
        <span className="foot-scan-hit-meta dim tiny">
          {hit.starSystem || "—"}
          <CopySystemButton system={hit.starSystem} /> · {hit.recordedAt.slice(0, 19).replace("T", " ")}
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

export function ThinSampleNote({
  sampleN,
  unlikely,
}: {
  sampleN: number | null | undefined;
  unlikely: boolean;
}) {
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
  if (p.sharedBy?.length) {
    const who = p.sharedBy.map((n) => (n === "a commander" ? n : `CMDR ${n}`)).join(", ");
    return (
      <span
        className="species-prov species-prov--shared"
        title={`${who} logged this species on this very body — from the shared-exomastery folder.`}
      >
        shared{p.sharedBy.length > 1 ? ` (${p.sharedBy.length})` : ""}
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

/**
 * Which species, given the genus — B3.
 *
 * The question changes the moment `SAASignalsFound` arrives: the game names the genera, so "is
 * Bacterium here" is settled and only "which Bacterium" is left. This is that answer, and it is the
 * body's posterior normalised inside the genus rather than across it.
 *
 * Measured on 447 rows where the commander sampled the genus, so exactly one candidate in each group
 * was right: rows called 90-100 % came in at 95.9 %, 70-80 % at 75.0 %, 0-10 % at 8.7 %, mean squared
 * gap 0.0026. Tighter than the across-the-body number, which makes sense — it answers a smaller
 * question.
 *
 * Nothing is shown for a single-species genus: "100 % of one" is not information.
 */
export function GenusSpeciesOdds({
  items,
  confirmed,
  inCard,
}: {
  items: BodyComputed["matches"];
  confirmed: boolean;
  /** Under a card's chance bar (owner, 2026-09-14) rather than in the genus header. */
  inCard?: boolean;
}) {
  const shortName = (full: string) => {
    const parts = full.trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : full;
  };

  const shown = items.filter((m) => !m.unlikely);

  /**
   * A genus holding a species the app cannot gate gets **no percentages at all**.
   *
   * The shares are normalised *inside the genus*, so one unevaluable member poisons every other
   * number rather than just its own: Electricae radialem needs a nebula the app cannot measure, and
   * "radialem 70 % · pluma 30 %" is therefore two wrong figures, not one. Dropping radialem and
   * showing "pluma 100 %" would be worse still — it would assert the answer is pluma when the real
   * answer is that we cannot tell.
   *
   * So the species are still named, because knowing which ones the genus contains is useful, and the
   * numbers are withheld. Same discipline as `predictionUnsupported` on the card itself (§7.11), and
   * as §18's rule against a percentage with nothing behind it.
   */
  const ungateable = shown.filter((m) => m.entry.predictionUnsupported || m.spatialGateUnresolved);

  const scored = shown
    .map((m) => ({ name: m.entry.displayName, share: m.genusSharePercent }))
    .filter(
      (x): x is { name: string; share: number } => typeof x.share === "number" && Number.isFinite(x.share),
    )
    .sort((a, b) => b.share - a.share);
  if (scored.length < 2) return null;

  if (ungateable.length > 0) {
    /**
     * Phase 7 gave three genera a gate they can actually be judged by, which removed their
     * `predictionUnsupported` flag — and that flag was what this suppression keyed on. The gate can
     * still come back unevaluable: viewing a system remotely, or before the first `StarPos` is read,
     * there is no coordinate to measure from. Then the species is exactly as ungateable as it was
     * before Phase 7, and the split must be withheld for the same reason it always was.
     */
    const first = ungateable[0]!;
    const reason =
      first.entry.predictionUnsupported?.reason ??
      "its spawn depends on where the system is, and we have no coordinates for this one";
    return (
      <p
        className={`genus-species-odds genus-species-odds--ungateable${inCard ? " genus-species-odds--card" : ""}`}
        title={`These shares are normalised inside the genus, so a species the app cannot gate makes every other share wrong too — not only its own. ${reason}.`}
      >
        <span className="genus-species-odds-lead">
          {confirmed ? "DSS confirmed — one of:" : "If this genus is here, one of:"}
        </span>{" "}
        {scored.map((x, i) => (
          <span key={x.name} className="genus-species-odds-item">
            {i > 0 ? " · " : ""}
            {shortName(x.name)}
          </span>
        ))}{" "}
        <span className="genus-species-odds-why">
          — no split: {ungateable.map((m) => shortName(m.entry.displayName)).join(", ")}{" "}
          {ungateable.length === 1 ? "depends" : "depend"} on something a scan cannot answer
        </span>
      </p>
    );
  }

  return (
    <p
      className={`genus-species-odds${confirmed ? " genus-species-odds--confirmed" : ""}${inCard ? " genus-species-odds--card" : ""}`}
      title={
        confirmed
          ? "The DSS has named this genus, so it is on the body. These are the odds on which species it is — the ranking model's posterior, normalised inside the genus."
          : "If this genus is on the body, these are the odds on which of its species it is. Before a DSS the genus itself is not certain; see the chance on each card for that."
      }
    >
      <span className="genus-species-odds-lead">
        {confirmed ? "DSS confirmed — which species:" : "If this genus is here:"}
      </span>{" "}
      {scored.map((x, i) => (
        <span key={x.name} className="genus-species-odds-item">
          {i > 0 ? " · " : ""}
          {shortName(x.name)} <strong>{Math.round(x.share)}%</strong>
        </span>
      ))}
    </p>
  );
}
