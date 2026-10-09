import type { ExomasteryDetailDTO, ExomasteryVarietyItemDTO, OtherMatchDetailCardDTO } from "./exomastery.js";
import type { FootCatalogConfirmation, FootScanMatchPayload } from "./footCatalog.js";

/** Resolved host star MK fields for feeder vs journal comparisons (from parent `Scan`). */
export interface JournalHostStarObservation {
  starTypeRaw: string | null;
  /** Primary coarse slot (Harvard ladder + specials), e.g. `G`, `TTS`. */
  spectralLetter: string | null;
  subclass: number | null;
  luminosity: string | null;
}

/** Optional live context for species matching (star, orbit, FSS signals). Omitted fields = gate skipped. */
export interface SpeciesMatchContext {
  /** Host star `Scan.StarType` after resolving `Parents` (e.g. moons → planet → star). Fragment match only. */
  parentStarType?: string;
  /** Parent star `Subclass` when merged (`Scan`). */
  parentStarSubclass?: number;
  /** Parent star `Luminosity` / Yerkes label when merged. */
  parentStarLuminosity?: string;
  /** Orbit distance from host star: `SemiMajorAxis` (m) / c in LS (not cumulative for nested moons). */
  orbitDistanceFromParentStarLs?: number;
  /** The body orbits a star (or a barycentre of stars), not a planet — from its `Parents`. */
  orbitsAStar?: boolean;
  /** The body's `DistanceFromArrivalLS`: how far it is from the system's arrival (main) star. */
  distanceFromArrivalLs?: number;
  /** The body's system (id64), for species known from one system only. */
  systemAddress?: number;
  /**
   * Host-star class keys for this body — one star, both stars of a pair, or every star in the
   * system when the body orbits a barycentre that names none.
   *
   * `parentStarType` above is the single best host and stays what the codex fragment and colour
   * tables read. This is the *set*, and it exists because a body orbiting a star pair has no single
   * host: choosing one of the pair is how the corpus came to record an M-dwarf host for Electricae
   * pluma on a body whose system primary is a neutron star.
   */
  hostStarClasses?: string[];
  /**
   * Host-class key of the system's **main** star — the arrival star — which is not always the body's
   * host. Some species follow it rather than the star the body orbits: Stratum araneamus is under an
   * A, neutron, B or black-hole main star on 98.9 % of its codex sightings while a third of its bodies
   * orbit a brown dwarf. Read by host-star gates measured on the main star.
   */
  systemMainStarClass?: string;
  /**
   * The main star as the journal writes it — `StarType` ("B", "AeBe") and `Luminosity` ("Vz",
   * "IIIab"). Read by the host-star gates that split on luminosity: the Anemone colours.
   */
  systemMainStarType?: string;
  systemMainStarLuminosity?: string;
  /** Every star in the system as the journal writes it, for gates with `anyStar` (the Anemone colours). */
  systemStars?: { type: string; luminosity?: string }[];
  /**
   * Journal star type of the star that sets star-coloured species' colours — the host, unless the
   * host is a brown dwarf in a planet slot, then the star that dwarf orbits (speciesMatchContext.ts
   * `colourStarTypeFor`). Colour only: gates keep reading {@link parentStarType}.
   */
  colourStarType?: string;
  /**
   * Every star lighting the body, brightest first (the first is {@link colourStarType}). When the
   * brightest star's class has no colour row for a species, the next one is tried; with none left the
   * colour is "(unknown)" — never a guessed class (owner, 2026-09-28).
   */
  colourStarTypes?: string[];
  /**
   * Starlight reaching the body, in the Sun's flux at 1 AU (Earth = 1): every scanned star's
   * luminosity over distance², the colour rule's stars and distances (speciesMatchContext.ts
   * `stellarIrradianceFor`). Read by the starlight gate (matchSpecies.ts `weighOutsideStarlight`).
   */
  stellarIrradiance?: number;
  /**
   * Journal `PlanetClass` of every other body the FSS has found in this system.
   *
   * The wire for the companion-body conditions: Amphora plant and the Brain Trees spawn on what else
   * the system holds, and this is the only thing in the matcher's inputs that can say.
   */
  systemBodyClasses?: string[];
  /**
   * Whether the system's body list is complete (`FSSAllBodiesFound`).
   *
   * Without it a missing companion body means "not found yet" rather than "not there", and gating on
   * that would demote a species precisely where the commander is still deciding whether to honk.
   */
  systemBodyListComplete?: boolean;
  /** Lowercased hints from scanner signal `Type` / `Type_Localised`. */
  signalHints?: string[];
  /**
   * The system's galactic position, from `FSDJump` / `CarrierJump` / `Location` `StarPos`.
   *
   * §28 recorded that `StarPos` "stays unconnected to the matcher — there is nothing to connect it
   * to". Phase 7 is the something: three genera are gated on position, and this is the wire.
   */
  systemCoords?: { x: number; y: number; z: number };
  /**
   * The named galactic region the body's system sits in, resolved from `systemCoords`.
   *
   * Carried here so a region rule can be written against it without every call site having to load
   * a 182 kB map. Nothing gates on it yet — the region×species table that would make it a gate has
   * not been built — but the owner's field reports keep landing on region questions ("Cactoida —
   * region check"), and a context that cannot answer where you are cannot answer those.
   */
  regionName?: string;
  regionIndex?: number;
  /** Surface pressure in atm after `journalPressureToAtm`; `null` / missing when not in scan. */
  surfacePressureAtm?: number | null;
}

