import type { GenusLikelihood } from "./genusCooccurrence.js";
import type { TriageTiming } from "./systemTriage.js";
import type { JournalHistoryPreset } from "./journalHistoryPreset.js";
import type { PollRatesDTO } from "./pollRates.js";
import type { RadarRadiusDTO } from "./radarRadius.js";

export type { JournalHistoryPreset };
export type { PollRatesDTO };
export type { RadarRadiusDTO };

/** Elite journal line (subset) */
export interface JournalLine {
  timestamp?: string;
  event?: string;
  [key: string]: unknown;
}

export interface PlanetScan {
  BodyName: string;
  BodyID: number;
  StarSystem: string;
  SystemAddress: number;
  PlanetClass?: string;
  Atmosphere?: string;
  AtmosphereType?: string;
  /** Journal value is **m/s²** (not Earth g). Convert with `/ 9.80665` for g. */
  SurfaceGravity?: number;
  /** Kelvin (journal `Scan` detailed). */
  SurfaceTemperature?: number;
  SurfacePressure?: number;
  /** Journal `Scan` / `Body` semi-major axis in metres (converted to AU for temperature heuristic). */
  SemiMajorAxis?: number;
  TidalLock?: boolean;
  Volcanism?: string;
  Landable?: boolean;
  TerraformState?: string;
  /** From detailed `Scan`: false until someone has claimed first footfall on this body. */
  WasFootfalled?: boolean;
  /** Journal detailed scan: crust material percentages (`Materials`). */
  materials?: { Name?: string; name?: string; Percent?: number; percent?: number }[];
  /** Journal `AtmosphereComposition` on detailed scan. */
  atmosphereComposition?: { Name?: string; name?: string; Percent?: number; percent?: number }[];
  /** Journal `Composition` (ice / rock / metal fractions). */
  composition?: Record<string, number>;
  /** Journal body radius in metres (`Radius`). */
  radius?: number;
  /** Detailed scan: Earth masses (`MassEM`). */
  MassEM?: number;
  /** Seconds (`RotationPeriod`). */
  RotationPeriod?: number;
  /** Radians (`AxialTilt`). */
  AxialTilt?: number;
  OrbitalPeriod?: number;
  Eccentricity?: number;
  OrbitalInclination?: number;
  Periapsis?: number;
  AscendingNode?: number;
  MeanAnomaly?: number;
  /** Journal `Scan.DistanceFromArrivalLS` — distance from system entry point in light-seconds. */
  distanceFromArrivalLs?: number;
}

export interface GenusHint {
  Genus_Localised: string;
  Genus: string;
}

/** Codex vs live scan / feeder consistency (Planetary body panel). */
export interface ExoDataAlertDTO {
  id: string;
  severity: "error" | "warning";
  /** Journal-based checks vs exomastery feeder profile JSON under data/species/.../exomastery/. */
  detectionSource: "journal" | "exomastery";
  title: string;
  detail: string;
  /** Plain text copied when user clicks Fix. */
  fixClipboard?: string;
  /** Populated on the server so Fix can write `fixes_*` stubs next to the right JSON. */
  speciesEntryId?: string;
  genusDataDir?: string;
  /** Journal fields used to generate criteriaPatch (volcanism tokens, etc.); not shown in UI. */
  journalFixHints?: {
    volcanism?: string;
    /**
     * Host `Scan.StarType` (merged parent). Used when codex fails the {@link SpeciesCriterion.parentStarTypeIncludesAnyOf}
     * fragment gate so Fix can append matching fragments to `fixes_*.json`.
     */
    parentStarType?: string;
  };
}

/** One confirmed on-foot organic sample on a body (ScanOrganic) — locks that genus to one species. */
export interface OrganicGenusLock {
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
  /**
   * How the species was confirmed on this body.
   *
   * `foot` is a `ScanOrganic` — the commander walked up to it. `codex` is a `CodexEntry` written by
   * the composition scanner, which names the species and the body without a landing, and which the
   * owner asked to count: some plants are on ground you cannot put a ship down near.
   *
   * Absent means `foot`. Caches written before this field existed hold nothing but foot scans.
   */
  source?: "foot" | "codex";
}

export interface BodyExoState {
  key: string;
  bodyName: string;
  bodyId: number;
  systemAddress: number;
  starSystem: string;
  /** From FSSBodySignals Biological Count */
  biologicalSignals: number | null;
  /** From SAASignalsFound after DSS */
  genusHints: GenusHint[] | null;
  dssComplete: boolean;
  scan: PlanetScan | null;
  /**
   * Merged `Type` / `Type_Localised` strings from `FSSBodySignals` and `SAASignalsFound` `Signals` arrays
   * (geological / biological / …). Used for optional exobiology gates (e.g. fumaroles).
   */
  signalHints?: string[] | null;
  /** From ScanOrganic — at most one species per genus on a body; variant label resolves the row. */
  organicGenusLocks: OrganicGenusLock[];
  /** From ScanOrganic / Variant_Localised (legacy list for UI) */
  confirmedVariants: string[];
  updatedAt: string;
}

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
   * Amphora plant and the Brain Trees are the only rows that carry it. Read by
   * `shared/systemBodyGates.ts`, which demotes rather than excludes and abstains until the honk is
   * finished — an absence in a half-scanned system is not an absence.
   */
  systemBodyClassesAnyOf?: string[];
  /**
   * Atmospheres the species is recorded on but rarely wins, measured against its own genus.
   *
   * Demotes, never excludes: `shared/atmospherePreference.ts` carries the numbers. A species row
   * without it behaves exactly as before.
   */
  atmosphereUnfavouredAnyOf?: string[];
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
   */
  softMaxSemiMajorAxisLs?: number;
  /** Journal SurfacePressure (official docs: atmospheres for landables) */
  surfacePressure?: { min?: number; max?: number };
  landable?: boolean;
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
  /** Orbit distance from host star in light-seconds; only when context provides it. */
  orbitDistanceFromParentStarLs?: { min?: number; max?: number };
  /**
   * Atmosphere pressure class using shared thin threshold (`THIN_ATMOSPHERE_MAX_ATM`, default 0.1 atm after journal conversion).
   * Gate runs only when context exposes surface pressure.
   */
  atmospherePressureCategory?: "thin" | "thick";
  /** Any fragment must match a merged scanner signal hint (geological, etc.). */
  geologicalSignalIncludes?: string[];
  /** If true, require journal volcanism text (same as brain-tree rule) even without `volcanismIncludes`. */
  volcanismActiveRequired?: boolean;
  /** Appended to match reasons when a row passes (terrain / codex wording — not a hard planet-class gate). */
  matchContextNotes?: string[];
}

export interface SpeciesEntry {
  id: string;
  displayName: string;
  genus: string;
  /**
   * How this **species** gets its colour variant, and the table.
   *
   * Per species rather than per genus because the game is per species: three Bacterium read the
   * star and six read a material. See `shared/colourVariants.ts`. Absent when ED-DSN publishes no
   * table for it — Brain Trees and Sinuous Tubers carry the colour in the species name instead.
   */
  colourVariant?: import("./colourVariants.js").ColourVariantRule;
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

/**
 * "My discoveries": every system, body and star in the merged journals, for searching and filtering.
 *
 * Built on request rather than carried on the snapshot — see `src/server/discoveries.ts` for why,
 * and for the difference between an estimated value and a sold one, which this DTO keeps apart on
 * purpose.
 */
export interface DiscoveriesDTO {
  generatedAt: string;
  systems: DiscoverySystemRow[];
  bodies: DiscoveryBodyRow[];
  stars: DiscoveryStarRow[];
}

export interface DiscoverySystemRow {
  systemAddress: number;
  name: string;
  /** klightspeed codex region, when the system's position is known. */
  region: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  stars: number;
  bodies: number;
  landables: number;
  terraformables: number;
  earthLikes: number;
  waterWorlds: number;
  ammoniaWorlds: number;
  /** Bodies carrying at least one biological signal, and the total across them. */
  bioBodies: number;
  bioSignals: number;
  /** Species confirmed on foot here. */
  speciesConfirmed: number;
  firstDiscoveries: number;
  /**
   * Whether **this system** is the commander's discovery, which is a different question from
   * {@link firstDiscoveries}.
   *
   * The game decides it on the main star — `BodyID 0`'s `WasDiscovered` — and that is what puts his
   * name on the system and pays the bonus. Being first to scan body 7 of somebody else's system
   * makes that *body* his and the system still theirs, so a filter built on the body count listed
   * systems he knew perfectly well he had not found.
   *
   * `null` when the main star was never scanned with the flag present: unknown is not "yes".
   */
  firstDiscoveredSystem: boolean | null;
  firstFootfalls: number;
  dssMapped: number;
  /** Type of body 0, which is what a commander means by "the star". */
  primaryStarType: string | null;
  /** What the app thinks the system is worth, from the same model the map prices with. */
  estimatedCredits: number;
  /**
   * What selling actually paid, or null when he has not sold it.
   *
   * Never merged with {@link estimatedCredits}: one is a measurement and the other is a guess, and a
   * column that silently switches between them is a column nobody can reason about.
   */
  soldExplorationCredits: number | null;
  soldExobiologyCredits: number | null;
  /** Journal `FSSAllBodiesFound` — the honk finished, so the body list is complete. */
  fullyScanned: boolean;
  firstVisit: string | null;
  lastVisit: string | null;
}

export interface DiscoveryBodyRow {
  key: string;
  systemAddress: number;
  system: string;
  region: string | null;
  bodyName: string;
  planetClass: string;
  atmosphere: string | null;
  volcanism: string | null;
  terraformState: string | null;
  /** Tri-state: the journal's own flag, and null when it never said. */
  landable: boolean | null;
  gravityG: number | null;
  surfaceTemperatureK: number | null;
  surfacePressurePa: number | null;
  /**
   * Earth radii, not kilometres.
   *
   * The game shows a body against Earth and a star against the Sun, and the commander's own reason
   * is the better one: kilometres are subject to the km/miles setting, so a table in kilometres is a
   * table he has to convert in his head depending on how the game is configured. It also pairs with
   * {@link massEM} — radius and mass read in the same frame.
   */
  radiusEarth: number | null;
  massEM: number | null;
  distanceLs: number | null;
  bioSignals: number | null;
  speciesConfirmed: string[];
  dssMapped: boolean;
  firstDiscoverer: boolean;
  /**
   * Whether the **system** this sits in is the commander's discovery, from its arrival star.
   *
   * Separate from {@link firstDiscoverer}, which is about this body alone. Both are true facts and
   * they answer different questions: being first to scan a body in somebody else's system makes the
   * body his and the system theirs. Filtering on the body's own flag listed 25 Earth-likes as first
   * discoveries where the Systems tab, asking the same question of the system, found 6.
   *
   * `null` when the arrival star was never scanned with the flag present.
   */
  firstDiscoveredSystem: boolean | null;
  firstFootfall: boolean;
  estimatedCredits: number;
  scannedAt: string | null;
}

export interface DiscoveryStarRow {
  key: string;
  systemAddress: number;
  system: string;
  region: string | null;
  bodyName: string;
  starType: string;
  subclass: number | null;
  luminosity: string | null;
  solarMasses: number | null;
  /** Solar radii, which is how the game itself shows a star. See `DiscoveryBodyRow.radiusEarth`. */
  radiusSolar: number | null;
  surfaceTemperatureK: number | null;
  distanceLs: number | null;
  firstDiscoverer: boolean;
  /**
   * Whether the **system** this sits in is the commander's discovery, from its arrival star.
   *
   * Separate from {@link firstDiscoverer}, which is about this body alone. Both are true facts and
   * they answer different questions: being first to scan a body in somebody else's system makes the
   * body his and the system theirs. Filtering on the body's own flag listed 25 Earth-likes as first
   * discoveries where the Systems tab, asking the same question of the system, found 6.
   *
   * `null` when the arrival star was never scanned with the flag present.
   */
  firstDiscoveredSystem: boolean | null;
  estimatedCredits: number;
  scannedAt: string | null;
}

export interface SpeciesDatabase {
  species: SpeciesEntry[];
}

/** One row for the Encyclopedia UI (resolved photo URL on the server). */
export interface EncyclopediaSpeciesRowDTO {
  entry: SpeciesEntry;
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

