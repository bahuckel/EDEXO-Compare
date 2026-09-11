import { join } from "node:path";
import type { FootTravelFix } from "./footTravelStatus.js";
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
  /** Where each plant was sampled on this body — the minimap's dots. */
  surfaceSampleMarks: { bodyKey: string; latDeg: number; lonDeg: number; label: string }[];
  addSurfaceSampleMark(bodyKey: string, latDeg: number, lonDeg: number, label: string): void;
  surfaceShipMark: { bodyKey: string; latDeg: number; lonDeg: number } | null;
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
    store.exoOrganicLastFix = null;
  }
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

  const scanTypeRaw = line.ScanType;
  const scanType = typeof scanTypeRaw === "string" ? scanTypeRaw.trim() : "";
  if (!scanType) return;
  const scanKind = scanType.toLowerCase();

  const sa = line.SystemAddress;
  const bodyId = line.Body;
  if (typeof sa !== "number" || typeof bodyId !== "number") return;

  const bk = organicBodyKey(sa, bodyId);
  const bodyNameNormEarly = normOrganicToken(
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
      store.addSurfaceSampleMark(bk, fix.latDeg, fix.lonDeg, speciesDisplay);
      store.footSessionBodyKey = bk;
      store.footSessionBodyNameNorm = bodyNameNormEarly;
      if (store.footTravelOdometerEnabled) {
        store.beginFootTravelOdometerSession(bk, bodyNameNormEarly);
      }
      persistSoon(store, projectRoot);
      return;
    }

    if (t.bundleKey !== bundleKey) return;

    if (t.anchors.length >= 2) {
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
      store.addSurfaceSampleMark(bk, fix.latDeg, fix.lonDeg, speciesDisplay);
      store.footSessionBodyKey = bk;
      store.footSessionBodyNameNorm = bodyNameNormEarly;
      if (store.footTravelOdometerEnabled) {
        store.beginFootTravelOdometerSession(bk, bodyNameNormEarly);
      }
      persistSoon(store, projectRoot);
      return;
    }

    if (t.anchors.length === 1) {
      if (scanKind === "log") return;
      t.anchors.push({
        latDeg: fix.latDeg,
        lonDeg: fix.lonDeg,
        planetRadiusM: fix.planetRadiusM,
      });
      store.addSurfaceSampleMark(bk, fix.latDeg, fix.lonDeg, speciesDisplay || t.speciesDisplay);
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
    if (t.anchors.length < 2) {
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
    Which body's marks to show. With a session it is that session's body; without one it is wherever
    the ship last touched down. Null means we cannot tell, and then nothing is drawn rather than
    marks from the last rock — a map of somewhere else is worse than an empty one.
  */
  for (const m of store.surfaceSampleMarks) {
    if (bodyKeyOnFoot != null && m.bodyKey !== bodyKeyOnFoot) continue;
    push(m.latDeg, m.lonDeg, "sample", m.label);
  }
  const ship = store.surfaceShipMark;
  if (ship && (bodyKeyOnFoot == null || ship.bodyKey === bodyKeyOnFoot)) {
    push(ship.latDeg, ship.lonDeg, "ship", "Your ship");
  }

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
    sampleCount: anchors.length,
    trackingBodyKey: t.bodyKey,
    distToNearestSampleM,
    minimap,
    nearestSampleMeetsMin,
  };
}
