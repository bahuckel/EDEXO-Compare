/**
 * After the matcher: each candidate's presence probability, and the floors that push the long shots behind 'show unlikely'. Split out of snapshot.ts (code review D, 2026-09-27).
 */
import { genusShares } from "../shared/systemTriage.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalHostStarObservation,
  PlanetScan,
  SpeciesDatabase,
  SpeciesMatch,
} from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { collectOwnOrganicLockSpeciesIds } from "./organicLocks.js";
import { regionIndexForSystem } from "./regionMapData.js";
import { REGION_PRIOR_WEIGHT, rankSpeciesOnBody } from "./speciesLikelihood.js";

/* The region-prior weight now lives with the other model constants; see REGION_PRIOR_WEIGHT. */

/**
 * klightspeed region index for the body's own system, or null when its position is not known.
 *
 * The body's system, not the focused one: the panel can be showing a body the commander has
 * flown away from, and scoring it against wherever they happen to be standing would be worse
 * than not scoring it at all.
 */
function regionIndexForBody(store: GameStateStore, b: BodyExoState, projectRoot: string): number | null {
  const pos = store.systemPositions.get(b.systemAddress);
  if (!pos) return null;
  const index = regionIndexForSystem(projectRoot, pos.x, pos.z);
  return index != null && index > 0 ? index : null;
}

/**
 * Measured presence rates for species the ranking model has no profile for, so the floor can judge
 * them too instead of treating them as "unmeasured" forever.
 *
 * Crystalline Shards (2026-09-28): over the Spansh dump, of the bio bodies meeting every Shards rule
 * (class, 20-273 K, airless or its thin atmospheres, ≥ 12,000 Ls from arrival, a companion body, no
 * O/B/remnant host), Shards is on 4,426 of 134,646 one-signal bodies (3.3 %) and 255 of 203,234 with
 * more signals (0.13 %). Under the 5 % floor either way: before a DSS it waits behind "show unlikely",
 * and once a DSS names the genus it is shown like any confirmed genus.
 */
const FIXED_PRESENCE_PCT: Record<string, { oneSignal: number; more: number }> = {
  crystalline_shards_crystalline_shards: { oneSignal: 3.3, more: 0.13 },
};

/**
 * The ranking model's answer, written onto the matches.
 *
 * `rankSpeciesOnBody` normalises across the candidates, which answers "which one species is this".
 * The game places one genus per biological signal, so a candidate's chance of being *present* is
 * that share times the count — the same constraint step 7 applies at genus level, and the reason the
 * number calibrates. Without a signal count the share is left as it is, which under-reads on a
 * multi-signal body and is the honest thing to do when the game has not said how many are down there.
 *
 * Only the shown tier is ranked. A demoted row disagreed with a gate, and normalising it alongside
 * the others would hand it a share of a probability the panel does not offer it.
 */
export function attachPresenceProbability(
  matches: SpeciesMatch[],
  b: BodyExoState,
  scan: PlanetScan | null,
  rec: ExplorationScanRecord | null,
  journalHost: JournalHostStarObservation | null,
  root: string,
  store: GameStateStore,
): void {
  if (!scan) return;
  const shown = matches.filter((m) => !m.unlikely);
  if (shown.length === 0) return;
  for (const m of shown) {
    const fixed = FIXED_PRESENCE_PCT[m.entry.id];
    if (fixed) m.presenceProbabilityPercent = (b.biologicalSignals ?? 1) > 1 ? fixed.more : fixed.oneSignal;
  }
  const { ranked } = rankSpeciesOnBody(shown, scan, rec, journalHost, {
    root,
    regionPrior: true,
    regionIndex: regionIndexForBody(store, b, root),
    regionPriorWeight: REGION_PRIOR_WEIGHT,
  });
  if (ranked.length === 0) return;

  const signals = b.biologicalSignals;
  const scale = signals != null && Number.isFinite(signals) && signals > 0 ? signals : 1;
  /*
    A soft band's factor (presenceFactor) weighs the row *before* the posterior is shared out, so a row
    kept at x0.02 does not take its full share of the body's probability from the others first: the
    Fumerola extremus on a lone-signal body fell from 3.3 % to 0.6 % behind rows kept that way
    (2026-10-03). The weights are renormalised to the same total.
  */
  const total = ranked.reduce((a, r) => a + r.probability, 0);
  const weighted = ranked.reduce((a, r) => a + r.probability * (r.match.presenceFactor ?? 1), 0);
  const norm = weighted > 0 ? total / weighted : 1;
  for (const r of ranked) {
    const p = Math.max(0, Math.min(1, r.probability * (r.match.presenceFactor ?? 1) * norm * scale));
    r.match.presenceProbabilityPercent = Math.round(p * 1000) / 10;
  }

  /**
   * The same posterior, normalised inside each genus instead of across the body (B3).
   *
   * After a DSS the game has named the genera, so "is Bacterium here" is settled and the only open
   * question is which Bacterium. That is this number, and it is worth computing before the DSS too —
   * it is what the answer becomes the moment the genus is confirmed.
   */
  // A soft band's factor (Bark Mounds' nebula ring, Clypeus speculumi's orbit) is part of the answer
  // to "which one of the genus" too, or a row kept at ×0.07 would take its full share after a DSS.
  const rows = ranked.map((r) => ({
    genus: r.match.entry.genusDataDir,
    probability: r.probability * (r.match.presenceFactor ?? 1),
    r,
  }));
  const shares = genusShares(rows);
  for (const row of rows) {
    const share = shares.get(row);
    row.r.match.genusSharePercent = share == null ? null : Math.round(share * 1000) / 10;
  }
}

