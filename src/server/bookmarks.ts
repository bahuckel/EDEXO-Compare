/**
 * Bookmarks, kept in `edexo-bookmarks.json` beside the user settings (shared/bookmarks.ts has the
 * what and why).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  PRESET_TAGS,
  normaliseTags,
  type BookmarkDTO,
  type BookmarkInput,
  type BookmarksListDTO,
} from "../shared/bookmarks.js";

type Vec3 = { x: number; y: number; z: number };

export interface BookmarksService {
  list(from: Vec3 | null): BookmarksListDTO;
  /** Saves a new one, or replaces the one with the same id (or, lacking an id, the same system and body). */
  save(input: BookmarkInput, pos: Vec3 | null): BookmarkDTO;
  remove(id: string): boolean;
  /** Bookmarks for one system, for its card's star. */
  forSystem(systemAddress: number | null, system: string | null): BookmarkDTO[];
  all(): readonly BookmarkDTO[];
}

export function createBookmarksService(opts: { filePath: string | null; now?: () => number }): BookmarksService {
  const now = opts.now ?? Date.now;
  let items = load(opts.filePath);

  function persist(): void {
    if (!opts.filePath) return;
    const tmp = `${opts.filePath}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ formatVersion: 1, items }, null, 1)}\n`, "utf8");
      renameSync(tmp, opts.filePath);
    } catch {
      /* the list stays in memory; the next save tries again */
    }
  }

  const sameSystem = (b: BookmarkDTO, addr: number | null, name: string | null) =>
    addr != null && b.systemAddress != null ? b.systemAddress === addr : !!name && b.system.toLowerCase() === name.toLowerCase();

  return {
    list(from) {
      const rows = items
        .map((b) => ({
          ...b,
          distanceLy: from && b.pos ? Math.hypot(b.pos.x - from.x, b.pos.y - from.y, b.pos.z - from.z) : null,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const presets = new Set(PRESET_TAGS.map((t) => t.toLowerCase()));
      const custom = new Map<string, string>();
      for (const b of items) for (const t of b.tags) if (!presets.has(t.toLowerCase())) custom.set(t.toLowerCase(), t);
      return { items: rows, customTags: [...custom.values()].sort((a, b) => a.localeCompare(b)) };
    },
    save(input, pos) {
      const at = new Date(now()).toISOString();
      const idx = input.id
        ? items.findIndex((b) => b.id === input.id)
        : items.findIndex((b) => sameSystem(b, input.systemAddress, input.system) && (b.bodyKey ?? null) === (input.bodyKey ?? null));
      const prev = idx >= 0 ? items[idx]! : null;
      const next: BookmarkDTO = {
        id: prev?.id ?? randomUUID(),
        system: input.system,
        systemAddress: input.systemAddress,
        body: input.body,
        bodyKey: input.bodyKey,
        tags: normaliseTags(input.tags),
        note: input.note,
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
        pos: pos ?? prev?.pos ?? null,
      };
      if (idx >= 0) items[idx] = next;
      else items.push(next);
      persist();
      return next;
    },
    remove(id) {
      const before = items.length;
      items = items.filter((b) => b.id !== id);
      if (items.length === before) return false;
      persist();
      return true;
    },
    forSystem(addr, name) {
      return items.filter((b) => sameSystem(b, addr, name));
    },
    all: () => items,
  };
}

function load(filePath: string | null): BookmarkDTO[] {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as { items?: unknown };
    if (!Array.isArray(raw.items)) return [];
    return raw.items
      .filter((b): b is BookmarkDTO => !!b && typeof b === "object" && typeof (b as BookmarkDTO).id === "string")
      .map((b) => ({ ...b, tags: normaliseTags(b.tags), note: typeof b.note === "string" ? b.note : "" }));
  } catch {
    return [];
  }
}
