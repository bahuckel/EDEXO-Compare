/**
 * Green gas giants — the gas giants that glow green (owner, 2026-09-30: "find them in My discoveries and
 * in FSS scans, show them as notable, and let a commander confirm one").
 *
 * Why they are green (edGGG, "About GGGs"): a colour-picker bug. Green is a gas giant's default colour
 * before its temperature and composition pick the real one; for some values the pick falls outside the
 * range and the planet stays green. Surface temperature is the one value known to decide it: every
 * catalogued GGG sits at an exact temperature, and class III ones sit on a 30 K grid (370, 550 … 700 K).
 * The research and the catalogue are CMDR Arcanic's (https://ed-ggg.github.io/edggg/); the idea of
 * matching scans against it comes from "Custom Criteria for Everyone" (CMDR Julian Ford, table by
 * DaftMav). No code is taken from either — the numbers come from shared/gggCatalogue.ts.
 *
 * The verdict, strongest first — one per body, and the card says why:
 * - `confirmed`  the codex logged a green gas giant for this body, or the commander marked it green;
 * - `catalogued` the body is in the edGGG catalogue;
 * - `likely`     the cloud ladder puts a rung exactly on a colour border (shared/gggLadder.ts, CMDR
 *                Arcanic's model from CMDR Regza's density finding, 2026-10-05; aligned to his own
 *                code 2026-10-07); or EDAstro's codex
 *                file has a green report of its class in its system and it is the
 *                only body of that class scanned there; or its surface temperature is one that at
 *                least two catalogued GGGs share, for a class seen there (±0.001 K) — or a catalogued
 *                class III temperature, which sits on the grid;
 * - `possible`   such a report with more than one body of the class; a class III on the 30 K grid;
 *                a ladder hit that needs the mass and radius the scan did not give;
 *                or any gas giant in a system with a K10-Type Anomaly
 *                (an NSP that only spawns around GGGs: 8 of 8 K10 systems in EDAstro's codex file are
 *                catalogued GGG systems, checked 2026-09-30).
 *
 * Checked against the owner's 2,394 gas giants on 2026-09-30: nothing fires below `confirmed`, as it
 * should for something this rare (70 known). The cloud ladder, on his 2,454 of the classes it knows
 * on 2026-10-05: none either.
 *
 * Why only shared temperatures (checked 2026-09-30 on Spansh's 1.14 M life-bearing and water giants):
 * where temperature decides, GGGs repeat it — 12 water-life GGGs sit on just 3 values (158 K ×3 with
 * the water giant, 176.667 K ×8), class III on its grid, class IV at 1150 K ×2, class I at 130 K ×2.
 * Where it does not, every GGG has its own value (ammonia-life 5 of 5, class II 15 of 15), and a match
 * is chance: giants within 0.001 K of the ammonia GGGs' temperatures were as common as within 0.001 K
 * of shifted control values (83 vs 75). Leaving each GGG out in turn, the shared rule still finds 25
 * of 70 by temperature, the same as matching every catalogued value, and 91 chance hits go.
 */
import { codexEntryKey } from "./codexLog.js";
import { GGG_CATALOGUE } from "./gggCatalogue.js";
import { inNudgeRange, ladderClassOf, ladderGreen, type LadderVerdict } from "./gggLadder.js";

export type GreenGiantLevel = "confirmed" | "catalogued" | "likely" | "possible";

export interface GreenGiantVerdict {
  level: GreenGiantLevel;
  /** One line for the card and the tooltip. */
  why: string;
  /** edGGG catalogue number, when the body is catalogued. */
  gggNumber?: number;
  /** A guess's plausibility, 1–5 in tenths (5 = the cloud ladder's exact match); none when confirmed or catalogued. */
  score?: number;
}

/** The commander's own call, from the body popup: it is green, it is not, or no call. */
export type GreenGiantMark = "yes" | "no";

/**
 * Gas giant classes that can come in green: edGGG's seven, and the three his cloud ladder also covers
 * (class V, helium-rich and helium giants; none found green yet, and no codex entry names them).
 */
export const GGG_CLASSES: ReadonlySet<string> = new Set([
  "Sudarsky class I gas giant",
  "Sudarsky class II gas giant",
  "Sudarsky class III gas giant",
  "Sudarsky class IV gas giant",
  "Sudarsky class V gas giant",
  "Water giant",
  "Gas giant with water based life",
  "Gas giant with ammonia based life",
  "Helium rich gas giant",
  "Helium gas giant",
]);

