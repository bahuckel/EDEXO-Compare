/**
 * How long does a body actually cost — measured from the commander's own journals.
 *
 * B2 ranks bodies by value per *minute*, which needs minutes. Guessing them would put an invented
 * number next to a calibrated one, so the three legs of a trip are measured instead, from the events
 * the game already writes with timestamps:
 *
 *   1. **supercruise** — `SupercruiseEntry` to the `SupercruiseExit` that drops at a body, against
 *      that body's distance from the arrival star. Supercruise accelerates, so the expectation is
 *      `t ≈ a + b·√d` rather than anything linear, and the fit reports both.
 *   2. **approach and landing** — `SupercruiseExit` to `Touchdown` on the same body.
 *   3. **sampling** — first `ScanOrganic` to the third on one body, which is what an exobiology stop
 *      costs once you are down there, per genus.
 *
 * Everything is reported as a median: a handful of trips where the commander went to make tea would
 * otherwise set the mean, and the number wanted here is the typical one.
 *
 *   npm run travel-probe
 */
import path from "node:path";
import { listJournalFilesChronological, readJournalFull } from "../src/server/journalWatcher.js";
import type { JournalLine } from "../src/shared/types.js";

const journalDir = path.join(
  process.env.USERPROFILE || "",
  "Saved Games",
  "Frontier Developments",
  "Elite Dangerous",
);

const files = await listJournalFilesChronological(journalDir, { minFileStartUtcMs: 0 });
if (files.length === 0) {
  console.error(`No journals under ${journalDir}`);
  process.exit(1);
}

interface Leg {
  distanceLs: number;
  minutes: number;
}

const supercruise: Leg[] = [];
const landing: number[] = [];
const sampling: number[] = [];

/** Distance from arrival per body name, from `Scan`; the only place the game states it. */
const distanceByBody = new Map<string, number>();

/**
 * Arrival in the current system, so a supercruise leg can be tied to a starting point.
 *
 * `SupercruiseEntry` on its own says nothing about where the ship *was* — most of them are a hop
 * between two bodies, or a re-entry after dropping out at the same one, and measuring those against
 * the target's distance-from-arrival compares two unrelated numbers. Only the first leg after an
 * `FSDJump` starts where the distance is measured from: the arrival star.
 */
let arrivedAt: number | null = null;
let arrivedSystem: string | null = null;
let legsSinceArrival = 0;

let scEntryAt: number | null = null;
let scExitAt: number | null = null;
let scExitBody: string | null = null;
const organicFirstAt = new Map<string, number>();
const organicSamples = new Map<string, number>();

