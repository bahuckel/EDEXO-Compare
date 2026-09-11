import { join } from "node:path";
import type { FootTravelFix } from "./footTravelStatus.js";
import type { SurfaceMark } from "./surfaceMarksFile.js";
import { greatCircleDistanceMeters, resolveFootFixForOrganicLine } from "./footTravelStatus.js";
import type {
  JournalLine,
  SpeciesDatabase,
  ExoOrganicOverlayDTO,
  ExoMinimapDTO,
  ExoMinimapMarkDTO,
} from "../shared/types.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import {
  displayLabelFromOrganicLine,
  speciesKeyFromOrganicJournal,
  normOrganicToken,
} from "./organicTracking.js";
import {
  normStatusBodyName,
  schedulePersistOrganicSampleSession,
  wipeOrganicSampleSession,
  type OrganicSampleSessionHost,
} from "./organicSampleSessionFile.js";
import { getProjectRoot, getSpeciesDataDir } from "./paths.js";
import { readGenusMinSampleDistanceM } from "./speciesTreeLoader.js";

export type ExoOrganicAnchors = { latDeg: number; lonDeg: number; planetRadiusM: number };

export type ExoOrganicTrackerInternal = {
  bundleKey: string;
  bodyKey: string;
  speciesKey: string;
  speciesDisplay: string;
  genusLocalised: string;
  /** Normalized journal body name for `Status.json`/`BodyName` gating. */
  bodyNameNorm: string;
  minSampleDistanceM: number;
  anchors: ExoOrganicAnchors[];
  /**
   * Samples the journal says were taken but whose position was never captured.
   *
   * `ScanOrganic` has no coordinates, so a scan made while this app was closed can be *counted*
   * from the log and never *placed*. Kept separate from `anchors` so the two are never confused:
   * an anchor is somewhere you stood, this is only a number.
   */
  recoveredSamples?: number;
  phase: "tracking" | "celebrate";
  celebrationUntil: number;
  /** Set when Analyse merges; true = species already in codex (no 5× codex bonus). */
  analyseWasLogged?: boolean;
};

/** Store slice used by overlay tracker (`GameStateStore` implements this). */
export type ExoOrganicOverlayHost = {
  exoOrganicTracker: ExoOrganicTrackerInternal | null;
  exoOrganicLastFix: FootTravelFix | null;
  readonly firstFootfallBodies: Set<string>;
  /** Where each plant was sampled — the radar's dots, kept across bodies and across restarts. */
  surfaceSampleMarks: SurfaceMark[];
  addSurfaceSampleMark(
    bodyKey: string,
    bodyNameNorm: string,
    latDeg: number,
    lonDeg: number,
    label: string,
    atIso: string,
  ): void;
  surfaceShipMark: SurfaceMark | null;
};

/**
 * How far the minimap draws, in metres.
 *
 * The owner's number: "scanned plants outside the 500m radius of the minimap should appear as
 * arrows". It is also the right scale for the job — the widest genus separation in the game is
 * 500 m, so a map of this radius always contains the ring you are trying to clear.
 */
const MINIMAP_RADIUS_M = 500;

const genusMinDistCache = new Map<string, number>();

export function clearExoOrganicGenusMinDistCache(): void {
  genusMinDistCache.clear();
}

function organicBodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

type ExoOrganicJournalStore = ExoOrganicOverlayHost &
  OrganicSampleSessionHost & {
    footTravelOdometerEnabled: boolean;
    beginFootTravelOdometerSession(bodyKey: string, bodyNameNorm: string | null): void;
  };

function expireCelebrationIfNeeded(store: ExoOrganicJournalStore, projectRoot: string): void {
  const t = store.exoOrganicTracker;
  if (!t || t.phase !== "celebrate") return;
  if (Date.now() >= t.celebrationUntil) {
    wipeOrganicSampleSession(store, projectRoot);
    /*
      The live surface fix is **not** cleared with the session.

      It belongs to the `Status.json` poll, which rewrites it every 150 ms, and it is now what the
      radar draws from — so clearing it here made the radar blank for a frame and then reappear as
      the next poll landed. Against a card whose colour also changed as the session ended, that read
      as flashing. Owning a field means owning when it is emptied.
    */
  }
}