export interface SpeciesCriterion {
  /**
   * Presence branches: the body must satisfy **at least one** of them, or the species is not there.
   *
   * Every other field on this interface is ANDed. This is the one place the data can say "or", and
   * it exists because Bacterium tela needs it: measured across three datasets it grows where there
   * is **volcanism, or a surface at 300 K or more**, and on neither condition alone. The cold branch
   * is a hard requirement and the hot branch makes volcanism irrelevant, which is why both earlier
   * readings of the codex row — "requires volcanism" and "volcanism is never required" — were each
   * half right. See `docs/tela-decision-20092026.md`.
   *
   * Each branch is a full criterion object, parsed by the same loader, and evaluated with **plain
   * comparisons**: no observation rescue and no numeric tolerance. Both matter. The corpus has seen
   * tela between 20 K and 698 K, so routing a 300 K branch through the ordinary temperature gate
   * would let `observedAtTemperature` re-admit every cold body and the rule would quietly become
   * "always"; and the 300 K edge is measured (0 tela of 149 non-volcanic bodies between 240 K and
   * 300 K), not a rounded codex band, so 2 % of slack would be slack against a fact.
   *
   * Failing every branch is a **hard** failure. A soft one lands in the unlikely tier, where
   * `restoreDemotionsBelowSignalCount` can lift it back whenever a body reports more signals than
   * shown genera — putting the row back exactly where three datasets say it never is.
   *
   * Only the fields in `PRESENCE_BRANCH_FIELDS` are understood inside a branch; `tests/presenceAnyOf.test.ts`
   * fails if a shipped branch carries anything else, rather than letting it be ignored.
   */
  presenceAnyOf?: SpeciesCriterion[];
  /**
   * Body classes that must exist **elsewhere in the same system** for this species to spawn.
   *
   * Amphora plant, the Brain Trees and Crystalline Shards carry it. Read by
   * `shared/systemBodyGates.ts`, which demotes rather than excludes and abstains until the honk is
   * finished — an absence in a half-scanned system is not an absence.
   */
  systemBodyClassesAnyOf?: string[];
  planetClassAnyOf?: string[];
  atmosphereTypeAnyOf?: string[];
  /**
   * A gas the **genus** cannot live without, measured against the body's atmosphere composition.
   *
   * Different in kind from `atmosphereTypeAnyOf`, which lists the atmospheres the codex mentions and
   * is soft because the corpus may know better. This one is the genus saying "no sulphur dioxide, no
   * Recepta", and the corpus is not allowed to argue — 21 Recepta rows labelled "Thin Carbon
   * dioxide" are 21 rows about something else.
   *
   * It is checked against `AtmosphereComposition`, not `AtmosphereType`, because the type names only
   * the dominant gas. Blu Thua EM-D d12-25 A 1 a is 99.01 % CO₂ with 0.99 % SO₂, and both Recepta
   * species were offered there: the gas is present, but a trace is not a habitat. Five per cent is
   * the floor — see `REQUIRED_GAS_MIN_SHARE_PCT`.
   *
   * Failing it **demotes** rather than excludes. A trace of the right gas is a long shot, not an
   * impossibility, and the unlikely tier is where long shots belong.
   */
  atmosphereTypeRequiredAnyOf?: string[];
  /**
   * How much of the air has to be a given gas — the axis `AtmosphereType` cannot express.
   *
   * `AtmosphereType` names the **dominant** gas, and a trailing `Rich` means the named gas is
   * present but something else dominates. Measured over 8,000 journal scans:
   *
   * ```
   *                plain label        "…Rich" label
   * Neon           50.29 – 100 %      0.13 – 49.74 %
   * Argon          43.21 – 100 %      0.10 – 47.76 %
   * CarbonDioxide  44.37 – 100 %      0.11 – 46.24 %
   * ```
   *
   * So `NeonRich` air is not neon-rich at all — it averages **5.5 % neon**, usually nitrogen with a
   * neon trace. Both the loader and `atmosphereCompositionKey` fold the suffix away, which is right
   * for the many species that live either side of it and wrong for the few that do not:
   *
   * ```
   *                        the gas its codex row names
   * Bacterium acies        Neon   85.36 – 100.00 %   (213 bodies)
   * Fonticulua segmentatus Neon    0.24 –   0.53 %   (16 bodies, labelled NeonRich)
   * Fonticulua campestris  Argon  51.97 – 100.00 %   (761 bodies)
   * Fonticulua upupam      Argon   0.36 –  49.68 %   (56 bodies, labelled ArgonRich)
   * ```
   *
   * Campestris and upupam are the pair this was written for: two ranges that do not touch, on a
   * label that cannot tell them apart. The bands say it directly and leave the folding alone.
   *
   * Read from `AtmosphereComposition`, which is present on **100 %** of the 8,000 scans measured,
   * AutoScan included. When a scan carries none the band is skipped rather than failed — inventing a
   * rejection from missing data is worse than letting a rare body through.
   *
   * **Soft**, like every atmosphere verdict here: it demotes with its reason shown rather than
   * deleting the row, and one foot sample there lifts it back (`sampledHere`).
   */
  atmosphereGasSharePct?: { gas: string; min?: number; max?: number }[];
  /** Earth **g** (compared after converting journal m/s² → g). */
  surfaceGravity?: { min?: number; max?: number };
  surfaceTemperatureK?: { min?: number; max?: number };
  /**
   * A **measured** temperature band, inside the codex one, that only ever demotes.
   *
   * The codex band stays the wall. This says where the species actually lives: Concha labiata's
   * codex ceiling is 195 K, but 99 % of its 1,928 bodies sit at or below 190 K, while 365 of Concha
   * renibus's bodies sit at 190–195 K and labiata was offered on every one. Writing the ceiling as
   * a codex 190 would hide the 1 % above it; written here it demotes them, with the reason shown.
   */
  softTemperatureK?: { min?: number; max?: number };
  /**
   * A **measured** ceiling on the body's own orbit — its `SemiMajorAxis`, in light-seconds, around
   * whatever it orbits. Demotes only.
   *
   * Concha labiata grows on tight moons: 97 % of its 1,927 carbon-dioxide bodies are moons, their
   * orbits round the planet at a median 4.1 ls and 98.3 % within 12.6 ls, and only 11 orbit a star
   * directly. Concha renibus, in the same climate, is a star-orbiting planet on 22 % of its bodies
   * (176 of them round Y dwarfs) and its moons sit at a median 9.6 ls. A planet round a star reads
   * thousands of light-seconds here, so the one number covers both.
   *
   * Moons only since 2026-10-09: a year of EDDN has 926 of 27,415 labiata bodies orbiting a star
   * (3.4 %, not the corpus's 11), each demoted by the ceiling. Its moons: 99.9 % within 27.8 ls.
   */
  softMaxSemiMajorAxisLs?: number;
  /** Journal SurfacePressure (official docs: atmospheres for landables) */
  surfacePressure?: { min?: number; max?: number };
  landable?: boolean;
  /**
   * Known only from these systems (id64). A wall: Ingensradices unicus, found in HIP 87621 alone
   * (2026-09-28). Unknown system → not offered.
   */
  systemAddressAnyOf?: number[];
  /**
   * Not counted in the game's biological signals and not named by a DSS (Ingensradices unicus:
   * HIP 87621 2 a reports three genera and grows it as a fourth). The DSS genus filter lets it through.
   */
  outsideSignalCount?: boolean;
  /**
   * Listed only when every condition is known and met — no demotion, no unresolved gate (owner,
   * 2026-10-04, on Crystalline Shards: "show crystalline only if they meet all conditions, no guess
   * work"). A row that would be demoted, or whose companion body or host star is not known yet, is
   * dropped rather than shown as unlikely; a DSS naming the genus still lists it. See
   * `dropUnprovenStrictSpecies` in demotionPasses.ts.
   */
  allConditionsRequired?: boolean;
  /** Substring match on Volcanism journal field */
  volcanismIncludes?: string[];
  /**
   * When `atmosphereTypeAnyOf` applies, also require estimated / journal temperature band’s upper bound
   * to be ≤ this value K (e.g. CO₂ with “mean temperature below 195 K”).
   */
  whenAtmosphereLinkedMaxTempK?: number;
  /**
   * Lower half of an atmosphere-linked temperature band.
   *
   * The linked rule started as a cap because every species that used it had only a ceiling. Concha
   * renibus has both: its codex row reads 180-195 K **for carbon dioxide only**, and water
   * atmospheres carry no temperature limit at all. Expressing that as a flat range gated water
   * bodies it should never have touched.
   */
  whenAtmosphereLinkedMinTempK?: number;
  /**
   * If set with {@link whenAtmosphereLinkedMaxTempK}, the temperature cap applies only when the scan
   * atmosphere matches one of these journal atmosphere tokens (e.g. CO₂-only on a row that also allows ammonia).
   */
  whenAtmosphereLinkedAtmosphereAnyOf?: string[];
  /** Host star type: any fragment (substring, case-insensitive) must appear in {@link SpeciesMatchContext.parentStarType}. */
  parentStarTypeIncludesAnyOf?: string[];
  /**
   * Orbit distance from host star in light-seconds; only when context provides it.
   *
   * `softBelow`: under `min`, the row is kept at a lower chance instead of demoted — `factor` from
   * the first step whose `fromLs` the orbit reaches (highest first), measured on the corpus.
   */
  orbitDistanceFromParentStarLs?: {
    min?: number;
    max?: number;
    softBelow?: { fromLs: number; factor: number }[];
  };
  /**
   * Distance from the system's arrival star in light-seconds, soft. Crystalline Shards: every one of
   * 4,450 Bioforge sightings is ≥ 10,369 Ls from arrival, while many sit right beside a secondary star.
   */
  distanceFromArrivalLs?: { min?: number; max?: number };
  /**
   * Atmosphere pressure class using shared thin threshold (`THIN_ATMOSPHERE_MAX_ATM`, default 0.1 atm after journal conversion).
   * Gate runs only when context exposes surface pressure.
   */
  atmospherePressureCategory?: "thin" | "thick";
  /** Any fragment must match a merged scanner signal hint (geological, etc.). */
  geologicalSignalIncludes?: string[];
  /** If true, require journal volcanism text (same as brain-tree rule) even without `volcanismIncludes`. */
  volcanismActiveRequired?: boolean;
  /**
   * Off its codex atmosphere list, this species grows only on volcanic bodies. Qualifies the
   * "observed under this atmosphere anyway" rescue: without volcanism the rescue does not fire and the
   * atmosphere miss demotes as usual. Osseus discus: away from water, 62 of 62 bodies are volcanic
   * (methane 44, ammonia 15, argon 3); on water, 1,193 of 1,199 are not.
   */
  offListAtmosphereNeedsVolcanism?: boolean;
  /**
   * A **measured** absence: the species is recorded almost only on bodies with no volcanism, so a
   * volcanic body demotes it. Never hides. Osseus spiralis: 1,763 of 1,765 bodies have none.
   */
  softNoVolcanism?: boolean;
  /**
   * Atmospheres outside the codex list that the species grows on **only with volcanism** — journal
   * spelling, like `atmosphereTypeAnyOf`. On a volcanic body they count as listed; otherwise — no
   * volcanism, or none reported — they demote like any off-list atmosphere. Fungoida gelata and
   * stabitis: every recorded body on methane (79–106 K) or ammonia (168–176 K) has silicate vapour
   * geysers or magma, while setisis, which owns those atmospheres, is volcanism-free on 99.9 % of
   * 2,083 ammonia bodies.
   */
  volcanicOnlyAtmospheres?: string[];
  /** Appended to match reasons when a row passes (terrain / codex wording — not a hard planet-class gate). */
  matchContextNotes?: string[];
}

