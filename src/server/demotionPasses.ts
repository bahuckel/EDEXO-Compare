/**
 * The passes that run after the per-species criteria: gates judged on the system or the region (spatial, host star, companion bodies, atmosphere preference, starlight, regional siblings), each demoting rather than deleting, and the restores that undo a demotion the game's own signal count contradicts. Split out of matchSpecies.ts (code review D, 2026-09-27).
 */
import {
  describeHostStarVerdict,
  evaluateHostStarGate,
  hostStarGateForSpeciesId,
} from "../shared/hostStarGates.js";
import {
  REGION_SIBLING_DEPLETION,
  REGION_SIBLING_DEPLETION_MAX_SHARE,
  regionGenusShareDetail,
  regionSiblingDepletionDetail,
} from "../shared/regionAbsence.js";
import {
  SpatialCatalogue,
  describeVerdict,
  evaluateSpatialGate,
  gateForSpeciesId,
} from "../shared/spatialGates.js";
import { describeSystemBodyVerdict, evaluateSystemBodyGate } from "../shared/systemBodyGates.js";
import { atmosphereAllowlistMeansAnyThinCompositionOnly } from "../shared/scanAtmosphereMatch.js";
import type { MatchReason, SpeciesEntry, SpeciesMatch, SpeciesMatchContext } from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import { regionalGenusEnrichment, regionalGenusShare } from "./regionSpeciesData.js";
import { speciesHostStarObservations } from "./speciesHostStarObservations.js";
import { evaluateStarlightGate, formatStarlight, starlightOutsideFactor } from "./starlightRanges.js";

/** Suffix appended to every demoted failure, so the card says what the tier means. */
export const DEMOTED_NOTE = "Listed as a low-probability find rather than excluded.";

/** Ends a gas-share band failure: the air is the species' own, only the share is outside its band. */
export const GAS_BAND_NOTE = "every observed body for it sits inside that band.";

type PendingMatch = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;

/**
 * Never let a demotion contradict the game's own signal count.
 *
 * The observation term demotes a species that has never been seen under this kind of star, and on a
 * handful of bodies that took the shown list below the number of genera the game reports — which is
 * impossible, and shows up in the probe as a provable data defect. The count is not a preference:
 * `k` genera are down there whatever our corpus has seen.
 *
 * So demotions are handed back, weakest evidence first, until the shown list can satisfy the count
 * again. Only rows demoted *solely* by the host-star observation term are eligible: a candidate that
 * also disagrees on temperature or planet class was not demoted by this and must not be rescued by
 * it. Restoring by ascending determinism means the species whose host star matters least gives way
 * first, which is the same ordering the demotion itself was decided on.
 */
/**
 * A genus the DSS named keeps at least one row on the shown list.
 *
 * The surface scan is the game telling us what is down there. Every gate in this file is an
 * inference from a corpus of a few thousand bodies, so when the two disagree the corpus is what is
 * wrong — and a genus with every row demoted is the app quietly contradicting the scanner while
 * showing no sign of it.
 *
 * Found on Myiesue CH-L d8-10 body 45: 7 signals, 7 genera named, 5 shown. Concha and Tubus had
 * every row demoted by a 190 K codex ceiling on a 193 K body, 1.6 % over. The commander then landed
 * and found Concha labiata exactly where the scanner said it was.
 *
 * {@link restoreDemotionsBelowSignalCount}'s count rule could not help: it only ever restored rows
 * demoted **solely** for `ObservedTemperature` or `StarType`, and these were `SurfaceTemperature`
 * codex-range demotions, several carrying a second soft reason as well. A count also cannot see
 * *which* genus is missing — it would happily restore a sixth row of a genus already shown.
 *
 * One row per named genus, the least-objected-to first. Everything else stays demoted: this is a
 * floor under the shown list, not a reprieve for the whole genus.
 */