/**
 * How many scans of this plant are done.
 *
 * Two kinds, added: **anchors** are scans this app watched and therefore knows the position of, and
 * **recoveredSamples** are scans the journal reported while the app was closed, which can be counted
 * and never placed. A session restored at boot has only the second kind, so any rule written against
 * `anchors.length` alone reads it as untouched — which is how a second scan came to be ignored.
 *
 * Capped at three, because that is the run.
 */
function effectiveSampleCount(t: ExoOrganicTrackerInternal): number {
  return Math.min(3, (t.recoveredSamples ?? 0) + t.anchors.length);
}

function persistSoon(store: ExoOrganicJournalStore, projectRoot: string): void {
  schedulePersistOrganicSampleSession(store, projectRoot);
}

function resolveMinSampleDistanceM(projectRoot: string, db: SpeciesDatabase, genusLocalised: string): number {
  const g = genusLocalised.trim().toLowerCase();
  if (!g) return 0;
  const cached = genusMinDistCache.get(g);
  if (cached !== undefined) return cached;
  for (const e of db.species) {
    if (e.genus.trim().toLowerCase() !== g) continue;
    const rel = e.dataSourceRelPath;
    if (!rel) {
      genusMinDistCache.set(g, 0);
      return 0;
    }
    const jsonPath = join(getSpeciesDataDir(projectRoot), rel);
    const m = readGenusMinSampleDistanceM(jsonPath);
    const v = m != null && m > 0 ? m : 0;
    genusMinDistCache.set(g, v);
    return v;
  }
  genusMinDistCache.set(g, 0);
  return 0;
}

function speciesDisplayFromLine(line: JournalLine): string {
  const sl = typeof line.Species_Localised === "string" ? line.Species_Localised.trim() : "";
  return sl || displayLabelFromOrganicLine(line);
}

/**
 * Rebuild the sample count for a plant that was scanned while this app was closed.
 *
 * The owner's report: he scanned one and the overlay said zero. `ingestExoOrganicJournalLine` runs
 * on live lines only — deliberately, since replaying four years of scans would fire a celebration
 * for each — so a session in progress when the app starts was invisible.
 *
 * **Count only, never a position.** `ScanOrganic` carries no coordinates, so the one thing that
 * could be invented here is where the plant was, and inventing it would put a false dot on the
 * radar and a false distance in the rows. The count is a fact in the log; the position is not, and
 * the difference is kept in the type.
 *
 * Returns true when a session was restored, so the caller can say so.
 */
export function restoreOrganicSessionFromJournal(
  store: ExoOrganicJournalStore,
  lines: readonly JournalLine[],
  projectRoot: string,
  db: SpeciesDatabase,
): boolean {
  /*
    Walk backwards to the start of the current attempt. A Touchdown or a Liftoff ends whatever came
    before it: a plant is sampled in one visit to one surface, so anything older belongs to a
    different one.
  */
  const recent: JournalLine[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = lines[i]!.event;
    if (e === "Liftoff" || e === "Touchdown") break;
    if (e === "ScanOrganic") recent.push(lines[i]!);
  }
  if (recent.length === 0) return false;
  recent.reverse();

  /*
    The same state machine the live path runs, which is not "count the Samples".

    A new species opens with a **Log** — the codex entry — and that is the first anchor; after it,
    only Sample advances. Filtering to Sample alone reported nothing for a plant the commander had
    genuinely started: his one scan since landing was a Log of Bacterium Acies, and the overlay said
    zero. Mirroring the live rule rather than inventing a stricter one is the fix.
  */
  const counted: JournalLine[] = [];
  for (const l of recent) {
    const kind = String(l.ScanType ?? "").trim().toLowerCase();
    if (kind !== "sample" && kind !== "log") continue;
    // A Log only ever opens a run; it never advances one.
    if (counted.length > 0 && kind === "log") continue;
    counted.push(l);
    if (counted.length >= 3) break;
  }
  if (counted.length === 0) return false;
  const last = counted[counted.length - 1]!;

  const sa = last.SystemAddress;
  const bodyId = last.Body;
  if (typeof sa !== "number" || typeof bodyId !== "number") return false;
  const bk = organicBodyKey(sa, bodyId);

  const speciesKey = speciesKeyFromOrganicJournal(last);
  const genusLoc = typeof last.Genus_Localised === "string" ? last.Genus_Localised.trim() : "";
  const speciesDisplay = speciesDisplayFromLine(last);
  store.exoOrganicTracker = {
    bundleKey: `${bk}::${speciesKey}`,
    bodyKey: bk,
    speciesKey,
    speciesDisplay,
    genusLocalised: genusLoc,
    bodyNameNorm: normOrganicToken(
      typeof last.BodyName === "string" && last.BodyName.trim() ? last.BodyName.trim() : `Body ${bodyId}`,
    ),
    minSampleDistanceM: resolveMinSampleDistanceM(projectRoot, db, genusLoc),
    anchors: [],
    recoveredSamples: counted.length,
    phase: "tracking",
    celebrationUntil: 0,
  };
  return true;
}

