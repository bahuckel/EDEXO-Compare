/**
 * Reads saved planet sample packs into contexts for the profile builder.
 *
 * Extracted from the analyze endpoint so the HTTP path and the offline rebuild cannot drift: a
 * host-star resolution that differed between "analyze in the UI" and "rebuild everything" would be
 * invisible, showing up only as unexplained profile churn.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeederStarSummary } from "./feederStarHost.js";
import type { PlanetSampleContext } from "./profileBuilder.js";
import type { EdsmBody } from "./edsm.js";
import { rawSystemsDir } from "./paths.js";
import { readSamplesByIdentity, type SamplePackRecord } from "./samplePacks.js";
import { readNumericOverlay } from "./numericRehydration.js";

const systemStarCache = new Map<string, FeederStarSummary[] | null>();

/**
 * The restored numerics, read once. `undefined` means "not looked for yet", `null` means "no
 * overlay on this machine" — which is the normal state for anyone who has not run
 * `feeder -- rehydrate-numerics`, and must cost nothing.
 */
let overlayCache: ReturnType<typeof readNumericOverlay> | undefined;

/**
 * Put the dump's float temperature back on a pack body, when this machine has one for it.
 *
 * A copy, never a mutation: the pack objects are parsed fresh per load today, but a cache one day
 * would make an in-place edit persist into readers that asked for the original, and the whole point
 * of a sidecar is that the packs stay as EDSM sent them. See `feeder/numericRehydration.ts`.
 */
function applyNumericOverlayToBody(body: EdsmBody | null): EdsmBody | null {
  if (!body) return body;
  if (overlayCache === undefined) overlayCache = readNumericOverlay();
  if (!overlayCache) return body;
  const o = body as unknown as Record<string, unknown>;
  // By name, not by id64: EDSM's id64 arrives already rounded through a double, so the value this
  // reader holds is not the body's real id. See `feeder/numericRehydration.ts`.
  const name = typeof o.name === "string" ? o.name : null;
  if (!name) return body;
  const fix = overlayCache.bodies[name];
  if (!fix || typeof fix.surfaceTemperature !== "number") return body;
  return { ...(body as object), surfaceTemperature: fix.surfaceTemperature } as EdsmBody;
}

/** Test seam: forget the cached overlay so a test can write one and see it applied. */
export function clearNumericOverlayCache(): void {
  overlayCache = undefined;
}

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

/**
 * Every sighting for one species, once per body: the archive, the old `sample_N` files and the
 * `body_<hash>` files the hydrator has written since packs were keyed by identity.
 *
 * This used to read the archive and `sample_N` only, merged **by occurrence index**. Two things went
 * wrong at once, and neither showed in any count. The index had been positional — an alphabetical
 * occurrence list that shifted under every import — so the archive and the loose files describe the
 * same body under several indices; and the `body_*` files, which is where every hydration since the
 * identity change went, were never read at all. Measured across the corpus on 2026-09-24: 69,189
 * records read, 46,029 distinct bodies among them, and 23,160 hydrated bodies left on disk. Bacterium
 * volu's profile said 68 and described 38.
 *
 * `readSamplesByIdentity` is what the hydrator already uses to decide what is done; the builder now
 * reads the same set. Sorted by identity so the order does not depend on which file a body is in.
 */
async function loadSamplePackRecords(dir: string): Promise<SamplePackRecord[]> {
  const byIdentity = await readSamplesByIdentity(dir);
  if (byIdentity.size === 0) throw new Error("No samples — run fetch first");
  return [...byIdentity.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, r]) => r);
}

/** Load every sighting for a species — archived or loose — as a context for the profile builder. */
export async function loadPlanetContextsFromDir(dir: string): Promise<PlanetSampleContext[]> {
  const records = await loadSamplePackRecords(dir);

  const contexts: PlanetSampleContext[] = [];
  for (const rec of records) {
    const j = rec as SamplePackRecord & {
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
      targetBody: applyNumericOverlayToBody(c.targetBody ?? null),
      systemName: systemNameMerged,
      bodyName: bodyNameGuess,
      // Cached system bodies carry bodyId, which is what makes parent-chain resolution possible.
      starSummaries: fromCache ?? starSummaries,
      systemPrimaryStar: pickSystemPrimary(fromCache),
    });
  }

  return contexts;
}