export interface SpeciesEntry {
  id: string;
  displayName: string;
  genus: string;
  /** Rarity tier from EDSM's codex (all colours), set when the database loads — `shared/speciesRarity.ts`. */
  rarity?: import("../speciesRarity.js").SpeciesRarity;
  /** Starlight range from the galaxy dump, set when the database loads — server `starlightRanges.ts`. */
  starlight?: import("../starlight.js").SpeciesStarlight;
  /**
   * How this **species** gets its colour variant, and the table.
   *
   * Per species rather than per genus because the game is per species: three Bacterium read the
   * star and six read a material. See `shared/colourVariants.ts`. Absent when ED-DSN publishes no
   * table for it — Brain Trees and Sinuous Tubers carry the colour in the species name instead.
   */
  colourVariant?: import("../colourVariants.js").ColourVariantRule;
  /** Folder name under `data/species/<this>/` where the genus `.json` and `*_photos` live. */
  genusDataDir: string;
  photoFile?: string;
  description: string;
  criteria: SpeciesCriterion;
  /** Optional inline note from the genus JSON row (short). */
  notes?: string;
  /** e.g. `data/species/Stratum/stratum.json` for debugging. */
  dataSourceRelPath?: string;
  /**
   * Set when the species' spawn depends on something a body scan cannot answer — the presence of
   * other body types in the system, or proximity to a nebula. The candidate is still listed (nothing
   * is ever removed, see the no-walls rule), but it is marked so the reader knows the app is not
   * claiming to have predicted it, and so ambiguity can be reported with and without it.
   *
   * Star-type requirements are deliberately *not* included: the parent star is resolvable from the
   * journal, so those are a wiring job rather than an unknowable.
   */
  predictionUnsupported?: {
    /** Short reason, shown to the reader. */
    reason: string;
    /** The condition key that made it unpredictable, for debugging. */
    sourceKey: string;
  };
  /**
   * The surface temperature range this species has actually been found in, from its exomastery
   * profile. Attached at load so the matcher stays free of file access.
   *
   * It is a **demotion**, never a gate — see `matchSpecies.ts`. Replacing the codex temperature gate
   * with this range was measured and is worse on every headline: recall 97.9 to 97.4 %, value
   * 97.4 to 97.0 %, precision 43.2 to 39.4 % on *more* candidates. The codex bands are deliberately
   * wider than anything observed and that width is doing real work. Used softly it pays instead:
   * decidable bodies 497 to 527, mean ambiguity 4.80 to 4.71 genera, and the two tiers together are
   * unchanged — 616 found, 9 missed, either way.
   *
   * Absent for the ~20 species whose profile has fewer than {@link OBSERVED_TEMP_MIN_SAMPLES}
   * bodies, because a handful of observations is not an envelope.
   */
  observedTemperatureK?: { min: number; max: number; count: number };
  /**
   * Set when a sibling of the same genus starts its codex temperature band exactly where this
   * species' band ends — the display name of that sibling. The shared edge belongs to the one that
   * starts there: see `attachSharedTemperatureEdges`.
   */
  temperatureCeilingSharedWith?: string;
  /**
   * From genus `meta.color_variants.mapping`: spectral keys (e.g. `O`, `A`) whose value is JSON `null`
   * — codex assigns no colour for that host star class, so the matcher rejects the body when host `StarType` resolves to that key.
   */
  genusStarColorNullSpectralClasses?: string[];
  /**
   * Non-null stellar keys from genus `meta.color_variants.mapping` (single-letter + `TTS` only — material-based maps omitted).
   * Informational “soft” fit in Candidate species UI; matcher does not require host to appear here unless combined with {@link genusStarColorNullSpectralClasses}.
   */
  genusStarColorPreferredSpectralClasses?: string[];
  /** Genus `meta` minimum metres between organic samples (genetic diversity). */
  genusMinSampleDistanceM?: number;
  /**
   * Never predicted from the body (owner, 2026-10-04: the Thargoid entries, "nice to have if there"):
   * listed only when a DSS names its genus on the body, or once the commander has logged it there.
   * From the genus file's `meta.dssOnly`.
   */
  dssOnly?: boolean;
  /** Genus `meta.color_variants.rule` when present. */
  genusColorVariantRule?: string;
  /** Spectral class key (normalised) → codex colour label for star-driven morph tables. */
  genusColorStellarMapping?: Record<string, string>;
  /** True when colour map includes material / composition keys (not only host spectral class). */
  genusColorMaterialDriven?: boolean;
  /**
   * This species' own `color_rules`, as written in the genus file.
   *
   * Per species, not per genus: each Bacterium names a different colour for the same material, so
   * the genus-level map cannot answer for any of them. The loader used to read only the genus meta
   * and record a bare `genusColorMaterialDriven` boolean, which is why a material-driven species
   * always displayed "(unknown)" — the app had the rule in its data and never carried it far enough
   * to use.
   */
  speciesColourRules?: { type?: string; mapping?: Record<string, string> };
}