/**
 * How likely a candidate has to be before the panel offers it as a candidate.
 *
 * One per cent (owner, 2026-10-03: "I didn't mean that we should exclude legitimate results to meet
 * that quota, give 3 results if needed ... without any misses"). It was five, the commander's line
 * for a trace gas, and on Hypi Fraae RF-Q b21-2 B 4 — icy, thin neon, 20 K, Minor Methane Magma —
 * it hid Bacterium tela at 2.6 % on a body type where tela is a third of the confirmed finds (1,534
 * bodies: scopulum 33.8, tela 33.3, acies 32.9 %). The model's chance there is wrong; the floor is what
 * turned a wrong number into a miss.
 *
 * Measured over 1,500 random confirmed Bacterium bodies and 2,960 bodies of every genus (one per
 * species per region; docs/perf/share-floor-probe.mts, share_floor_eval.py): at 5 % the floors alone
 * hid the right species on 11 and 25 of them, every Bacterium one a tela; at 1 % on 2 and 4, for
 * one wrong row more (almost always tela) on 1.4 % and 2.5 % of the bodies.
 */
export const PRESENCE_FLOOR_PCT = 1;

/**
 * Push the long shots behind "show unlikely".
 *
 * Reported from the field twice: an icy moon offering Fonticulua upupam at 2.6 % and a Fungoida at
 * 1.5 %, on a body where other candidates were well clear of the floor. Nothing was wrong with the
 * numbers — the panel was simply showing rows its own model had already judged.
 *
 * Three things it will not do:
 *
 *  - **Empty the list.** If nothing at all clears the floor, the single best row stays. A body where
 *    the answer is spread that thin still deserves a best guess, and an empty panel over a body the
 *    game says has life on it reads as a broken app rather than as an honest shrug.
 *
 *    Deliberately *one* row and not one per biological signal. Two signals mean two genera are down
 *    there, so keeping the runner-up looks defensible — but it puts a row the model scored at 4.7 %
 *    on the same list as one it scored at 100 %, which is the thing being complained about. The
 *    second genus is not unknown, it is unnamed, and the ambiguity note already says so.
 *  - **Touch an unmeasured row.** `presenceProbabilityPercent` is null when the model has no opinion
 *    — no profile, too few observed bodies. Null is "unmeasured", never "unlikely".
 *  - **Argue with the commander's own boots.** A species he has sampled on this body stays, whatever
 *    the model thinks of it.
 */
export function demoteBelowPresenceFloor(
  matches: SpeciesMatch[],
  b: BodyExoState,
  db: SpeciesDatabase,
): void {
  const confirmed = new Set(collectOwnOrganicLockSpeciesIds(b.organicGenusLocks, db));

  // Probes have named the genera, so "is Bacterium here" is settled and the presence floor has
  // nothing left to judge. "Which Bacterium" is wide open, and that is a different floor.
  if (b.genusHints?.length) {
    demoteBelowGenusShareFloor(matches, confirmed);
    return;
  }

  const shown = matches.filter((m) => !m.unlikely);
  if (shown.length === 0) return;

  const keepAtLeast = 1;
  // Highest chance first, so the one row that survives an all-below-floor body is the best of them.
  // An unmeasured row sorts with the survivors rather than the casualties: it is not a weak claim,
  // it is no claim.
  const order = [...shown].sort(
    (x, y) => (y.presenceProbabilityPercent ?? Infinity) - (x.presenceProbabilityPercent ?? Infinity),
  );

  let kept = 0;
  for (const m of order) {
    const pct = m.presenceProbabilityPercent;
    const immune =
      pct == null ||
      !Number.isFinite(pct) ||
      m.organicAnalysisComplete === true ||
      m.approximateMatch === true ||
      confirmed.has(m.entry.id);
    if (immune || pct >= PRESENCE_FLOOR_PCT || kept < keepAtLeast) {
      kept++;
      continue;
    }
    m.unlikely = true;
    m.unlikelyReasons = [
      ...(m.unlikelyReasons ?? []),
      {
        field: "Chance here",
        detail: `${pct.toFixed(1)} % — under the ${PRESENCE_FLOOR_PCT} % this panel shows. Listed as a low-probability find rather than excluded.`,
      },
    ];
  }
}

/**
 * How large a share of its own genus a candidate needs after a DSS.
 *
 * The same one per cent as {@link PRESENCE_FLOOR_PCT} (owner, 2026-10-03, no misses). At five it hid
 * Bacterium tela at 4.9 % on Hypi Fraae RF-Q b21-2 B 4, where it grew; over 1,500 random confirmed
 * Bacterium bodies it hid the right species on 7, all tela, and at one per cent on none, for a wrong
 * extra row (tela 15 times, cerbrus twice) on 1.1 % of the bodies. Earlier, on the commander's 609
 * confirmed species: 5 % hid two (Bacterium omentum 0.81 %, Osseus discus 4.78 %).
 */