function restoreNamedGenera(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  dssGenera: ReadonlySet<string> | null,
  generaOf: (rows: PendingMatch[]) => Set<string>,
): void {
  if (!dssGenera?.size) return;
  const shown = generaOf(strict);
  const missing = [...dssGenera].filter((g) => !shown.has(g));
  if (!missing.length) return;

  // The body's own class counts with its atmosphere: a row demoted on class never reaches the later
  // gates, so it carries fewer objections than it deserves. HIP 34326 D 2 (2026-09-28, the Anemone
  // split): rocky-only Luteolum, one class objection, tied with Blatteum's one star objection on a
  // high metal content body and won on list order.
  // A gas-share band counts half: the air is on the species' own list and only its share is outside
  // the band. Fonticulua segmentatus on pure thin Neon (9 of 968 confirmed bodies, the only Fonticulua
  // ever confirmed there; its band is 0.1-50 %) lost to methane-only digitos on list order
  // (2026-10-05).
  const atmObjections = (m: PendingMatch) =>
    (m.unlikelyReasons ?? []).reduce(
      (n, r) =>
        r.field === "PlanetClass" ? n + 1 : r.field === "AtmosphereType" ? n + (r.detail.includes(GAS_BAND_NOTE) ? 0.5 : 1) : n,
      0,
    );
  const objections = (m: PendingMatch) =>
    (m.unlikelyReasons ?? []).filter((r) => r.field !== "ObservedTemperature").length;
  const restored = new Set<number>();
  for (const genus of missing) {
    const candidates = unlikely
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.entry.genusDataDir === genus && !m.entry.predictionUnsupported)
      // Fewest objections first; a row the corpus merely has not seen beats one that disagrees on
      // three axes at once. And the observed-temperature envelope counts after every other kind —
      // it is the weakest evidence we hold (see below). Counted alike, a volu at 213 K, outside a
      // 68-body envelope, tied with an ammonia species on an oxygen world, and the ammonia species
      // won on list order: twice in the commander's own journals.
      //
      // An atmosphere the codex does not list outweighs every other objection. Counted alike, the
      // ammonia-only Concha aureolas tied with labiata on carbon-dioxide bodies and won on list order
      // (three of them in the 2026-09-24 capture). Replayed: +49 truth slots, -6 (Frutexa metallicum
      // on water, which really does grow off its list), 2 more single-species slots.
      .sort(
        (a, b) =>
          atmObjections(a.m) - atmObjections(b.m) ||
          objections(a.m) - objections(b.m) ||
          (a.m.unlikelyReasons?.length ?? 0) - (b.m.unlikelyReasons?.length ?? 0),
      );
    const best = candidates[0];
    if (!best) continue;
    strict.push({ entry: best.m.entry, reasons: best.m.reasons });
    restored.add(best.i);
  }
  if (!restored.size) return;
  const keep = unlikely.filter((_, i) => !restored.has(i));
  unlikely.length = 0;
  unlikely.push(...keep);
}

export function restoreDemotionsBelowSignalCount(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  signalCount: number | null,
  dssGenera: ReadonlySet<string> | null,
): void {
  const generaOf = (rows: PendingMatch[]) =>
    new Set(rows.filter((m) => !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir));

  restoreNamedGenera(strict, unlikely, dssGenera, generaOf);

  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return;
  if (generaOf(strict).size >= signalCount) return;

  /*
    Weakest evidence gives way first, and the observed-temperature envelope is the weakest we have.

    It says "nobody has recorded this species at this temperature yet", which a corpus of a few
    hundred bodies can easily be wrong about. A host-star gate says "this species has never been seen
    under this kind of star", which is a harder observation and is there because of a real report —
    Electricae pluma turning up on a neutron-star body.

    Ordering matters more than it looks. Before this, only star-type demotions were eligible, so a
    body whose shown list fell below the count *because of a temperature demotion* restored the
    Electricae instead of the row that had actually been pushed out — resurrecting the exact bug
    `hostStarGates` exists to hold down. Temperature rows are offered first and the star-type ones
    only if the count still is not met.
  */
  const solely = (m: PendingMatch, field: string) =>
    (m.unlikelyReasons ?? []).length > 0 && (m.unlikelyReasons ?? []).every((r) => r.field === field);

  const byTemperature = unlikely
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => solely(m, "ObservedTemperature"));
  const byStar = unlikely
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => solely(m, "StarType"))
    .sort((a, b) => hostStarDeterminism(a.m.entry) - hostStarDeterminism(b.m.entry));
  const eligible = [...byTemperature, ...byStar];

  const restored = new Set<number>();
  for (const { m, i } of eligible) {
    if (generaOf(strict).size >= signalCount) break;
    strict.push({ entry: m.entry, reasons: m.reasons, restoredForSignalCount: true });
    restored.add(i);
  }
  if (restored.size === 0) return;
  const keep = unlikely.filter((_, i) => !restored.has(i));
  unlikely.length = 0;
  unlikely.push(...keep);
}

function hostStarDeterminism(entry: SpeciesEntry): number {
  return speciesHostStarObservations(entry)?.determinism ?? 0;
}

