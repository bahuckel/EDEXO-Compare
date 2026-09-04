import type { BodyExoState, ExplorationScanRecord, SpeciesMatchContext } from "../shared/types.js";
import { journalPressureToAtm, LIGHT_SECOND_METERS } from "../shared/journalPhysics.js";
import { resolveHostStarBodyId } from "./orbitUtils.js";
import type { GameStateStore } from "./gameState.js";

function bodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/**
 * Per-system index of exploration records, cached on the store's scan revision.
 *
 * Building it walks the *entire* `explorationScans` map — over 100k records after a long play
 * history — and it ran once per body, on every snapshot build. Records are replaced rather than
 * mutated on update, so the revision counter is the signature; map size alone would go stale.
 */
let cachedScanIndex: { signature: string; byId: Map<number, ExplorationScanRecord> } | null = null;

export function systemExplorationScanIndex(
  store: GameStateStore,
  systemAddress: number,
): Map<number, ExplorationScanRecord> {
  const signature = `${systemAddress}:${store.explorationScansRevision}`;
  if (cachedScanIndex && cachedScanIndex.signature === signature) return cachedScanIndex.byId;
  const byId = new Map<number, ExplorationScanRecord>();
  for (const [, r] of store.explorationScans) {
    if (r.systemAddress === systemAddress) byId.set(r.bodyId, r);
  }
  cachedScanIndex = { signature, byId };
  return byId;
}

/** Build optional matching context from merged exploration scans + scanner signal hints on the body. */
export function buildSpeciesMatchContext(exo: BodyExoState, store: GameStateStore): SpeciesMatchContext {
  const sk = bodyKey(exo.systemAddress, exo.bodyId);
  const rec = store.explorationScans.get(sk);
  const scan = exo.scan;

  const byId = systemExplorationScanIndex(store, exo.systemAddress);

  let parentStarType: string | undefined;
  let parentStarSubclass: number | undefined;
  let parentStarLuminosity: string | undefined;
  if (rec) {
    const starId = resolveHostStarBodyId(rec, byId);
    if (starId != null) {
      const starRec = byId.get(starId);
      const st = starRec?.starType?.trim();
      if (st) parentStarType = st;
      if (typeof starRec?.subclass === "number" && Number.isFinite(starRec.subclass)) {
        parentStarSubclass = starRec.subclass;
      }
      const lum = starRec?.luminosity?.trim();
      if (lum) parentStarLuminosity = lum;
    }
  }

  let orbitDistanceFromParentStarLs: number | undefined;
  const sma = rec?.semiMajorAxis ?? scan?.SemiMajorAxis;
  if (typeof sma === "number" && Number.isFinite(sma) && sma > 0) {
    orbitDistanceFromParentStarLs = sma / LIGHT_SECOND_METERS;
  }

  let signalHints: string[] | undefined;
  if (exo.signalHints?.length) {
    const s = new Set<string>();
    for (const h of exo.signalHints) {
      const t = h.trim().toLowerCase();
      if (t) s.add(t);
    }
    signalHints = s.size ? [...s] : undefined;
  }

  const ctx: SpeciesMatchContext = {};
  if (parentStarType) ctx.parentStarType = parentStarType;
  if (parentStarSubclass !== undefined) ctx.parentStarSubclass = parentStarSubclass;
  if (parentStarLuminosity) ctx.parentStarLuminosity = parentStarLuminosity;
  if (orbitDistanceFromParentStarLs !== undefined) ctx.orbitDistanceFromParentStarLs = orbitDistanceFromParentStarLs;
  if (signalHints?.length) ctx.signalHints = signalHints;
  const rawP = scan?.SurfacePressure ?? rec?.surfacePressure;
  if (rawP != null && Number.isFinite(rawP)) ctx.surfacePressureAtm = journalPressureToAtm(rawP);

  return ctx;
}
