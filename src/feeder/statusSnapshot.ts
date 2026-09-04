/**
 * A small file the feeder leaves behind so the app can show its state without opening the store.
 *
 * The corpus counts live in a WASM SQLite database, and reading it needs `sql.js` plus a 1.5 MB
 * WASM blob. The app's server has no business carrying that: the feeder is a maintainer tool whose
 * 250 MB corpus never ships, and a normal install has nothing for it to open. So the CLI writes what
 * it knows into `<corpus>/feeder-status.json` after every command, and the app reads that.
 *
 * Everything the app can work out for itself — which species rows have a profile, how big those
 * profiles are, how many sample packs are on disk — is computed live instead, so the panel is only
 * as stale as the numbers that genuinely require the store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feederDataDir } from "./paths.js";

export const FEEDER_STATUS_SNAPSHOT_VERSION = 1;

export interface FeederStatusSnapshot {
  version: number;
  writtenAtIso: string;
  /** The command that wrote it — "status", "import", "run", "rebuild". */
  lastCommand: string;
  uniqueSystems: number;
  uniquePlanets: number;
  uniqueSightings: number;
  corpusSpecies: number;
  cumulativeCsvRows: number;
  /** Species label → occurrences the CSV corpus knows about. Drives the "behind" comparison. */
  occurrencesBySpecies: Record<string, number>;
}

export function feederStatusSnapshotPath(): string {
  return join(feederDataDir(), "feeder-status.json");
}

export function writeFeederStatusSnapshot(
  snapshot: Omit<FeederStatusSnapshot, "version" | "writtenAtIso">,
): void {
  const full: FeederStatusSnapshot = {
    ...snapshot,
    version: FEEDER_STATUS_SNAPSHOT_VERSION,
    writtenAtIso: new Date().toISOString(),
  };
  try {
    mkdirSync(feederDataDir(), { recursive: true });
    writeFileSync(feederStatusSnapshotPath(), `${JSON.stringify(full, null, 2)}\n`, "utf8");
  } catch {
    /* best-effort: the snapshot is a convenience for the UI, never something a run depends on */
  }
}

/** Null when the feeder has never run here, or the file is from a version this build cannot read. */
export function readFeederStatusSnapshot(): FeederStatusSnapshot | null {
  const p = feederStatusSnapshotPath();
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Partial<FeederStatusSnapshot>;
    if (j.version !== FEEDER_STATUS_SNAPSHOT_VERSION) return null;
    if (typeof j.writtenAtIso !== "string") return null;
    return {
      version: j.version,
      writtenAtIso: j.writtenAtIso,
      lastCommand: typeof j.lastCommand === "string" ? j.lastCommand : "",
      uniqueSystems: j.uniqueSystems ?? 0,
      uniquePlanets: j.uniquePlanets ?? 0,
      uniqueSightings: j.uniqueSightings ?? 0,
      corpusSpecies: j.corpusSpecies ?? 0,
      cumulativeCsvRows: j.cumulativeCsvRows ?? 0,
      occurrencesBySpecies: j.occurrencesBySpecies ?? {},
    };
  } catch {
    return null;
  }
}