export const GENUS_SHARE_FLOOR_PCT = 1;

/**
 * The same idea as the presence floor, for the list after a DSS.
 *
 * Reported from the field: *"I shouldn't be getting Tela as a suggestion for every single body with
 * 1 bio signal."* He was right, and the cause was this function returning early on any probed body.
 * The early return reasoned that the probes had named the genera so nothing left was a guess — true
 * of the **genus** and not of the **species**, and the panel lists species. On his own cache
 * Bacterium tela sat on 546 of 574 probed bodies (95.1 %) at a median share of its own genus of
 * **1.9 %**, while the never-probed bodies, where the floor did run, showed it on 13.7 %. One early
 * return, one species on almost every body he had actually flown to.
 *
 * `genusSharePercent` is the right number here and `presenceProbabilityPercent` is not: after a DSS
 * the genus is settled, so a species' chance of being the one down there is its share within that
 * genus. On the two bodies where tela really did grow, that share was 39.4 % and 98.0 % — the floor
 * never came near them.
 *
 * The three exemptions of the presence floor hold here for the same reasons: never empty a genus
 * (the best row in each hinted genus stays, whatever its share), never touch an unmeasured row, and
 * never argue with the commander's own boots.
 */
function demoteBelowGenusShareFloor(matches: SpeciesMatch[], confirmed: Set<string>): void {
  const shown = matches.filter((m) => !m.unlikely);
  if (shown.length === 0) return;

  const byGenus = new Map<string, SpeciesMatch[]>();
  for (const m of shown) {
    const genus = m.entry.genusDataDir;
    byGenus.set(genus, [...(byGenus.get(genus) ?? []), m]);
  }

  for (const rows of byGenus.values()) {
    // Best share first, so the row that survives a genus where nothing clears is the best of them.
    // Unmeasured sorts with the survivors: it is not a weak claim, it is no claim.
    const order = [...rows].sort(
      (x, y) => (y.genusSharePercent ?? Infinity) - (x.genusSharePercent ?? Infinity),
    );
    let kept = 0;
    for (const m of order) {
      const pct = m.genusSharePercent;
      const immune =
        pct == null ||
        !Number.isFinite(pct) ||
        m.organicAnalysisComplete === true ||
        m.approximateMatch === true ||
        confirmed.has(m.entry.id);
      if (immune || pct >= GENUS_SHARE_FLOOR_PCT || kept < 1) {
        kept++;
        continue;
      }
      m.unlikely = true;
      m.unlikelyReasons = [
        ...(m.unlikelyReasons ?? []),
        {
          field: "Share of its genus",
          detail:
            `${pct.toFixed(1)} % of ${m.entry.genus || m.entry.genusDataDir} here — under the ` +
            `${GENUS_SHARE_FLOOR_PCT} % this panel shows once the genus is confirmed. Listed as a ` +
            `low-probability find rather than excluded.`,
        },
      ];
    }
  }
}

/**
 * A species the commander has sampled on this body belongs in the list, banner and all.
 *
 * The owner, on Bacterium omentum at `Synookooe WW-F b55-0 A 2 a`: *"keep the [unlikely] banner
 * after the name. But do not continue to hide it in the unlikely list if the user scans it, it
 * should go into candidate species with the [unlikely] banner."*
 *
 * He is right, and the reason is that the two facts are not in competition. "Unlikely" is the app's
 * opinion about a body it has never stood on; a sample is the commander's own boots. Collapsing the
 * row behind "show unlikely (N)" after he has proved it is there makes the panel argue with him —
 * and the species he has to hunt for hardest is exactly the one worth not hiding.
 *
 * So the demotion is **kept**: `unlikely` stays true, `unlikelyReasons` stays, and the banner still
 * says which gate it failed. Only where the row is *filed* changes. That is deliberate — the reason
 * it was demoted is usually the interesting part. Omentum's codex row lists Neon and this body is
 * Methane, which the corpus says happens in 1 of 22 observed bodies; the banner is how he finds out
 * the codex is narrow rather than the app being broken.
 *
 * Runs after every demotion pass, because it is about the final verdict rather than any one gate.
 * `exoDataConsistencyAlerts` still reports the mismatch: the row being visible does not make the
 * codex list right.
 */
export function markSampledDespiteUnlikely(matches: SpeciesMatch[], b: BodyExoState, db: SpeciesDatabase): void {
  const sampled = new Set(collectOwnOrganicLockSpeciesIds(b.organicGenusLocks, db));
  if (sampled.size === 0) return;
  for (const m of matches) {
    // A Log already resolves the species, so `organicAnalysisComplete` is too strict a test here:
    // one sample is proof the plant is on the body, whatever the remaining two would add.
    if (m.unlikely && (sampled.has(m.entry.id) || m.organicAnalysisComplete === true)) {
      m.sampledHere = true;
    }
  }
}