  /**
   * Count of per-body EDSM / CSV / JSON row exports when present.
   * Feeder profile cards use {@link exomasteryProfileFilePresent} instead.
   */
  exomasteryEdsmSampleCount: number;
  /**
   * Bodies from feeder for this species: profile JSON `sampleCount` (distinct EDSM planets analyzed)
   * or, when no profile, same as {@link exomasteryEdsmSampleCount}.
   */
  exomasteryFeederBodyCount: number;
  /** `*_exomastery*.json` loads as a usable feeder profile (mode/mean rollups). */
  exomasteryProfileFilePresent: boolean;
  /** Encyclopedia can open inline Exomastery (profile and/or at least one EDSM row). */
  exomasteryEncyclopediaAvailable: boolean;
  /**
   * Single-sample warning: profile rollup `count === 1` or exactly one EDSM row (no multi-sample cohort).
   * When unknown counts on profile (`max count` 0), this stays false.
   */
  exomasteryDataInsufficient: boolean;
}

export type EncyclopediaExomasteryFieldTier = "blue" | "green" | "yellow" | "orange" | "red";

/** Chart payload: min/max/mode from exomastery feeder rollup (or EDSM column sample min/max); `current` = BODY marker only. */
export interface ExomasteryStatDistributionDTO {
  min: number;
  max: number;
  mode: number;
  current: number | null;
  /**
   * The observed distribution, when the profile carries a histogram for this parameter (B7).
   *
   * Present: the chart draws what was actually counted, and a species that lives at two separate
   * temperatures looks like two humps. Absent: the chart falls back to a bell curve around the mode,
   * which is a drawing rather than a measurement — the exact summary B7 was raised to replace.
   *
   * Bins come from the globally shared edges, so they are equal-population across the corpus and
   * therefore **unequal width**. The chart plots count ÷ width for that reason; anything else would
   * make a wide bin look tall for being wide.
   */
  bins?: { x0: number; x1: number; count: number }[];
  /** Server path used for unit formatting (e.g. body.materials.Fe, EDSM column key). */
  displayPath: string;
  minLabel: string;
  maxLabel: string;
}

/** One trait on one planet in Encyclopedia exomastery breakdown. */
export interface EncyclopediaExomasteryFieldDTO {
  id: string;
  columnKey: string;
  label: string;
  valueDisplay: string;
  /** Feeder profile: mean (μ); EDSM row: cohort mean — shown as “Typical”. */
  typicalDisplay?: string;
  /** Feeder profile: mode; EDSM row: this body’s value — shown as “Mode”. */
  modeDisplay?: string;
  /** Pre-formatted deviation (e.g. `12.3%`). */
  deviationDisplay?: string;
  tier: EncyclopediaExomasteryFieldTier;
  /** Deviation from mean (numeric) or 100×(1−frequency) for categorical rarity vs sample. */
  deviationPercent: number;
  contextNote: string;
  distribution?: ExomasteryStatDistributionDTO | null;
}

/** Grouped traits (atmosphere / surface / orbit / misc) for encyclopedia cards. */
export interface EncyclopediaExomasterySectionDTO {
  title: string;
  fields: EncyclopediaExomasteryFieldDTO[];
}

/** One planet / CSV row with all comparable traits. */
export interface EncyclopediaExomasteryPlanetDTO {
  index: number;
  title: string;
  /** Flat list (legacy); prefer {@link sections} when present. */
  fields?: EncyclopediaExomasteryFieldDTO[];
  sections?: EncyclopediaExomasterySectionDTO[];
}

export interface EncyclopediaExomasteryPlanetsResponseDTO {
  speciesEntryId: string;
  displayName: string;
  genusDataDir: string;
  sampleCount: number;
  /** `profile` = feeder JSON rollups (mode vs μ); `edsm` = per-body row cohort. */
  source?: "profile" | "edsm";
  planets: EncyclopediaExomasteryPlanetDTO[];
  /**
   * When the client passes `focusBodyKey` (BODY tab) and this species has a feeder profile:
   * merged journal scan vs profile — same math as Similarity index. Shown even if the species is
   * not a candidate on that planet.
   */
  focusBody?: EncyclopediaExomasteryFocusBodyDTO | null;
}

/**
 * Feeder state for the Options panel.
 *
 * The feeder is a maintainer tool: its 250 MB corpus of raw EDSM sample packs never ships, so on a
 * normal install `available` is false and the panel is not rendered at all. Where it is present, the
 * panel answers one question — is the data the app ranks with the data the corpus actually holds?
 */
export interface FeederStatusDTO {
  /** False when there is no corpus on this machine; the panel hides itself. */
  available: boolean;
  corpusDir: string | null;
  /**
   * The path the owner set in Options, or null when none is remembered.
   *
   * The two search locations are relative to `PROJECT_ROOT`, which in a packaged build is the
   * install directory — so a corpus that lives beside the *repository* was unreachable and the
   * feeder reported itself unavailable no matter what was on disk. This is the escape.
   */
  configuredCorpusDir: string | null;
  /** Everywhere the app looked, in order, so an unavailable feeder can say why rather than just hide. */
  searchedDirs: string[];
  /**
   * Counts that need the feeder's SQLite store, taken from the snapshot its CLI writes rather than
   * by opening the store here — that would pull a WASM SQLite build into the shipped server.
   * Null until the feeder has run once on this machine.
   */
  snapshot: {
    writtenAtIso: string;
    lastCommand: string;
    uniqueSystems: number;
    uniquePlanets: number;
    uniqueSightings: number;
    corpusSpecies: number;
    cumulativeCsvRows: number;
  } | null;
  /** Species with sample packs on disk — what a rebuild would read. Computed live. */
  hydratedSpecies: number;
  speciesRows: number;
  speciesRowsWithProfile: number;
  /** Total size of the installed profiles, so the shipped-data cost is visible. */
  profileBytes: number;
  /**
   * Profiles built from fewer bodies than the corpus already holds — the actionable list, truncated
   * for display. {@link behindCount} and {@link behindOccurrences} are the real totals, because a
   * truncated list that reports its own length understates the problem it exists to show.
   */
  behind: { species: string; profileSamples: number; corpusOccurrences: number }[];
  behindCount: number;
  /** Observed bodies the corpus holds that no installed profile has been built from. */
  behindOccurrences: number;
  /** Corpus species with no row in the app's species tree, listed rather than guessed at. */
  unmatchedCorpusLabels: string[];
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

/**
 * How a foot-catalog row was recorded from the journal, weakest first.
 *
 * All three name the species — the journal writes `Species_Localised` on every `ScanOrganic` line —
 * so all three confirm the species was on that body. What they differ on is how much of it the
 * commander then took:
 *
 *  - `log`     — first contact with the composition scanner. Seen and identified, nothing harvested.
 *  - `sample`  — one of the three samples that make a sellable specimen.
 *  - `analyse` — the third sample, which completes it.
 *
 * The distinction is about payout, not about presence, so a `log` is evidence exactly as much as an
 * `analyse` is. Skipping the low-value species after logging it is a normal way to play, and 85 of
 * this commander's 352 observations are that.
 */
export type FootCatalogConfirmation = "analyse" | "sample" | "log";

/** Strongest wins when the same species on the same body is seen more than once. */
export const FOOT_CONFIRMATION_RANK: Record<FootCatalogConfirmation, number> = {
  log: 0,
  sample: 1,
  analyse: 2,
};

/** One row learned from a prior on-foot `ScanOrganic` plus detailed scan (persisted in `data/foot_scanned.json`). */
export interface FootScannedEntry {
  id: string;
  recordedAt: string;
  /** Strongest `ScanType` seen for this species on this body — see {@link FOOT_CONFIRMATION_RANK}. */
  confirmationSource?: FootCatalogConfirmation;
  planetClass: string;
  /** From `normalizeScanAtmosphereForMatch` — compositional token or "" (vacuum). */
  atmosphereNorm: string;
  surfacePressure: number | null;
  surfaceTemperatureK: number | null;
  tempBandMinK: number;
  tempBandMaxK: number;
  tempMidK: number;
  surfaceGravityMs2?: number;
  starSystem: string;
  systemAddress: number;
  bodyId: number;
  bodyName: string;
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
  /** Resolved `SpeciesEntry.id` when identifiable at record time. */
  speciesEntryId: string | null;
  /** Top strict DB candidate for this genus + scan (locks ignored) at record time. */
  dbProbableSpeciesId: string | null;
  /** True when `dbProbableSpeciesId` differs from `speciesEntryId` (both non-null). */
  dbProbableDisagreed: boolean;
}

export interface FootScannedFile {
  formatVersion: number;
  entries: FootScannedEntry[];
}

/** One compared attribute: this body vs a foot-catalog snapshot. */
export interface FootScanFieldRow {
  key: string;
  label: string;
  currentDisplay: string;
  catalogDisplay: string;
  matches: boolean;
  /** Genus `criteria` in `data/species/…` includes this dimension. */
  speciesCriteriaIncludes: boolean;
}

/** One foot-catalog row that matched `isCloseFootScanProfile` for the current body scan. */
export interface FootScanHitDetail {
  bodyName: string;
  starSystem: string;
  recordedAt: string;
  confirmationSource: FootCatalogConfirmation;
  fieldRows: FootScanFieldRow[];
}

/** Structured UI payload for the foot-scan suggestion card. */
export interface FootScanMatchPayload {
  hits: FootScanHitDetail[];
}

/** One row in the Exomastery breakdown modal (scan vs typical habitat). */
export interface ExomasteryStatDetailDTO {
  id: string;
  kind: "numeric" | "material" | "atmosphere" | "solid" | "categorical";
  /** Original feeder path (for grouping in UI); optional on older payloads. */
  chartPath?: string;
  label: string;
  typicalDisplay: string;
  currentDisplay: string;
  /** When true, this stat is not in the journal/DSS merge — it does not affect similarity. */
  isMissing: boolean;
  /** |current − typical| in percentage points (materials / gas / solid %). */
  diffPoints: number | null;
  /** |current − typical| / max(|typical|, ε) × 100 for scalar numerics; null if not applicable. */
  diffRelativePercent: number | null;
  /** Relative difference exceeds 200% — UI shows a capped message instead of a huge number. */
  diffHuge?: boolean;
  /** Compact crust / atmo composition rows: ▲ green, ▼ red, — yellow (≤1 pp), none if missing. */
  chevron: "up" | "down" | "dash" | "none";
  compact: boolean;
  /** When kind is categorical and the row is not missing: how close scan is to modal after normalization (e.g. atmosphere). */
  categoricalCloseness?: "match" | "close" | "different";
  /**
   * Host-star MK tiers: `{@link categoricalCloseness}` ignored for duplex color — 0 = match … 4+ = farthest → red tier.
   * Only set on spectral / luminosity / host-subclass categorical rows vs EDSM cohort.
   */
  stellarProximitySteps?: number | null;
  stellarProximityAxis?: "spectral" | "subclass" | "luminosity";
  /** Distribution chart uses feeder min/max only; `current` marks BODY (SVG), not axis endpoints. */
  distribution?: ExomasteryStatDistributionDTO | null;
}

/** Aggregate match quality for one composition group (crust / atmosphere / solid). */
export interface ExomasteryCompositionSummaryDTO {
  overallMatchPercent: number | null;
  best: { label: string; matchPercent: number } | null;
  worst: { label: string; matchPercent: number } | null;
}

export interface ExomasteryCompositionGroupDTO {
  id: "crust" | "atmosphere" | "solid";
  title: string;
  summary: ExomasteryCompositionSummaryDTO;
  rows: ExomasteryStatDetailDTO[];
}

/** Full comparison table for pop-up when clicking Similarity Index. */
export interface ExomasteryDetailDTO {
  stats: ExomasteryStatDetailDTO[];
  compositionGroups: ExomasteryCompositionGroupDTO[];
  /** Surface temperature + gravity numerics (subset of profile paths) — shown under the Atmosphere modal section. */
  atmosphereClimateStats?: ExomasteryStatDetailDTO[];
}

/** Exomastery vs the planet selected in the main UI BODY: tab (merged FSS/DSS journal scan). */
export interface EncyclopediaExomasteryFocusBodyDTO {
  bodyKey: string;
  bodyTabLabel: string;
  starSystem: string;
  planetClass: string | null;
  /** 0–100 weighted habitat quality; null when {@link unavailableReason} is set. */
  habitatMatchPercent: number | null;
  unavailableReason: string | null;
  /** Duplex field breakdown (Typical vs This body); null when scan data is insufficient. */
  detail: ExomasteryDetailDTO | null;
}

/** Compact comparison chip for Candidate species — Other match details. */
export interface OtherMatchDetailCardDTO {
  id: string;
  /** Lower sorts earlier. */
  priority: number;
  shortTitle: string;
  topLegend: string;
  topValue: string;
  bottomLegend: string;
  bottomValue: string;
  tooltip: string;
  /** Same deviation tiers as encyclopedia / habitat rows: closer match → blue/green; farther → orange/red. */
  highlight?: EncyclopediaExomasteryFieldTier | "neutral";
}

/** One row for “lowest variety / strongest mode” hints from the feeder profile (no planet context). */
export interface ExomasteryVarietyItemDTO {
  id: string;
  label: string;
  /** 0–100 — higher means the sample clusters more tightly on one value (categorical mode share or tight numeric band). */
  concentrationPercent: number;
}

export interface SpeciesProvenance {
  /** The commander scanned this species on this exact body. */
  firstHand: boolean;
  firstHandAt?: string;
  /** Bodies in this system the shipped corpus confirms this species on. System resolution, not body. */
  corpusInSystem: number;
  /** Whether the corpus knows this system at all, so a 0 above can be told from silence. */
  systemInCorpus: boolean;
}

export interface SpeciesMatch {
  entry: SpeciesEntry;
  reasons: MatchReason[];
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
   * Confirmed here by the composition scanner and not on foot — the `[Comp Scan]` badge.
   *
   * Set only when there is no `ScanOrganic` for this species on this body: a foot scan says
   * everything a comp scan does and also that the commander could get to it.
   */
  confirmedByCompositionScan?: boolean;
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

/** Estimated sell-value band for completing all exo slots on a body (strict price list × footfall mult). */
/**
 * One body in the first-discovery backlog: biology this commander found and never collected.
 *
 * Both credit figures already carry the 5x, because the whole point of the row is that the
 * first-footfall bonus is still unclaimed. `minCr` is the floor — what the body pays if every slot
 * turns out to hold the cheapest candidate — and is the number to plan a route on. `maxCr` is the
 * ceiling and can be wildly higher on a body whose candidate list has one rare outlier.
 */
/** One species in a system, priced. `firstFootfallCr` is display only — the filter uses `baseCr`. */
export interface GalaxyValueSpeciesDTO {
  speciesId: string;
  displayName: string;
  /** What one sample sells for at 1x — the number the filter tests. */
  baseCr: number;
  /** The same at 5x, for a commander who gets there first. Never filtered on. */
  firstFootfallCr: number;
}

/**
 * A system the codex says holds something worth at least the asked-for price.
 *
 * A recorded sighting, not a prediction — somebody logged this species in this system. That is a
 * different claim from the backlog panel's estimates and must not be shown as the same thing.
 */
export interface GalaxyValueHitDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  /** klightspeed region index, 1-42; 0 when unknown. */
  regionId: number;
  /** Straight-line light years from the commander, or null when their position is unknown. */
  distanceLy: number | null;
  /** Only the species that clear the threshold, dearest first. */
  species: GalaxyValueSpeciesDTO[];
  bestCr: number;
  /** Everything the codex knows here, including species under the threshold. */
  totalKnownSpecies: number;
  /** Sum of every known species here at 1x — what the slider tests. */
  systemCr: number;
  /** The same at 5x, if nobody has walked these bodies. Never filtered on; the index cannot know. */
  systemFirstFootfallCr: number;
  /** Evidence flags for this system — TIER_FSS | TIER_DSS | TIER_CODEX | TIER_BODIES_KNOWN. */
  tiers: number;
  /** Spansh's body count, or 0 when unknown — not the same as a system with no bodies. */
  bodyCount: number;
}

/**
 * What a commander asked the galaxy for.
 *
 * Price and species are alternatives, not a pair. Choosing *Stratum tectonicas* fixes the price at
 * 19,010,800, so a price filter beside it is either redundant or contradictory — the UI disables it
 * and says why. Choosing the *genus* Stratum leaves eight species spanning 1 M to 19 M, where "at
 * least 10 M" is a real question, so price stays live.
 */
/** One row of the genus/species picker: what can be searched for, and what it pays. */
export interface GalaxySpeciesOptionDTO {
  speciesId: string;
  displayName: string;
  genusDir: string;
  genusName: string;
  baseCr: number;
  /** Systems in the index where the codex has recorded this species. */
  systemCount: number;
}

export interface GalaxySpeciesCatalogueDTO {
  available: boolean;
  /** Ascending; the price control offers steps drawn from these. */
  species: GalaxySpeciesOptionDTO[];
  systemCount: number;
}

/**
 * What this commander's own journals say about one sector.
 *
 * Only their half: the client merges it with the sector map file it already holds, so the ladder in
 * shared/galaxyTier.ts lives in one place and a 900 kB corpus is not parsed twice.
 */
export interface CommanderSectorDTO {
  /** `x:y:z` sector cell key, matching the sector map file. */
  key: string;
  visited: boolean;
  scannedByYou: number;
  /** Bodies here with biology this commander has not scanned. Decides the "you missed some" tier. */
  unscannedByYou: number;
}

export interface CommanderSectorsDTO {
  /** False when there is no journal store behind this build. */
  available: boolean;
  rows: CommanderSectorDTO[];
}

export interface GalaxyValueQueryDTO {
  /**
   * Minimum **system** total, in credits, at 1x list price.
   *
   * Per system rather than per species, and at 1x rather than 5x, because the bonus is not knowable
   * from the index: nothing here says whether anybody has already walked those bodies. A commander
   * who arrives and finds it untouched earns five times this; the filter promises only what can be
   * promised. Ignored when `speciesIds` is set — a named species already has a price.
   */
  minCr: number;
  /** Exact species wanted. When present, price is not consulted. */
  speciesIds?: string[];
  /** Genus data directories to restrict to. Combines with `minCr`. */
  genusDirs?: string[];
  /** Required evidence flags (TIER_*), all of which must be present. 0 means any. */
  requireTiers?: number;
}

export interface GalaxyValueSearchDTO {
  /** False on a build with no galaxy index — the feature hides itself rather than showing nothing. */
  available: boolean;
  minCr: number;
  /** Echoed back so a stale response can be told from a current one. */
  query?: GalaxyValueQueryDTO;
  /** How many systems matched in total, before trimming to the nearest few. */
  matchedSystems: number;
  speciesConsidered: number;
  /** The nearest matches, for the list. Ordered by distance when the commander's position is known. */
  hits: GalaxyValueHitDTO[];
  /**
   * A galaxy-wide sample for the **map**: the richest system in each matching sector cell.
   *
   * The list and the map ask different questions. "Which of these should I fly to" is answered
   * nearest-first; "where does this species live" is not, and a nearest-first sample collapses onto
   * the commander's own position — 200 systems inside twelve pixels, in the case that prompted
   * this. Capped, so {@link spreadCells} says how many cells there really were.
   */
  spread?: GalaxyValueHitDTO[];
  /** Distinct sector cells that matched, before the sample was capped. */
  spreadCells?: number;
}

/**
 * One named galactic region the body file holds, for the region picker.
 *
 * The system count travels with the name because it is the difference between a one-second search
 * and a slow one: Inner Orion Spur carries two orders of magnitude more systems than the far arms,
 * and a picker that offers all forty-two identically hides that.
 */
export interface GalaxyRegionOptionDTO {
  /** klightspeed region index, 1-42. */
  regionId: number;
  name: string;
  systemCount: number;
}

export interface GalaxyRegionsDTO {
  /** False when this machine has no body file — the whole predicted search hides itself. */
  available: boolean;
  regions: GalaxyRegionOptionDTO[];
  systemCount: number;
  bodyCount: number;
  /** Bytes on disk. Half a gigabyte, and a reader is entitled to know what they are searching. */
  fileBytes: number;
}

/**
 * What a commander asked the galaxy's *unvisited* bodies for.
 *
 * The three evidence flags are independent ticks rather than a mode, which is the owner's design:
 * *"I choose filters FSS/DSS/ScanOrganic as proof. If ScanOrganic is not selected it excludes
 * them."* The first two describe a **body** — the dump carries a genus list only where somebody
 * probed it — and the third describes a **system**, and is answered from `bio-index.bin`, because
 * the body file knows nothing about who has walked where.
 */
export interface GalaxyBodyScanQueryDTO {
  /** Which region to walk. Required: the galaxy in one request is forty-two regions of waiting. */
  regionId: number;
  /** Exact species wanted. */
  speciesIds?: string[];
  /** Genus data directories, when no species was named. */
  genusDirs?: string[];
  /** Bodies with biological signals that nobody has probed. The default, and the point of this. */
  includeUnprobed?: boolean;
  /** Bodies somebody has already mapped with probes, where the genus is public knowledge. */
  includeProbed?: boolean;
  /** Systems where somebody has already logged a species on foot. Off excludes them entirely. */
  includeWalked?: boolean;
  /**
   * Drop bodies whose gravity gives biology less than this chance of being there at all.
   *
   * Off (0 or absent) by default and deliberately so: the scan's gates are a superset of the
   * matcher's, and a curve measured from one commander's journals should not quietly delete rows
   * nobody asked it to. Compared against the *smoothed* figure — see `server/gravityBiologyOdds.ts`
   * — so a band measured at 0 of 32 bodies is treated as unlikely rather than impossible.
   */
  minGravityOddsPct?: number;
}

/** One body that would be offered this species if a commander were standing on it. */
export interface GalaxyBodyMatchDTO {
  bodyId: number;
  bodyName: string;
  /** Planet class as the dump spells it, e.g. `Icy body`. Empty when unrecorded. */
  planetClass: string;
  atmosphere: string;
  volcanism: string;
  /** Kelvin; 0 means the dump did not record it. */
  temperatureK: number;
  /** Earth gees — the dump's unit, kept as measured. */
  gravityG: number;
  /** Atmospheres — the dump's unit. */
  pressureAtm: number;
  /** How many biological signals the FSS counted. The number of genera actually down there. */
  bioCount: number;
  landable: boolean;
  /** Somebody has probed this body, so the genus is already known. */
  probed: boolean;
  /** The wanted species that survive the gates here, un-demoted. Dearest first. */
  species: GalaxyValueSpeciesDTO[];
  /**
   * How often a body of this gravity carries **any** biology, from the commander's own journals.
   *
   * Reported, not applied — the species rows above are the matcher's verdict and this does not
   * change them. Null when the curve has nothing to say: an airless body, or one whose gravity the
   * dump never recorded. See `server/gravityBiologyOdds.ts` for the measurement and its limits.
   */
  gravityOdds?: {
    observedPct: number;
    smoothedPct: number;
    /** Bodies behind the figure. Small at the ends of the curve; shown so the row can say so. */
    bodies: number;
    bandLabel: string;
  } | null;
}

export interface GalaxyBodyHitDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  regionId: number;
  /** The primary's spectral class as the dump writes it — `K3`, `M9`. Empty when it named none. */
  starType: string;
  distanceLy: number | null;
  /** Somebody has logged a species in this system. Only ever true when the filter allowed it. */
  walked: boolean;
  /** How many bodies here carry biological signals at all, matched or not. */
  bioBodyCount: number;
  bodies: GalaxyBodyMatchDTO[];
}

/**
 * The answer to "where could this be, where nobody has looked".
 *
 * Every count is reported because the claim is a weak one and the reader has to be able to size it:
 * how many bodies were looked at, how many cleared the cheap numeric gate, how many the matcher
 * actually accepted. A bare list of names would read as certainty this does not have — these are
 * bodies whose conditions suit the species, not sightings.
 */
export interface GalaxyBodyScanDTO {
  /** False when this machine has no body file. The feature hides rather than showing nothing. */
  available: boolean;
  regionId: number;
  regionName: string | null;
  /** Systems in the region that held at least one body worth handing to the matcher. */
  systemsWithCandidates: number;
  /**
   * How many of the region's systems the walk actually reached.
   *
   * Equal to {@link systemsInRegion} unless {@link truncated}, and the pair is what makes a
   * truncated answer honest: a region is walked in system order, so stopping early leaves a prefix
   * rather than a sample, and a list headed "nearest first" over a prefix would be confidently
   * wrong. The panel reports the fraction instead of implying the whole.
   */
  systemsSearched: number;
  systemsInRegion: number;
  /** Bodies with biological signals walked in this region. */
  bodiesScanned: number;
  /** Of those, how many cleared the evidence filter and the numeric bands. */
  bodiesGated: number;
  /**
   * Dropped by {@link GalaxyBodyScanQueryDTO.minGravityOddsPct}, when one was set.
   *
   * Reported rather than left implicit: a filter that only makes a list shorter cannot be told apart
   * from a region with nothing in it, and the commander should be able to see what their own floor
   * cost them. Always 0 when no floor was asked for.
   */
  bodiesBelowGravityFloor?: number;
  /** Of those, how many the full matcher accepted un-demoted. */
  bodiesMatched: number;
  matchedSystems: number;
  speciesConsidered: number;
  /** The walk ran out of time before the region ended; {@link systemsSearched} says how far it got. */
  truncated: boolean;
  elapsedMs: number;
  /** The nearest systems, for the list. */
  hits: GalaxyBodyHitDTO[];
  /** One system per sector cell, for the map — see `galaxyValueSearch`'s spread for why. */
  spread?: GalaxyBodyHitDTO[];
  spreadCells?: number;
}

export interface FirstDiscoveryBacklogRowDTO {
  bodyKey: string;
  systemAddress: number;
  starSystem: string;
  bodyName: string;
  /** FSS biological signal count — how many species the game says are down there. */
  biologicalSignals: number;
  /** Guaranteed floor at 5x: every slot pays its cheapest candidate. */
  minCr: number;
  /** Ceiling at 5x: every slot pays its dearest. */
  maxCr: number;
  /** Distinct predicted species carrying a list price. */
  candidateCount: number;
  /** True once a DSS has named the genera, which narrows the prediction sharply. */
  genusKnown: boolean;
  dssComplete: boolean;
  /**
   * This commander scanned the system's main star before anyone else had.
   *
   * Not a condition of appearing — footfall is claimed body by body — but the strongest single
   * indicator that the 5x is really still there, since nobody had been in the system at all.
   */
  firstDiscovery: boolean;
  /**
   * Straight-line distance from the commander, in light years, or null before their first jump.
   *
   * Attached per request rather than with the rest of the row: the row is memoised behind a species
   * match that costs ~45 s, and the commander moves constantly. Baking a distance into that cache
   * would freeze it at whatever system they were in when the panel was first opened.
   */
  distanceLy: number | null;
  /**
   * The journal has actually reported this body unwalked, rather than never mentioning it.
   *
   * `WasFootfalled` did not exist before 2025-09-29, so on older scans the field is absent, not
   * false. A row without this is a plausible target, not a verified one, and must not be drawn as
   * though the bonus were confirmed.
   */
  footfallObserved: boolean;
}

/**
 * One system on the galaxy map's backlog layer: its position, and what is left in it.
 *
 * Systems rather than bodies, because the map plots places and a system with four unfinished bodies
 * is one dot, not four. `floorCr` sums the bodies so the minimum-value filter is answering "is this
 * system worth the detour", which is the question a route is planned on.
 */
export interface BacklogSystemDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  bodies: number;
  /** Summed guaranteed floor across this system's unfinished bodies, at 5x. */
  floorCr: number;
  /** Summed ceiling. */
  ceilingCr: number;
  /** This commander scanned the main star first. */
  firstDiscovery: boolean;
  /** Every body here has a journal statement that it is unwalked. */
  allVerified: boolean;
  /** Straight-line distance from the commander, in light years. Null when their position is unknown. */
  distanceLy: number | null;
}