/**
 * Demote candidates whose **spatial** gate fails — INCLUDE-BODY-IDS Phase 7.
 *
 * Runs after the strict/unlikely split rather than inside `speciesMatchesCriteria`, because this is
 * a fact about the *system*, not about the body: every body in a system shares the answer, and
 * threading a galactic coordinate through a per-body criterion would put it in the wrong place.
 *
 * **Demotes, never deletes.** Bark Mounds reach 100 % within 300 ly of a nebula, so a hard cut there
 * would lose nothing — but Electricae radialem only reaches 82 %, meaning about one radialem system
 * in five is further from a *catalogued* nebula than any threshold allows. A hard gate cannot tell
 * "no nebula here" from "no nebula recorded here", so it would silently delete real sightings. The
 * unlikely tier already exists for exactly this: listed, collapsed, and explained.
 *
 * Ordering matters. This runs **before** {@link restoreDemotionsBelowSignalCount}, so a body whose
 * signal count cannot otherwise be satisfied can still pull a spatially-demoted species back — the
 * game reporting N biological signals is a harder fact than a catalogue's completeness.
 */
export function demoteFailedSpatialGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
  catalogue: SpatialCatalogue | null,
): void {
  const coords = matchContext?.systemCoords;

  /**
   * No position, no verdict — never a failure.
   *
   * But "we could not check" is not the same as "there is nothing to check", and the difference is
   * visible to the reader: a gated species that survives unmarked looks like one that passed. Mark
   * it so the genus split can withhold its percentage, then leave the tiers alone.
   */
  if (!coords || !catalogue) {
    for (const m of strict) {
      if (gateForSpeciesId(m.entry.id)) m.spatialGateUnresolved = true;
    }
    return;
  }

  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = evaluateSpatialGate(m.entry.id, coords, catalogue);
    if (!verdict || verdict.passes) continue;
    const reason: MatchReason = {
      field: verdict.kind === "core" ? "GalacticCore" : verdict.kind === "nebula" ? "Nebula" : "GuardianSite",
      detail: `${describeVerdict(verdict)} ${verdict.evidence}.`,
      soft: true,
    };
    // Inside the gate's soft band (Bark Mounds 150–300 ly): stays shown, at a lower chance.
    if (verdict.softBand) {
      strict[i] = { ...m, reasons: [...m.reasons, reason], presenceFactor: (m.presenceFactor ?? 1) * verdict.softBand.factor };
      continue;
    }
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Demote candidates whose **host-star class** gate fails — INCLUDE-BODY-IDS §7.12.
 *
 * Runs beside {@link demoteFailedSpatialGates} and for the same reason: this is a fact about the
 * star, shared by every body that orbits it, and it is measured rather than quoted. Electricae pluma
 * was recorded under a neutron star, white dwarf, A-class star or black hole in all 10,194 sightings
 * `ABSTRACT-COND.md` measured, and under nothing else — O and B, which ed-dsn lists as unconfirmed
 * possibilities, came in at 0 %.
 *
 * Against our own corpus the gate keeps all 31 confirmed pluma bodies and withdraws the species from
 * 591 of the 627 bodies that match the Electricae genus shape, which is the whole point: the shape
 * alone is nearly worthless for telling pluma from radialem.
 *
 * **Demotes, never deletes**, and an unresolved star produces no verdict at all — see
 * `evaluateHostStarGate`. The single write path with the spatial gate is deliberate: both mark
 * `spatialGateUnresolved`-style state through the same tier so the genus split can withhold a
 * percentage rather than normalising one against a candidate nobody can judge.
 */
export function demoteFailedHostStarGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  const classes = matchContext?.hostStarClasses;
  const mainStar = matchContext?.systemMainStarClass ?? null;

  if ((!classes || classes.length === 0) && !mainStar) {
    // No star scanned yet. Not a pass — mark it, so the split does not put a number on it.
    for (const m of strict) {
      if (hostStarGateForSpeciesId(m.entry.id)) m.spatialGateUnresolved = true;
    }
    return;
  }

  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = evaluateHostStarGate(m.entry.id, classes, mainStar, {
      type: matchContext?.systemMainStarType,
      luminosity: matchContext?.systemMainStarLuminosity,
    }, matchContext?.systemStars);
    if (!verdict || verdict.passes) continue;
    const reason: MatchReason = {
      field: "StarType",
      detail: `${describeHostStarVerdict(verdict)} ${verdict.evidence}. ${DEMOTED_NOTE}`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }

  /*
    Rows already demoted carry the star's objection too, or a DSS-named genus restores the wrong one.
    BD-12 1172 11 a (EDDN ScanOrganic set, 2026-10-03): thin sulphur dioxide, so every Anemone was
    demoted on its atmosphere alike; the DSS named Anemone, and the restore took Luteolum (main star
    B only) on list order over Prasinum Bioluminescent, whose O main star this is and which players
    logged there.
  */
  for (let i = 0; i < unlikely.length; i++) {
    const m = unlikely[i]!;
    if ((m.unlikelyReasons ?? []).some((r) => r.field === "StarType")) continue;
    const verdict = evaluateHostStarGate(m.entry.id, classes, mainStar, {
      type: matchContext?.systemMainStarType,
      luminosity: matchContext?.systemMainStarLuminosity,
    }, matchContext?.systemStars);
    if (!verdict || verdict.passes) continue;
    const reason: MatchReason = {
      field: "StarType",
      detail: `${describeHostStarVerdict(verdict)} ${verdict.evidence}. ${DEMOTED_NOTE}`,
      soft: true,
    };
    unlikely[i] = { ...m, reasons: [...m.reasons, reason], unlikelyReasons: [...(m.unlikelyReasons ?? []), reason] };
  }
}

