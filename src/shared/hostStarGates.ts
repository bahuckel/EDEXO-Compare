/**
 * Spawn conditions that depend on the host **star class**, measured rather than quoted.
 *
 * ## Why this is a module and not a field on the species row
 *
 * The species JSON already carries `conditions.parent_star` for Electricae pluma and Amphora, and
 * `conditions.parent_star_types` for Anemone. **None of the three is read.** `speciesTreeLoader`
 * looks for `parentStarTypeIncludesAnyOf` / `parentStarTypeIncludes` / `starTypeIncludes` and
 * nothing else, so those keys are dropped in silence — not evaluated, and not even flagged as
 * `predictionUnsupported` the way `location_requirement` is. Pluma has therefore never been gated on
 * its host star at all.
 *
 * Wiring the prose through would not have helped much either. It reads
 * `"A (luminosity class V or higher)"` and `"Neutron star"`, and the matcher compares codex
 * fragments against the journal's `StarType`, which spells those same stars `A` and `N`. Substring
 * matching one vocabulary against the other is what {@link hostStarClassKey} was written to stop.
 *
 * ## The evidence
 *
 * From `EDSM-targz-to-db/docs/ABSTRACT-COND.md` §3.7, measured 2026-09-06 across **10,194 pluma
 * sightings**: arrival stars are Neutron 46 %, White Dwarf 30 %, A 14 %, Black Hole 8 %. **O and B
 * came in at 0 %**, which refutes two of the four "to be confirmed" classes ed-dsn lists, so the
 * set is exactly {A, N, D, H} rather than the wider one the codex claims.
 *
 * Checked against our own corpus before being switched on, and the numbers are unusually clean:
 *
 * | measure | result |
 * |---|---|
 * | confirmed pluma sightings kept | **31 of 31** |
 * | corpus bodies matching the Electricae genus shape | 627 |
 * | …of those, hosts inside {A, N, D, H} | 36 (5.7 %) |
 * | …so pluma is withdrawn from | **591 bodies (94.3 %)**, losing nothing |
 *
 * ## Barycentres, which is what made this necessary
 *
 * A body orbiting a star *pair* has no star in its parents chain — only `{Null: n}` — and picking
 * one star out of the pair invents an answer. That is not hypothetical: the shipped pluma profile
 * records one `M3` host, and it comes from **Eok Blao ED-Q d6-351 BC 3 c**, a body orbiting the B+C
 * barycentre of an M dwarf and an L brown dwarf in a system whose primary is a *neutron star*. That
 * single mis-attributed row is what licensed pluma on every M-class body in the game, including the
 * owner's home system 175 ly from R Cra.
 *
 * `ABSTRACT-COND.md` §6.3 hit the same wall from the other side and states the rule: *"if the body
 * orbits a barycentre with no star in its parents chain, fall back to the letters of ALL stars in
 * the system (fixes 35 Anemone misses on star-pair barycentres)"*. So a gate is evaluated against a
 * **set** of classes, never a single one:
 *
 *  - every star in the body's own parents chain, which for a body orbiting a pair is both of them;
 *  - and when the chain names no star at all, every star in the system.
 *
 * Both readings are generous on purpose. The set only has to *intersect* the allowed classes, so a
 * body whose host is ambiguous keeps its candidate rather than losing it to a coin flip.
 *
 * ## What a failure means
 *
 * The same thing a failed spatial gate means: the row moves to the `unlikely` tier with its reason
 * attached, and stays visible behind "show unlikely". An empty class set — no star scanned yet —
 * returns null, never a failure.
 */
import { hostStarClassKey } from "./hostStarClass.js";

export interface HostStarGate {
  /** Class keys from {@link hostStarClassKey} the species has actually been recorded under. */
  allowed: string[];
  /** What the measurement says, for the tooltip. */
  evidence: string;
  /**
   * `"main"` when the rule was measured on — and is judged on — the system's main star rather than
   * the star the body orbits. The codex CSV records the main star, and for most species the two
   * agree; where they do not (a body orbiting a brown dwarf in an A-star system), judging a
   * main-star rule on the body's host would demote the species on its own bodies.
   */
  judgedOn?: "main";
  /**
   * Yerkes luminosity classes allowed per star class, judged on the system's main star (so only on
   * `judgedOn: "main"` gates) — the Anemone colours split on it: a B dwarf makes Luteolum, a B giant
   * Roseum. Keyed by {@link hostStarClassKey}, or `AeBe` for a Herbig star, which that key folds into
   * A. An empty list refuses the class outright; a class with no entry, or a star with no luminosity
   * reading, is judged on its class alone.
   */
  luminosity?: Record<string, readonly YerkesClass[]>;
}