export interface BacklogMapDTO {
  systems: BacklogSystemDTO[];
  /** Backlog systems with no `StarPos` in the journals, so nothing can place them. */
  unplaceable: number;
}

export interface FirstDiscoveryBacklogDTO {
  /** Ranked by `minCr`, highest first. */
  rows: FirstDiscoveryBacklogRowDTO[];
  systemCount: number;
  /** How many rows are in systems this commander discovered. */
  firstDiscoveryCount: number;
  /** How many rows have a journal statement that the body was unwalked. */
  footfallObservedCount: number;
  totalMinCr: number;
  totalMaxCr: number;
  computedAt: string;
}

/**
 * One fleet carrier as EDAstro last saw it.
 *
 * **Two ages, and they answer different questions.** `lastSeenDays` is how old the record is;
 * `dwellDays` is how long the carrier had already sat still at the moment of that sighting, and it
 * is the one that predicts whether it is still there. Measured across the whole file, carriers are
 * bimodal — median dwell 1 day, p90 180 — so a long-parked carrier on a stale record is a better bet
 * than a mover on a fresh one. Both go on the row; neither is presented as a position.
 */
export interface CarrierRowDTO {
  callsign: string;
  /** Often empty: EDAstro only learns the name from events that carry it. */
  name: string;
  system: string;
  systemAddress: number | null;
  region: string;
  /** Null when the app has not seen the commander jump yet, which is a real state on a cold start. */
  distanceLy: number | null;
  lastSeenDays: number | null;
  dwellDays: number | null;
  /** Raw EDAstro service keys; `carrierServices.ts` turns them into names. */
  services: string[];
  /**
   * Set when this carrier is part of the Deep Space Support Array — 101 curated, deliberately parked
   * service carriers. Null for the other ~90,000, which is almost all of them.
   */
  dssa: {
    commander: string;
    /** "Carrier Operational" on all 101 today; surfaced because the column exists to say otherwise. */
    status: string;
    /** Where the network placed it. It has drifted from this on 0 of 101 rows, which is the point. */
    deploymentSystem: string;
  } | null;
  /**
   * A network whose membership this app carries rather than downloads — OASIS today.
   *
   * Separate from `dssa` because the evidence is different in kind: DSSA arrives as a curated file
   * with an operational status, this is a stated list that goes stale silently.
   */
  network: { key: string; label: string; name: string } | null;
}

