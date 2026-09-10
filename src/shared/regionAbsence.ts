/**
 * Whether a species is worth offering *here*, from how often it has been recorded in this region.
 *
 * ## The gap this fills
 *
 * Conditions say what could grow; they cannot separate two species that share a codex row and live
 * half a galaxy apart. On Blu Thua EM-D d12-25 A 1 a the conditions admitted twenty species for nine
 * signals, and against every loser the owner wrote the same two words: *region check*. He was right
 * about all of them. In Inner Orion Spur, of 560,598 systems with recorded biology:
 *
 *   Tussock caputus      22,026   3.93 %   ← found
 *   Tussock propagito        61   0.01 %
 *   Tussock pennatis          5   0.00 %
 *   Frutexa acus         42,160   7.52 %   ← found
 *   Frutexa fera              3   0.00 %
 *   Osseus fractus       17,353   3.10 %   ← found
 *   Osseus cornibus           5   0.00 %
 *
 * Three orders of magnitude, on a question temperature and gravity cannot answer at all.
 *
 * ## Where the numbers come from
 *
 * `data/exomastery/region-species.json` — counts per region, rolled up from the galaxy bio index.
 * The rule is deliberately a *presence* test rather than a ranking: a share is a claim about how
 * common something is, which the corpus is not evenly sampled enough to support, while "this has
 * essentially never been recorded here" survives uneven sampling.
 *
 * ## The two numbers, and why they were measured rather than chosen
 *
 * The cut sits between the rarest species the owner has actually found and the most common species
 * the region test wants to reject, and both ends were measured against his own 313 placeable finds:
 *
 *   0.0451 %   Fonticulua fluctus in Inner Orion Spur — the rarest thing he has genuinely scanned
 *   0.0109 %   Tussock propagito there — the most common of the losers on Blu Thua
 *
 * {@link REGION_ABSENCE_MAX_SHARE} is 0.02 %, in the gap, four times below the first and twice above
 * the second. At that cut **none of his 313 finds** would have been demoted.
 *
 * {@link REGION_ABSENCE_MIN_EXPECTED} is the guard that stops the rule speaking where it knows
 * nothing. Aquila's Halo has 1,629 recorded bio systems, where the cut works out at a third of a
 * system — seeing zero there means nothing at all. Requiring five expected records before the rule
 * may fire leaves the 13 regions holding 81.5 % of all recorded biology, and the rest say "unknown",
 * which is the truth about them.
 *
 * ## Soft, always
 *
 * A demotion, never a rejection. Somebody has to be the first commander to record a species in a
 * region, and an app that deletes the candidate makes sure it is not this one.
 */

/** Below this share of a region's recorded bio systems, a species counts as absent from it. */
export const REGION_ABSENCE_MAX_SHARE = 0.0002;

/** A region must expect at least this many records at the cut before the rule may fire. */
export const REGION_ABSENCE_MIN_EXPECTED = 5;

/** Recorded bio systems a region needs before it can be used to judge an absence. */
export const REGION_ABSENCE_MIN_BIO_SYSTEMS = REGION_ABSENCE_MIN_EXPECTED / REGION_ABSENCE_MAX_SHARE;

export type RegionPresence = "absent" | "present" | "unknown";

export interface RegionPresenceVerdict {
  presence: RegionPresence;
  /** Systems in this region recording this species. */
  count: number;
  /** Systems in this region recording any species at all. */
  bioSystems: number;
  /** `count / bioSystems`, or 0 when the region has nothing. */
  share: number;
}

/**
 * Judge one species against one region.
 *
 * `unknown` is a real answer and the commonest one outside the well-travelled regions: it means the
 * corpus cannot support a claim either way, and the caller must treat it as neutral rather than as a
 * quiet "present".
 */
export function judgeRegionalPresence(count: number, bioSystems: number): RegionPresenceVerdict {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  const d = Number.isFinite(bioSystems) && bioSystems > 0 ? bioSystems : 0;
  const share = d > 0 ? n / d : 0;
  if (d < REGION_ABSENCE_MIN_BIO_SYSTEMS) return { presence: "unknown", count: n, bioSystems: d, share };
  return {
    presence: share < REGION_ABSENCE_MAX_SHARE ? "absent" : "present",
    count: n,
    bioSystems: d,
    share,
  };
}

/** One line a commander can check our working against. */
export function regionPresenceDetail(
  regionName: string,
  verdict: RegionPresenceVerdict,
  demoted: boolean,
): string {
  const pct = (verdict.share * 100).toFixed(verdict.share < 0.001 ? 3 : 2);
  if (verdict.presence === "absent") {
    const tail = demoted ? " Listed as a low-probability find rather than excluded." : "";
    return verdict.count === 0
      ? `Never recorded in ${regionName} — 0 of ${verdict.bioSystems.toLocaleString()} systems there with known biology.${tail}`
      : `Barely recorded in ${regionName} — ${verdict.count.toLocaleString()} of ${verdict.bioSystems.toLocaleString()} systems there with known biology (${pct} %).${tail}`;
  }
  return `${regionName}: ${verdict.count.toLocaleString()} of ${verdict.bioSystems.toLocaleString()} systems with known biology carry it (${pct} %).`;
}
