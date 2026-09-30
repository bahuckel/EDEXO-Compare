/**
 * Notable stellar phenomena for one system (owner, 2026-09-30: "a small card that says this system,
 * in this region, might have an NSP" — and then: only when something says it could, from what makes
 * them spawn, the way the exobiology works).
 *
 * What is known comes first: the commander's own journals (the FSS reports a phenomenon on arrival,
 * the codex names it once he drops in), then EDAstro's codex file (someone logged one there). Without
 * either, a prediction from what the system is: its region and its main star, and — with the EDAstro
 * phenomena download — how many phenomena lie within 100 ly. Measured on EDAstro's codex file
 * (shared/nspModelData.ts has the numbers and the test): region is by far the strongest sign
 * (Dryman's Point 73 % of logged systems, the Sagittarius-Carina Arm 69 %, Tenebrae 40 %, most regions
 * under 1 %), then the star (black holes ×2.3, A ×1.4, M ×1.3; neutron stars ×0.4). Catalogued
 * nebulae nearby add almost nothing and are left out.
 *
 * The card shows only for a sighting, an EDAstro entry, or a prediction of 10 % or more (owner: "not
 * needed if nothing in the system indicates there could be one").
 */
import { regionJoinKey } from "./regionMap.js";
import { NSP_BASE, NSP_NEARBY_FACTOR, NSP_REGION_LIFT, NSP_STAR_LIFT } from "./nspModelData.js";

/** The codex families that are phenomena, by codex id (same as the EDAstro NSP list). Not L-type stars. */
const NSP_CODEX = /^codex_ent_(gas_clds|small_org|l_(?!type)|s_|spoi)/i;

/** A `CodexEntry` Name (`$Codex_Ent_Gas_Clds_Light_Name;`) or a codex id that is a phenomenon. */
export function isNspCodexName(name: string | null | undefined): boolean {
  const id = (name ?? "").trim().replace(/^\$/, "").replace(/_name;?$/i, "").toLowerCase();
  return NSP_CODEX.test(id);
}

/** Within this radius phenomena count as nearby. */
export const NSP_NEARBY_RADIUS_LY = 100;
/**
 * Below this, the card stays away: about twice the average for a logged system (5 %). In the test,
 * predictions of 10–30 % came true 10–12 % of the time, and over 30 % about 70 %; below 10 % it was the
 * average — no sign at all.
 */
export const NSP_SHOW_FROM = 0.1;

/** A journal `StarType` → EDAstro's name for it (the model's key). */
export function nspStarKey(starType: string | null | undefined): string | null {
  const t = (starType ?? "").trim();
  if (!t) return null;
  if (t === "H" || /blackhole/i.test(t)) return "Black Hole";
  if (t === "N") return "Neutron Star";
  if (/^D[A-Z]*$/.test(t)) return "White Dwarf";
  if (t === "TTS") return "T Tauri Star";
  if (t === "AeBe") return "Herbig Ae/Be Star";
  const wr: Record<string, string> = {
    W: "Wolf-Rayet Star",
    WN: "Wolf-Rayet N Star",
    WNC: "Wolf-Rayet NC Star",
    WC: "Wolf-Rayet C Star",
    WO: "Wolf-Rayet O Star",
  };
  if (wr[t]) return wr[t]!;
  if (t === "C" || t === "CH" || t === "CHd") return "C Star";
  if (t === "CN") return "CN Star";
  if (t === "CJ") return "CJ Star";
  if (t === "S") return "S-type Star";
  if (t === "MS") return "MS-type Star";
  const cls = t.split("_")[0]!;
  return /^[OBAFGKMLTY]$/.test(cls) ? cls : null;
}

function nearbyBucket(n: number): number {
  return n === 0 ? 0 : n < 5 ? 1 : n < 20 ? 2 : n < 100 ? 3 : 4;
}

export interface NspPrediction {
  /** Chance of a phenomenon, 0–1 (capped at 0.9). */
  p: number;
  /** Why, in words, strongest first. */
  reasons: string[];
}

/** The prediction from what the system is. `nearby` is null without the EDAstro phenomena download. */
export function nspPredict(o: {
  region: string | null;
  starType: string | null;
  nearby: number | null;
}): NspPrediction {
  /** `up`: raises the chance (listed first, the card shows the first). */
  const reasons: { text: string; w: number; up: boolean }[] = [];
  let p = NSP_BASE;
  const rl = o.region ? NSP_REGION_LIFT[regionJoinKey(o.region)] : undefined;
  if (rl != null) {
    p *= rl;
    if (rl >= 1.3) reasons.push({ text: `${o.region} is rich in phenomena (×${rl < 10 ? rl.toFixed(1) : Math.round(rl)})`, w: rl, up: true });
    else if (rl <= 0.2) reasons.push({ text: `${o.region} has very few`, w: 1 / Math.max(rl, 0.001), up: false });
  }
  const sk = nspStarKey(o.starType);
  const sl = sk ? NSP_STAR_LIFT[sk] : undefined;
  if (sl != null) {
    p *= sl;
    if (sl >= 1.2 || sl <= 0.6) {
      const what = sk === "Black Hole" ? "a black hole" : /^[A-Z]$/.test(sk!) ? `${sk}-type star` : sk!.toLowerCase();
      reasons.push({ text: `${what} (×${sl.toFixed(1)})`, w: sl >= 1 ? sl : 1 / sl, up: sl >= 1 });
    }
  }
  if (o.nearby != null) {
    const f = NSP_NEARBY_FACTOR[nearbyBucket(o.nearby)] ?? 1;
    p *= f;
    reasons.push({
      text: o.nearby === 0 ? `none known within ${NSP_NEARBY_RADIUS_LY} ly` : `${o.nearby.toLocaleString("en-US")} known within ${NSP_NEARBY_RADIUS_LY} ly`,
      w: f >= 1 ? f : 1 / f,
      up: f > 1,
    });
  }
  return {
    p: Math.min(0.9, p),
    reasons: reasons.sort((a, b) => Number(b.up) - Number(a.up) || b.w - a.w).map((r) => r.text),
  };
}

/** "Likely", "Good chance", "Possible", from a prediction. */
export function nspChanceWord(p: number): string {
  if (p >= 0.3) return "Likely";
  if (p >= 0.1) return "Good chance";
  return "Possible";
}

/** "about 1 in 12", "about 2 in 3". */
export function nspOdds(p: number): string {
  if (p >= 0.6) return "about 2 in 3";
  if (p >= 0.45) return "about 1 in 2";
  return `about 1 in ${Math.max(2, Math.round(1 / p))}`;
}

export interface NspOutlookDTO {
  systemAddress: number;
  /** Phenomena the commander met here (journal): names, "" for an FSS signal not yet named. */
  seen: string[];
  /** Phenomena EDAstro's codex file has for this system: their families ("Lagrange cloud")... */
  logged: string[];
  /** ...and the entries themselves ("Viride Lagrange Cloud"), for the tooltip. */
  loggedDetail: string[];
  /** The prediction when neither knows (null when there is nothing to go on). */
  guess: NspPrediction | null;
  /** Nearest phenomena of different kinds, nearest first (up to 4); empty without the download. */
  nearest: { name: string; system: string; distanceLy: number }[];
  region: string | null;
}

/** Whether the card has anything worth showing. */
export function nspCardWorthShowing(o: NspOutlookDTO | null | undefined): boolean {
  if (!o) return false;
  return o.seen.length > 0 || o.logged.length > 0 || (o.guess != null && o.guess.p >= NSP_SHOW_FROM);
}