/** Whether the commander has a carrier file yet, how old it is, and whether the button is armed. */
export interface CarrierDataStatusDTO {
  haveData: boolean;
  rowCount: number;
  /** When we last asked EDAstro — what the cooldown counts. */
  fetchedAtMs: number | null;
  /** `Last-Modified` as EDAstro reported it: how old the data is, rather than the request. */
  sourceLastModified: string | null;
  cooldownMsRemaining: number;
  sourceUrl: string;
  /** How many Deep Space Support Array carriers are on disk; 0 until the first fetch. */
  dssaCount: number;
}

/**
 * One point of interest from EDAstro's combined catalogue.
 *
 * Two catalogues behind it and the thinner one shows: the 2,123 Galactic Mapping Project rows carry
 * no `rating`, no `region` and no `summary`, so those read blank rather than zero. `key` is
 * `source:id` because `id` alone collides on 551 rows.
 */
export interface PoiRowDTO {
  key: string;
  name: string;
  /** The system as the galaxy map spells it. Blank on 94 of 2,766. */
  system: string;
  region: string;
  typeLabel: string;
  group: string;
  organic: boolean;
  distanceLy: number | null;
  /** At most 200 characters. The full description stays on EDAstro's own page — see `url`. */
  summary: string;
  /** 1.07 to 9.3 where the catalogue has one; null for every GMP row. */
  rating: number | null;
  url: string;
  source: string;
}

export interface PoiDataStatusDTO {
  haveData: boolean;
  rowCount: number;
  fetchedAtMs: number | null;
  cooldownMsRemaining: number;
  sourceUrl: string;
}

export interface PoiQueryResultDTO {
  rows: PoiRowDTO[];
  matchCount: number;
  status: PoiDataStatusDTO;
  origin: { x: number; y: number; z: number } | null;
}

/**
 * What Spansh says about one carrier, fetched on a row's own button.
 *
 * A second opinion, not a correction. Measured on 16 carriers: Spansh newer on 9, EDAstro newer on
 * 3, same on 3, absent on 1 — so the panel shows both and overwrites nothing.
 */
