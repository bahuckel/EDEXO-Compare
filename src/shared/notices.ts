/**
 * "Notify me when I find X" (guild tester report, 2026-09-30; owner's answers the same day).
 *
 * Notices are the app's own messages about what the commander found: a notable body, a personal
 * record, a notable stellar phenomenon. They land in the mail icon's list and stay there until marked
 * read, and every one names the system and the body, because he may be several jumps on by the time
 * he looks. Never an OS notification; the one sound is an opt-in chime for records.
 */
import { isTerraformableState } from "./terraformState.js";

export type NoticeKind = "notable" | "record" | "nsp";

export interface NoticeDTO {
  id: string;
  /** ISO time of the journal line that raised it. */
  at: string;
  kind: NoticeKind;
  title: string;
  text: string;
  system: string;
  systemAddress: number | null;
  /** Short body label (`A 2`), when the notice is about a body. */
  body: string | null;
  bodyKey: string | null;
  /** A notable stellar phenomenon that was a new codex entry. */
  codexNew?: boolean;
}

/** The body types the Notable card flags, plus Helium gas giants (owner, 2026-09-30). */
export type NotableKind = "earthlike" | "water" | "ammonia" | "terraformable" | "helium";

export const NOTABLE_KINDS: readonly { key: NotableKind; label: string }[] = [
  { key: "earthlike", label: "Earth-like worlds" },
  { key: "water", label: "Water worlds" },
  { key: "ammonia", label: "Ammonia worlds" },
  { key: "terraformable", label: "Other terraformable bodies" },
  { key: "helium", label: "Helium gas giants" },
];

export interface NotifyPrefsDTO {
  notable: Record<NotableKind, boolean>;
  /** Largest and smallest radius per star type and per planet class. */
  records: boolean;
  /** A short chime when a record falls, on this PC's app window only. Off by default. */
  chime: boolean;
  /** A notable stellar phenomenon in the system (FSS signal, then its type from the codex). */
  nsp: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefsDTO = {
  notable: { earthlike: true, water: true, ammonia: true, terraformable: true, helium: true },
  records: true,
  chime: false,
  nsp: true,
};

/** Only known keys and booleans get through; anything else keeps its current value. */
export function mergeNotifyPrefs(prev: NotifyPrefsDTO, raw: unknown): NotifyPrefsDTO {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, cur: boolean) => (typeof v === "boolean" ? v : cur);
  const n = r.notable && typeof r.notable === "object" ? (r.notable as Record<string, unknown>) : {};
  const notable = { ...prev.notable };
  for (const { key } of NOTABLE_KINDS) notable[key] = bool(n[key], prev.notable[key]);
  return {
    notable,
    records: bool(r.records, prev.records),
    chime: bool(r.chime, prev.chime),
    nsp: bool(r.nsp, prev.nsp),
  };
}

/**
 * Which notable type a planet is, or null. Same rules as the Notable card, plus the Helium gas giant
 * — exactly that class: "Helium rich gas giant" is common and does not count.
 */
export function notableKindFor(planetClass: string | null | undefined, terraformState?: string | null): NotableKind | null {
  const pc = (planetClass ?? "").trim();
  const norm = pc.toLowerCase().replace(/\s+/g, " ");
  if (!pc) return null;
  if (norm === "earthlike body" || (norm.includes("earth") && norm.includes("like"))) return "earthlike";
  if (norm.includes("ammonia world")) return "ammonia";
  if (norm.includes("water") && norm.includes("world")) return "water";
  if (norm === "helium gas giant") return "helium";
  if (isTerraformableState(terraformState)) return "terraformable";
  return null;
}

/* ---- personal records ---------------------------------------------------------------------- */

export type RecordSubject = "star" | "planet";

/** One record a body broke, kept for good (a later, bigger one does not take the mark away). */
export interface RecordMarkDTO {
  bodyKey: string;
  systemAddress: number;
  bodyId: number;
  system: string;
  body: string;
  subject: RecordSubject;
  /** Journal StarType or PlanetClass. */
  type: string;
  which: "largest" | "smallest";
  /** Journal Radius, metres. */
  radius: number;
  /** The record it beat, metres. */
  previous: number;
  at: string;
}

const SOLAR_RADIUS_M = 695_700_000;

/** Stars in solar radii (km below a hundredth — neutron stars are twenty kilometres across), planets in km. */
export function formatRadius(metres: number, subject: RecordSubject): string {
  if (subject === "star" && metres >= SOLAR_RADIUS_M / 100) {
    return `${(metres / SOLAR_RADIUS_M).toLocaleString("en-US", { maximumFractionDigits: 3 })} R☉`;
  }
  return `${Math.round(metres / 1000).toLocaleString("en-US")} km`;
}

const STAR_WORDS: Record<string, string> = {
  TTS: "T Tauri star",
  AeBe: "Herbig Ae/Be star",
  N: "neutron star",
  H: "black hole",
  SupermassiveBlackHole: "supermassive black hole",
  X: "exotic star",
  MS: "MS-type star",
  S: "S-type star",
};

/** The journal's StarType as words: `K` → "K-type star", `DA` → "white dwarf (DA)", `M_RedGiant` → "M red giant". */
export function starTypeLabel(t: string): string {
  if (STAR_WORDS[t]) return STAR_WORDS[t];
  if (t.includes("_")) {
    const [cls, rest] = t.split("_", 2) as [string, string];
    return `${cls} ${rest.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
  }
  if (/^D[A-Z]*$/.test(t)) return `white dwarf (${t})`;
  if (/^W[A-Z]*$/.test(t)) return `Wolf-Rayet star (${t})`;
  if (/^C[A-Za-z]*$/.test(t)) return `carbon star (${t})`;
  return `${t}-type star`;
}

export function recordTypeLabel(subject: RecordSubject, type: string): string {
  return subject === "star" ? starTypeLabel(type) : type;
}

/** "Largest Water world you have found — 7,234 km (was 6,900 km)". */
export function recordText(m: Pick<RecordMarkDTO, "subject" | "type" | "which" | "radius" | "previous">): string {
  return (
    `${m.which === "largest" ? "Largest" : "Smallest"} ${recordTypeLabel(m.subject, m.type)} you have found — ` +
    `${formatRadius(m.radius, m.subject)} (was ${formatRadius(m.previous, m.subject)})`
  );
}

/** What the mail icon's list and the body marks need from the server. */
export interface NoticesSnapshotDTO {
  /** Unread notices, newest first. */
  items: NoticeDTO[];
  chime: boolean;
  /** Records broken by bodies of the system on screen. */
  recordMarks: RecordMarkDTO[];
}
