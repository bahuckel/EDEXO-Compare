/**
 * Every species, on bodies where it is known to grow (owner, 2026-09-27: "tests for the full list of
 * species ... a few bodies where we know they spawn, and if the app would show them").
 *
 * The bodies are real: `tests/fixtures/species-spawn-bodies.json.gz`, from the Spansh galaxy dump, a
 * body counting as a known spawn when it is the only body in its system carrying the genus and the
 * EDSM + EDAstro codex logs exactly one species of that genus there (docs/perf/build_spawn_fixture.py).
 * Up to four per species, from four regions; two per Anemone colour.
 *
 * Each goes through the app's own path for a looked-up system — `fetchRemoteSystem` on the stored
 * dump, the store, `buildSnapshot` (matcher, presence floors, all of it) — with nobody's logged
 * species attached, so the app has to find the answer itself. Two readings per body:
 *
 *   - **post-DSS** — the dump's genus list as DSS hints. The species must be offered (shown or
 *     behind "show unlikely"); bodies where it is not are listed in the baseline as `missing` and
 *     skipped here, so the suite names them without failing on them.
 *   - **FSS only** — genus list withheld.
 *
 * Both with "Bacterium" on, as the owner plays: off (the default, "low value") the matcher drops every
 * bacterium even after a DSS names the genus — by design, so not something this file should count.
 *
 * Slow (~5 min: two full snapshots per body), so not in the default run — `npm run test:spawn`.
 *
 * `species-spawn-baseline.json` records the tier of both readings for every body. Any change —
 * a species newly shown, newly hidden — fails the baseline test until it is looked at and the file
 * is rewritten with `UPDATE_SPAWN_BASELINE=1 npx vitest run tests/speciesSpawnBodies.test.ts`.
 * The misses are written up in docs/code-review-27092026.md §G.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { fetchRemoteSystem } from "../src/server/remoteSystems.js";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";

type Tier = "shown" | "unlikely" | "missing";
interface Sample {
  species: string;
  variant?: string;
  region: string | null;
  bodyId: number;
  bodyName: string;
  system: { id64: string; name: string; coords: unknown; bodies: Record<string, unknown>[] };
}

const FIXTURE = path.join(__dirname, "fixtures", "species-spawn-bodies.json.gz");
const BASELINE = path.join(__dirname, "fixtures", "species-spawn-baseline.json");
const doc = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString("utf8")) as { samples: Sample[] };
const baseline: Record<string, { dss: Tier; fss: Tier }> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : {};
const keyOf = (s: Sample) => `${s.species}${s.variant ? ` (${s.variant})` : ""} @ ${s.bodyName}`;

async function tierOn(s: Sample, mode: "dss" | "fss"): Promise<Tier> {
  const bodies = s.system.bodies.map((b) => {
    if (b.bodyId !== s.bodyId || mode === "dss") return b;
    const sig = (b.signals ?? {}) as Record<string, unknown>;
    return { ...b, signals: { ...sig, genuses: [] } };
  });
  const dump = { system: { ...s.system, bodies } };
  const fakeFetch = (async (url: string) =>
    String(url).includes("/api/dump/")
      ? new Response(JSON.stringify(dump))
      : new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const addr = Number(s.system.id64);
  const r = await fetchRemoteSystem(addr, s.system.name, fakeFetch, () => new Date("2026-09-27T00:00:00Z"));
  if (!r.ok) throw new Error(`${keyOf(s)}: ${r.error}`);
  const store = new GameStateStore();
  store.setIncludeBacteriumInSearch(true);
  store.remoteSystems.set(addr, r.system);
  store.setViewingSystemAddress(addr);
  const snap = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
  const body = snap.bodies.find((b) => b.state.bodyId === s.bodyId);
  const m = body?.matches.find((x) => x.entry.id === s.species);
  return !m ? "missing" : m.unlikely ? "unlikely" : "shown";
}

const results = new Map<string, { dss: Tier; fss: Tier }>();

beforeAll(async () => {
  loadSpeciesDatabase();
  for (const s of doc.samples) results.set(keyOf(s), { dss: await tierOn(s, "dss"), fss: await tierOn(s, "fss") });
  if (process.env.UPDATE_SPAWN_BASELINE === "1") {
    const out = Object.fromEntries([...results].sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  }
}, 600_000);

describe("every species is offered on bodies where it is known to grow (post-DSS)", () => {
  const bySpecies = new Map<string, Sample[]>();
  for (const s of doc.samples) bySpecies.set(s.species, [...(bySpecies.get(s.species) ?? []), s]);
  for (const [species, samples] of [...bySpecies].sort(([a], [b]) => a.localeCompare(b))) {
    describe(species, () => {
      for (const s of samples) {
        const known = baseline[keyOf(s)]?.dss === "missing";
        (known ? it.skip : it)(`${s.variant ? `${s.variant}, ` : ""}${s.bodyName} (${s.region ?? "?"})`, () => {
          expect(results.get(keyOf(s))?.dss).not.toBe("missing");
        });
      }
    });
  }
});

it("matches the recorded baseline for both readings", () => {
  expect(Object.keys(baseline).length, "no baseline yet — run with UPDATE_SPAWN_BASELINE=1").toBeGreaterThan(0);
  expect(Object.fromEntries(results)).toEqual(baseline);
});