export interface CarrierLiveFixDTO {
  callsign: string;
  system: string;
  /** Spansh's last-seen timestamp, ISO, or null when it carries none. */
  updatedAt: string | null;
  /** From the commander, when a position is known. */
  distanceLy: number | null;
  /** True when Spansh names a different system from the cached row — the reason to press the button. */
  differs: boolean;
  /** Stable game id; the name match that found it is fuzzy, this is not. Null from the map feed. */
  marketId: number | null;
  /**
   * Which source answered.
   *
   * `galmap` is EDAstro's own map feed, which is fresher than the daily CSV for carriers it carries
   * and is the only source that saw some jumps at all. `spansh` is the fallback for the ~88,000
   * carriers the map does not track.
   */
  source: "galmap" | "spansh";
  /** The network the map files it under — OASIS, DSSA, IGAU, STAR, Pioneer — or null. */
  network: string | null;
  /** True when the map put it in a cluster pin, so its system is known and its distance is not. */
  positionUnknown?: boolean;
}

export interface CarrierQueryResultDTO {
  rows: CarrierRowDTO[];
  /** Matches before the row limit, so the panel can say "100 of 19,541". */
  matchCount: number;
  status: CarrierDataStatusDTO;
  /** Null when no jump has been seen; the panel then lists without distances. */
  origin: { x: number; y: number; z: number } | null;
}

export interface ExoPayoutRangeDTO {
  minCr: number;
  maxCr: number;
  /** Biological signals (or DSS genus count fallback). */
  slotCount: number;
  /** Whether slot count came from FSS bio count or DSS genus list length. */
  slotSource: "bio_signals" | "genus_hints";
  /** Distinct matched species with a strict list price. */
  pricedCandidateCount: number;
  /** 5 when this commander qualifies for first-footfall organics on this body, else 1. */
  mult: 1 | 5;
  /** Same as `mult === 5` — your commander gets the 5× journal payout on this body. */
  commanderFirstFootfall: boolean;
  /** Latest detailed `Scan.WasFootfalled` if seen in merged journal; null if unknown. */
  journalWasFootfalled: boolean | null;
  /**
   * Phase 3 provenance for that flag: how old the claim is, in words.
   *
   * A `false` is a statement about a moment, not a property of the body — the ×5 was intact *then*.
   * Null when nothing has been observed, which is a different thing from a fresh `false` and must
   * be drawn differently.
   */
  footfallSeenLabel: string | null;
  /** Whether anyone has DSS-mapped it, as a tri-state, with the same age caveat. */
  wasMapped: boolean | null;
  mappedSeenLabel: string | null;
  /**
   * The target ladder of INCLUDE-BODY-IDS §2.7. `unknown` is **not** `unopened` — the first is the
   * absence of evidence and the second is evidence of absence.
   */
  targetRung: "unopened" | "mapped-not-walked" | "walked" | "unknown";
  /** Age of the observation the rung actually rests on, so the UI never shows a rung bare. */
  rungSeenLabel: string | null;
  /** A map from before Odyssey says nothing about plants — nobody could collect them yet (§1.5). */
  mappedPredatesExobiology: boolean;
  /** `slotCount` exceeds priced species (range uses `pricedCandidateCount` terms only). */
  incomplete: boolean;
  /** The `k` cheapest distinct priced species (`k` = min(slots, pricedCandidateCount)); sums to `minCr`. */
  minTotalSpecies: ExoPayoutSpeciesLineDTO[];
  /** The `k` priciest distinct priced species; sums to `maxCr`. */
  maxTotalSpecies: ExoPayoutSpeciesLineDTO[];
}

/** Organic scan distance + payout overlay (Electron); built from live journal + Status.json. */
export interface ExoOrganicOverlayDTO {
  visible: boolean;
  phase: "tracking" | "celebrate";
  celebrationRemainSec: number;
  speciesDisplay: string;
  minSampleDistanceM: number;
  distToFirstM: number | null;
  distToSecondM: number | null;
  /**
   * Distance back to the third sample, once Analyse has been taken.
   *
   * The "Scan 3" slot used to carry the payout, which put a credits figure in a row of two
   * distances and read as a bug. The payout has its own banner on completion; this row is about
   * where you have been.
   */
  distToThirdM: number | null;
  spacingBetweenSamplesM: number | null;
  spacingMeetsMin: boolean | null;
  /** Distance from current position to first sample point (only while one sample taken). */
  separationForSecondSampleM: number | null;
  separationMeetsMin: boolean | null;
  baseCredits: number | null;
  payNewCodex: number | null;
  payLoggedCodex: number | null;
  finalCredits: number | null;
  analyseWasLogged: boolean | null;
  footfallMult: 1 | 5;
  sampleCount: number;
  /** ISO time of the first Log/Sample of this run on this body, for the HUD's run timer; null if unknown. */
  runStartedIso?: string | null;
  /** Journal organic session body (`systemAddress:bodyId`) — distances apply only on this body. */
  trackingBodyKey: string | null;
  /**
   * Great-circle distance from live `Status.json` position to the nearest prior sample anchor (m).
   * Use with {@link minSampleDistanceM} to see if you are still too close after backtracking.
   */
  distToNearestSampleM: number | null;
  /** True when {@link distToNearestSampleM} ≥ {@link minSampleDistanceM} (both known). */
  nearestSampleMeetsMin: boolean | null;
  /** Where things are around you on this body. Null until the game reports a surface position. */
  minimap: ExoMinimapDTO | null;
}

/**
 * The overlay minimap — where you are standing and what is around you.
 *
 * Everything is already in metres **relative to the commander**, north-up, because the overlay is a
 * transparent HUD panel and should not be doing spherical trigonometry on a 320 ms tick. The server
 * holds the latitudes; the client holds a compass.
 *
 * What can and cannot appear here is set by the game, not by choice:
 *
 * - **Plants** are only placeable if this app was running when they were scanned. `ScanOrganic`
 *   carries no coordinates, so the position has to be taken from `Status.json` at the moment the
 *   scan lands. Nothing can be recovered from old journals.
 * - **The ship** comes from `Touchdown`, which does carry them, so it survives a restart and is
 *   known even for a landing made before the app opened.
 */
export interface ExoMinimapDTO {
  /** Radius the map draws to, metres. Things beyond it become arrows on the rim. */
  radiusM: number;
  /** Degrees clockwise from north, or null when the game is not reporting a heading. */
  headingDeg: number | null;
  /** The minimum separation this genus needs, so the map can draw the ring you have to clear. */
  minSampleDistanceM: number;
  marks: ExoMinimapMarkDTO[];
}

export interface ExoMinimapMarkDTO {
  kind: "sample" | "ship";
  /**
   * Whether this mark belongs to the sampling run in progress on this body.
   *
   * The game's sampler holds **one genus/species per planet at a time**, so a mark left by a species
   * the commander has moved on from is not part of what they are doing now. Drawing every mark the
   * same colour invited the mistake the owner described: standing among Stratum marks while sampling
   * Tussock, and reading one as the other.
   *
   * Per body, because the sampler is: the same species on another planet is a fresh run worth fresh
   * credits, and its marks are not shown here anyway.
   */
  active?: boolean;
  /** Metres north (+) or south (−) of the commander. */
  northM: number;
  /** Metres east (+) or west (−) of the commander. */
  eastM: number;
  /** Straight-line surface distance, metres — what the label shows for an off-map arrow. */
  distanceM: number;
  label: string;
}

/** Heuristic surface temperature band (K) from journal + body class (not raw game min/max). */
export interface EstimatedSurfaceTempBand {
  minK: number;
  maxK: number;
  midK: number;
}

/** Ratios 0…0.5 from user sliders 0…50% — DSS / lone-genus physical gate slack. */
/**
 * The signal-count rule.
 *
 * The game reports how many biological signals a body carries in `FSSBodySignals`, before the
 * commander travels anywhere, and it places **one genus per signal — never the same genus twice**.
 * So comparing the number of candidate genera with the signal count turns a list into a verdict:
 *
 * - `certain`   — as many candidate genera as signals, so every one of them is present. No trip
 *                 needed to know what is there.
 * - `ambiguous` — more candidates than signals: `k` of these genera are present, not all.
 * - `underCovered` — fewer candidates than signals, which is impossible in the game and therefore a
 *                 defect in our data: a gate is excluding a genus that is really there.
 */
export interface GenusCertaintyDTO {
  status: "certain" | "ambiguous" | "underCovered";
  /** Biological signals the game reports for this body. */
  signalCount: number;
  /** Distinct candidate genera the matcher offered. */
  candidateGenera: number;
  /** Display names of the candidate genera, sorted. */
  genera: string[];
}

export interface BodyComputed {
  state: BodyExoState;
  /**
   * `Scan` merged with {@link ExplorationScanRecord} for this body (materials, orbit fields, …).
   * Use for UI + matching when `state.scan` was never set at detailed honk-time (different system focused).
   */
  mergedScan: PlanetScan | null;
  /** Journal-only duplex breakdown (Planetary DSS / scan detail modal) — no feeder “typical” column semantics. */
  bodyScanDetail: ExomasteryDetailDTO | null;
  /** Short tab label: body designation without star system prefix when the journal name includes it. */
  tabLabel: string;
  matches: SpeciesMatch[];
  /** True when genus hints exist and were used to filter */
  genusFilterActive: boolean;
  /** Message when signals < candidate genera etc. */
  ambiguityNote: string | null;
  /**
   * Candidate genera vs the FSS signal count. Null when the body has no signal count or no usable
   * scan. See {@link GenusCertaintyDTO} — this is the difference between "one of these twelve" and
   * "these three, guaranteed".
   */
  genusCertainty: GenusCertaintyDTO | null;
  /**
   * Candidate genera in likelihood order, most likely first — ordering only.
   *
   * The `probability` each row carries is honest arithmetic over the co-occurrence corpus, and it is
   * **not calibrated**: measured against 51 landed bodies its reliability curve is non-monotonic and
   * its Brier score is worse than assuming every candidate equally likely. So it orders the list and
   * nothing renders it as a number (acceptance rule 3). Null when there is no signal count, no
   * co-occurrence table, or fewer candidates than signals.
   */
  genusLikelihoods: GenusLikelihood[] | null;
  /** Estimated viable surface temperature band from scan heuristics; null if planet class could not be mapped. */
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  /**
   * Built with the same rules as strict species matching (host star, orbit LS, signal hints, pressure atm).
   * Populated when {@link state.scan} exists; null when there is no usable body scan.
   */
  speciesMatchContext: SpeciesMatchContext | null;
  /**
   * True when a candidate is listed on the strength of an on-foot `ScanOrganic` rather than the
   * gates. The four distance-guessing fallbacks that used to set this were removed once they
   * measured zero firings across 13,713 bodies.
   */
  approximateMatchingUsed: boolean;
  /** Total CR band if you sell one sample per bio slot from current candidates (updates with DSS / on-foot / Include Bacterium). */
  /**
   * Why this body is showing candidates at all.
   *
   * `conditions` means an auto scan described the body and nothing has counted its organics — the
   * game shows a signal count on screen but never writes one to the journal until an FSS or a DSS.
   * The candidate list is then "what could live here", not "what is here", and the UI has to say so.
   */
  exoMarkerBasis?: "scanned" | "genus" | "signals" | "conditions" | "none";
  exoPayoutRange: ExoPayoutRangeDTO | null;
  /**
   * Live organic / feeder checks vs genus JSON — errors (red) and warnings (yellow).
   * Dismiss state is client-only (localStorage).
   */
  exoDataAlerts: ExoDataAlertDTO[];
  /**
   * DSS genus hints with no candidate row in that genus (for (!) markers next to the genus label).
   */
  dssGenusOrphanHints: GenusHint[];
}