/** How far a scanned temperature may sit from a catalogued one: the journal's own precision. */
const DELTA_K = 0.001;
/** Class III: green on 310 + 30k K (catalogued 370–700, theorised 310, 340, 400, 490, 520, 760, 790). */
const CLASS_III = "Sudarsky class III gas giant";
const GRID_MIN_K = 310;
const GRID_MAX_K = 790;

function onClassIIIGrid(t: number): boolean {
  if (t < GRID_MIN_K - DELTA_K || t > GRID_MAX_K + DELTA_K) return false;
  const k = Math.round((t - GRID_MIN_K) / 30);
  return Math.abs(GRID_MIN_K + 30 * k - t) <= DELTA_K;
}

const byName = new Map<string, number>();
for (const [n, body] of GGG_CATALOGUE) byName.set(body.toLowerCase(), n);

/** The temperatures that count, per class: shared by two or more GGGs (any class), or class III on the grid. */
const tempsByClass = new Map<string, number[]>();
for (const [, , cls, t] of GGG_CATALOGUE) {
  const shared = GGG_CATALOGUE.filter((r) => Math.abs(r[3] - t) <= DELTA_K);
  if (shared.length < 2 && !(cls === CLASS_III && onClassIIIGrid(t))) continue;
  for (const r of shared) {
    const list = tempsByClass.get(r[2]) ?? [];
    if (!list.some((k) => Math.abs(k - t) <= DELTA_K)) list.push(t);
    tempsByClass.set(r[2], list);
  }
}

export function isGggClass(planetClass: string | null | undefined): boolean {
  return !!planetClass && GGG_CLASSES.has(planetClass.trim());
}

/** The catalogue number of a body name, or null. */
export function gggCatalogueNumber(bodyName: string | null | undefined): number | null {
  if (!bodyName) return null;
  return byName.get(bodyName.trim().toLowerCase()) ?? null;
}

const fmtK = (t: number) => `${Number(t.toFixed(6))} K`;

/**
 * The codex ids that name a green gas giant, and which journal classes each can stand for.
 * A known codex bug (edGGG): a GGG with ammonia-based life logs as the *water*-based-life entry, and a
 * real water-based-life GGG logs nothing — so that one id covers both classes.
 */
const CODEX_CLASSES: Record<string, readonly string[]> = {
  codex_ent_green_sudarsky_class_i: ["Sudarsky class I gas giant"],
  codex_ent_green_sudarsky_class_ii: ["Sudarsky class II gas giant"],
  codex_ent_green_sudarsky_class_iii: [CLASS_III],
  codex_ent_green_sudarsky_class_iv: ["Sudarsky class IV gas giant"],
  codex_ent_green_water_giant: ["Water giant"],
  codex_ent_green_giant_with_water_life: ["Gas giant with water based life", "Gas giant with ammonia based life"],
  codex_ent_green_giant_with_ammonia_life: ["Gas giant with ammonia based life"],
};

/** `$Codex_Ent_Green_Sudarsky_Class_I_Name;` → `codex_ent_green_sudarsky_class_i`, or null when not a GGG entry. */
export function greenCodexId(codexName: string | null | undefined): string | null {
  const k = codexEntryKey(codexName);
  return k.startsWith("codex_ent_green_") ? k : null;
}

/** A green codex id in words: `codex_ent_green_sudarsky_class_ii` → "class II". */
export function greenCodexClassLabel(codexId: string): string {
  const cls = CODEX_CLASSES[codexId];
  if (!cls) return "green gas giant";
  return cls.length > 1 ? "water- or ammonia-based-life giant" : shortClass(cls[0]!);
}

/** Whether a green codex entry can be this class of gas giant. */
export function greenCodexFits(codexId: string, planetClass: string | null | undefined): boolean {
  const classes = CODEX_CLASSES[codexId];
  return !!classes && !!planetClass && classes.includes(planetClass.trim());
}

/** The K10-Type Anomaly's codex id: an NSP that only spawns around green gas giants. */
export const K10_CODEX_ID = "codex_ent_l_phn_part_cld_011";

export function isK10CodexName(codexName: string | null | undefined): boolean {
  return codexEntryKey(codexName) === K10_CODEX_ID;
}

export interface GreenGiantInput {
  planetClass: string | null | undefined;
  surfaceTemperatureK: number | null | undefined;
  /** Journal `MassEM` and `Radius` (metres), for the cloud ladder's density. */
  massEM?: number | null;
  radiusM?: number | null;
  bodyName?: string | null;
  /** A green codex entry was logged for this body. */
  codex?: boolean;
  /** The system has a K10-Type Anomaly. */
  k10InSystem?: boolean;
  /**
   * EDAstro has a green codex report of this body's class in its system (the file names no body):
   * `only` when this is the one body of that class scanned there, `shared` when there are more.
   */
  edastroReport?: "only" | "shared" | null;
  /** With `shared`: how many bodies of that class are scanned there. */
  edastroCandidates?: number;
  /** The commander's own call. "no" silences a guess, never a codex entry or a catalogue listing. */
  mark?: GreenGiantMark | null;
}

