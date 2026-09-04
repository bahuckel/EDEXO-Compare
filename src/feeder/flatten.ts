/** Slug for filenames — keep aligned with edexo-compare loader. */
export function speciesFileSlug(speciesLabel: string): string {
  return speciesLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Same rules as {@link speciesFileSlug} — used for genus ZIP filenames and URL segments. */
export function genusFileSlug(genus: string): string {
  return speciesFileSlug(genus);
}

function isPlainNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const SKIP_KEYS = new Set(["bodies", "parents", "rawSystem"]);

/** Flatten JSON to dot paths for range mining. */
export function flattenForStats(
  obj: unknown,
  prefix = "",
  depth = 0,
  out: Map<string, number | string | boolean | null> = new Map(),
): Map<string, number | string | boolean | null> {
  if (depth > 16) return out;
  if (obj === null || obj === undefined) {
    if (prefix) out.set(prefix, null);
    return out;
  }
  if (isPlainNumber(obj) || typeof obj === "string" || typeof obj === "boolean") {
    if (prefix) out.set(prefix, obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      const p = `${prefix}[${i}]`.replace(/^\./, "");
      if (v !== null && typeof v === "object") flattenForStats(v, p, depth + 1, out);
      else if (isPlainNumber(v) || typeof v === "string" || typeof v === "boolean") out.set(p, v);
    }
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_KEYS.has(k)) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object") flattenForStats(v, p, depth + 1, out);
      else if (isPlainNumber(v) || typeof v === "string" || typeof v === "boolean") out.set(p, v);
      else if (v === null) out.set(p, null);
    }
  }
  return out;
}

export function extractMaterialPercents(body: Record<string, unknown>): Record<string, number> {
  const raw = body.materials;
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = (o.name as string)?.toLowerCase?.() ?? "";
    const pct = o.percent;
    if (name && isPlainNumber(pct as number)) out[name] = pct as number;
  }
  return out;
}

export function extractAtmospherePercents(body: Record<string, unknown>): Record<string, number> {
  const raw = body.atmosphereComposition;
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = (o.name as string)?.toLowerCase?.() ?? "";
    const pct = o.percent;
    if (name && isPlainNumber(pct as number)) out[name] = pct as number;
  }
  return out;
}

export function extractSolidComposition(body: Record<string, unknown>): Record<string, number> {
  const raw = body.solidComposition;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (isPlainNumber(v as number)) out[k.toLowerCase()] = v as number;
  }
  return out;
}