export interface OrganicPendingLineItem {
  bodyKey: string;
  bodyName: string;
  starSystem: string;
  speciesLabel: string;
  /** Typical row from price list before multiplier; null if unknown. */
  baseCredits: number | null;
  /** baseCredits × multiplier when base known; otherwise 0. */
  valueCredits: number;
  firstFootfall: boolean;
  /** Total multiplier on list price: 5 when first footfall (1× + 4× bonus), else 1. */
  multiplier: 1 | 5;
  /** Species illustration URL (resolved from DB match on organic label). */
  photoUrl: string;
}

/** One system seen in merged journals (for browse / search). */
export interface JournalSystemInfo {
  systemAddress: number;
  starSystem: string;
}

/** Discovery scanner body tally from journal `FSSDiscoveryScan` + completion from `FSSAllBodiesFound`. */
export interface DScanBodiesDTO {
  /** `SystemName` from the honk line (confirm against galaxy map). */
  systemName: string;
  /** Bodies resolved in FSS so far (from `Progress` × `BodyCount`, or full count when complete). */
  found: number;
  /** Journal `BodyCount` — suns, planets, moons only (not belts / non-body signals). */
  total: number;
  /** Journal reported `FSSAllBodiesFound` for this system. */
  complete: boolean;
}

/** Parsed `NavRoute.json` + fuel reachability for the remaining plotted path. */
export interface LiveShipFuelNavRouteDTO {
  /** Commander `currentSystemAddress` appears in the live NavRoute list. */
  onPlot: boolean;
  /** Sum of 3D segment lengths for the whole plotted route (ly). */
  routeTotalLy: number;
  /** Distance left along the route from the current system; null when not on plot. */
  routeRemainingLy: number | null;
  /** Hyperjumps remaining until the last waypoint; 0 at destination. */
  routeJumpsRemaining: number | null;
  /** Whether current tank (Status.json) can cover all remaining legs — needs fuel + FSD sample. */
  fuelCanFinishPlottedRoute: boolean | null;
  /** How many consecutive upcoming legs you can complete before running dry (~distance² model). */
  fuelJumpsReachableOnPlottedRoute: number | null;
  /** Longest single leg ahead (ly); null when at destination. */
  maxRemainingLegLy: number | null;
  /** True when a remaining leg exceeds journal `Loadout.MaxJumpRange`. */
  anyRemainingLegOverMaxRange: boolean;
  /**
   * Scoop / tank heuristic when the plotted route cannot be finished on the current tank (~FSD sample).
   * Red = stop and scoop (or urgent); yellow = plan to scoop on the next hop or ~2 jumps of margin.
   */
  routeRefuelAlert: "none" | "yellow" | "red";
  /**
   * Jumps until the furthest main-sequence scoop you can reach **on current fuel** along NavRoute
   * legs (ly from StarPos, use ∝ distance² from last FSDJump, legs capped by Loadout max range).
   * Null when no scoop ahead is reachable or fuel/range data rules it out.
   */
  jumpsToLastScoopableOnRoute: number | null;
  /**
   * The HUD's route strip (owner, 2026-09-13): the next hops after the current system, at most
   * `ROUTE_AHEAD_HOPS`, each with its star class and, on the nearest scoopable star when the tank
   * cannot finish the plot, the refuel mark. Empty when off plot or at the destination.
   */
  ahead: RouteAheadHopDTO[];
  /** Hops to that nearest scoopable star (may exceed `ahead.length`); null when none is needed. */
  refuelInHops: number | null;
  /** `yellow` = plan to scoop there; `red` = you must (last reachable scoop, or none reachable). */
  refuelLevel: "none" | "yellow" | "red";
}

export interface RouteAheadHopDTO {
  starSystem: string;
  /** NavRoute `StarClass` ("" when the file has none). */
  starClass: string;
  scoopable: boolean;
  refuel: "none" | "yellow" | "red";
  /**
   * Would the commander probably be the first here? `null` while nothing is known yet.
   *
   * The game says whether a system was discovered only on arrival, so before the jump the only
   * source is EDSM. That makes the answer asymmetric and the HUD renders it that way: `false` is
   * certain — someone has been and uploaded — while `true` is a good bet, because a commander who
   * never uploads leaves no trace. `null` means the lookup has not answered and the arrow keeps its
   * ordinary colour rather than guessing. See `server/firstFootfallLookup.ts`.
   */
  likelyFirstFootfall: boolean | null;
}

/** Live ship fuel from `Status.json` + jump calibration from merged `Loadout` / `FSDJump`. */
export interface LiveShipFuelRangeDTO {
  /** False when `Status.json` is missing or unread — fuel tonnes are not live. */
  hasLiveStatusFuel: boolean;
  fuelMainT: number;
  fuelReserveT: number;
  fuelTotalT: number;
  maxJumpRangeLy: number | null;
  /** Estimated tonnes for a max-range jump (from last `FSDJump` fuel scaled by `MaxJumpRange` / `JumpDist`). */
  estFuelPerMaxJumpT: number | null;
  /** Max-range jump count heuristic when **not** on a parsed NavRoute; omitted on-plot (see `navRoute`). */
  estJumpsRemaining: number | null;
  calibration: "none" | "fsd_sample";
  /** From live `NavRoute.json` when present (two+ waypoints). */
  navRoute: LiveShipFuelNavRouteDTO | null;
}

export type StarRoleDTO = "fuel" | "neutron_boost" | "wd_boost" | "useless";

export interface PrimaryStarHeaderEntryDTO {
  /** `A`, `B`, … when multiple stars; `null` → show ★ for a lone primary. */
  letter: string | null;
  shortLabel: string;
  starRole: StarRoleDTO;
  /** Journal `StarType` + `Subclass` + `Luminosity` when merged (MK-style shorthand). */
  fullSpectralNotation?: string | null;
}

export interface PrimaryStarsHeaderDTO {
  systemName: string;
  stars: PrimaryStarHeaderEntryDTO[];
}

/** One high-value world in the focused system for the header strip (orange = scan only, green = DSS mapped). */
export interface NotableBodyInfo {
  /** Full journal body name (often `SystemName A 1`). */
  bodyName: string;
  /** Body designator only for compact pills, e.g. `A 2` (system prefix stripped when possible). */
  bodyLabelShort: string;
  systemAddress: number;
  bodyId: number;
  /** Short type line, e.g. `Earth-like`, `Water world`, `HMC - Terraformable`. */
  tag: string;
  /** True when `SAAScanComplete` was merged for this body (DSS). */
  dssMapped: boolean;
}

/** Shown in the UI while the initial journal folder merge (or a full resync) runs. */
export interface JournalBootProgressDTO {
  /** 0–100, best-effort progress. */
  percent: number;
  phase: "starting" | "listing" | "merging" | "watching";
  filesDone: number;
  filesTotal: number;
  message: string;
}

/**
 * Launcher-sized status. Everything the launcher window renders (lamp, journal folder, file count,
 * connect URLs, boot splash) without touching the snapshot builder — see GET /api/status.
 */
/**
 * The radar's own frame, sent on its own so it is not gated on a snapshot rebuild.
 *
 * The sample radar is the one part of the HUD that has to move smoothly: it draws where the
 * commander is standing, and a commander walking at 7 m/s crosses a 500 m radar in a minute. It
 * used to arrive only inside the full snapshot push, which is coalesced at 250 ms and rebuilds the
 * entire state to produce it, so the radar could never update faster than four times a second no
 * matter how often `Status.json` was read. These two fields are the whole of what it draws, they
 * come straight off the store, and they cost nothing to build — so they go out on every poll.
 */
export interface ExoLiveDTO {
  exoOrganicOverlay: ExoOrganicOverlayDTO | null;
  exoMinimap: ExoMinimapDTO | null;
}

export interface AppStatusDTO {
  mode: "server" | "client";
  bindHost: string;
  port: number;
  /** LAN links already carrying `?k=` when {@link lanKeyRequired}; see server/lanAuth.ts. */
  lanUrls: string[];
  /** True when non-loopback clients must present the access key. Only ever true in server mode. */
  lanKeyRequired: boolean;
  journalDir: string;
  journalDirConfiguredOk: boolean;
  journalPath: string | null;
  journalFileCount: number;
  journalHistoryPreset: JournalHistoryPreset;
  lastJournalEventIso: string | null;
  commanderName: string | null;
  journalBoot: JournalBootProgressDTO | null;
  /**
   * The launcher's live strip, cheap store reads only (no snapshot rebuild): where the commander
   * is and what is unsold. All optional so older status payloads still parse.
   */
  live?: {
    systemName: string | null;
    bodyName: string | null;
    /** FSS biological signal count on that body, when known. */
    bioSignals: number | null;
    organicDataValueCredits: number | null;
    organicPendingSampleCount: number;
    /** The next jump, mirrored for the strip. See AppSnapshot.jumpTarget for `source`. */
    jumpTarget: { starSystem: string; starClass: string; arrived: boolean; source: JumpTargetSource } | null;
  };
  /**
   * Species rows carrying a `conditions` key nothing in the app reads — see `conditionKeyAudit`.
   *
   * Empty for the shipped data, and a test keeps it that way. It is surfaced here because the only
   * other report was a `console.warn`, and a packaged Electron build has no console: the owner went
   * looking for it in the app folder and in `%APPDATA%` and found nothing, which is the correct
   * outcome of writing a warning to a stream nobody can read. A hand-edited genus file is the case
   * this exists for, and `/api/status` is somewhere a commander can actually look.
   */
  speciesDataWarnings: string[];
  /**
   * The two live-file poll intervals and their bounds, so the launcher's inputs can never offer a
   * value the server would clamp. Optional: an older launcher against a newer server, or the
   * reverse, simply hides the row. See `shared/pollRates.ts`.
   */
  pollRates?: PollRatesDTO;
  /** The sample radar's radius and its bounds, for the Overlay panel's control. */
  radarRadius?: RadarRadiusDTO;
}

