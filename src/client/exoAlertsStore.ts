/**
 * Alert dismissals and acknowledgements in localStorage, and the snapshot collector (7.3).
 */
import type { AppSnapshot, BodyComputed, ExoDataAlertDTO } from "@shared/types";

export const EXO_DATA_ALERT_DISMISS_LS = "edexo.exoDataAlertDismissals";

export const EXO_ALERT_DETECT_JOURNAL_LS = "edexo.exoDataAlertDetectJournal";

export const EXO_ALERT_DETECT_FEEDER_LS = "edexo.exoDataAlertDetectExoFeeder";

const EXO_ALERT_ACK_IDS_LS = "edexo.exoDataAlertsAckIds";

export function readExoAlertDismissals(): Set<string> {
  try {
    const raw = localStorage.getItem(EXO_DATA_ALERT_DISMISS_LS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function readExoAlertAckIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXO_ALERT_ACK_IDS_LS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeExoAlertAckIds(ids: Set<string>) {
  try {
    localStorage.setItem(EXO_ALERT_ACK_IDS_LS, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Re-show alerts for selected sources (clears client dismissals + ack for those ids). */
export function applyExoDataScanSourceClear(detectJournal: boolean, detectFeeder: boolean): void {
  if (!detectJournal && !detectFeeder) return;
  const dismiss = readExoAlertDismissals();
  const ack = readExoAlertAckIds();
  const shouldDrop = (id: string): boolean => {
    if (detectJournal && (id.startsWith("err-codex-") || id.startsWith("err-hidden-"))) return true;
    if (detectFeeder && id.startsWith("warn-feeder-")) return true;
    return false;
  };
  let nextD: Set<string>;
  let nextA: Set<string>;
  if (detectJournal && detectFeeder) {
    nextD = new Set();
    nextA = new Set();
  } else {
    nextD = new Set(dismiss);
    nextA = new Set(ack);
    for (const id of dismiss) {
      if (shouldDrop(id)) nextD.delete(id);
    }
    for (const id of ack) {
      if (shouldDrop(id)) nextA.delete(id);
    }
  }
  try {
    localStorage.setItem(EXO_DATA_ALERT_DISMISS_LS, JSON.stringify([...nextD]));
  } catch {
    /* ignore */
  }
  writeExoAlertAckIds(nextA);
}

type ExoDataAlertWithBody = ExoDataAlertDTO & {
  bodyTabLabel: string;
  bodyKey: string;
};

export function collectExoDataAlertsFromSnapshot(snap: AppSnapshot): ExoDataAlertWithBody[] {
  const byId = new Map<string, ExoDataAlertWithBody>();
  const ingest = (bc: BodyComputed) => {
    const bodyTabLabel = bc.tabLabel || bc.state.bodyName || bc.state.key;
    for (const a of bc.exoDataAlerts) {
      if (!byId.has(a.id)) {
        byId.set(a.id, { ...a, bodyTabLabel, bodyKey: bc.state.key });
      }
    }
  };
  for (const b of snap.bodies) ingest(b);
  if (snap.exoOverlayFocusBody) ingest(snap.exoOverlayFocusBody);
  return [...byId.values()];
}