export type YerkesClass = "I" | "II" | "III" | "IV" | "V" | "VI" | "VII";
const ALL_LUMINOSITIES: readonly YerkesClass[] = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** The Roman class of a journal `Luminosity` ("Vz", "IIIab", "Ia0", "0") — null when unreadable. */
export function yerkesClass(value: string | null | undefined): YerkesClass | null {
  const v = (value ?? "").trim().toUpperCase();
  if (v === "0") return "I";
  const m = /^(VII|VI|V|IV|III|II|I)/.exec(v);
  return m ? (m[1] as YerkesClass) : null;
}

const isHerbig = (type: string) => /^aebe$|herbig/i.test(type.trim());

/*
 * The Anemone colours (split 2026-09-28, owner's yes). Measured on the Spansh dump's bodies where
 * the codex (EDSM + EDAstro) logs exactly one Anemone in the system — 4,090 of them — with the main
 * star's class and luminosity, and on Bioforge's 15,178 sightings (main star class only). The colour
 * follows the system's main star and its luminosity class; the body class picks which of each pair:
 *
 * | star | rocky | metal-rich / HMC | dump bodies with that main star |
 * |---|---|---|---|
 * | O (Wolf-Rayet, Herbig Ae/Be) | Puniceum (icy) | Prasinum Bioluminescent (also rocky) | 30/34, 548/552 |
 * | B IV-V | Luteolum | Blatteum Bioluminescent | 202/204, 1,465/1,499 |
 * | B I-III | Roseum | Roseum Bioluminescent | 35/35, 821/838 |
 * | B VI, A I-III | Croceum | Rubeum Bioluminescent | 51/52, 719/857 (B IV 84) |
 *
 * Bioforge agrees on the classes: main star B 99.2 % of Luteolum, O 91 % of Puniceum, O 93.5 % +
 * Herbig 5.3 % of Prasinum, A (giant or supergiant) 29-34 % of Croceum and Rubeum and under 1 % of the
 * others.
 *
 * **Judged on the main star**, not the body's host nor the brightest star in its sky. Read on the
 * brightest star (the colour rule other genera follow) each colour's own gate passed on only 76-92 %
 * of its bodies: the misses were bodies lit most by a nearby A, F or K dwarf, or a B dwarf in an O
 * system, whose colour was still the main star's. A third of Luteolum bodies orbit a Y or T dwarf.
 * Main star a black hole or neutron star (under 2 %) fails.
 */
const B_DWARF: Record<string, readonly YerkesClass[]> = { B: ["IV", "V"] };
const B_GIANT: Record<string, readonly YerkesClass[]> = { B: ["I", "II", "III"] };
const B_SUBDWARF_A_GIANT: Record<string, readonly YerkesClass[]> = {
  B: ["VI"],
  A: ["I", "II", "III"],
  AeBe: [],
};
const O_STAR: Record<string, readonly YerkesClass[]> = { A: [], AeBe: ALL_LUMINOSITIES };

/**
 * The gates, keyed by the species-id fragment they apply to.
 *
 * All three thresholds are measured against edastro's `codex-life-data.csv` — 4,845,751 codex
 * sightings, 1,136 codex ids — with the whole file as the background control:
 *
 * | class | K | F | M | G | A | N | B |
 * |---|---|---|---|---|---|---|---|
 * | all life (n = 4,809,242) | 26.9 % | 23.8 % | 22.9 % | 14.4 % | 6.2 % | 2.4 % | 0.8 % |
 *
 * Bark Mounds are the negative control and behave like one: F 22.8 %, M 20.9 %, K 19.1 %, A 18.1 %
 * across 23,552 sightings — the background, which is what "no star rule" should look like.
 *
 * **A caveat that travels with the last two.** The CSV records the *system's main star*, not the
 * body's host, and our gate reads the body's host set. For pluma that mismatch does not arise —
 * `ABSTRACT-COND.md` measured the same quantity and our own body-level corpus agrees 31 of 31. For
 * Amphora and Anemone the class sets are extreme enough (97.4 % and 98.2 %) that the distinction
 * cannot plausibly reverse them, but they should be re-measured at body-host granularity when the
 * galaxy database lands.
 */
