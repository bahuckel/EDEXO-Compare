/**
 * Bookmarks (guild tester report, 2026-09-30: "Bookmarks — pre-done tags, custom tags"). A system,
 * optionally one body in it, with tags and a note. Kept on the server so the phone and this window
 * see the same list; the system's coordinates are captured when it is saved, so the list can say how
 * far away each one is and the galaxy map can draw them.
 */

export interface BookmarkDTO {
  id: string;
  system: string;
  systemAddress: number | null;
  /** Short body label (`A 2`), when the bookmark is about one body. */
  body: string | null;
  bodyKey: string | null;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  /** Light years, when the journals placed the system. */
  pos: { x: number; y: number; z: number } | null;
}

/** A bookmark as the list shows it: with the distance from where the commander is now. */
export interface BookmarkRowDTO extends BookmarkDTO {
  distanceLy: number | null;
}

export interface BookmarksListDTO {
  items: BookmarkRowDTO[];
  /** Every tag in use that is not a preset, for the chips. */
  customTags: string[];
}

/** The tags offered out of the box: what explorers mark systems for. */
export const PRESET_TAGS: readonly string[] = [
  "Revisit",
  "Biology",
  "First footfall",
  "Notable world",
  "Geology",
  "Phenomenon",
  "Scenery",
  "Fuel",
  "Carrier",
  "Station",
  "Screenshot",
  "Route",
];

export const MAX_TAG_LENGTH = 32;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_TAGS = 12;

/** Trim, collapse spaces, cap the length; a preset keeps its own spelling whatever the case typed. */
export function normaliseTag(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
  const preset = PRESET_TAGS.find((p) => p.toLowerCase() === t.toLowerCase());
  return preset ?? t;
}

export function normaliseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = normaliseTag(x);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** What a client may send: everything else about a bookmark is the server's to fill in. */
export interface BookmarkInput {
  id?: string;
  system: string;
  systemAddress: number | null;
  body: string | null;
  bodyKey: string | null;
  tags: string[];
  note: string;
}

export function parseBookmarkInput(raw: unknown): BookmarkInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const system = typeof r.system === "string" ? r.system.trim() : "";
  if (!system) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    ...(typeof r.id === "string" && r.id ? { id: r.id } : {}),
    system,
    systemAddress: typeof r.systemAddress === "number" && Number.isFinite(r.systemAddress) ? r.systemAddress : null,
    body: str(r.body),
    bodyKey: str(r.bodyKey),
    tags: normaliseTags(r.tags),
    note: typeof r.note === "string" ? r.note.slice(0, MAX_NOTE_LENGTH) : "",
  };
}
