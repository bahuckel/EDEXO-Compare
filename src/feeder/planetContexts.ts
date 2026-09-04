/**
 * Reads saved planet sample packs into contexts for the profile builder.
 *
 * Extracted from the analyze endpoint so the HTTP path and the offline rebuild cannot drift: a
 * host-star resolution that differed between "analyze in the UI" and "rebuild everything" would be
 * invisible, showing up only as unexplained profile churn.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FeederStarSummary } from "./feederStarHost.js";
import type { PlanetSampleContext } from "./profileBuilder.js";
import type { EdsmBody } from "./edsm.js";
import { rawSystemsDir } from "./paths.js";

const systemStarCache = new Map<string, FeederStarSummary[] | null>();

async function loadSystemStarSummaries(cacheFile: string): Promise<FeederStarSummary[] | null> {
  const key = cacheFile.trim();
  if (!key) return null;
  const cached = systemStarCache.get(key);
  if (cached !== undefined) return cached;

  let out: FeederStarSummary[] | null = null;
  try {
    const raw = await readFile(join(rawSystemsDir(), key), "utf8");
    const parsed = JSON.parse(raw) as { bodies?: unknown };
    if (Array.isArray(parsed.bodies)) {
      const stars = parsed.bodies
        .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
        .filter((b) => b.type === "Star")
        .map((b) => ({
          name: typeof b.name === "string" ? b.name : "",
          subType: typeof b.subType === "string" ? b.subType : undefined,
          spectralClass: typeof b.spectralClass === "string" ? b.spectralClass : undefined,
          isScoopable: typeof b.isScoopable === "boolean" ? b.isScoopable : undefined,
          bodyId: typeof b.bodyId === "number" ? b.bodyId : undefined,
        }))
        .filter((sm) => sm.name.trim().length > 0);
      out = stars.length > 0 ? stars : null;
    }
  } catch {
    out = null;
  }
  systemStarCache.set(key, out);
  return out;
}

/** Lowest body id wins — EDSM numbers the system's primary star 0. */
function pickSystemPrimary(stars: FeederStarSummary[] | null): FeederStarSummary | undefined {
  if (!stars?.length) return undefined;
  let best: FeederStarSummary | undefined;
  for (const s of stars) {
    if (typeof s.bodyId !== "number") continue;
    if (!best || s.bodyId < (best.bodyId ?? Number.MAX_SAFE_INTEGER)) best = s;
  }
  return best ?? stars[0];
}

/** Load every `sample_*.json` in `dir` as a context for the profile builder. */
export async function loadPlanetContextsFromDir(dir: string): Promise<PlanetSampleContext[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.startsWith("sample_") && f.endsWith(".json"));
  } catch {
    throw new Error("No samples — run fetch first");
  }
  if (files.length === 0) throw new Error("No samples — run fetch first");

  const contexts: PlanetSampleContext[] = [];
  for (const f of files.sort()) {
    const j = JSON.parse(await readFile(join(dir, f), "utf8")) as {
      bodyName?: string;
      systemName?: string;
      systemCacheFile?: string;
      context?: {
        targetBody?: EdsmBody | null;
        systemName?: unknown;
        starSummaries?: unknown;
      };
    };
    const c = j.context;
    if (!c) continue;

    let starSummaries: FeederStarSummary[] | undefined;
    const rawStars = c.starSummaries;
    if (Array.isArray(rawStars)) {
      starSummaries = rawStars
        .filter((x) => Boolean(x && typeof x === "object"))
        .map((x) => {
          const o = x as Record<string, unknown>;
          return {
            name: typeof o.name === "string" ? o.name : "",
            subType: typeof o.subType === "string" ? o.subType : undefined,
            spectralClass: typeof o.spectralClass === "string" ? o.spectralClass : undefined,
            isScoopable: typeof o.isScoopable === "boolean" ? o.isScoopable : undefined,
          } satisfies FeederStarSummary;
        })
        .filter((s) => s.name.trim().length > 0);
      if (starSummaries.length === 0) starSummaries = undefined;
    }

    const sysFromCtx = typeof c.systemName === "string" ? (c.systemName as string).trim() : "";
    const sysFromPack = typeof j.systemName === "string" ? j.systemName.trim() : "";
    const systemNameMerged = sysFromPack || sysFromCtx || undefined;

    const bodyNameGuess =
      typeof j.bodyName === "string"
        ? j.bodyName
        : c.targetBody?.name && typeof c.targetBody.name === "string"
          ? c.targetBody.name
          : undefined;

    const fromCache = await loadSystemStarSummaries(j.systemCacheFile ?? "");

    contexts.push({
      targetBody: c.targetBody ?? null,
      systemName: systemNameMerged,
      bodyName: bodyNameGuess,
      // Cached system bodies carry bodyId, which is what makes parent-chain resolution possible.
      starSummaries: fromCache ?? starSummaries,
      systemPrimaryStar: pickSystemPrimary(fromCache),
    });
  }

  return contexts;
}