/**
 * Live journal tail only (do not call during full journal hydration merge).
 * Tracks `ScanOrganic` Log/Sample/Analyse for live distance + codex-new 5× payout hints.
 * `WasLogged: true` on Sample clears an active session for that species bundle (resample / already logged).
 */
export function ingestExoOrganicJournalLine(
  store: ExoOrganicJournalStore,
  line: JournalLine,
  statusFix: FootTravelFix | null,
  projectRoot: string,
  db: SpeciesDatabase,
): void {
  expireCelebrationIfNeeded(store, projectRoot);
  if (line.event !== "ScanOrganic") return;

  /** The line's own timestamp, so a mark is dated by when it happened rather than when it was read. */
  const lineIso = typeof line.timestamp === "string" ? line.timestamp : new Date().toISOString();

  const scanTypeRaw = line.ScanType;
  const scanType = typeof scanTypeRaw === "string" ? scanTypeRaw.trim() : "";
  if (!scanType) return;
  const scanKind = scanType.toLowerCase();

  const sa = line.SystemAddress;
  const bodyId = line.Body;
  if (typeof sa !== "number" || typeof bodyId !== "number") return;

  const bk = organicBodyKey(sa, bodyId);
  /*
    What to call the body this scan happened on.

    `ScanOrganic` does **not** carry `BodyName` — only `SystemAddress` and a numeric `Body`. Every
    one of the commander's scans confirms it. So the fallback below produces "body 22", which is not
    a name anything else in the app uses, and anything comparing it against `Status.json`'s
    `BodyName` can never match.

    That is what hid the radar dot: the mark was filed under "body 22" while the radar asked for
    "smojai uj-f b13-0 b 4". The ship was unaffected because `Touchdown` does carry a real name.

    `Status.json` is read at the moment the scan lands and names the surface the commander is
    standing on, which is by definition the body being scanned — so it is both the correct name and
    the same vocabulary the radar matches in. The old derivation stays as the fallback for a fix
    with no name.
  */
  const statusBodyNorm = normStatusBodyName(statusFix?.bodyName ?? null);
  const bodyNameNormEarly =
    statusBodyNorm ??
    normOrganicToken(
      (typeof line.BodyName === "string" && line.BodyName.trim() ? line.BodyName.trim() : `Body ${bodyId}`) ||
        `body ${bodyId}`,
    );

  const tCross = store.exoOrganicTracker;
  if (tCross && tCross.bodyKey !== bk) {
    wipeOrganicSampleSession(store, projectRoot);
  }
  if (!store.exoOrganicTracker && store.footSessionBodyKey && store.footSessionBodyKey !== bk) {
    wipeOrganicSampleSession(store, projectRoot);
  }

  const speciesKey = speciesKeyFromOrganicJournal(line);
  const bundleKey = `${bk}::${speciesKey}`;
  const genusLoc = typeof line.Genus_Localised === "string" ? line.Genus_Localised.trim() : "";

  /** Log (initial codex) + Sample (physical samples) both carry position for distance tracking. */
  if (scanKind === "sample" || scanKind === "log") {
    const wl = line.WasLogged;
    if (wl === true) {
      const t = store.exoOrganicTracker;
      if (t && t.bundleKey === bundleKey) wipeOrganicSampleSession(store, projectRoot);
      return;
    }

    let t = store.exoOrganicTracker;
    if (t && t.phase === "celebrate") {
      if (t.bundleKey === bundleKey) return;
      wipeOrganicSampleSession(store, projectRoot);
      t = store.exoOrganicTracker;
    }

    const fix = resolveFootFixForOrganicLine(statusFix, line);
    if (!fix) return;

    if (t && t.bundleKey !== bundleKey) {
      wipeOrganicSampleSession(store, projectRoot);
      t = store.exoOrganicTracker;
    }

    const speciesDisplay = speciesDisplayFromLine(line);
    const minM = resolveMinSampleDistanceM(projectRoot, db, genusLoc);

    if (!t) {
      store.exoOrganicTracker = {
        bundleKey,
        bodyKey: bk,
        speciesKey,
        speciesDisplay,
        genusLocalised: genusLoc,
        bodyNameNorm: bodyNameNormEarly,
        minSampleDistanceM: minM,
        anchors: [{ latDeg: fix.latDeg, lonDeg: fix.lonDeg, planetRadiusM: fix.planetRadiusM }],
        phase: "tracking",
        celebrationUntil: 0,
      };
      // The anchors are this species' own and are wiped when the next one starts; the map wants
      // every plant taken on this body, so it keeps its own list.
      store.addSurfaceSampleMark(bk, bodyNameNormEarly, fix.latDeg, fix.lonDeg, speciesDisplay, lineIso);
      store.footSessionBodyKey = bk;
      store.footSessionBodyNameNorm = bodyNameNormEarly;
      if (store.footTravelOdometerEnabled) {
        store.beginFootTravelOdometerSession(bk, bodyNameNormEarly);
      }
      persistSoon(store, projectRoot);
      return;
    }

    if (t.bundleKey !== bundleKey) return;

    if (effectiveSampleCount(t) >= 2) {
      wipeOrganicSampleSession(store, projectRoot);
      store.exoOrganicTracker = {
        bundleKey,
        bodyKey: bk,
        speciesKey,
        speciesDisplay,
        genusLocalised: genusLoc,
        bodyNameNorm: bodyNameNormEarly,
        minSampleDistanceM: minM,
        anchors: [{ latDeg: fix.latDeg, lonDeg: fix.lonDeg, planetRadiusM: fix.planetRadiusM }],
        phase: "tracking",
        celebrationUntil: 0,
      };
      // The anchors are this species' own and are wiped when the next one starts; the map wants
      // every plant taken on this body, so it keeps its own list.
      store.addSurfaceSampleMark(bk, bodyNameNormEarly, fix.latDeg, fix.lonDeg, speciesDisplay, lineIso);
      store.footSessionBodyKey = bk;
      store.footSessionBodyNameNorm = bodyNameNormEarly;
      if (store.footTravelOdometerEnabled) {
        store.beginFootTravelOdometerSession(bk, bodyNameNormEarly);
      }
      persistSoon(store, projectRoot);
      return;
    }

    /*
      `< 2`, not `=== 1`.

      A session restored from the journal at boot knows a scan happened but has no anchor for it —
      `ScanOrganic` carries no position, so there is nothing to anchor. With `=== 1` the next live
      Sample matched neither this branch nor the `>= 2` restart above and was silently dropped: the
      owner's second scan went unrecorded while the first and third worked.
    */
    if (effectiveSampleCount(t) < 2) {
      if (scanKind === "log") return;
      t.anchors.push({
        latDeg: fix.latDeg,
        lonDeg: fix.lonDeg,
        planetRadiusM: fix.planetRadiusM,
      });
      store.addSurfaceSampleMark(
        bk,
        bodyNameNormEarly,
        fix.latDeg,
        fix.lonDeg,
        speciesDisplay || t.speciesDisplay,
        lineIso,
      );
      t.speciesDisplay = speciesDisplay || t.speciesDisplay;
      t.genusLocalised = genusLoc || t.genusLocalised;
      t.minSampleDistanceM = minM || t.minSampleDistanceM;
      t.bodyNameNorm = bodyNameNormEarly || t.bodyNameNorm;
      persistSoon(store, projectRoot);
    }
    return;
  }

  if (scanKind === "analyse") {
    expireCelebrationIfNeeded(store, projectRoot);
    const t = store.exoOrganicTracker;
    if (!t || t.phase !== "tracking") return;
    if (t.bundleKey !== bundleKey) return;
    if (effectiveSampleCount(t) < 2) {
      wipeOrganicSampleSession(store, projectRoot);
      return;
    }

    const wasLogged = line.WasLogged === true;
    t.phase = "celebrate";
    t.celebrationUntil = Date.now() + 60_000;
    t.analyseWasLogged = wasLogged;
    persistSoon(store, projectRoot);
  }
}