function ms(line: JournalLine): number | null {
  const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

for (const file of files) {
  await readJournalFull(file, (line) => {
    const at = ms(line);
    if (at == null) return;
    const event = String(line.event ?? "");

    if (event === "Scan") {
      const name = String(line.BodyName ?? "").trim();
      const d = line.DistanceFromArrivalLS;
      if (name && typeof d === "number" && Number.isFinite(d)) distanceByBody.set(name, d);
      return;
    }

    if (event === "FSDJump" || event === "CarrierJump") {
      arrivedAt = at;
      arrivedSystem = String(line.StarSystem ?? "").trim() || null;
      legsSinceArrival = 0;
      return;
    }

    if (event === "SupercruiseEntry") {
      scEntryAt = at;
      return;
    }

    if (event === "SupercruiseExit") {
      const body = String(line.Body ?? "").trim();
      scExitAt = at;
      scExitBody = body || null;
      if (scEntryAt != null && body) {
        const d = distanceByBody.get(body);
        const minutes = (at - scEntryAt) / 60_000;
        const firstLegOfVisit = legsSinceArrival === 0 && arrivedAt != null && arrivedSystem != null;
        // A leg over an hour is someone who left the game running, and a body at 0 Ls is the star.
        // Only the first drop after arriving is a trip from the star to that body.
        if (firstLegOfVisit && d != null && d > 0 && minutes > 0 && minutes < 60) {
          supercruise.push({ distanceLs: d, minutes });
        }
        legsSinceArrival++;
      }
      scEntryAt = null;
      return;
    }

    if (event === "Touchdown") {
      const body = String(line.Body ?? "").trim();
      if (scExitAt != null && body && body === scExitBody) {
        const minutes = (at - scExitAt) / 60_000;
        if (minutes > 0 && minutes < 30) landing.push(minutes);
      }
      scExitAt = null;
      scExitBody = null;
      return;
    }

    if (event === "ScanOrganic") {
      const key = `${String(line.SystemAddress ?? "")}:${String(line.Body ?? "")}:${String(line.Species ?? "")}`;
      const type = String(line.ScanType ?? "");
      if (type === "Log" || type === "Sample") {
        if (!organicFirstAt.has(key)) organicFirstAt.set(key, at);
        organicSamples.set(key, (organicSamples.get(key) ?? 0) + 1);
      } else if (type === "Analyse") {
        const first = organicFirstAt.get(key);
        if (first != null) {
          const minutes = (at - first) / 60_000;
          if (minutes > 0 && minutes < 90) sampling.push(minutes);
        }
        organicFirstAt.delete(key);
        organicSamples.delete(key);
      }
    }
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/**
 * Least squares for `minutes = a + b·√distance`.
 *
 * Straight lines fit supercruise badly — the ship accelerates the whole way, so ten times the
 * distance is nowhere near ten times the time. The square root is the shape constant acceleration
 * gives, and the residual is reported so the claim can be checked rather than believed.
 */
function fitSqrt(legs: Leg[]): { a: number; b: number; rmse: number } {
  const n = legs.length;
  if (n < 10) return { a: 0, b: 0, rmse: 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const l of legs) {
    const x = Math.sqrt(l.distanceLs);
    sx += x;
    sy += l.minutes;
    sxx += x * x;
    sxy += x * l.minutes;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  let se = 0;
  for (const l of legs) se += (a + b * Math.sqrt(l.distanceLs) - l.minutes) ** 2;
  return { a, b, rmse: Math.sqrt(se / n) };
}

console.log(`\njournals            ${files.length}`);
console.log(`supercruise legs    ${supercruise.length}`);
console.log(`landings            ${landing.length}`);
console.log(`sampling runs       ${sampling.length}`);

/**
 * Medians per distance band, which is what the model should be built from.
 *
 * Least squares over the raw legs fits the commander's tea breaks: a handful of hour-long "legs"
 * drag the intercept to six minutes when the typical leg at that distance is under four. The bands
 * report the middle of each group and how many legs stand behind it.
 */
const BANDS: [number, number][] = [
  [0, 200],
  [200, 600],
  [600, 2000],
  [2000, 6000],
  [6000, 20000],
  [20000, Number.POSITIVE_INFINITY],
];
console.log(`\nsupercruise by distance band (median of the legs in it)`);
for (const [lo, hi] of BANDS) {
  const inBand = supercruise.filter((l) => l.distanceLs >= lo && l.distanceLs < hi);
  if (inBand.length === 0) continue;
  const label = hi === Number.POSITIVE_INFINITY ? `${lo}+ Ls` : `${lo}-${hi} Ls`;
  console.log(
    `  ${label.padEnd(16)} ${String(inBand.length).padStart(4)} legs   median ${median(
      inBand.map((l) => l.minutes),
    )
      .toFixed(1)
      .padStart(5)} min` +
      `   p25 ${quantile(
        inBand.map((l) => l.minutes),
        0.25,
      ).toFixed(1)}   p75 ${quantile(
        inBand.map((l) => l.minutes),
        0.75,
      ).toFixed(1)}`,
  );
}

const fit = fitSqrt(supercruise);
console.log(`\nsupercruise         minutes ≈ ${fit.a.toFixed(2)} + ${fit.b.toFixed(4)} · √(distance Ls)`);
console.log(`                    residual ${fit.rmse.toFixed(2)} min`);
for (const d of [100, 1000, 5000, 20000, 100000]) {
  const observed = supercruise.filter((l) => l.distanceLs > d / 2 && l.distanceLs <= d * 2);
  console.log(
    `  ${String(d).padStart(6)} Ls   model ${(fit.a + fit.b * Math.sqrt(d)).toFixed(1).padStart(5)} min` +
      (observed.length >= 5
        ? `   observed median ${median(observed.map((l) => l.minutes)).toFixed(1)} min over ${observed.length} legs`
        : `   (${observed.length} legs nearby)`),
  );
}

console.log(
  `\napproach + landing  median ${median(landing).toFixed(1)} min   (p25 ${quantile(landing, 0.25).toFixed(1)}, p75 ${quantile(landing, 0.75).toFixed(1)})`,
);
console.log(
  `sampling one genus  median ${median(sampling).toFixed(1)} min   (p25 ${quantile(sampling, 0.25).toFixed(1)}, p75 ${quantile(sampling, 0.75).toFixed(1)})`,
);
console.log("");
