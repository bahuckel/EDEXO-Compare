import type { ExplorationScanRecord } from "./scan.js";

/**
 * A system nobody on this machine has flown to, fetched from Spansh when the commander looks it up
 * (owner, 2026-09-25). Held apart from the journal-derived state — never merged into it, never
 * counted as a discovery or as unsold data — and cached for 30 days in its own file.
 */
export interface RemoteBioBody {
  bodyId: number;
  bodyName: string;
  /** Spansh `signals.signals["$SAA_SignalType_Biological;"]`, null when it lists none. */
  biologicalSignals: number | null;
  /** Genus tokens (`$Codex_Ent_*`) somebody's surface scan reported to EDDN. */
  genuses: string[];
  /** Every signal type Spansh lists for the body (geological, …) — the fumarole gate reads these. */
  signalTypes: string[];
  /** Species other commanders logged here (Spansh `landmarks`, biology only): genus and species names. */
  loggedSpecies: { genus: string; species: string }[];
}

export interface RemoteSystemRecord {
  systemAddress: number;
  starSystem: string;
  coords: { x: number; y: number; z: number } | null;
  /** When this app fetched it (ISO). The cache keeps it 30 days. */
  fetchedAt: string;
  /** Spansh's own `updated_at` for the system, when it gave one. */
  sourceUpdatedAt: string | null;
  records: ExplorationScanRecord[];
  bio: RemoteBioBody[];
  /**
   * Bodies Spansh holds any signal counts for (biological or not). Zero means nobody uploaded an FSS
   * of the system, so "no biology" is unknown rather than known. Absent on records cached before it.
   */
  signalBodyCount?: number;
}

/** What the main screen shows about a looked-up system that is not in the journals. */
export interface RemoteViewDTO {
  systemAddress: number;
  starSystem: string;
  state: "loading" | "ready" | "error";
  error?: string;
  fetchedAt?: string;
  sourceUpdatedAt?: string | null;
  bodyCount?: number;
  bioBodyCount?: number;
  /** See {@link RemoteSystemRecord.signalBodyCount}. */
  signalBodyCount?: number;
}