export interface SpeciesDatabase {
  species: SpeciesEntry[];
}

export interface MatchReason {
  field: string;
  detail: string;
  /**
   * On a *failure* reason: this criterion is a weighted term, not a wall. The candidate is demoted
   * to the unlikely tier rather than removed.
   *
   * Measured against the feeder's observed habitats, the planet-class gate alone rejected 4.14 % of
   * the bodies where the species was actually found (1,046 of 25,289), concentrated in Tussock,
   * Osseus and Fungoida — High metal content body is missing from the allowed list of almost every
   * one of them. Nothing about that 4.14 % is recoverable by tuning the list; the list itself is the
   * wrong shape. Absent data is still a wall: "no planet class in the scan" is not a disagreement
   * about habitat, it is a missing measurement.
   */
  soft?: boolean;
}

export interface SpeciesProvenance {
  /** The commander scanned this species on this exact body. */
  firstHand: boolean;
  firstHandAt?: string;
  /** Bodies in this system the shipped corpus confirms this species on. System resolution, not body. */
  corpusInSystem: number;
  /** Whether the corpus knows this system at all, so a 0 above can be told from silence. */
  systemInCorpus: boolean;
  /** Other commanders whose shared exomastery file has this species on this exact body (§S). */
  sharedBy?: string[];
}