export const HOST_STAR_GATES: { idIncludes: string; gate: HostStarGate }[] = [
  {
    /**
     * Amphora Plant. `conditions.parent_star: "A"` sat unread in the species file; ed-dsn states it
     * with no count, and the CSV supplies one: **A 97.4 % of 1,484 sightings**, against 6.2 % of all
     * life. B adds 1.8 % and is kept — the whole set costs nothing in filtering power, because B is
     * 0.8 % of the background, and dropping it would delete 27 real sightings.
     *
     * Amphora also needs a life-bearing companion body in the system, which nothing here can answer,
     * so the row keeps its `predictionUnsupported` flag either way. This gate narrows *where*, not
     * whether.
     */
    idIncludes: "amphora",
    gate: {
      allowed: ["A", "B"],
      evidence: "A-class hosts 97.4 % of 1,484 Amphora sightings (B a further 1.8 %); A is 6.2 % of all life",
    },
  },
  /*
   * Anemone, one gate per colour pair (table above). Before the split one row carried
   * {O, B, A}: B 82.8 %, O 10.4 %, A 5.0 % of 27,232 Anemone sightings.
   */
  {
    idIncludes: "anemone_luteolum",
    gate: {
      judgedOn: "main",
      allowed: ["B"],
      luminosity: B_DWARF,
      evidence: "main star B IV-V on 202 of 204 Luteolum bodies (Bioforge: B 99.2 % of 1,682)",
    },
  },
  {
    idIncludes: "anemone_blatteum_bioluminescent",
    gate: {
      judgedOn: "main",
      allowed: ["B"],
      luminosity: B_DWARF,
      evidence: "main star B IV-V on 1,465 of 1,499 Blatteum bodies (Bioforge: B 97.7 % of 5,446)",
    },
  },
  {
    // Also covers anemone_roseum_bioluminescent: the same stars.
    idIncludes: "anemone_roseum",
    gate: {
      judgedOn: "main",
      allowed: ["B"],
      luminosity: B_GIANT,
      evidence:
        "main star a B giant or supergiant (I-III) on 35 of 35 Roseum and 821 of 838 Roseum Bioluminescent bodies (98 %)",
    },
  },
  {
    idIncludes: "anemone_croceum",
    gate: {
      judgedOn: "main",
      allowed: ["B", "A"],
      luminosity: B_SUBDWARF_A_GIANT,
      evidence:
        "main star B VI or an A giant / supergiant on 51 of 52 Croceum bodies (Bioforge: B 66 %, A 34 %)",
    },
  },
  {
    idIncludes: "anemone_rubeum_bioluminescent",
    gate: {
      judgedOn: "main",
      allowed: ["B", "A"],
      luminosity: { ...B_SUBDWARF_A_GIANT, B: ["IV", "VI"] },
      evidence:
        "main star B VI 523, A giant / supergiant 196, B IV 84 of 857 Rubeum bodies (Bioforge: B 70 %, A 27 %)",
    },
  },
  {
    idIncludes: "anemone_puniceum",
    gate: {
      judgedOn: "main",
      allowed: ["O", "W"],
      evidence: "main star O on 30 of 34 Puniceum bodies (Bioforge: O 91 %, Wolf-Rayet 4 %)",
    },
  },
  {
    idIncludes: "anemone_prasinum_bioluminescent",
    gate: {
      judgedOn: "main",
      allowed: ["O", "W", "A"],
      luminosity: O_STAR,
      evidence:
        "main star O 505, Herbig Ae/Be 29, Wolf-Rayet 8 of 552 Prasinum bodies (Bioforge: O 93.5 %, Herbig 5.3 %)",
    },
  },
  {
    /**
     * Stratum araneamus — measured on the **main** star, and judged on it.
     *
     * edastro's codex CSV, 13,732 sightings of `codex_ent_stratum_04`: A 74.2 %, neutron 16.8 %,
     * B 6.7 %, black hole 1.2 % — 98.9 %, where those four are 9.4 % of all life; F 0.4 %, G and K
     * 0.0 %. Its own bodies agree at body level, across three sources: every one of the 66 with a
     * known main star is under A, N, B or H (capture 29, Spansh corpus 34, the commander's journals 3).
     *
     * A third of those bodies orbit a Y or T dwarf, which is why this gate reads the main star: judged
     * on the body's host it would demote araneamus on its own ground. The profile's host-star
     * determinism (0.154, from 35 bodies) sits just under the observation term's floor, so nothing
     * else said this.
     */
    idIncludes: "stratum_araneamus",
    gate: {
      allowed: ["A", "N", "B", "H"],
      judgedOn: "main",
      evidence:
        "main star of 13,732 araneamus sightings: A 74.2 %, neutron 16.8 %, B 6.7 %, black hole 1.2 % — 98.9 %; those four are 9.4 % of all life",
    },
  },
  {
    /**
     * Concha labiata — every class but M. The codex CSV has it under an M main star on 1.2 % of
     * 86,565 sightings, where M is 22.7 % of all life and 8.5 % of Concha renibus, its rival on
     * carbon dioxide at 180–190 K. At body level the host is M on 3 of 1,923 labiata bodies (Spansh
     * corpus, EDDN capture, the commander's journals) against 64 of about 1,030 renibus. Written as
     * an allow-list of everything else, so an unknown class or a mixed M + K pair still passes.
     */
    idIncludes: "concha_labiata",
    gate: {
      allowed: ["O", "B", "A", "F", "G", "K", "L", "T", "Y", "TTS", "D", "W", "N", "H", "other"],
      evidence: "main star of 86,565 labiata sightings is M on 1.2 %, against 22.7 % of all life; host M on 3 of 1,923 labiata bodies",
    },
  },
  {
    /**
     * Crystalline Shards (added 2026-09-28). The owner's notes say "A, F, G, K, M or S"; the Spansh
     * dump's 5,932 Shards bodies with a known host are K 2,101, M 1,730, G 481, F 269, brown dwarf 206,
     * A 43, T Tauri 2 — never O, B, a white dwarf, a neutron star or a black hole. Bioforge's 4,450
     * sightings agree (local star: neutron once). Judged on the body's own star: Shards sit ≥ 12,000
     * Ls from the arrival star, often beside a secondary, and the main star says nothing there.
     */
    idIncludes: "crystalline_shards",
    gate: {
      allowed: ["A", "F", "G", "K", "M", "L", "T", "Y", "TTS", "other"],
      evidence:
        "host of 4,832 Shards bodies: K 43 %, M 36 %, G 10 %, F 6 %, brown dwarf 4 %, A 1 % — never O, B, D, N or H",
    },
  },
  {
    /**
     * Electricae pluma — measured on the codex CSV's main star, so judged on it, like araneamus.
     * Judged on the host it demoted 12 of the 69 pluma bodies in the corpus, every one orbiting an
     * M, L, Y or T dwarf in a system whose main star is neutron or A. The owner's original report
     * (Swoilz KI-E b4-9 10 b, a single M3 star) still fails: its main star is that M3.
     */
    idIncludes: "electricae_pluma",
    gate: {
      allowed: ["A", "N", "D", "H"],
      judgedOn: "main",
      evidence:
        "10,139 pluma sightings: neutron 46.0 %, white dwarf 30.6 %, A 14.2 %, black hole 8.3 % — 99.1 %; B 0.2 %, O 0.0 %",
    },
  },
];