export interface AppSnapshot {
  journalPath: string | null;
  /** How many Journal.*.log files were merged (oldest → newest) */
  journalFileCount: number;
  journalDir: string;
  /** False if the configured journal folder is missing or not a directory. */
  journalDirConfiguredOk: boolean;
  /**
   * Merge every `Journal.*.log` in the folder, or only files from a rolling window (cutoff recomputed when merging).
   */
  journalHistoryPreset: JournalHistoryPreset;
  /**
   * When viewing a journal-known system, the system map is drawn from EDSM because merged journals have no `Scan` rows for that system yet.
   * Cleared when real journal scans arrive; exploration payouts remain journal-first elsewhere.
   */
  edsmMapSupplementForViewingSystem: boolean;
  /**
   * When set, the server is still merging journals (or switching journal folders).
   * The client should show a loading shell; snapshot lists/maps may be empty or stale until this clears.
   */
  journalBoot: JournalBootProgressDTO | null;
  mode: "server" | "client";
  bindHost: string;
  port: number;
  lanUrls: string[];
  /** Journal `LoadGame.Commander`; null until a LoadGame line is merged. */
  commanderName: string | null;
  currentSystem: string | null;
  currentSystemAddress: number | null;
  /**
   * Which of the galaxy's 42 named regions the focused system sits in.
   *
   * Region is one of the strongest signals in exobiology — several species simply do not occur
   * outside particular regions — and the app already shipped a 2 048-row region map that nothing
   * read. It was reachable only by opening the galaxy map, which is the one place a commander does
   * not need to be told where they are. Now it rides on every snapshot, so the header can say it and
   * the matcher can eventually use it.
   *
   * Follows the *viewed* system, not the commander: browsing a system 5 kly away should name that
   * system's region, not the one under the ship. Null when the system has no recorded `StarPos`, or
   * when the point falls outside every named region — which is most of the galaxy.
   */
  currentRegion: { name: string; index: number } | null;
  /**
   * When non-null, the body list reflects this system (journal memory); null = follow commander (`currentSystemAddress`).
   */
  viewingSystemAddress: number | null;
  /** Friendly name for `viewingSystemAddress` when browsing; null if not browsing or unknown. */
  viewingSystemName: string | null;
  /** Distinct systems from merged journal (and any body rows) for search / picker. */
  journalSystems: JournalSystemInfo[];
  bodies: BodyComputed[];
  speciesCount: number;
  lastJournalEventIso: string | null;
  /**
   * Sum of typical sell values for completed (3× analyse) organic samples still unsold in the journal,
   * using `price-list.json`, with 5× total on first-footfall bodies (1× base payout + 4× first-footfall bonus).
   */
  organicDataValueCredits: number;
  /** Rows included in `organicDataValueCredits` (pending sales). */
  organicPendingSampleCount: number;
  /** Per-sample breakdown for the data value modal (unsold completes in journal). */
  organicPendingLines: OrganicPendingLineItem[];
  /** When true, journal has `FSSAllBodiesFound` for the current system and no bodies match bio/hints/organics yet. */
  fssAllBodiesFoundNoBio: boolean;
  /** When true, Bacterium genus is included in planet↔species matching. */
  includeBacteriumInSearch: boolean;
  /**
   * The launcher's HUD settings, mirrored on the server so a phone (its own browser, its own
   * localStorage) renders the HUD in the same colours and order (owner, 2026-09-13, task 13).
   */
  hudPrefs: HudPrefsDTO | null;
  /** Tonight's play, from live journal lines since the app started (NEXT-TASKS 11). App channel only. */
  sessionLog: SessionLogDTO | null;
  /**
   * EDSM auto-fetch on jump (§50): the toggle, plus enough about the stored credentials for the
   * Options panel to tell the commander what state they are in.
   *
   * `keyHint` is the key's last four characters and nothing else — enough to recognise, useless to
   * anyone who reads it. The key itself never leaves the server.
   */
  /**
   * Sending discoveries to Canonn Research.
   *
   * `sent` / `failed` are this session's tally, so the option can say what it has actually done
   * rather than only what it is set to.
   */
  canonnUpload: { enabled: boolean; sent: number; failed: number };
  edsmAutoFetch: {
    enabled: boolean;
    commanderName: string | null;
    hasKey: boolean;
    keyHint: string | null;
  };
  /**
   * Contributing the journal to EDSM. Off unless asked for; see `edsmUpload.ts`.
   *
   * `progress` describes the run happening now and is null between runs; `ledger` is what has ever
   * been sent, and survives restarts.
   */
  edsmUpload: {
    enabled: boolean;
    /** Keep sending while the commander plays — a timer over the same catch-up. */
    live: boolean;
    progress: {
      running: boolean;
      filesDone: number;
      filesTotal: number;
      currentFile: string | null;
      eventsSent: number;
      eventsRejected: number;
      eventsDiscarded: number;
      error: string | null;
      fatal: boolean;
      finishedAt: string | null;
    } | null;
    ledger: {
      filesTracked: number;
      eventsAccepted: number;
      eventsRejected: number;
      lastRunAt: string | null;
      lastError: string | null;
    };
  };
  /**
   * DSS fallback: extra slack (0–50%) on physical gates — temperature estimator band, codex pressure, codex gravity.
   * 0 = strict codex matching for those fallbacks. See Options.
   */
  /**
   * When true, “Data value” adds approximate UC exploration data (FSS/DSS) from merged journal scans.
   * Not first-discoverer bonuses; see Options.
   */
  includeExplorationScanDataInDataValue: boolean;
  /** Estimated CR from all merged `Scan` rows (MattG-style formulas; belts excluded). */
  explorationScanDataValueCredits: number;
  /** Unique bodies with journal `FSSBodySignals` (any system in merged logs). */
  explorationFssScanCount: number;
  /**
   * This commander's own median minutes per landing and per sampling run (B5).
   *
   * Measured from the merged journals rather than configured: time is the one quantity on the triage
   * screen that varies between commanders, and the app already reads the events that state it. Null
   * until there are ten of each leg, where the screen falls back to the shipped medians and says so.
   */
  onSiteTiming: TriageTiming | null;
  /**
   * The miss log's running count (B6) — species the commander found where the app did not offer them.
   *
   * `absent` was not in the list at all, `unlikelyOnly` was behind "show unlikely (N)", and
   * `rankedLow` is the case the ranking model created: offered, but sorted below the genera the panel
   * names. Zero of everything is the honest reading of a fresh install, not a claim of accuracy.
   */
  exoOutliers: { total: number; absent: number; unlikelyOnly: number; rankedLow: number };
  /** Sum of FSS-only estimates for those bodies with merged scan data (belts skipped). */
  explorationFssValueCredits: number;
  /** Planetary bodies with `SAAScanComplete` (stars & belts excluded). */
  explorationDssScanCount: number;
  /** Sum of full mapped (DSS) estimates for those bodies. */
  explorationDssValueCredits: number;
  /** @deprecated Use explorationDssScanCount — kept for older clients. */
  dssMappedPlanetaryBodyCount: number;

  /**
   * High-value exploration targets in the focused system (from merged `Scan`):
   * Earth-like, water world, ammonia world, or terraformable worlds. UI uses FSS-orange vs DSS-green.
   */
  notableBodies: NotableBodyInfo[];
  /**
   * System map exobiology node suffixes: min estimated sell heuristic (price-list × 5) for `+` and `++`.
   * `++` threshold is always kept strictly greater than `+` (CR, integer).
   */
  exoMapTierPlusMinCr: number;
  exoMapTierPlusPlusMinCr: number;

  /**
   * Discovery-scanner honk (`FSSDiscoveryScan`) for the focused system: journal `BodyCount` is bodies only
   * (stars / planets / moons), excluding `NonBodyCount` signals. `found` tracks FSS progress until `FSSAllBodiesFound`.
   */
  dScanBodies: DScanBodiesDTO | null;

  /** Focused-system stars from merged scans: system name + per-star role chips for the header. */
  primaryStarsHeader: PrimaryStarsHeaderDTO | null;

  /**
   * Hierarchical system map + exploration estimates for the focused system (viewing or live).
   * Built from merged journal `Scan` events plus exobiology state.
   */
  systemMap: SystemMapSnapshot | null;
  /**
   * The focused system's main star was undiscovered when this commander scanned it — show FIRST.
   *
   * From `Scan` on `BodyID 0`, the only event that carries `WasDiscovered`. False also covers "no
   * main-star scan yet", which is why the chip is an award rather than a verdict: its absence never
   * claims somebody else got there first.
   */
  focusedSystemUndiscovered: boolean;
  /** Journal `FSDTarget.RemainingJumpsInRoute`; null until line merged. */
  remainingJumpsInRoute: number | null;
  /**
   * Commander fuel tank + rough “how many max-range jumps left” from Status.json + journal `Loadout`/`FSDJump`.
   * Null when Status.json unread or no fuel fields.
   */
  liveShipFuelRange: LiveShipFuelRangeDTO | null;

  /** User pref / launcher: HUD + Status.json polling for on-foot distance. */
  footTravelOdometerEnabled: boolean;
  /** True when the odometer is accumulating for the active `organic_sample_session` body (survives Embark). */
  footTravelOdometerTracking: boolean;
  /** Metres walked while tracking (great-circle on `PlanetRadius`); persisted in `data/organic_sample_session.json`. */
  footTravelDistanceMeters: number;

  /** Completed on-foot analyses (`ScanOrganic` Analyse) persisted in `data/foot_scanned.json`, newest first. */
  footScannedEntries: FootScannedEntry[];
  /**
   * Live organic sample-distance overlay (journal tail + Status.json).
   * Null when inactive (no scans or post-celebration cooldown).
   */
  exoOrganicOverlay: ExoOrganicOverlayDTO | null;
  /**
   * The overlay radar, independent of whether a species is being sampled.
   *
   * Separate from {@link exoOrganicOverlay} because the two answer different questions: that one is
   * about the plant half-collected, this one is about the ground underfoot. Null until the game
   * reports a surface position.
   */
  exoMinimap: ExoMinimapDTO | null;
  /**
   * One-shot: client selects this body tab (`systemAddress:bodyId`) when present in `bodies`.
   * The server clears the pending value after a single snapshot build.
   */
  uiAutoSelectBodyKey: string | null;

  /**
   * Web UI body tab focus (`systemAddress:bodyId`), mirrored from the client for HUD overlays.
   * May be null until the user opens the app or changes tabs.
   */
  uiSelectedBodyKey: string | null;

  /**
   * Resolved focus for the Exo-Candidates overlay: same body as foot-distance tracking when that session is
   * active (after first `ScanOrganic`), otherwise {@link uiSelectedBodyKey}, else last touchdown.
   */
  exoOverlayFocusBodyKey: string | null;

  /**
   * When {@link exoOverlayFocusBodyKey} is not in `bodies` (e.g. FSS reported 0 biological signals),
   * full {@link BodyComputed} for that body so the overlay can still show `0/0` and species rows.
   */
  exoOverlayFocusBody: BodyComputed | null;

  /**
   * The body the commander has targeted, from `Status.json` `Destination` (polled live). The game
   * keeps it set while they are still on the previous body, which is exactly when the HUD should
   * already be showing the next one's candidates. Null when nothing is targeted.
   */
  statusDestination?: { systemAddress: number; bodyId: number; name: string } | null;

  /**
   * The last hyperspace jump target from `StartJump` (JumpType Hyperspace), for the HUD's next-jump
   * card: system name and the arrival star class, which decides whether the ship can scoop there.
   * `arrived` flips on the matching `FSDJump`. Null until the first jump this session.
   */
  jumpTarget?: {
    starSystem: string;
    systemAddress: number;
    starClass: string;
    /** ISO timestamp of the journal line that named it ("" for a NavRoute hop). */
    at: string;
    arrived: boolean;
    source: JumpTargetSource;
    /**
     * Would the commander probably be the first here? `null` while the lookup has not answered.
     *
     * Same asymmetry as {@link RouteAheadHopDTO.likelyFirstFootfall}: `false` is certain and `true`
     * is a good bet. Never set once `arrived` is true — by then the journal knows the answer and a
     * guess from EDSM would be the weaker source.
     */
    likelyFirstFootfall: boolean | null;
  } | null;
}