/**
 * Demote a species whose system does not hold the companion body it grows alongside.
 *
 * Amphora plant wants an Earth-like world, ammonia world, water giant, or a gas giant with water- or
 * ammonia-based life somewhere in the system; the Brain Trees want an Earth-like world or a gas giant
 * with water-based life. Both conditions sat in the data raising `predictionUnsupported` until the
 * match context learned to carry the system's other bodies.
 *
 * Demotion, not exclusion, and the reason travels with the row: the requirement lists are transcribed
 * community knowledge, and one missing entry on a 3 M credit species should cost a tier rather than
 * the body. An unfinished honk is marked unresolved instead, exactly as the spatial gates do — an
 * Earth-like world nobody has scanned yet is not an Earth-like world that is not there.
 */
export function demoteFailedSystemBodyGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const wanted = m.entry.criteria?.systemBodyClassesAnyOf;
    if (!wanted?.length) continue;

    const verdict = evaluateSystemBodyGate(
      wanted,
      matchContext?.systemBodyClasses,
      matchContext?.systemBodyListComplete === true,
    );
    if (!verdict || verdict.kind === "pass") continue;
    if (verdict.kind === "unresolved") {
      // Not a pass. Marked, so nothing downstream counts it as one.
      m.spatialGateUnresolved = true;
      continue;
    }

    const reason: MatchReason = {
      field: "System bodies",
      detail: `${describeSystemBodyVerdict(verdict)}. ${DEMOTED_NOTE}`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Drop a species that must meet every condition (`allConditionsRequired`) unless it has.
 *
 * The owner on Crystalline Shards (2026-10-04): "show crystalline only if they meet all conditions,
 * no guess work". They were listed on cold rocks before the system's other bodies were known, since
 * an unfinished honk leaves the companion-body gate unresolved and unresolved is not a failure. For
 * these species it is: the row goes — strict or demoted — unless the gates that need the system all
 * answered yes (a listed companion body scanned, the body's host star known and allowed) and nothing
 * demoted it. A DSS naming the genus is the game saying it is there, and keeps the row.
 *
 * Runs after the other demotions and before the signal-count restore, so the restore cannot bring
 * back what this removed.
 */
export function dropUnprovenStrictSpecies(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  matchContext: SpeciesMatchContext | null | undefined,
  dssNamed: (entry: SpeciesEntry) => boolean,
): void {
  const proven = (m: PendingMatch): boolean => {
    const wanted = m.entry.criteria?.systemBodyClassesAnyOf;
    if (wanted?.length) {
      const v = evaluateSystemBodyGate(wanted, matchContext?.systemBodyClasses, matchContext?.systemBodyListComplete === true);
      if (v?.kind !== "pass") return false;
    }
    if (hostStarGateForSpeciesId(m.entry.id)) {
      const v = evaluateHostStarGate(m.entry.id, matchContext?.hostStarClasses, matchContext?.systemMainStarClass ?? null, {
        type: matchContext?.systemMainStarType,
        luminosity: matchContext?.systemMainStarLuminosity,
      }, matchContext?.systemStars);
      if (!v?.passes) return false;
    }
    return true;
  };
  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    if (m.entry.criteria?.allConditionsRequired && !dssNamed(m.entry) && !proven(m)) strict.splice(i, 1);
  }
  for (let i = unlikely.length - 1; i >= 0; i--) {
    const m = unlikely[i]!;
    if (m.entry.criteria?.allConditionsRequired && !dssNamed(m.entry)) unlikely.splice(i, 1);
  }
}

/**
 * Weigh a species down when the body gets less or more starlight than it is usually seen under.
 *
 * The owner's idea (2026-09-27), measured before it was built: a range for every species, gated only
 * where it adds to temperature and planet type — see `starlightRanges.ts` for the seven species and
 * why the rest are not. The ranges hold 99 % of the clean sightings, not all of them, and the gate
 * used to demote the other 1 %: Stratum araneamus under 0.025× Earth's light at Eol Prou QX-S
 * d4-3465 6 (EDDN ScanOrganic set, 2026-10-03), 1.3 % of its bodies in all and 4.6 % of Bacterium
 * volu's. Outside the range the row now stays, its chance and genus share multiplied by how much
 * less likely it is there than its siblings (`starlightOutsideFactor`), and the 1 % floors decide.
 * Unknown light (a star the body orbits never scanned) says nothing.
 */
export function weighOutsideStarlight(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  _unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  const light = matchContext?.stellarIrradiance;
  if (light === undefined) return;
  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = evaluateStarlightGate(m.entry.id, light);
    if (!verdict || verdict.passes) continue;
    const { lo, hi } = verdict.range;
    const factor = starlightOutsideFactor(verdict.range);
    const reason: MatchReason = {
      field: "Starlight",
      detail:
        `${formatStarlight(light)}× Earth's starlight here; ${m.entry.displayName} grows under ` +
        `${formatStarlight(lo)}–${formatStarlight(hi)}× on 99 % of its sightings. Kept at ×${factor.toFixed(2)} chance.`,
      soft: true,
    };
    strict[i] = { ...m, reasons: [...m.reasons, reason], presenceFactor: (m.presenceFactor ?? 1) * factor };
  }
}