export interface SpeciesMatch {
  entry: SpeciesEntry;
  reasons: MatchReason[];
  /**
   * Demoted by a gate, then put back only because the shown list had fewer genera than the game's
   * signal count. It fills the count; it is not a verdict that the gate was wrong.
   */
  restoredForSignalCount?: true;
  /**
   * Who says this species is here — the read-time union of the shipped corpus and the commander's
   * own journal. See `server/speciesProvenance.ts`; it is evidence *about* the row, never an input
   * to whether the row is listed.
   */
  provenance?: SpeciesProvenance;
  photoUrl: string;
  photoNote: string | null;
  /**
   * Every photograph of this species, {@link photoUrl} first.
   *
   * A species can have several — the same organism on a different world, by a different commander —
   * and the viewer steps through them. Optional so a payload written before galleries existed still
   * parses; a reader that finds it absent should treat `[photoUrl]` as the whole set.
   */
  photoUrls?: string[];
  /**
   * Photographs of the specific colour variants, when someone has taken them.
   *
   * The app works out which variant a body will grow, and the owner is photographing the variants
   * themselves. Apart, each is a curiosity; together they let the card show the plant the commander
   * is actually going to find rather than one of its siblings.
   */
  photoVariants?: { url: string; colour: string }[];
  /**
   * Photographs that are not ED-DSN's, by URL.
   *
   * Only the exceptions travel — the shipped images are ED-DSN's and carry the standing credit — so
   * this is a handful of entries or absent entirely. Crediting a commander's own photograph to
   * somebody else is the one mistake this area of the project has been careful about.
   */
  photoCreditByUrl?: Record<string, { name: string; url?: string; licence?: string }>;