export function classifyGreenGiant(i: GreenGiantInput): GreenGiantVerdict | null {
  const pc = (i.planetClass ?? "").trim();
  if (!GGG_CLASSES.has(pc)) return null;
  const n = gggCatalogueNumber(i.bodyName);
  if (i.codex) return { level: "confirmed", why: "Codex entry: green gas giant", ...(n ? { gggNumber: n } : {}) };
  if (i.mark === "yes") return { level: "confirmed", why: "You marked it green", ...(n ? { gggNumber: n } : {}) };
  if (n) return { level: "catalogued", why: `edGGG catalogue #${n}`, gggNumber: n };
  if (i.mark === "no") return null;

  // Every sign, with how much it says on its own (the scale is in the header of `PLAUSIBILITY`).
  const signs: { score: number; why: string }[] = [];
  const ladder = cloudLadder(i);
  if (ladder) signs.push(ladder);
  const said = ladder ? null : ladderSaysNo(i);
  const cls = shortClass(pc);
  if (i.edastroReport) {
    const k = i.edastroReport === "only" ? 1 : Math.max(2, i.edastroCandidates ?? 2);
    signs.push({
      score: 1 + 3.5 / k,
      why:
        k === 1
          ? `EDAstro: a green ${cls} is reported in this system, and this is its only ${cls}`
          : `EDAstro: a green ${cls} is reported in this system — one of its ${k} ${cls}s`,
    });
  }
  const t = i.surfaceTemperatureK;
  if (t != null && Number.isFinite(t)) {
    const hit = (tempsByClass.get(pc) ?? []).find((k) => Math.abs(k - t) <= DELTA_K);
    if (hit != null) {
      signs.push({
        score: said ? 1.5 : 3.5,
        why: `${fmtK(t)} — a temperature catalogued green ${cls}s share${said ? `, but ${said}` : ""}`,
      });
    } else if (pc === CLASS_III && onClassIIIGrid(t)) {
      signs.push({
        score: said ? 1 : 2,
        why: `${fmtK(t)} — on the class III green temperature grid (every 30 K from 310)${said ? `, but ${said}` : ""}`,
      });
    }
  }
  if (i.k10InSystem) {
    signs.push({ score: 1.5, why: "K10-Type Anomaly in this system — they spawn only around green gas giants" });
  }
  if (!signs.length) return null;

  signs.sort((a, b) => b.score - a.score);
  const top = signs[0]!;
  const more = signs.length - 1;
  const raw = top.score + PLAUSIBILITY.agreeing * more;
  const score = Math.round(Math.min(top.score >= 5 ? 5 : 4.9, raw) * 10) / 10;
  return {
    level: score >= PLAUSIBILITY.likelyFrom ? "likely" : "possible",
    why: more ? `${top.why} (and ${more} more sign${more > 1 ? "s" : ""})` : top.why,
    score,
  };
}

/**
 * Plausibility of a guess, 1–5 (owner, 2026-10-05: "5/5 is a 100% match, can have decimals"). What
 * each sign is worth on its own:
 * - cloud ladder, mass and radius scanned: 5 when the temperature alone puts a layer on a border and
 *   the temperature is on CMDR Arcanic's always-green tables (the model reproduces them value by
 *   value); 4.7 when the density decides and the float match is exact; 4.5 for a float step or two
 *   off that the journal's rounding of mass and radius can close (shared/gggLadder.ts
 *   `roundingReach`; a miss it cannot close is no sign). Measured on the whole Spansh dump with his
 *   float path (33.7 M gas giants with real-precision temperatures, 2026-10-07): 25 exact hits, all
 *   green — 24 catalogued and Cyoilz JM-N b26-0 1, found green on 1 Oct 3312; of the 35 near misses,
 *   the 3 catalogued ones are the only ones rounding can close (0 to 0.034 float steps short), the
 *   other 32 stay 0.15 to 1.8 short — Blaa Eork EH-S d5-4 7 and Leami SL-W c18-375 8 among them, both
 *   not green by his own tool (owner, 2026-10-07);
 * - a hit in his "maybe" nudge range, exact or without a mass: half a point less (it holds only if
 *   the random nudge left the planet alone; on the dump both exact ones were green);
 * - cloud ladder without a scanned mass: 2.5 (the clouds may not reach their ceiling);
 * - EDAstro's green report for its class in the system: 1 + 3.5 / the bodies of that class there
 *   (4.5 for the only one);
 * - a temperature catalogued greens share: 3.5; a class III on the 30 K grid: 2 — each 2 lower when
 *   the ladder had all it needs and puts no layer on a border;
 * - a K10-Type Anomaly in the system: 1.5.
 * The strongest sign sets the score, each other one adds `agreeing`, and only the ladder's 5 reaches 5.
 */