/**
 * Of two or more species of one genus shown together, demote the one the region barely records.
 *
 * The absence rule judges a species against the galaxy's biology as a whole and cannot see "12
 * divisa against thousands of cultro" — divisa clears it in Galactic Centre at 0.022 %. Given that
 * the genus is on the body, the record's answer to *which species* is each one's share of its genus
 * in the region; under `REGION_GENUS_SHARE_MIN` it is the rare one. See `shared/regionAbsence.ts`.
 *
 * A share cut alone cannot tell a species that is out of place from one that is a minority
 * everywhere, so a second test compares siblings directly: each one's regional share over its
 * galaxy-wide share, against the favourite's. Under `REGION_SIBLING_DEPLETION` of the favourite, it
 * is out of place — Tubus compagibus beside cavas in the Trojan Belt — while Bacterium scopulum,
 * rare everywhere, stays beside verrata. A species holding `REGION_SIBLING_DEPLETION_MAX_SHARE` of
 * its genus there is not out of place, whatever the ratio (Sinuous Tubers Prasinum, 18 % of them in
 * Inner Scutum-Centaurus, dominant in Empyrean Straits).
 *
 * **A tie-breaker, never an eviction.** It only acts between siblings that are shown together, and
 * never demotes the last one standing. Run as a per-species gate it demoted Fonticulua fluctus in
 * Inner Orion Spur — the commander's rarest find, 20 M — on bodies where it was the only Fonticulua
 * shown, and `restoreNamedGenera` then put back a *different* species to fill the named genus. A
 * rare species alone in its slot is still the best answer the body has.
 */
/**
 * Kelvin either side of a species' observed temperature envelope still read as inside it.
 *
 * The envelope's edges are the coldest and hottest bodies a profile happens to hold, to the decimal.
 * Cactoida peperatis' profile starts a hair above 160 K, and 17 of its corpus bodies read exactly
 * 160.0 K — each one demoted, and lapis (0.3-0.5 % of Cactoida in those regions) shown alone in its
 * place. The codex gate beside it allows 2 %; this allows half a kelvin.
 *
 * Replayed over 78,343 slots: 92 truth slots come back and none is lost (Tubus cavas +45, peperatis
 * +17, Aleoida spica +13, Osseus cornibus +8); 247 slots gain a second species, 171 of them Aleoida
 * pairs at a shared envelope edge. The commander's journals do not move. 1 K and 0.5 K are the same
 * to within two slots; 2 K starts to cost Tussock 174 slots for 7 more truths.
 */
export const OBSERVED_TEMP_TOLERANCE_K = 0.5;