/**
 * Where things are around you on this body, in metres.
 *
 * **Not tied to a sample session.** It was, and that was wrong: the overlay only built a payload
 * while a species was being tracked, so a commander standing on a planet having just landed saw no
 * map at all — the owner reported exactly that. A radar answers "what is around me here", which is
 * a question about the rock, not about whichever plant is half-sampled. So it is built from the
 * live surface fix alone, and the distance rows above it keep their own gate.
 *
 * Done here rather than in the overlay because the overlay is a transparent HUD ticking every
 * 320 ms and should not be running spherical trigonometry; and because the latitudes are here.
 *
 * The flat-earth approximation is fine and worth saying out loud: over a few hundred metres on a
 * body thousands of kilometres across, treating a degree of latitude as a fixed number of metres is
 * wrong by far less than a marker is wide. The longitude term keeps its cos(lat) factor because
 * that one is not negligible — near a pole it is the difference between a map and a lie.
 */
export function buildExoMinimapDto(
  store: ExoOrganicOverlayHost,
  bodyKeyOnFoot: string | null,
  minSampleDistanceM: number,
): ExoMinimapDTO | null {
  const fix = store.exoOrganicLastFix;
  if (!fix) return null;
  const R = fix.planetRadiusM;
  if (!(R > 0)) return null;

  const torad = Math.PI / 180;
  const mPerDegLat = (Math.PI * R) / 180;
  const mPerDegLon = mPerDegLat * Math.cos(fix.latDeg * torad);
  const marks: ExoMinimapMarkDTO[] = [];

  const push = (latDeg: number, lonDeg: number, kind: "sample" | "ship", markLabel: string) => {
    // Longitude wraps; without this a plant just across the antimeridian reads as half a planet away.
    let dLon = lonDeg - fix.lonDeg;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    marks.push({
      kind,
      northM: (latDeg - fix.latDeg) * mPerDegLat,
      eastM: dLon * mPerDegLon,
      distanceM: greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, latDeg, lonDeg, R),
      label: markLabel,
    });
  };

  /*
    Which body's marks to show — and it is decided by `Status.json`, not by the journal.

    The owner's rule: "if I enter supercruise they get dropped until I go down on that planet
    again". Nothing is deleted when he leaves; the marks are filed under their body and stop
    matching while he is elsewhere. `Status.json` names the body he is actually on, second by
    second, which is the only source that knows he has left — the journal's last Touchdown still
    says "that planet" long after he has flown away.

    The body key is the fallback for the case where the live fix has no name, which happens on some
    surfaces; a key from the session or the last landing is better than refusing to draw.
  */
  const onBodyNorm = normStatusBodyName(fix.bodyName);
  const belongsHere = (m: { bodyKey: string; bodyNameNorm?: string }): boolean => {
    // A mark from an older store may have no name; its key is then the only thing to go on, and
    // refusing to draw it would lose a ship that is genuinely parked here.
    if (onBodyNorm && m.bodyNameNorm) return m.bodyNameNorm === onBodyNorm;
    return bodyKeyOnFoot == null || m.bodyKey === bodyKeyOnFoot;
  };

  for (const m of store.surfaceSampleMarks) {
    if (!belongsHere(m)) continue;
    push(m.latDeg, m.lonDeg, "sample", m.label);
  }
  const ship = store.surfaceShipMark;
  if (ship && belongsHere(ship)) push(ship.latDeg, ship.lonDeg, "ship", "Your ship");

  return { radiusM: MINIMAP_RADIUS_M, headingDeg: fix.headingDeg, minSampleDistanceM, marks };
}

