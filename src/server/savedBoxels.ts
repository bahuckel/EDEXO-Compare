/**
 * Saved boxels, kept in `edexo-boxels.json` beside the user settings (shared/boxel.ts has the what
 * and why). Only the boxel and its last system are stored; which systems are flown is read from the
 * journals each time, so the ticks follow him without anything to update.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { boxelIndexOf, parseBoxel, type SavedBoxelDTO } from "../shared/boxel.js";
import { BOXEL_MAX_ROWS } from "./boxel.js";

interface Stored {
  id: string;
  lastSystem: string;
  addedAt: string;
}

export interface SavedBoxelsService {
  list(visited: Iterable<string>): SavedBoxelDTO[];
  /** Adds a boxel by its last system, or moves the end of one already saved. Null: not a boxel system name. */
  add(lastSystem: string): { id: string } | null;
  remove(id: string): boolean;
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

  return {
    list(visited) {
      const parsed = items
        .map((s) => ({ s, b: parseBoxel(s.lastSystem) }))
        .filter((x): x is { s: Stored; b: NonNullable<ReturnType<typeof parseBoxel>> } => x.b?.index != null);
      const flownBy = new Map(parsed.map((x) => [x.s.id, new Set<number>()]));
      for (const name of visited) {
        for (const { s, b } of parsed) {
          const n = boxelIndexOf(name, b.prefix);
          if (n != null) flownBy.get(s.id)!.add(n);
        }
      }
      return parsed.map(({ s, b }) => {
        const end = Math.min(BOXEL_MAX_ROWS - 1, b.index!);
        const flown = flownBy.get(s.id)!;
        let next: number | null = null;
        for (let n = 0; n <= end; n++) {
          if (!flown.has(n)) {
            next = n;
            break;
          }
        }
        return {
          id: s.id,
          lastSystem: s.lastSystem,
          sector: b.sector,
          boxel: b.boxel,
          prefix: b.prefix,
          end,
          addedAt: s.addedAt,
          flown: [...flown].filter((n) => n <= end).length,
          total: end + 1,
          next: next == null ? null : `${b.prefix}${next}`,
        };
      });
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
  };
}

function load(filePath: string | null): Stored[] {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { items?: Stored[] };
    return (raw.items ?? []).filter((s) => s && typeof s.id === "string" && typeof s.lastSystem === "string");
  } catch {
    return [];
  }
}