export function demoteRegionallyRareSiblings(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  const regionIndex = matchContext?.regionIndex;
  if (!regionIndex) return;
  const root = getProjectRoot();
  const byGenus = new Map<string, number[]>();
  strict.forEach((m, i) => {
    const g = m.entry.genusDataDir;
    byGenus.set(g, [...(byGenus.get(g) ?? []), i]);
  });
  const demote: { i: number; reason: MatchReason }[] = [];
  for (const idxs of byGenus.values()) {
    if (idxs.length < 2) continue;
    const judged = idxs.map((i) => ({
      i,
      v: regionalGenusShare(root, regionIndex, strict[i]!.entry.id),
      e: regionalGenusEnrichment(root, regionIndex, strict[i]!.entry.id),
    }));
    // The sibling the region favours most, as the yardstick for the others.
    const top = judged.reduce<(typeof judged)[number] | null>((b, x) => (x.e != null && (b?.e == null || x.e > b.e) ? x : b), null);
    // A species the body meets on its own key — the volcanism it needs, or an atmosphere only it of the
    // shown siblings asks for — is rare in a region because such bodies are, not because it is out of
    // place there; on this body it is the likely answer (owner, 2026-10-04: no misses).
    const specificAtm = (m: PendingMatch) => {
      const list = m.entry.criteria?.atmosphereTypeAnyOf;
      const all = list?.some((v) => (v ?? "").trim().toUpperCase() === "ALL");
      if (!list?.length || all || atmosphereAllowlistMeansAnyThinCompositionOnly(list)) return false;
      return m.reasons.some((r) => r.field === "AtmosphereType");
    };
    const keyed = (i: number) => {
      const m = strict[i]!;
      if (m.entry.criteria?.volcanismIncludes?.length && m.reasons.some((r) => r.field === "Volcanism" && !r.detail.includes("outside the codex list"))) return true;
      return specificAtm(m) && idxs.filter((j) => specificAtm(strict[j]!)).length === 1;
    };
    const rare = judged.filter(
      (x) =>
        (x.v?.rare && !keyed(x.i)) ||
        (x !== top &&
          x.e != null &&
          top?.e != null &&
          top.e > 0 &&
          x.e / top.e < REGION_SIBLING_DEPLETION &&
          (x.v?.share ?? 0) < REGION_SIBLING_DEPLETION_MAX_SHARE),
    );
    if (rare.length === 0 || rare.length === idxs.length) continue;
    for (const { i, v, e } of rare) {
      const detail = v!.rare
        ? regionGenusShareDetail(v!.regionName, strict[i]!.entry.genus, v!)
        : regionSiblingDepletionDetail(v!.regionName, strict[i]!.entry.displayName, strict[top!.i]!.entry.displayName, e! / top!.e!);
      demote.push({ i, reason: { field: "Region", soft: true, detail } });
    }
  }
  for (const { i, reason } of demote.sort((a, b) => b.i - a.i)) {
    const m = strict[i]!;
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Recepta Deltahedronix never grows on an icy body whose only biology is the Recepta (owner,
 * 2026-10-02: shrink the Recepta list "only if no real recepta signals are lost, 0!").
 *
 * Every body fact was measured against the three Recepta species (`docs/perf/recepta_analysis.py`,
 * 76 facts incl. crust and materials) and none beat "always Umbrux". One cell is empty, though:
 * Icy body with exactly one biological signal — 0 Deltahedronix of 6,801 Recepta bodies in the
 * Spansh dump (3,360 Conditivus, 3,441 Umbrux), 0 of 12 EDDN ScanOrganic sightings, 0 in the
 * commander's journals. With two or more signals on an icy body it is the commonest of the three
 * (303 of 739), so the rule is the count, not the ice.
 *
 * Only on the game's own count: an AutoScan-only body is computed with an assumed single signal,
 * and there the count proves nothing (`signalCountAssumed`).
 */
export function demoteDeltahedronixOnOneSignalIcy(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  planetClass: string | null | undefined,
  biologicalSignals: number | null | undefined,
  signalCountAssumed: boolean,
): void {
  if (signalCountAssumed || biologicalSignals !== 1) return;
  if ((planetClass ?? "").trim().toLowerCase() !== "icy body") return;
  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    if (!m.entry.id.toLowerCase().includes("deltahedronix")) continue;
    const reason: MatchReason = {
      field: "BioSignals",
      soft: true,
      detail: `Never recorded on an icy body with one biological signal (0 of 6,801 Recepta bodies). ${DEMOTED_NOTE}`,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}