export function buildExoOrganicOverlayDto(
  store: ExoOrganicOverlayHost,
  prices: PriceIndex,
): ExoOrganicOverlayDTO | null {
  expireCelebrationIfNeeded(store as ExoOrganicJournalStore, getProjectRoot());
  const t = store.exoOrganicTracker;
  if (!t) return null;

  const fix = store.exoOrganicLastFix;
  const anchors = t.anchors;
  const minG = Math.max(0, Math.round(t.minSampleDistanceM));

  const avgR = (a: ExoOrganicAnchors): number =>
    typeof a?.planetRadiusM === "number" && a.planetRadiusM > 0 ? a.planetRadiusM : (fix?.planetRadiusM ?? 0);

  let distFirstM: number | null = null;
  let distSecondM: number | null = null;
  let spacingBetweenSamplesM: number | null = null;

  if (fix && anchors[0] && avgR(anchors[0]) > 0) {
    distFirstM = greatCircleDistanceMeters(
      fix.latDeg,
      fix.lonDeg,
      anchors[0].latDeg,
      anchors[0].lonDeg,
      avgR(anchors[0]),
    );
  }
  if (fix && anchors[1] && avgR(anchors[1]) > 0) {
    distSecondM = greatCircleDistanceMeters(
      fix.latDeg,
      fix.lonDeg,
      anchors[1].latDeg,
      anchors[1].lonDeg,
      avgR(anchors[1]),
    );
  }
  if (anchors.length >= 2) {
    const ra = avgR(anchors[0]!);
    if (ra > 0) {
      spacingBetweenSamplesM = greatCircleDistanceMeters(
        anchors[0]!.latDeg,
        anchors[0]!.lonDeg,
        anchors[1]!.latDeg,
        anchors[1]!.lonDeg,
        ra,
      );
    }
  }

  const spacingMeetsMin = spacingBetweenSamplesM != null && minG > 0 ? spacingBetweenSamplesM >= minG : null;

  const separationForSecondSampleM = anchors.length === 1 ? distFirstM : null;
  const separationMeetsMin =
    separationForSecondSampleM != null && minG > 0 ? separationForSecondSampleM >= minG : null;

  let distToNearestSampleM: number | null = null;
  if (fix && anchors.length > 0) {
    let best: number | null = null;
    for (const a of anchors) {
      const R = avgR(a);
      if (R <= 0) continue;
      const d = greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, a.latDeg, a.lonDeg, R);
      if (best === null || d < best) best = d;
    }
    distToNearestSampleM = best != null ? Math.round(best) : null;
  }
  const nearestSampleMeetsMin =
    distToNearestSampleM != null && minG > 0 ? distToNearestSampleM >= minG : null;

  const minimap = buildExoMinimapDto(store, t.bodyKey, minG);

  const label = t.speciesDisplay;
  const baseCredits = lookupPrice(prices, label, label);
  const ff: 1 | 5 = store.firstFootfallBodies.has(t.bodyKey) ? 5 : 1;

  /** New codex (WasLogged false): 5× list — do not stack footfall again (matches main UI / pending organic valuation). */
  const payNewCodex = baseCredits != null ? Math.round(baseCredits * 5) : null;
  const payLoggedCodex = baseCredits != null ? Math.round(baseCredits * ff) : null;

  let finalCredits: number | null = null;
  let analyseWasLogged: boolean | null = null;
  if (t.phase === "celebrate") {
    analyseWasLogged = t.analyseWasLogged === true;
    finalCredits = baseCredits != null ? Math.round(baseCredits * (analyseWasLogged ? ff : 5)) : null;
  }

  const celebrationRemainSec =
    t.phase === "celebrate" ? Math.max(0, Math.ceil((t.celebrationUntil - Date.now()) / 1000)) : 0;

  return {
    visible: true,
    phase: t.phase,
    celebrationRemainSec,
    speciesDisplay: label,
    minSampleDistanceM: minG,
    distToFirstM: distFirstM != null ? Math.round(distFirstM) : null,
    distToSecondM: distSecondM != null ? Math.round(distSecondM) : null,
    spacingBetweenSamplesM: spacingBetweenSamplesM != null ? Math.round(spacingBetweenSamplesM) : null,
    spacingMeetsMin,
    separationForSecondSampleM:
      separationForSecondSampleM != null ? Math.round(separationForSecondSampleM) : null,
    separationMeetsMin,
    baseCredits,
    payNewCodex,
    payLoggedCodex,
    finalCredits,
    analyseWasLogged,
    footfallMult: ff,
    sampleCount: effectiveSampleCount(t),
    trackingBodyKey: t.bodyKey,
    distToNearestSampleM,
    minimap,
    nearestSampleMeetsMin,
  };
}