/** The host-star gate a species carries, or null when its spawn does not depend on the star class. */
export function hostStarGateForSpeciesId(speciesId: string): HostStarGate | null {
  const id = speciesId.toLowerCase();
  for (const { idIncludes, gate } of HOST_STAR_GATES) if (id.includes(idIncludes)) return gate;
  return null;
}

/**
 * Class keys for however many host stars a body has, de-duplicated and in a stable order.
 *
 * Unrecognised spellings collapse to `other` rather than to nothing — see {@link hostStarClassKey} —
 * so an exotic star still counts as *a star that is not on the allowed list*, which is the honest
 * reading.
 */
export function hostStarClassKeys(starTypes: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of starTypes) {
    const k = hostStarClassKey(t);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export interface HostStarVerdictGate {
  passes: boolean;
  /** The classes we resolved for this body — one star, a pair, or the whole system. */
  classes: string[];
  allowed: string[];
  evidence: string;
  /** Set when the gate was judged on the system's main star rather than the body's host. */
  judgedOn?: "main";
  /** Set when the star's luminosity class decided it, as the journal writes the star. */
  luminosity?: { star: string; allowed: string };
}

/** A star as the journal writes it, for the luminosity half of a gate: `StarType`, `Luminosity`. */
export interface StarReading {
  type?: string | null;
  luminosity?: string | null;
}

/**
 * The luminosity half: null when not judged (no rule for this class, no luminosity reading), else
 * whether the colour star's class is allowed.
 */
function luminosityVerdict(
  gate: HostStarGate,
  star: StarReading | null | undefined,
): { passes: boolean; star: string; allowed: string } | null {
  const type = star?.type?.trim();
  if (!gate.luminosity || !type) return null;
  const herbig = isHerbig(type);
  const cls = hostStarClassKey(type);
  const rule = herbig ? (gate.luminosity.AeBe ?? gate.luminosity.A) : cls ? gate.luminosity[cls] : undefined;
  if (!rule) return null;
  const name = herbig ? "Herbig Ae/Be" : `${cls}-class`;
  const allowed = rule.length ? `${name} ${rule.join(", ")}` : `no ${name} star`;
  if (!rule.length) return { passes: false, star: name, allowed };
  const lum = yerkesClass(star?.luminosity);
  if (!lum) return null;
  return { passes: rule.includes(lum), star: `${name} ${star!.luminosity!.trim()}`, allowed };
}

/**
 * Evaluate a species' host-star gate, or null when there is nothing to evaluate — the species has no
 * star condition, or no star has been scanned for this body yet.
 *
 * **An empty class list returns null, never a failure**, for the same reason a missing coordinate
 * does in `spatialGates`: not knowing what the star is must not read as "the species cannot be here".
 */
export function evaluateHostStarGate(
  speciesId: string,
  starClasses: readonly string[] | null | undefined,
  mainStarClass?: string | null,
  mainStar?: StarReading | null,
): HostStarVerdictGate | null {
  const gate = hostStarGateForSpeciesId(speciesId);
  if (!gate) return null;
  if (gate.judgedOn === "main") {
    // An unknown main star abstains, exactly as an unknown host does below.
    if (!mainStarClass) return null;
    const classPasses = gate.allowed.includes(mainStarClass);
    const lum = classPasses ? luminosityVerdict(gate, mainStar) : null;
    return {
      passes: classPasses && (lum?.passes ?? true),
      classes: [mainStarClass],
      allowed: gate.allowed,
      evidence: gate.evidence,
      judgedOn: "main",
      ...(lum && !lum.passes ? { luminosity: { star: lum.star, allowed: lum.allowed } } : {}),
    };
  }
  if (!starClasses || starClasses.length === 0) return null;
  return {
    passes: starClasses.some((c) => gate.allowed.includes(c)),
    classes: [...starClasses],
    allowed: gate.allowed,
    evidence: gate.evidence,
  };
}

/** Human-readable class name, so the card does not show a bare letter. */
const CLASS_LABEL: Record<string, string> = {
  D: "white dwarf",
  N: "neutron star",
  H: "black hole",
  W: "Wolf-Rayet",
  TTS: "T Tauri",
  other: "exotic",
};

export function hostStarClassLabel(key: string): string {
  return CLASS_LABEL[key] ?? `${key}-class`;
}

/** One line for the reader: what the star is, and what the species has been recorded under. */
export function describeHostStarVerdict(v: HostStarVerdictGate): string {
  const seen = v.classes.map(hostStarClassLabel).join(" / ");
  const want = v.allowed.map(hostStarClassLabel).join(", ");
  if (v.luminosity) return `Main star ${v.luminosity.star} — recorded only under ${v.luminosity.allowed}.`;
  return v.judgedOn === "main"
    ? `Main star ${seen} — recorded only in systems whose main star is ${want}.`
    : `Host star ${seen} — recorded only under ${want}.`;
}