/**
 * Where the next-jump card's target came from, best first:
 * - `jump`: `StartJump` (hyperspace in progress), or the system just arrived in, held for a minute;
 * - `target`: `FSDTarget` — the system locked in the nav panel before the countdown starts;
 * - `route`: the next hop after the current system in the live `NavRoute.json`.
 */
export type JumpTargetSource = "jump" | "target" | "route";

/** Single journal `Scan` row merged over time (basic + detailed). */
export interface ExplorationScanRecord {
  systemAddress: number;
  bodyId: number;
  bodyName: string;
  starSystem: string;
  updatedAt: string;
  /** Synthetic map placeholder inferred from body designation; not from the journal. */
  isSynthetic?: boolean;
  /** When true, row was loaded from EDSM because the journal had no `Scan` for this system yet. */
  edsmHydrated?: boolean;
  scanType?: string;
  /** Journal `Scan.BodyType` (e.g. `AsteroidCluster` for belt clusters). */
  bodyType?: string;
  planetClass?: string;
  starType?: string;
  subclass?: number;
  /** Journal detailed `Scan.Luminosity` (Yerkes class, e.g. `V`, `VI`). */
  luminosity?: string;
  stellarMass?: number;
  massEM?: number;
  terraformState?: string;
  landable?: boolean;
  semiMajorAxis?: number;
  surfaceTemperature?: number;
  surfaceGravity?: number;
  surfacePressure?: number;
  radius?: number;
  atmosphereType?: string;
  atmosphere?: string;
  volcanism?: string;
  tidalLock?: boolean;
  parents?: unknown;
  atmosphereComposition?: unknown;
  materials?: unknown;
  composition?: unknown;
  /**
   * Journal `Scan.WasDiscovered`. When present, `false` means this commander is the first discoverer
   * (exploration bonus). When `true`, the body was already discovered.
   */
  wasDiscovered?: boolean;
  /**
   * Journal `Scan.WasMapped`. When present, `false` means first mapper (DSS bonus). When `true`, the body
   * was already mapped before that scan; later scans after your DSS often flip to `true`, so payouts freeze at `SAAScanComplete`.
   */
  wasMapped?: boolean;
  /** Journal `Scan.DistanceFromArrivalLS`. `0` marks the arrival / primary entry body in the system map. */
  distanceFromArrivalLs?: number;
  /**
   * Journal `ScanBaryCentre` for `{ Null: journalBarycentreNullId }` in `Scan.Parents`.
   * Stored under `bodyId = barycentreSyntheticBodyId(nullId)` so it never collides with real `BodyID`s.
   */
  isBarycentreJournal?: boolean;
  /** Raw journal `ScanBaryCentre.BodyID` (the `Null` chain id, not a ship body id). */
  journalBarycentreNullId?: number;
  /** Orbital elements from `ScanBaryCentre`: this barycentre's own orbit around its parent. */
  eccentricity?: number;
  orbitalInclination?: number;
  periapsis?: number;
  orbitalPeriod?: number;
  ascendingNode?: number;
  meanAnomaly?: number;
  /** Planet `Scan.RotationPeriod` (s). */
  rotationPeriod?: number;
  /** Planet `Scan.AxialTilt` (rad). */
  axialTilt?: number;
}

export interface SystemMapNodeDTO {
  bodyId: number;
  bodyName: string;
  /** Short body-type label (HMC, ELW, …) — base letters only. */
  label: string;
  /** Text inside map node circle (includes +/++ for exo value tier or neutron). */
  mapLabel: string;
  isStar: boolean;
  hasExobiology: boolean;
  /** True when estimated FSS value is materially above reference at 1 Earth mass for this class. */
  valuePlus: boolean;
  maxExoHeuristicCredits: number;
  exoValueTier: 0 | 1 | 2;
  /** Scoopable star: append + to name under node. */
  namePlus: boolean;
  starVisual: "default" | "neutron";
  /**
   * Multi-star map layout: comma-separated star `bodyId`s this body orbits (sorted), from journal `Parents`
   * or parsed from the short designation (e.g. `AB 1` → stars A and B). Empty for stars / unknown.
   */
  orbitPrimaryKey: string;
  children: SystemMapNodeDTO[];
  /** Synthetic node for journal `Parents` `{ Null: id }` (barycentre). */
  isBarycentre?: boolean;
  /** Journal `DistanceFromArrivalLS === 0` — usual entry star. */
  isArrivalBody?: boolean;
  /** First discoverer not yet determined / not in journal — optional UI tint. */
  isUnexplored?: boolean;
  /** `Scan.SemiMajorAxis` when known — sibling sort on the map. */
  semiMajorAxis?: number | null;
  /** Inferred from naming; no `Scan` / FSS row yet in merged journal. */
  isInferredPlaceholder?: boolean;
  /**
   * Journal classifies body as stellar (incl. YSO in a planet designation slot). Sun-column `isStar` can still be false.
   */
  journalStellar?: boolean;
}

export interface SystemMapBodyDetailDTO {
  bodyId: number;
  bodyName: string;
  bodyKey: string;
  isStar: boolean;
  /**
   * True when merged journal treats the body as stellar, including planet-slot YSO / young star rows.
   */
  journalStellar?: boolean;
  starType?: string;
  /** `StarType` + `Subclass` + `Luminosity` when present on merged `Scan`. */
  fullSpectralNotation?: string | null;
  starRole?: StarRoleDTO;
  planetClass?: string;
  terraformState?: string;
  landable?: boolean;
  massEM?: number;
  stellarMass?: number;
  semiMajorAxis?: number;
  surfaceTemperature?: number;
  surfaceGravity?: number;
  surfacePressure?: number;
  atmosphereType?: string;
  atmosphere?: string;
  volcanism?: string;
  tidalLock?: boolean;
  compositionSummary?: string;
  atmosphereCompositionSummary?: string;
  fssCredits: number | null;
  fssFirstDiscoverCredits: number | null;
  fssFirstDiscoverBonus: number | null;
  /** Full cartographics value at current state: FSS-only until DSS completes, then mapped total (incl. mapping multiplier). */
  dssCredits: number | null;
  dssFirstDiscoverCredits: number | null;
  dssFirstDiscoverBonus: number | null;
  /** When DSS complete: mapped total minus FSS discovery baseline (highlights DSS contribution). */
  dssVersusFssUpliftCredits: number | null;
  /** When not DSS complete: estimated mapped payout if you complete DSS (same discover / mapper flags as journal). */
  dssProjectedCredits: number | null;
  /** Journal efficient probe completion; applies community efficiency tail on mapped estimate. */
  dssProbeEfficientApplied: boolean | null;
  valuePlus: boolean;
  hasExobiology: boolean;
  bioBodyKey: string | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  /**
   * The span between the coldest and hottest point on a landable surface.
   *
   * Different in kind from {@link estimatedSurfaceTempK}, which guesses the *average* before a
   * detailed scan. This is the range the game's own body panel prints once the body is scanned, and
   * no journal event carries it. Null when the body is not landable, when its atmosphere has never
   * been calibrated, or when the star is unknown.
   */
  surfaceTemperatureRangeK: { minK: number; maxK: number } | null;
  exoMatchSummaries: { displayName: string; id: string }[];
  /** max(list price × multiplier) over matched exo species; multiplier is 5 with first-footfall on this body, else 1 (pending-sale rule). */
  maxExoHeuristicCredits: number;
  exoValueTier: 0 | 1 | 2;
  /** Band for selling all bio slots from current candidates (same rules as body tab). */
  exoPayoutRange: ExoPayoutRangeDTO | null;
  /** Journal parent body id if any. */
  parentBodyId: number | null;
  /** All Star: ids from Parents chain (circumbinary detection). */
  parentStarIds: number[];
  /** Naming-inference placeholder on the map (no journal scan yet). */
  isInferredPlaceholder?: boolean;
  /**
   * Journal `ScanBaryCentre` row merged for this synthetic `{ Null: n }` node — used in the map detail popup.
   */
  isMutualBarycentre?: boolean;
  /** Bodies that directly orbit this mutual barycentre (map children). */
  baryAffectsBodyIds?: number[];
  /**
   * Journal `ScanBaryCentre` elements (when `isMutualBarycentre`) — the barycentre's own orbit
   * around its parent, **not** the mutual orbit of its children. See `mergeBarycentreJournalLine`.
   */
  baryEccentricity?: number;
  baryOrbitalInclination?: number;
  baryPeriapsis?: number;
  baryOrbitalPeriod?: number;
  baryAscendingNode?: number;
  baryMeanAnomaly?: number;
  /** Raw `ScanBaryCentre.BodyID` (`Null` chain id). */
  baryJournalNullId?: number;
}

export interface SystemMapSnapshot {
  systemAddress: number;
  /** Journal system name (header / context). */
  starSystem: string;
  tree: SystemMapNodeDTO[];
  detailsByBodyId: Record<string, SystemMapBodyDetailDTO>;
  totalFss: number;
  totalDss: number;
  totalFssFirstDiscover: number;
  totalDssFirstDiscover: number;
  /** Sum of (mapped body DSS − FSS) for planetary bodies with DSS complete — mapping uplift only. */
  totalDssVersusFssUplift: number;
  formulaAttribution: string;
  /** Community attachment-style + MattG-ish stars → approximate full-system FSS value. */
  approxSystemFssValue: number;
  /** Same heuristic with planetary DSS mapping × efficiency tails (stars unchanged vs FSS). */
  approxSystemDssValue: number;
  /**
   * MattG-style sell estimate from merged `Scan` rows in this system only (FSS baseline / DSS mapped
   * depending on completion) — scales with discoveries and DSS state.
   */
  journalExplorationSaleCreditsFocused: number;
}

/** GET /api/feeder/import-dump/status — the Spansh export import started from the launcher. */
export interface ImportDumpStatusDTO {
  running: boolean;
  file: string | null;
  apply: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** The importer's human report (same text the CLI prints), once finished. */
  report: string | null;
  error: string | null;
  failures?: number;
  matched?: number;
  changed?: number;
  /** The last import that finished without error (persisted across runs). */
  lastImport?: { file: string; finishedAt: string; fileMtimeIso: string | null; apply: boolean } | null;
  /** mtime of the file the status was asked about (`?file=`), or of `lastImport.file`; null when unreadable. */
  fileMtimeIso?: string | null;
  /** True when that file is the last-imported one and has been rewritten since (owner, 2026-09-13: one-click re-import). */
  newerOnDisk?: boolean;
}

/** What the launcher's HUD settings modal writes; every field optional, unknown keys dropped. */
export interface HudPrefsDTO {
  theme?: { preset?: string; accent?: string; text?: string };
  scale?: number;
  /** The panel fill's opacity, 0.1–1 (text and lines stay solid). */
  opacity?: number;
  candOrder?: "likelihood" | "value";
  region?: boolean;
  audio?: boolean;
}

/** The session log: what happened since the app started, for the modal and the Markdown copy. */
export interface SessionLogDTO {
  startedIso: string;
  systems: { name: string; at: string; jumpLy: number | null }[];
  landings: { body: string; system: string; at: string; firstFootfall: boolean; key: string | null }[];
  samples: {
    species: string;
    body: string;
    system: string;
    at: string;
    listCredits: number | null;
    mult: 1 | 5;
    credits: number | null;
  }[];
  sales: { at: string; items: number; credits: number }[];
  firstFootfalls: number;
  creditsAnalysed: number;
  creditsSold: number;
}