  /** From `data/price-list.json` when this species is listed. */
  priceCredits: number | null;
  /** True when strict temp/pressure gates failed and this row was kept as a closest-distance guess. */
  approximateMatch?: boolean;
  /**
   * Listed, but below the display threshold: every criterion this row failed is a weighted term
   * rather than a wall, so it is collapsed behind "show unlikely (N)" instead of being deleted.
   *
   * A body that contradicts the species on one axis is a low-probability find, not an impossible
   * one. Stratum tectonicas — the highest-payout species in the game — grows in its canonical
   * atmosphere less than half the time.
   */
  unlikely?: boolean;
  /**
   * Our data on this species is thin and yours is thinner — sampling one here would teach the app
   * something. Set by `server/collectionFocus.ts` from a **local-only** file; never shipped, never
   * committed, and absent entirely when the commander switches the marker off.
   */
  collectionFocus?: boolean;
  /** Why it is marked: bodies in the corpus, and confirmations of your own. Display only. */
  collectionFocusNote?: { ownScans: number; corpusBodies: number; remaining?: number };
  /**
   * The terms that demoted it, so the card can say *why* rather than showing a bare percentage.
   * Set only when {@link unlikely}.
   */
  unlikelyReasons?: MatchReason[];
  /**
   * This species carries a Phase 7 spatial gate, but the app could not evaluate it — no coordinate
   * for the system, or no catalogue on disk.
   *
   * Not a failure and not a pass: it is the third answer, "we cannot check here". The card stays,
   * because absence of evidence is not evidence of absence — but the genus split must not put a
   * percentage on it, since a share is normalised inside the genus and one unknowable member makes
   * every other member's figure wrong too.
   */
  spatialGateUnresolved?: boolean;
  /** Exobiology line complete on this body (two Sample + one Analyse in journal, per codex key). */
  organicAnalysisComplete?: boolean;
  /**
   * Multiplies "Chance here" — set when a spatial gate's soft band keeps the row listed at a lower
   * chance (Bark Mounds 150–300 ly from a nebula; `spatialGates.ts`).
   */
  presenceFactor?: number;
  /**
   * Confirmed here by the composition scanner and not on foot — the `[Comp Scan]` badge.
   *
   * Set only when there is no `ScanOrganic` for this species on this body: a foot scan says
   * everything a comp scan does and also that the commander could get to it.
   */
  confirmedByCompositionScan?: boolean;
  /**
   * Who logged this species on this body (owner, 2026-09-25): "you" — a foot scan or the
   * composition scanner in this commander's journal — or "others", from Spansh for a system
   * looked up remotely. Absent when nobody has, which is the prediction case.
   */
  loggedBy?: "you" | "others";
  /**
   * Demoted by the gates, and sampled here anyway — so it is listed with the candidates, banner and
   * all, instead of being collapsed behind "show unlikely".
   *
   * {@link unlikely} stays true and so does {@link unlikelyReasons}: the demotion is still the
   * honest description of what the app thought, and the reason is usually the interesting part. Only
   * where the row is filed changes. The commander's own boots outrank the app's opinion about a body
   * it has never stood on.
   */
  sampledHere?: boolean;
  /** Suggested from `data/foot_scanned.json` when DSS/signals imply genera the DB did not return under strict gates. */
  learnedFromFootScan?: boolean;
  /** Which journal confirmations (`ScanOrganic`) produced matching foot-catalog rows (analyse vs sample). */
  footCatalogConfirmations?: FootCatalogConfirmation[];
  /** Per-catalog-hit comparison vs this body's scan. */
  footScanMatch?: FootScanMatchPayload;
  /** True when any `*_exomastery*.json` exists for this species pack (feeder export). */
  exomasteryProfilePresent?: boolean;
  /**
   * 0–100 weighted habitat quality vs exomastery (before same-genus competitive scaling).
   * Null when the profile exists but no scan fields overlap the profile.
   */
  exomasteryHabitatQuality?: number | null;
  /**
   * 0–100 absolute match from tiered “Other matching details” deck (linear scale); cross-genus comparable.
   * Null when no exomastery overlap — UI omits the bar (species still listed from genus JSON gates).
   */
  exomasterySimilarityPercent?: number | null;
  /**
   * 0–100 when multiple same-genus exomastery candidates on this body: max deck = 100, min = 0. Null when only one.
   */
  exomasteryGenusRelativePercent?: number | null;
  /**
   * Chance this species is one of the ones actually on this body, 0-100.
   *
   * The Bayes posterior over the body's candidates (`speciesLikelihood.ts`), multiplied by the
   * biological signal count because the game places that many genera and the posterior answers
   * "which one species is it". Unlike every other percentage on this row it has been calibrated: on
   * complete-label bodies the 90-100 bin comes in at 97.8 % observed and the 0-10 bin at 8.9 %, mean
   * squared gap 0.0045 (`npm run rank-probe --model`).
   *
   * Null when the model has no opinion — no profile, fewer than 20 observed bodies, or nothing about
   * this body it can measure. Null is "unmeasured", never "unlikely".
   */
  presenceProbabilityPercent?: number | null;
  /**
   * Share of its own genus this species holds, 0-100 — P(this species | this genus is here).
   *
   * The question changes after a DSS: `SAASignalsFound` names the genera, so "is Bacterium here" is
   * answered and only "which Bacterium" is left. This is that answer, and it is the same posterior
   * as {@link presenceProbabilityPercent} normalised inside the genus instead of across the body.
   *
   * Meaningful whenever the genus is actually present; before a DSS that is itself uncertain, which
   * is why both numbers exist. Null when the model could not score the row.
   */
  genusSharePercent?: number | null;
  /**
   * True when this commander has no codex page for this species (B4).
   *
   * From `CodexEntry` across the merged journals, colour variant ignored. For a codex hunter this is
   * the reason to fly somewhere, so it reads as an invitation rather than a warning. Absent — rather
   * than false — when the journals have not been re-merged since the app started collecting them, so
   * "no badge" never silently means "already logged".
   */
  notInCodex?: boolean;
  /**
   * [CODEX]: not yet in the commander's codex for this galactic region, in the colour this body would
   * grow (per colour, per region — as the game's CODEX tab keeps it; shared/codexLog.ts). Absent when
   * already logged, when the region is unknown, or before the journals were merged with the record.
   */
  codexNew?: boolean;
  /**
   * The colour logged for this species on this body (a foot or composition scan's variant), which
   * wins over the predicted one. Absent until it has been scanned here.
   */
  confirmedColour?: string;
  /**
   * The colour the app predicts for this row on this body (server-side, one rule for every panel):
   * the species' own table or materials, else the stars by their light on the body. "(unknown)" when
   * nothing decides.
   */
  predictedColour?: string;
  /**
   * Set when {@link confirmedColour} is not what the app predicted for this body: the prediction, for
   * the flag on the row. Such a find is written to the outliers file as a `colour` record.
   */
  colourMismatchPredicted?: string;
  /** The colours that would be new ("Green", or both of "Cyan or Orange"); empty when the colour is unknown. */
  codexNewColours?: string[];
  /** The region the mark is about, for the tooltip. */
  codexRegion?: string;
  /**
   * [CODEX FIRST] (owner, 2026-09-30): nobody has logged it in this region as far as EDSM's codex dump
   * knows — logging it would make the commander its first discoverer here (server/codexFirst.ts).
   * Only on a [CODEX] row; the colours that would be firsts, [] when the colour is unknown.
   */
  codexFirst?: boolean;
  codexFirstColours?: string[];
  /** The EDSM dump date the mark is from. */
  codexFirstAsOf?: string;
  /** EDAstro's codex file was checked too (fetch date), when the phenomena data is downloaded. */
  codexFirstEdastroAsOf?: string;
  /** The EDDN collector's ledger was checked too, through this date (eddnLedger.ts, 2026-10-04). */
  codexFirstEddnAsOf?: string;
  /** EDAstro has this species in the region but not which colour: still gold, with a note. */
  codexFirstEdastroSpeciesOnly?: boolean;
  /**
   * A [CODEX FIRST] row in the list at 1 % or less: why it is there (the floor rule that kept it), for
   * the row's red tint and [?] (owner, 2026-10-09). Absent otherwise.
   */
  lowChanceWhy?: string;
  /** This plant, here, would advance the tracked achievement (`server/achievements.ts`). */
  achievementAdvance?: import("./achievements.js").AchievementAdvanceDTO;
  /** This species' rarity in the body's region (`shared/speciesRarity.ts`); the DNA badge shows it. */
  regionRarity?: import("../speciesRarity.js").RegionalRarity;
  /**
   * Distinct feeder bodies behind {@link exomasteryHabitatQuality}. Null when no profile.
   * Small counts mean the habitat signal is weak, not that the habitat is wrong.
   */
  exomasteryProfileSampleCount?: number | null;
  /**
   * Profile present, habitat quality exactly 0, and enough samples for that to mean something:
   * the body does not resemble anywhere this species has been observed. The candidate is still
   * listed — it is ranked last and labelled, never removed. Species that only matched through a
   * DSS temperature or physical slack fallback are never marked.
   */
  exomasteryHabitatUnlikely?: boolean;
  /** Feeder-only: strongest clustering dimensions in the profile sample (spawn “habit” concentration). */
  exomasteryVarietyHints?: ExomasteryVarietyItemDTO[] | null;
  /** Basename of on-disk profile JSON under `data/species/<genusDir>/` for download API. */
  exomasteryExportBasename?: string | null;
  /** Habitat / feeder comparison chips (Candidate species → Other match details). */
  otherMatchDetailCards?: OtherMatchDetailCardDTO[] | null;
  /**
   * Combined unit score from “Other matching details” tiers + chip colours (used for same-genus similarity display).
   * Set server-side from feeder preview cards; null when no profile or scan.
   */
  exomasteryOtherMatchCardScore?: number | null;
  /** Per-field typical vs current (for modal); omitted when no profile or scan. */
  exomasteryDetail?: ExomasteryDetailDTO | null;
  /**
   * Set on the app channel instead of `exomasteryDetail`, `exomasteryVarietyHints` and
   * `otherMatchDetailCards` (UI review P1b): the body key to ask `/api/match-detail` with when the
   * habitat modal or the other-details drawer opens, whether there is a habitat breakdown, and how
   * many detail cards there are; `v` changes whenever what was left out does.
   */
  lazyDetail?: { body: string; habitat: boolean; otherCards: number; v: string };
}

/** One species row contributing to organic sell-range min or max totals. */
export interface ExoPayoutSpeciesLineDTO {
  id: string;
  displayName: string;
  /** Row from `data/price-list.json` via strict key match (CR). */
  listCredits: number;
  /** `listCredits` × payout multiplier, rounded (CR). */
  payoutCredits: number;
}
