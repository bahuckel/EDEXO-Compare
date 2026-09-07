/**
 * Where a claim came from, kept separate from how strong the claim is.
 *
 * EDEXO already had one provenance axis and it is a good one: {@link EvidenceKind} —
 * `predicted < signal < genus < confirmed` — which says **how much is known** about a species on a
 * body. What it never recorded is **who said so**. Those are different questions, and collapsing
 * them into one enum is the mistake this module exists to prevent.
 *
 * ## Why one field could not work
 *
 * The three groups the owner asked to tell apart do not partition:
 *
 * | asked for | strength | origin |
 * |---|---|---|
 * | confirmed species | `confirmed` | `exomastery` **and** `journal` |
 * | possible species | `predicted` / `signal` | `spansh-dump` |
 * | my scanned species | `confirmed` | `journal` |
 *
 * The commander's own exploration is *both* a confirmed species and their own scan. One enum forces
 * a choice — either their scans stop counting as confirmed, or they stop being identifiable as
 * theirs — and both answers are wrong. With strength and origin as separate fields the three groups
 * stop being categories at all and become queries, which is what they always were.
 *
 * ## The distinction that is easy to get wrong
 *
 * A row in the corpus is really two claims from two sources:
 *
 *  - **{@link ClaimOrigin}** — who says this species grows on this body.
 *  - **{@link BodyDataOrigin}** — who supplied that body's gravity, temperature and atmosphere.
 *
 * They are usually different. The bulk of the corpus is an Exomastery CSV saying "Bacterium Aurasus
 * is on this body", hydrated with physical numbers fetched from EDSM. Reading `edsm_id IS NOT NULL`
 * as "EDSM told us about this species" would attribute 79.5 % of all sightings to EDSM, which is
 * false — EDSM's bodies endpoint returns no biological signals at all, as this session measured
 * across 1,444 planet records. Hydration source is not claim source.
 *
 * That is also why only one of the two can be backfilled. Body-data origin is recoverable from the
 * columns already present; claim origin is not, and a row imported before this existed says
 * `unknown` rather than a guess.
 */

/** Ordered as the ingest paths appear in the pipeline, not by trust. */
export const CLAIM_ORIGINS = ["exomastery", "spansh-dump", "journal", "edsm", "eddn", "unknown"] as const;
export type ClaimOrigin = (typeof CLAIM_ORIGINS)[number];

export const BODY_DATA_ORIGINS = ["edsm", "spansh", "journal", "unknown"] as const;
export type BodyDataOrigin = (typeof BODY_DATA_ORIGINS)[number];

/** How each origin reads to a commander. Kept here so the UI and the CLI cannot drift apart. */
export const CLAIM_ORIGIN_LABEL: Record<ClaimOrigin, string> = {
  exomastery: "Spansh Exomastery",
  "spansh-dump": "Spansh galaxy dump",
  journal: "Your journal",
  edsm: "EDSM",
  eddn: "EDDN",
  unknown: "Unrecorded",
};

export const CLAIM_ORIGIN_HELP: Record<ClaimOrigin, string> = {
  exomastery:
    "A Spansh Exomastery export: another commander scanned this species here and it reached Spansh. Confirmed, but not by you.",
  "spansh-dump":
    "A Spansh galaxy dump or route export. The body is real and carries a biological signal; which species is there may be a prediction rather than an identification.",
  journal: "Your own journal. You scanned this yourself — the only evidence in the corpus that is first-hand.",
  edsm: "EDSM's API. Used to fill in a body's physical data; EDSM does not publish biological signals, so it is rarely a claim source.",
  eddn: "The live EDDN stream — another commander's scan, seen as it was uploaded.",
  unknown: "Imported before origin was recorded. Not a guess: the corpus genuinely does not know.",
};

/** True for a claim the commander made themselves, which is the only first-hand evidence there is. */
export function isFirstHand(o: ClaimOrigin | null | undefined): boolean {
  return o === "journal";
}

/**
 * True for an origin that names a species because somebody saw it, rather than inferring one.
 *
 * `spansh-dump` is deliberately excluded. A dump row proves a **biological signal** on a body and
 * often names a genus, but the species attached to it may be this app's own prediction — counting
 * that as an observation would let a prediction be re-read later as evidence for itself.
 */
export function isObservedClaim(o: ClaimOrigin | null | undefined): boolean {
  return o === "exomastery" || o === "journal" || o === "eddn";
}

/** Narrow an arbitrary string to the vocabulary, falling back to `unknown` rather than inventing one. */
export function asClaimOrigin(v: unknown): ClaimOrigin {
  return (CLAIM_ORIGINS as readonly string[]).includes(v as string) ? (v as ClaimOrigin) : "unknown";
}

export function asBodyDataOrigin(v: unknown): BodyDataOrigin {
  return (BODY_DATA_ORIGINS as readonly string[]).includes(v as string)
    ? (v as BodyDataOrigin)
    : "unknown";
}

/**
 * Whether a row may be published to a public repository.
 *
 * The one rule with a consequence outside the app. `data/exomastery/sector-systems.json` is tracked
 * in git and is built from the corpus, which blends public Spansh and EDSM data with the owner's own
 * exploration. Without an origin field nothing can tell those apart, so nothing can be scrubbed —
 * you cannot remove what you cannot identify.
 *
 * A journal claim is the commander's own flight history: which systems they visited, when, and what
 * they scanned. That is theirs to publish, not the build's to publish for them, so it is excluded by
 * default and an export has to opt in explicitly.
 */
export function isPublishableClaim(o: ClaimOrigin | null | undefined): boolean {
  return o !== "journal";
}