const PLAUSIBILITY = { agreeing: 0.25, likelyFrom: 3.5 };

/** An exact or no-mass hit in one of his "maybe" nudge ranges, this much lower (see `PLAUSIBILITY`). */
const MAYBE_NUDGED = 0.5;

/** A density-decided layer a float step or two off its border that rounding can close. */
const NEAR_MISS_SCORE = 4.5;

/**
 * The cloud ladder's sign, scored as above. A whole-kelvin temperature is left to the rules above:
 * EDSM and Spansh round them, so it is not the game's value (and a real one sits on a border at the
 * surface, which those rules know).
 */
function cloudLadder(i: GreenGiantInput): { score: number; why: string } | null {
  const t = i.surfaceTemperatureK;
  if (t == null || !Number.isFinite(t) || Number.isInteger(t)) return null;
  const v: LadderVerdict | null = ladderGreen({
    planetClass: i.planetClass,
    tempK: t,
    massEM: i.massEM,
    radiusM: i.radiusM,
  });
  if (!v) return null;
  const layer = `cloud layer ${v.rung} of 7 lands on the ${v.door} K colour border`;
  const maybe = v.nudge === "maybe";
  const tag = maybe ? "cloud ladder; holds if the random nudge left it alone" : "cloud ladder";
  const sign = (score: number, why: string) => ({ score: maybe ? Math.max(1, score - MAYBE_NUDGED) : score, why });
  if (v.basis === "ceiling") return sign(5, `${fmtK(t)} — at this temperature ${layer} (${tag})`);
  if (!hasDensity(i)) {
    return sign(2.5, `${fmtK(t)} — ${layer} if its clouds reach their ceiling (${tag}; no mass scanned)`);
  }
  if (v.offUlp === 0) return sign(4.7, `${fmtK(t)} — at this temperature and density ${layer} (${tag})`);
  const steps = Math.round(v.offUlp * 10) / 10;
  return sign(
    NEAR_MISS_SCORE,
    `${fmtK(t)} — at this temperature and density ${layer} within ${steps} float step${steps === 1 ? "" : "s"}, which the scan's rounding of mass and radius can close (${tag})`,
  );
}

function hasDensity(i: GreenGiantInput): boolean {
  return i.massEM != null && i.massEM > 0 && i.radiusM != null && i.radiusM > 0;
}

/**
 * Why the ladder says no, when it could have said yes: a class with known borders, out of the nudge
 * ranges, a real-precision temperature, a scanned mass and radius. Null when it cannot tell.
 */
function ladderSaysNo(i: GreenGiantInput): string | null {
  const t = i.surfaceTemperatureK;
  const cls = ladderClassOf(i.planetClass);
  if (!cls || t == null || !Number.isFinite(t) || Number.isInteger(t) || inNudgeRange(cls, t)) return null;
  if (!hasDensity(i)) return null;
  return "at its density no cloud layer lands on a colour border (cloud ladder)";
}

export function shortClass(pc: string): string {
  const m = /^Sudarsky class (\w+) gas giant$/i.exec(pc);
  if (m) return `class ${m[1]}`;
  if (/water based life/i.test(pc)) return "water-based-life giant";
  if (/ammonia based life/i.test(pc)) return "ammonia-based-life giant";
  return pc.toLowerCase();
}

const LEVEL_WORD: Record<GreenGiantLevel, string> = {
  confirmed: "confirmed",
  catalogued: "catalogued",
  likely: "likely",
  possible: "possible",
};

export function greenGiantLabel(v: GreenGiantVerdict): string {
  if (v.gggNumber) return `Green gas giant #${v.gggNumber}`;
  return `Green gas giant (${LEVEL_WORD[v.level]}${v.score != null ? `, ${greenGiantScoreText(v.score)}` : ""})`;
}

/** `4.3/5`. */
export function greenGiantScoreText(score: number): string {
  return `${score.toFixed(1)}/5`;
}

/** A find worth telling edGGG about: confirmed green, and not in their catalogue. */
export function greenGiantIsNewFind(v: GreenGiantVerdict | null | undefined): boolean {
  return !!v && v.level === "confirmed" && !v.gggNumber;
}

export const EDGGG_URL = "https://ed-ggg.github.io/edggg/";
