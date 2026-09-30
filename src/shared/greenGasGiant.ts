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
 * - `likely`     EDAstro's codex file has a green report of its class in its system and it is the
 *                only body of that class scanned there; or its surface temperature is a catalogued
 *                GGG's, for the same class (±0.001 K);
 * - `possible`   such a report with more than one body of the class; a class III on the 30 K grid;
 *                or any gas giant in a system with a K10-Type Anomaly
 *                (an NSP that only spawns around GGGs: 8 of 8 K10 systems in EDAstro's codex file are
 *                catalogued GGG systems, checked 2026-09-30).
 *
 * Checked against the owner's 2,394 gas giants on 2026-09-30: nothing fires below `confirmed`, as it
 * should for something this rare (70 known).
 */
import { codexEntryKey } from "./codexLog.js";
import { GGG_CATALOGUE } from "./gggCatalogue.js";

export type GreenGiantLevel = "confirmed" | "catalogued" | "likely" | "possible";

export interface GreenGiantVerdict {
  level: GreenGiantLevel;
  /** One line for the card and the tooltip. */
  why: string;
  /** edGGG catalogue number, when the body is catalogued. */
  gggNumber?: number;
}

/** The commander's own call, from the body popup: it is green, it is not, or no call. */
export type GreenGiantMark = "yes" | "no";

/** Gas giant classes that come in green (edGGG's seven; class V and helium giants have none). */
export const GGG_CLASSES: ReadonlySet<string> = new Set([
  "Sudarsky class I gas giant",
  "Sudarsky class II gas giant",
  "Sudarsky class III gas giant",
  "Sudarsky class IV gas giant",
  "Water giant",
  "Gas giant with water based life",
  "Gas giant with ammonia based life",
]);

/** How far a scanned temperature may sit from a catalogued one: the journal's own precision. */
const DELTA_K = 0.001;
/** Class III: green on 310 + 30k K (catalogued 370–700, theorised 310, 340, 400, 490, 520, 760, 790). */
const CLASS_III = "Sudarsky class III gas giant";
const GRID_MIN_K = 310;
const GRID_MAX_K = 790;

const byName = new Map<string, number>();
const tempsByClass = new Map<string, number[]>();
for (const [n, body, cls, t] of GGG_CATALOGUE) {
  byName.set(body.toLowerCase(), n);
  const list = tempsByClass.get(cls) ?? [];
  list.push(t);
  tempsByClass.set(cls, list);
}

export function isGggClass(planetClass: string | null | undefined): boolean {
  return !!planetClass && GGG_CLASSES.has(planetClass.trim());
}

/** The catalogue number of a body name, or null. */
export function gggCatalogueNumber(bodyName: string | null | undefined): number | null {
  if (!bodyName) return null;
  return byName.get(bodyName.trim().toLowerCase()) ?? null;
}

function onClassIIIGrid(t: number): boolean {
  if (t < GRID_MIN_K - DELTA_K || t > GRID_MAX_K + DELTA_K) return false;
  const k = Math.round((t - GRID_MIN_K) / 30);
  return Math.abs(GRID_MIN_K + 30 * k - t) <= DELTA_K;
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
  if (i.edastroReport === "only") {
    return { level: "likely", why: `EDAstro: a green ${shortClass(pc)} is reported in this system, and this is its only ${shortClass(pc)}` };
  }
  const t = i.surfaceTemperatureK;
  if (t != null && Number.isFinite(t)) {
    const hit = (tempsByClass.get(pc) ?? []).find((k) => Math.abs(k - t) <= DELTA_K);
    if (hit != null) return { level: "likely", why: `${fmtK(t)} — a catalogued green ${shortClass(pc)} temperature` };
    if (pc === CLASS_III && onClassIIIGrid(t)) {
      return { level: "possible", why: `${fmtK(t)} — on the class III green temperature grid (every 30 K from 310)` };
    }
  }
  if (i.edastroReport === "shared") {
    return { level: "possible", why: `EDAstro: a green ${shortClass(pc)} is reported in this system — one of its ${shortClass(pc)}s` };
  }
  if (i.k10InSystem) return { level: "possible", why: "K10-Type Anomaly in this system — they spawn only around green gas giants" };
  return null;
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
  return v.gggNumber ? `Green gas giant #${v.gggNumber}` : `Green gas giant (${LEVEL_WORD[v.level]})`;
}

/** A find worth telling edGGG about: confirmed green, and not in their catalogue. */
export function greenGiantIsNewFind(v: GreenGiantVerdict | null | undefined): boolean {
  return !!v && v.level === "confirmed" && !v.gggNumber;
}

export const EDGGG_URL = "https://ed-ggg.github.io/edggg/";
