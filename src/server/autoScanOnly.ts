/**
 * Landable bodies the ship only AutoScanned (owner, 2026-10-02).
 *
 * On arrival the ship scans the bodies close to it by itself: the journal gets a full `Scan` with
 * `ScanType: "AutoScan"` — class, atmosphere, temperature, everything — but no `FSSBodySignals`. The
 * biological signal count only comes when the commander resolves the body in the FSS. Weqea BF-L b49-7
 * 2 was AutoScanned at 06:15:59 and had 2 biological signals at 06:22:29, when he resolved it; in
 * between the app did not know, gave it no tab, and a commander who trusted the tabs would have flown
 * past it.
 *
 * So every landable body in the system known only from an AutoScan gets a tab of its own, "AutoScanned
 * only - FSS required", with the candidates its scan allows (the signal count unknown). Atmosphere or
 * not: the legacy plants need none. Once the FSS resolves it, a `Detailed` scan (and, if there is life,
 * `FSSBodySignals`) takes it off this list — into an ordinary bio tab, or out of the tabs.
 */
import type { BodyExoState } from "../shared/types.js";
import { planetScanFromExplorationRecord } from "./footScannedCatalog.js";
import type { GameStateStore } from "./gameState.js";

export function autoScanOnlyBodies(store: GameStateStore, systemAddress: number): BodyExoState[] {
  const out: BodyExoState[] = [];
  for (const rec of store.liveScansInSystem(systemAddress)) {
    if (rec.scanType !== "AutoScan" || rec.fssResolved === true) continue;
    if (rec.landable !== true || !rec.planetClass) continue;
    const key = `${rec.systemAddress}:${rec.bodyId}`;
    if (store.fssBodySignalsBodyKeys.has(key)) continue;
    // The store may already hold a body for it (a Scan can create one); it counts only once it knows
    // something about life there.
    const held = store.bodies.get(key);
    if (held && (held.biologicalSignals !== null || held.genusHints?.length || held.confirmedVariants.length)) continue;
    if (held) {
      out.push({ ...held, scan: held.scan ?? planetScanFromExplorationRecord(rec), autoScanOnly: true });
      continue;
    }
    out.push({
      key,
      bodyName: rec.bodyName,
      bodyId: rec.bodyId,
      systemAddress: rec.systemAddress,
      starSystem: rec.starSystem,
      biologicalSignals: null,
      genusHints: null,
      dssComplete: false,
      scan: planetScanFromExplorationRecord(rec),
      signalHints: null,
      organicGenusLocks: [],
      confirmedVariants: [],
      updatedAt: rec.updatedAt,
      autoScanOnly: true,
    });
  }
  return out.sort((a, b) => a.bodyId - b.bodyId);
}
