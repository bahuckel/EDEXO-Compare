import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type PriceIndex = Map<string, number>;

function ingestRecord(obj: Record<string, unknown>, into: PriceIndex): void {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      into.set(normKey(k), Math.round(v));
    }
  }
}

/**
 * Read `data/price-list.json` — supports a flat map, `{ "prices": { ... } }`, or an array of `{ name, credits }`.
 */
export function loadPriceList(projectRoot: string): PriceIndex {
  const p = join(projectRoot, "data", "price-list.json");
  const idx: PriceIndex = new Map();
  if (!existsSync(p)) return idx;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return idx;
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const name = r.name ?? r.species ?? r.displayName ?? r.id;
        const credits = r.credits ?? r.price ?? r.value ?? r.Credits;
        if (typeof name === "string" && typeof credits === "number" && Number.isFinite(credits)) {
          idx.set(normKey(name), Math.round(credits));
        }
      }
      return idx;
    }

    const o = parsed as Record<string, unknown>;
    if (o.prices && typeof o.prices === "object" && !Array.isArray(o.prices)) {
      ingestRecord(o.prices as Record<string, unknown>, idx);
    }
    if (o.species_prices && typeof o.species_prices === "object" && !Array.isArray(o.species_prices)) {
      ingestRecord(o.species_prices as Record<string, unknown>, idx);
    }
    const skipTop = new Set([
      "prices",
      "species_prices",
      "rules",
      "source",
      "Source",
      "currency",
      "Currency",
      "version",
      "Version",
      "metadata",
      "Metadata",
      "comment",
      "Comment",
    ]);
    for (const [k, v] of Object.entries(o)) {
      if (skipTop.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) idx.set(normKey(k), Math.round(v));
    }
  }

  return idx;
}

export function lookupPrice(idx: PriceIndex, displayName: string, id: string): number | null {
  const tries = [displayName, id, displayName.replace(/\s*\(.*?\)\s*/g, "").trim()];
  for (const t of tries) {
    const v = idx.get(normKey(t));
    if (v !== undefined) return v;
  }
  /** Partial: first key that contains displayName */
  const n = normKey(displayName);
  for (const [k, v] of idx) {
    if (k.includes(n) || n.includes(k)) return v;
  }
  return null;
}

/** Exact / near-exact price lookup only (no substring fallback) — for tier math where partial matches inflate CR. */
export function lookupPriceStrict(idx: PriceIndex, displayName: string, id: string): number | null {
  const tries = [displayName, id, displayName.replace(/\s*\(.*?\)\s*/g, "").trim()];
  for (const t of tries) {
    const v = idx.get(normKey(t));
    if (v !== undefined) return v;
  }
  return null;
}
