/**
 * Which body a green gas giant codex entry is about (owner, 2026-10-08, at Braisoo HD-Q d6-11 9).
 *
 * The codex line's `BodyID` is not the scanned body: it is the body the ship is at, usually the arrival
 * star (none of the 170 planet codex entries in the owner's journals named the body scanned; Braisoo's
 * green class II came as BodyID 0). The body is the gas giant scanned in the same system within the
 * same few seconds — the codex line comes just before its Scan (153 of 171), sometimes just after (16).
 * So the codex is matched to the scan of a fitting class there; when two fitting giants are scanned in
 * that window it is no one's, rather than a guess.
 */
import { bodyKey } from "./bodyKey.js";
import { greenCodexFits, greenCodexId } from "./greenGasGiant.js";

type Line = Record<string, unknown>;

/** How far apart (ms) the codex line and its body's Scan may be. */
export const GREEN_CODEX_WINDOW_MS = 5_000;

export type GreenCodexEvent =
  /** The codex entry's body: `codex` is the codex line (IsNewEntry, Region …). */
  | { kind: "match"; bodyKey: string; codexId: string; codex: Line }
  /** A second fitting giant came in the window: the earlier match was not certain. */
  | { kind: "retract"; bodyKey: string };

interface Scanned {
  system: number;
  bodyId: number;
  planetClass: string;
  at: number;
}
interface Pending {
  system: number;
  codexId: string;
  at: number;
  codex: Line;
  /** Fitting bodies seen in the window; matched while there is exactly one. */
  bodies: Set<number>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface GreenCodexMatcher {
  observe(line: Line): GreenCodexEvent[];
  clear(): void;
}

export function createGreenCodexMatcher(): GreenCodexMatcher {
  let scans: Scanned[] = [];
  let codexes: Pending[] = [];

  function prune(now: number): void {
    scans = scans.filter((s) => now - s.at <= GREEN_CODEX_WINDOW_MS);
    codexes = codexes.filter((c) => now - c.at <= GREEN_CODEX_WINDOW_MS);
  }

  /** A fitting body joins a codex entry's candidates: the first matches, a second takes it back. */
  function add(c: Pending, id: number, out: GreenCodexEvent[]): void {
    if (c.bodies.has(id)) return;
    c.bodies.add(id);
    if (c.bodies.size === 1)
      out.push({ kind: "match", bodyKey: bodyKey(c.system, id), codexId: c.codexId, codex: c.codex });
    else if (c.bodies.size === 2) {
      const first = [...c.bodies][0]!;
      out.push({ kind: "retract", bodyKey: bodyKey(c.system, first) });
    }
  }

  return {
    observe(line) {
      const at = Date.parse(typeof line.timestamp === "string" ? line.timestamp : "");
      if (!Number.isFinite(at)) return [];
      prune(at);
      const out: GreenCodexEvent[] = [];
      const system = num(line.SystemAddress);
      if (system == null) return out;
      if (line.event === "CodexEntry") {
        const codexId = greenCodexId(typeof line.Name === "string" ? line.Name : "");
        if (!codexId) return out;
        const c: Pending = { system, codexId, at, codex: line, bodies: new Set() };
        codexes.push(c);
        for (const s of scans)
          if (s.system === system && greenCodexFits(codexId, s.planetClass)) add(c, s.bodyId, out);
      } else if (line.event === "Scan" && typeof line.PlanetClass === "string") {
        const bodyId = num(line.BodyID);
        if (bodyId == null) return out;
        scans.push({ system, bodyId, planetClass: line.PlanetClass, at });
        for (const c of codexes)
          if (c.system === system && greenCodexFits(c.codexId, line.PlanetClass)) add(c, bodyId, out);
      }
      return out;
    },
    clear() {
      scans = [];
      codexes = [];
    },
  };
}
