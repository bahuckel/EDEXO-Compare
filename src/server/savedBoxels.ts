/**
 * Saved boxels, kept in `edexo-boxels.json` beside the user settings (shared/boxel.ts has the what
 * and why). Only the boxel, its last system and the systems he chose to skip are stored; which
 * systems are flown is read from the journals each time, so the ticks follow him without anything to
 * update.
 *
 * Two corrections per system (owner, 2026-09-30): cut the list from a system on (a last number typed
 * too high), and skip a system (one he will not fly — it still completes the boxel).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { boxelIndexOf, parseBoxel, type SavedBoxelDTO } from "../shared/boxel.js";
import { BOXEL_MAX_ROWS, visitedEntry, type SystemStats, type VisitedSystem } from "./boxel.js";

interface Stored {
  id: string;
  lastSystem: string;
  addedAt: string;
  skipped?: number[];
}

export interface SavedBoxelsService {
  /**
   * Every saved boxel with its progress. `current` is the system the commander is in: its boxel
   * comes first and is marked current; the rest follow, newest first.
   */
  list(visited: Iterable<VisitedSystem>, stats?: SystemStats, current?: string | null): SavedBoxelDTO[];
  /** Adds a boxel by its last system, or moves the end of one already saved. Null: not a boxel system name. */
  add(lastSystem: string): { id: string } | null;
  remove(id: string): boolean;
  /** Drops system `n` and every one after it (the boxel now ends at n - 1). False when unknown or n < 1. */
  cutFrom(id: string, n: number): boolean;
  /** Marks system `n` skipped (or not): it counts as done without being flown. */
  setSkipped(id: string, n: number, skipped: boolean): boolean;
}

export function createSavedBoxels(opts: { filePath: string | null; now?: () => number }): SavedBoxelsService {
  const now = opts.now ?? Date.now;
  let items = load(opts.filePath);

  function persist(): void {
    if (!opts.filePath) return;
    const tmp = `${opts.filePath}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ formatVersion: 1, items }, null, 1)}\n`, "utf8");
      renameSync(tmp, opts.filePath);
    } catch {
      /* kept in memory; the next change tries again */
    }
  }

  const endOf = (s: Stored) => {
    const b = parseBoxel(s.lastSystem);
    return b?.index != null ? { b, end: Math.min(BOXEL_MAX_ROWS - 1, b.index) } : null;
  };

  return {
    list(visited, stats, current) {
      const parsed = items
        .map((s) => ({ s, e: endOf(s) }))
        .filter((x): x is { s: Stored; e: NonNullable<ReturnType<typeof endOf>> } => x.e != null);
      const flownBy = new Map(parsed.map((x) => [x.s.id, new Set<number>()]));
      const addrsBy = new Map(parsed.map((x) => [x.s.id, [] as { n: number; addr: number }[]]));
      for (const v of visited) {
        const { name, addr } = visitedEntry(v);
        for (const { s, e } of parsed) {
          const n = boxelIndexOf(name, e.b.prefix);
          if (n == null) continue;
          flownBy.get(s.id)!.add(n);
          if (addr != null) addrsBy.get(s.id)!.push({ n, addr });
        }
      }
      const out = parsed.map(({ s, e }) => {
        const { b, end } = e;
        const flownAll = flownBy.get(s.id)!;
        const skipped = (s.skipped ?? []).filter((n) => n <= end && !flownAll.has(n)).sort((x, y) => x - y);
        const skip = new Set(skipped);
        let next: number | null = null;
        for (let n = 0; n <= end; n++) {
          if (!flownAll.has(n) && !skip.has(n)) {
            next = n;
            break;
          }
        }
        let bodiesScanned = 0;
        let bodiesTotal: number | null = 0;
        let notable = 0;
        for (const { n, addr } of addrsBy.get(s.id)!) {
          if (n > end || !stats) continue;
          const st = stats(addr);
          bodiesScanned += st.bodies.scanned;
          notable += st.notable;
          bodiesTotal = bodiesTotal != null && st.bodies.total != null ? bodiesTotal + st.bodies.total : null;
        }
        return {
          id: s.id,
          lastSystem: s.lastSystem,
          bodiesScanned,
          bodiesTotal: stats ? bodiesTotal : null,
          notable,
          current: !!current && boxelIndexOf(current, b.prefix) != null,
          sector: b.sector,
          boxel: b.boxel,
          prefix: b.prefix,
          end,
          addedAt: s.addedAt,
          flown: [...flownAll].filter((n) => n <= end).length,
          skipped,
          flownBeyond: [...flownAll].filter((n) => n > end).sort((x, y) => x - y),
          total: end + 1,
          next: next == null ? null : `${b.prefix}${next}`,
        };
      });
      // The boxel he is in first; the rest keep their order (newest first).
      return [...out.filter((b) => b.current), ...out.filter((b) => !b.current)];
    },
    add(lastSystem) {
      const name = lastSystem.trim().replace(/\s+/g, " ").slice(0, 80);
      const b = parseBoxel(name);
      if (!b || b.index == null) return null;
      const same = items.find((s) => parseBoxel(s.lastSystem)?.prefix.toLowerCase() === b.prefix.toLowerCase());
      if (same) {
        same.lastSystem = name;
        persist();
        return { id: same.id };
      }
      const s: Stored = { id: randomUUID(), lastSystem: name, addedAt: new Date(now()).toISOString() };
      items = [s, ...items];
      persist();
      return { id: s.id };
    },
    remove(id) {
      const before = items.length;
      items = items.filter((s) => s.id !== id);
      if (items.length === before) return false;
      persist();
      return true;
    },
    cutFrom(id, n) {
      const s = items.find((x) => x.id === id);
      const e = s ? endOf(s) : null;
      if (!s || !e || !Number.isInteger(n) || n < 1 || n > e.end) return false;
      s.lastSystem = `${e.b.prefix}${n - 1}`;
      if (s.skipped) s.skipped = s.skipped.filter((k) => k < n);
      persist();
      return true;
    },
    setSkipped(id, n, skipped) {
      const s = items.find((x) => x.id === id);
      const e = s ? endOf(s) : null;
      if (!s || !e || !Number.isInteger(n) || n < 0 || n > e.end) return false;
      const set = new Set(s.skipped ?? []);
      if (skipped) set.add(n);
      else set.delete(n);
      s.skipped = [...set].sort((x, y) => x - y);
      persist();
      return true;
    },
  };
}

function load(filePath: string | null): Stored[] {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { items?: Stored[] };
    return (raw.items ?? [])
      .filter((s) => s && typeof s.id === "string" && typeof s.lastSystem === "string")
      .map((s) => ({ ...s, skipped: Array.isArray(s.skipped) ? s.skipped.filter((n) => Number.isInteger(n) && n >= 0) : undefined }));
  } catch {
    return [];
  }
}
