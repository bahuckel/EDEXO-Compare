import { boxelSystems, boxelTable, previousBoxels, type SystemStats } from "../boxel.js";
import { parseBoxel } from "../../shared/boxel.js";
import { createBoxelLookups } from "../boxelLookup.js";
import { resolveUserSettingsJsonPath } from "../paths.js";
import { boxelJournalFacts, notableBodiesForSystem, systemBodyTally } from "../snapshotSystemInfo.js";
import type { GameStateStore } from "../gameState.js";

/** Bodies scanned and notable bodies per visited system, for the boxel lists (owner, 2026-09-30). */
function boxelStats(store: GameStateStore): SystemStats {
  return (addr) => ({ bodies: systemBodyTally(store, addr), notable: notableBodiesForSystem(store, addr, null).length });
}
import { getCachedSpeciesDatabase } from "../snapshot.js";
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import express from "express";
import { getProjectRoot } from "../paths.js";
import { perfCount } from "../perf.js";
import { codexMapRegion, codexMapRegions } from "../codexMap.js";
import { clearGalaxyPoints, galaxyPoints } from "../galaxyPoints.js";
import { clearTileIndex, encodeCells, encodeTile, parseCellParam, sectorNames, tileIndex } from "../galaxyTiles.js";
import { registerGalaxyCache, touchGalaxyMemory } from "../galaxyMemory.js";
import {
  clearBioIndexCache,
  loadBioIndex,
  TIER_BODIES_KNOWN,
  TIER_CODEX,
  TIER_DSS,
  TIER_FSS,
} from "../bioIndex.js";
import {
  clearGalaxyCatalogueCache,
  clearGalaxySystemValues,
  galaxySystemSpecies,
  galaxySystemValues,
} from "../galaxyValueSearch.js";
import { clearSystemTraits, galaxyFilterMask, loadSystemTraits, systemTraitCounts } from "../galaxyTraits.js";
import { downloadGalaxyIndex, galaxyIndexStatus, probeGalaxyIndexSize } from "../galaxyIndexFiles.js";
import { checkNavRouteSystemsOnEdsm, clearNavRouteLog, lastNavRoute, navRouteLog } from "../navRouteLog.js";
import { BODY_TRAIT_GROUP, BODY_TRAITS, STAR_CLASSES } from "../../shared/galaxyTraits.js";
import { loadRegionMap } from "../regionMapData.js";
import { galaxyFind, galaxySector } from "../galaxyFind.js";
import { doneAddresses, MAX_PLAN_STOPS, nextTarget, ordinalsOf } from "../galaxyNext.js";
import type { GalaxySystemDTO } from "../../shared/dto/galaxy.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";
import { galaxyLayer, type GalaxyLayerKind } from "../galaxyLayers.js";
import { GALAXY_LAYER_KINDS } from "../../shared/galaxyLayers.js";

export function registerGalaxyRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  // The map's extra layers (galaxyLayers.ts): points of interest, phenomena, carriers, bookmarks.
  app.get("/api/galaxy/layers", (req, res) => {
    const kind = String(req.query?.kind ?? "") as GalaxyLayerKind;
    if (!GALAXY_LAYER_KINDS.includes(kind)) {
      res.status(400).json({ ok: false, error: `kind must be one of ${GALAXY_LAYER_KINDS.join(", ")}` });
      return;
    }
    res.json(galaxyLayer(kind, opts.bookmarks, Date.now(), opts.ownGreenGiants));
  });

  /**
   * Cheap status for the launcher window. It polls every 2.5 s and only renders a lamp, the journal
   * folder, a file count and the connect URLs — but it used to call /api/state, which rebuilds the
   * whole snapshot (~186 ms, ~630 KB) and consumed the one-shot auto-select key. This endpoint
   * reads store fields directly and allocates nothing.
   */
  /**
   * The sector heat map's data (Phase 10 step 3).
   *
   * Served from `data/exomastery/sector-map.json`, which the feeder writes — the app never opens the
   * corpus store. Read on demand rather than held in the snapshot: it is 87 kB, the map is one
   * screen among many, and most sessions never open it.
   *
   * A missing file is a 404 rather than an error. The map is a derived artefact; a build that has
   * not run the feeder should show "no map yet", not a broken app.
   */
  /**
   * The vendored region map, for the galaxy backdrop.
   *
   * 179 kB of run-length rows, served whole and cached hard: it is checked-in data that changes only
   * when the file is replaced, and the client paints it once into a canvas. Sent from disk rather
   * than through the decoder so the bytes on the wire are the bytes in the repo, notice and all.
   */
  /*
    Everything under /api/galaxy keeps the map's memory alive; five idle minutes lets it go
    (galaxyMemory.ts — the map is its own window, loaded fresh each time, owner 2026-09-28).
  */
  registerGalaxyCache("bio-index", clearBioIndexCache);
  registerGalaxyCache("species-catalogue", clearGalaxyCatalogueCache);
  registerGalaxyCache("points", clearGalaxyPoints);
  registerGalaxyCache("tiles", clearTileIndex);
  registerGalaxyCache("system-values", clearGalaxySystemValues);
  registerGalaxyCache("system-traits", clearSystemTraits);
  app.use("/api/galaxy", (_req, _res, next) => {
    touchGalaxyMemory();
    next();
  });

  const sendBinary = (res: express.Response, buf: Buffer) => {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buf);
  };
  const noIndex = (res: express.Response) =>
    res.status(404).json({ ok: false, error: "No galaxy index in this build." });

  /**
   * Every bio-index system as quantised points: the 3D map's overview (layout in galaxyPoints.ts).
   * `?stride=4|16` thins it for a machine drawing WebGL in software.
   */
  app.get("/api/galaxy/points", (req, res) => {
    const stride = [1, 4, 16].includes(Number(req.query.stride)) ? Number(req.query.stride) : 1;
    const buf = galaxyPoints(stride);
    if (!buf) return void noIndex(res);
    sendBinary(res, buf);
  });

  /**
   * The map's Bodies filters (owner, 2026-10-04): every star class and body trait with how many
   * systems hold it. `available: false` on a build without `system-traits.bin.gz`.
   */
  app.get("/api/galaxy/traits", (_req, res) => {
    const traits = loadSystemTraits();
    if (!traits) {
      res.json({ available: false, mainStars: [], stars: [], planets: [], features: [] });
      return;
    }
    const c = systemTraitCounts(traits);
    const rows = (list: readonly { key: string; label: string }[], counts: number[]) =>
      list.map((t, i) => ({ key: t.key, label: t.label, count: counts[i] ?? 0 }));
    const bodies = rows(BODY_TRAITS, c.bodies);
    res.json({
      available: true,
      mainStars: rows(STAR_CLASSES, c.main).filter((r) => r.key !== "SG"),
      stars: rows(STAR_CLASSES, c.stars),
      /*
        Only what the index holds: galaxy_bio.jsonl keeps the planets that matter for biology, so the
        Class I-V and Helium gas giants are never in it and a tick on them could only empty the map.
      */
      planets: bodies.filter((r) => BODY_TRAIT_GROUP[r.key] === "Planet type" && r.count > 0),
      /*
        The dump keeps every star but only the planets that matter for biology, so "landable" and
        "landable with atmosphere" hold 95-98 % of systems: not a filter. Kept in the file, not offered.
      */
      features: bodies.filter((r) => BODY_TRAIT_GROUP[r.key] === "Features" && !r.key.startsWith("landable")),
    });
  });

  /**
   * Which systems pass the map's filter, as bits over bio-index ordinals (galaxyTraits.ts):
   * `?genera=stratum&species=…&mainStars=N&stars=…&planets=elw&features=terraformable`, each a comma
   * list. Layout: "EDXFLT01", u32 system count, u32 matched, then the bits.
   */
  app.get("/api/galaxy/filter", (req, res) => {
    const index = loadBioIndex();
    if (!index) return void noIndex(res);
    const list = (k: string) =>
      String(req.query[k] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);
    const genusOf = new Map(getCachedSpeciesDatabase().species.map((e) => [e.id, e.genusDataDir]));
    const { bits, matched } = galaxyFilterMask(
      {
        species: list("species"),
        genera: list("genera"),
        mainStars: list("mainStars"),
        stars: list("stars"),
        planets: list("planets"),
        features: list("features"),
      },
      index,
      loadSystemTraits(),
      (id) => genusOf.get(id) ?? null,
    );
    const buf = Buffer.alloc(16 + bits.length);
    buf.write("EDXFLT01", 0, "ascii");
    buf.writeUInt32LE(index.systemCount, 8);
    buf.writeUInt32LE(matched, 12);
    buf.set(bits, 16);
    sendBinary(res, buf);
  });

  /**
   * The galaxy index as a separate download (plan 4.2, 2026-10-04): whether it is here, how big the
   * download is, and its progress; POST starts it. Builds leave the files out.
   */
  app.get("/api/galaxy/index", async (_req, res) => {
    const st = galaxyIndexStatus();
    if (!st.present && st.downloadBytes == null) await probeGalaxyIndexSize();
    res.json(galaxyIndexStatus());
  });
  app.post("/api/galaxy/index/download", (_req, res) => {
    void downloadGalaxyIndex(() => {
      clearBioIndexCache();
      clearSystemTraits();
      clearGalaxyPoints();
      clearTileIndex();
      clearGalaxyCatalogueCache();
      clearGalaxySystemValues();
    });
    res.json({ ok: true });
  });

  /**
   * The NavRoute star finder (owner, 2026-10-04): every plotted route's systems with their star class,
   * EDSM's answer per system once asked, and the check in progress. Not under /api/galaxy's memory
   * clock: it is the commander's own small list.
   */
  app.get("/api/navroutes", (_req, res) => {
    res.json({ ...navRouteLog(), last: lastNavRoute().map((s) => s.address) });
  });
  /** `{ addresses: number[] }` — ask EDSM about these (at most 2,000), in the background. */
  app.post("/api/navroutes/edsm-check", (req, res) => {
    const raw = (req.body as { addresses?: unknown } | undefined)?.addresses;
    const addresses = Array.isArray(raw) ? raw.filter((a): a is number => typeof a === "number" && Number.isFinite(a)).slice(0, 2000) : [];
    if (!addresses.length) {
      res.status(400).json({ ok: false, error: "addresses: a list of system addresses" });
      return;
    }
    void checkNavRouteSystemsOnEdsm(addresses);
    res.json({ ok: true });
  });
  app.delete("/api/navroutes", (_req, res) => {
    clearNavRouteLog();
    res.json({ ok: true });
  });

  /** The non-empty 1,280 ly cells and their system counts (layout in galaxyTiles.ts). */
  app.get("/api/galaxy/cells", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    sendBinary(res, encodeCells(t));
  });

  /** Each cell's sector name, same order as `/api/galaxy/cells` ("" where none). */
  app.get("/api/galaxy/sector-names", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    res.json(sectorNames(t));
  });

  /** Names by system ordinal, for the map's labels: `?i=1,2,3` (at most 400). */
  app.get("/api/galaxy/names", (req, res) => {
    const index = loadBioIndex();
    if (!index) return void noIndex(res);
    const ids = String(req.query.i ?? "")
      .split(",")
      .slice(0, 400)
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < index.systemCount);
    const out: Record<number, string> = {};
    for (const i of ids) out[i] = index.nameOf(i);
    res.json(out);
  });

  /** One system for the map's panel: `?i=<ordinal>`, or `?addr=<id64>` (a search hit, a journal system). */
  app.get("/api/galaxy/system", (req, res) => {
    const index = loadBioIndex();
    if (!index) return void noIndex(res);
    let i = Number(req.query.i);
    if (req.query.addr != null) {
      try {
        i = index.ordinalOf(BigInt(String(req.query.addr)));
      } catch {
        i = -1;
      }
      if (i < 0) return void res.status(404).json({ ok: false, error: "not in the galaxy index" });
    }
    if (!Number.isInteger(i) || i < 0 || i >= index.systemCount) {
      return void res.status(400).json({ ok: false, error: "i must be a system ordinal" });
    }
    const s = index.systemAt(i);
    const species = galaxySystemSpecies(index, s.species);
    const regions = loadRegionMap(getProjectRoot())?.regions;
    const dto: GalaxySystemDTO = {
      ordinal: i,
      id64: s.id64.toString(),
      name: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
      region: (s.regionId && regions?.[s.regionId]) || null,
      bodyCount: s.bodyCount || null,
      evidence: {
        fss: (s.tiers & TIER_FSS) !== 0,
        dss: (s.tiers & TIER_DSS) !== 0,
        codex: (s.tiers & TIER_CODEX) !== 0,
        bodiesKnown: (s.tiers & TIER_BODIES_KNOWN) !== 0,
      },
      species,
      valueCr: species.reduce((a, sp) => a + (sp.baseCr ?? 0), 0),
      distanceFromSolLy: Math.hypot(s.x, s.y, s.z),
    };
    res.json(dto);
  });

  /**
   * Next target: the nearest system to the ship worth at least `min` (100 k CR units, 1×) that the
   * commander has not analysed (DSS or foot scans; `skipVisited=1` also skips anything visited), not
   * counting `exclude` (ordinals skipped this session, at most 2,000). `plan=N` (≤ 20) adds a plan of
   * N stops from the ship (G5.3): chosen by a greedy chain, ordered by 2-opt (5.8); `loop=1` returns
   * to the ship.
   */
  app.get("/api/galaxy/next", (req, res) => {
    const index = loadBioIndex();
    if (!index) return void noIndex(res);
    const store = opts.getJournalStore?.() ?? null;
    const exclude = new Set(
      String(req.query.exclude ?? "")
        .split(",")
        .slice(0, 2000)
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0),
    );
    if (store) {
      const done = doneAddresses(store);
      for (const i of ordinalsOf(index, done.analysed)) exclude.add(i);
      if (req.query.skipVisited === "1") for (const i of ordinalsOf(index, done.visited)) exclude.add(i);
    }
    const min = Math.max(0, Math.min(65535, Number(req.query.min) || 0));
    const plan = Math.max(0, Math.min(MAX_PLAN_STOPS, Math.floor(Number(req.query.plan) || 0)));
    const from = store?.commanderPos ?? opts.getCommanderPosition?.() ?? null;
    res.json(nextTarget(index, galaxySystemValues(index), from, min, exclude, 6, plan, req.query.loop === "1"));
  });

  /*
    One boxel (shared/boxel.ts): `?name=` any system in it (or the boxel with a trailing "-"), `?end=`
    the last system number when known. Journals always; the galaxy index when this machine has it.
  */
  app.get("/api/boxel", (req, res) => {
    const name = String(req.query.name ?? "").slice(0, 80);
    const endRaw = Number(req.query.end);
    const end = String(req.query.end ?? "").trim() !== "" && Number.isFinite(endRaw) ? Math.floor(endRaw) : null;
    const store = opts.getJournalStore?.() ?? null;
    const byId = new Map(getCachedSpeciesDatabase().species.map((s) => [s.id, s.displayName]));
    const dto = boxelSystems({
      query: name,
      end,
      index: tileIndex(),
      visited: store ? store.visitedSystems.entries() : [],
      speciesName: (id) => byId.get(id) ?? id,
      stats: store ? boxelStats(store) : undefined,
    });
    if (!dto) {
      res.status(400).json({ ok: false, error: "Not a boxel name: type a system such as Eol Prou AB-C d1-23." });
      return;
    }
    res.json(dto);
  });

  /*
    Saved boxels (server/savedBoxels.ts): the commander types a boxel's last system, the list keeps it,
    and each read ticks off what the journals say he has flown.
  */
  // Spansh look-ups of whole boxels (server/boxelLookup.ts), kept 30 days beside the saved boxels.
  const lookups = createBoxelLookups({
    filePath: opts.savedBoxels ? path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-boxel-lookups.json") : null,
    isPlant: (genus) => {
      const g = genus.trim().toLowerCase();
      return getCachedSpeciesDatabase().species.some((s) => {
        const n = s.displayName.toLowerCase();
        return n === g || n.startsWith(`${g} `) || n.endsWith(` ${g}`);
      });
    },
  });
  /*
    Systems known to exist without being flown (auto-boxel detector, owner 2026-10-06): every route he
    plotted (the NavRoute finder) and every system he targeted in the galaxy map (journals' FSDTarget,
    Status.json's destination).
  */
  const sightings = (store: GameStateStore | null) => [
    ...navRouteLog().systems,
    ...(store ? [...store.targetedSystems.values()] : []),
  ];
  const savedList = () => {
    const store = opts.getJournalStore?.() ?? null;
    return {
      ok: true,
      items: opts.savedBoxels!.list(
        store ? store.visitedSystems.entries() : [],
        store ? boxelStats(store) : undefined,
        store?.currentSystem ?? null,
        sightings(store),
      ),
      autoCopyNext: opts.savedBoxels!.autoCopyNext(),
    };
  };
  app.get("/api/boxels", (_req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    res.json(savedList());
  });
  /*
    `{ lastSystem }` keeps a boxel to that system. `{ system, end? }` (the Boxels screen's Current boxel
    and Plan): any system of the boxel; with no end, up to the highest system the journals or the
    galaxy index know (at least the one named), and a boxel already saved keeps its own end.
  */
  app.post("/api/boxels", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    let last = typeof req.body?.lastSystem === "string" ? req.body.lastSystem : "";
    if (typeof req.body?.system === "string") {
      const b = parseBoxel(req.body.system.slice(0, 80));
      if (!b) {
        res.status(400).json({ ok: false, error: "Not a boxel name: type a system such as Eol Prou AB-C d1-23." });
        return;
      }
      const endRaw = Number(req.body.end);
      const asked = req.body.end != null && req.body.end !== "" && Number.isFinite(endRaw) ? Math.floor(endRaw) : null;
      const have = savedList().items.find((x) => x.prefix.toLowerCase() === b.prefix.toLowerCase());
      if (have && asked == null) return void res.json({ ...savedList(), id: have.id });
      const store = opts.getJournalStore?.() ?? null;
      const auto = boxelSystems({
        query: req.body.system,
        end: asked,
        index: tileIndex(),
        visited: store ? store.visitedSystems.entries() : [],
        speciesName: (id) => id,
      });
      last = `${b.prefix}${auto?.end ?? b.index ?? 0}`;
    }
    const added = opts.savedBoxels.add(last);
    if (!added) {
      res.status(400).json({ ok: false, error: "Type the boxel's last system in full, such as Eol Prou AB-C d1-57." });
      return;
    }
    res.json({ ...savedList(), id: added.id });
  });
  /*
    The Boxels screen's table: `?ids=` the ticked saved boxels (comma-separated), every system of each,
    with what the journals and the galaxy index say.
  */
  app.get("/api/boxels/table", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const want = new Set(String(req.query.ids ?? "").split(",").filter(Boolean));
    const store = opts.getJournalStore?.() ?? null;
    const byId = new Map(getCachedSpeciesDatabase().species.map((s) => [s.id, s.displayName]));
    res.json({
      ok: true,
      ...boxelTable({
        boxels: savedList().items.filter((b) => want.has(b.id)),
        index: tileIndex(),
        visited: store ? store.visitedSystems.entries() : [],
        speciesName: (id) => byId.get(id) ?? id,
        traits: loadSystemTraits(),
        journal: store ? (addr) => boxelJournalFacts(store, addr) : undefined,
        visitedAt: (addr) => store?.systemVisitedAt.get(addr) ?? null,
        lookup: (prefix) => lookups.get(prefix),
        routed: sightings(store),
      }),
    });
  });
  /*
    Look a saved boxel up on Spansh (plan Q1): `POST /api/boxels/:id/lookup` starts it (one at a time,
    pages five seconds apart), `GET /api/boxels/lookup` says how far it is, `DELETE` stops it.
  */
  app.post("/api/boxels/:id/lookup", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const b = savedList().items.find((x) => x.id === String(req.params.id ?? ""));
    if (!b) return void res.status(404).json({ ok: false, error: "No such saved boxel." });
    const started = lookups.start(b.prefix);
    res.status(started ? 200 : 409).json({
      ok: started,
      status: lookups.status(),
      ...(started ? {} : { error: "A look-up is already running." }),
    });
  });
  app.get("/api/boxels/lookup", (_req, res) => res.json({ ok: true, status: lookups.status() }));
  app.delete("/api/boxels/lookup", (_req, res) => {
    lookups.stop();
    res.json({ ok: true, status: lookups.status() });
  });
  /*
    Boxels he flew through (Previous): `?days=` the last visit within that many days (0 or none: all),
    notable ones first.
  */
  app.get("/api/boxels/previous", (req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return void res.json({ ok: true, items: [] });
    const days = Math.max(0, Number(req.query.days) || 0);
    const saved = new Set((opts.savedBoxels ? savedList().items : []).map((b) => b.prefix.toLowerCase()));
    res.json({
      ok: true,
      items: previousBoxels({
        visited: store.visitedSystems.entries(),
        visitedAt: (addr) => store.systemVisitedAt.get(addr) ?? null,
        journal: (addr) => boxelJournalFacts(store, addr),
        sinceIso: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
        savedPrefixes: saved,
      }),
    });
  });
  // Copy the next system to fly after each jump into a saved boxel: `{ autoCopyNext: boolean }`.
  app.post("/api/boxels/options", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    if (typeof req.body?.autoCopyNext === "boolean") opts.savedBoxels.setAutoCopyNext(req.body.autoCopyNext);
    res.json(savedList());
  });
  // A correction on one system: `{ cutFrom: n }` drops n and everything after; `{ skip: n, on }`.
  app.patch("/api/boxels/:id", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const id = String(req.params.id ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    let done = false;
    if (typeof body.cutFrom === "number") done = opts.savedBoxels.cutFrom(id, body.cutFrom);
    else if (typeof body.skip === "number") done = opts.savedBoxels.setSkipped(id, body.skip, body.on !== false);
    // The galaxy-map probe: `{ lastIs: n }` — he checked that n + 1 is not there, so n is the last.
    else if (typeof body.lastIs === "number") done = opts.savedBoxels.confirmEnd(id, body.lastIs);
    if (!done) {
      res.status(400).json({ ...savedList(), ok: false, error: "That system is not in this saved boxel." });
      return;
    }
    res.json(savedList());
  });
  app.delete("/api/boxels/:id", (req, res) => {
    if (!opts.savedBoxels) return void res.status(501).json({ ok: false, error: "Not available in this build." });
    const gone = opts.savedBoxels.remove(String(req.params.id ?? ""));
    res.status(gone ? 200 : 404).json({ ...savedList(), ok: gone });
  });

  /** Regions are the client's; this finds sectors and systems by name: `?q=`. */
  app.get("/api/galaxy/find", (req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    res.json(galaxyFind(t, opts.getJournalStore?.() ?? null, String(req.query.q ?? "").slice(0, 80)));
  });

  /** A sector column's panel: `?c=cx:cz` (every height together, as the map's rings are). */
  app.get("/api/galaxy/sector", (req, res) => {
    const m = /^(-?\d{1,3}):(-?\d{1,3})$/.exec(String(req.query.c ?? ""));
    if (!m) return void res.status(400).json({ ok: false, error: "c must be cx:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const dto = galaxySector(t, Number(m[1]), Number(m[2]));
    if (!dto) return void res.status(404).json({ ok: false, error: "empty sector" });
    res.json(dto);
  });

  /** One cell's systems at 0.02 ly: `?c=cx:cy:cz`. An empty cell is a 404, not an error. */
  app.get("/api/galaxy/tile", (req, res) => {
    const c = parseCellParam(req.query.c);
    if (!c) return void res.status(400).json({ ok: false, error: "c must be cx:cy:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const buf = encodeTile(t, c);
    if (!buf) return void res.status(404).json({ ok: false, error: "empty cell" });
    sendBinary(res, buf);
  });

  /** The commander's own systems with what they did there (G3; flags in galaxyMine.ts). */
  app.get("/api/galaxy/mine", (_req, res) => {
    if (!opts.getMySystems) return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getMySystems());
  });

  /** One of them, body by body: `?addr=<SystemAddress>`. */
  app.get("/api/galaxy/mine/system", (req, res) => {
    const addr = Number(req.query.addr);
    if (!Number.isFinite(addr)) return void res.status(400).json({ error: "addr must be a SystemAddress" });
    const dto = opts.getMySystem?.(addr) ?? null;
    if (!dto) return void res.status(404).json({ error: "not one of your systems" });
    res.json(dto);
  });

  /** The systems you have been to, newest first: `?days=1|7|30|90|365`, or 0 / absent for all. */
  app.get("/api/galaxy/visited", (req, res) => {
    if (!opts.getVisitedSystems) return void res.status(404).json({ error: "no journal store behind this build" });
    const days = Math.max(0, Math.min(100_000, Math.floor(Number(req.query.days) || 0)));
    res.json(opts.getVisitedSystems(days));
  });

  /** Where the ship is and this session's jumps with positions. */
  app.get("/api/galaxy/route", (_req, res) => {
    if (!opts.getSessionRoute) return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getSessionRoute());
  });

  app.get("/api/galaxy/my-sectors", (_req, res) => {
    perfCount("http.commanderSectors");
    if (!opts.getCommanderSectors) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getCommanderSectors());
  });

  app.get("/api/galaxy/species", (_req, res) => {
    perfCount("http.galaxySpecies");
    if (!opts.getGalaxySpecies) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    res.json(opts.getGalaxySpecies());
  });

  app.get("/api/galaxy/regions", (_req, res) => {
    perfCount("http.galaxyRegions");
    if (!opts.getGalaxyRegions) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    res.json(opts.getGalaxyRegions());
  });

  /**
   * Bodies that could hold a species, in places nobody has looked.
   *
   * The evidence ticks arrive as three independent booleans rather than a mode, because that is
   * what they are: FSS-only, already probed, and already walked are separate questions and the
   * commander may want any combination. Defaults match the panel's — untouched bodies only.
   */
  app.get("/api/galaxy/possible", (req, res) => {
    perfCount("http.galaxyPossible");
    if (!opts.scanGalaxyBodies) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    const regionId = Number(req.query.regionId ?? 0);
    if (!Number.isFinite(regionId) || regionId <= 0) {
      res.status(400).json({ error: "regionId must be a positive region index" });
      return;
    }
    const limit = Number(req.query.limit ?? 200);
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    // Absent means the default, so `fss=0` can turn the default off — `!== "0"` would read a
    // missing parameter as a tick the commander never made.
    const tick = (v: unknown, fallback: boolean): boolean => {
      const raw = String(v ?? "").trim();
      if (!raw) return fallback;
      return raw === "1" || raw.toLowerCase() === "true";
    };
    opts
      .scanGalaxyBodies(
        {
          regionId: Math.trunc(regionId),
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          includeUnprobed: tick(req.query.fss, true),
          includeProbed: tick(req.query.dss, false),
          includeWalked: tick(req.query.walked, false),
          // Absent or 0 means no floor, which is the default; see GalaxyBodyScanQueryDTO.
          minGravityOddsPct: Number(req.query.minGravityOdds ?? 0) || 0,
        },
        Number.isFinite(limit) ? limit : 200,
      )
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — galaxy body scan failed: ${String(e)}`);
        res.status(500).json({ error: "the galaxy body scan failed" });
      });
  });

  app.get("/api/galaxy/worth", (req, res) => {
    perfCount("http.galaxyWorth");
    if (!opts.searchGalaxyByValue) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    const minCr = Number(req.query.minCr ?? 0);
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isFinite(minCr) || minCr < 0) {
      res.status(400).json({ error: "minCr must be a non-negative number" });
      return;
    }
    /** Comma-separated so the whole query stays a GET a human can read in a log. */
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    const tiers = Number(req.query.tiers ?? 0);
    res.json(
      opts.searchGalaxyByValue(
        {
          minCr,
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          requireTiers: Number.isFinite(tiers) && tiers > 0 ? tiers : 0,
        },
        Number.isFinite(limit) ? limit : 200,
      ),
    );
  });

  app.get("/api/discoveries", (_req, res) => {
    perfCount("http.discoveries");
    if (!opts.getDiscoveries) {
      res.status(404).json({ error: "discoveries not available in this build" });
      return;
    }
    res.json(opts.getDiscoveries());
  });

  app.get("/api/backlog-map", (_req, res) => {
    perfCount("http.backlogMap");
    if (!opts.getBacklogMap) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getBacklogMap());
  });

  app.get("/api/achievements", (_req, res) => {
    perfCount("http.achievements");
    if (!opts.getAchievements) {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(opts.getAchievements());
  });

  app.get("/api/achievements/detail", (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const out = id && opts.getAchievementDetail ? opts.getAchievementDetail(id) : null;
    if (!out) {
      res.status(404).json({ error: "no such achievement" });
      return;
    }
    res.json(out);
  });

  /** POST { id: string | null } — track one achievement, or none. */
  app.post("/api/achievements/track", (req, res) => {
    if (!opts.trackAchievement) {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const id = (req.body as { id?: unknown } | undefined)?.id;
    if (id !== null && typeof id !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include "id": string or null.' });
      return;
    }
    if (!opts.trackAchievement(id)) {
      res.status(404).json({ ok: false, error: "no such achievement" });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.get("/api/codex/regions", (_req, res) => {
    perfCount("http.codexRegions");
    res.json(codexMapRegions(getProjectRoot(), opts.getCodexMapLogged?.() ?? new Set()));
  });

  app.get("/api/codex/region", (req, res) => {
    perfCount("http.codexRegion");
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const kind = req.query.kind === "bodies" || req.query.kind === "bio" ? req.query.kind : null;
    if (!name || !kind) {
      res.status(400).json({ error: "name and kind (bodies|bio) are required" });
      return;
    }
    const out = codexMapRegion(getProjectRoot(), opts.getCodexMapLogged?.() ?? new Set(), name, kind);
    if (!out) {
      res.status(404).json({ error: "no codex data for that region" });
      return;
    }
    res.json(out);
  });

  app.get("/api/region-map", (_req, res) => {
    perfCount("http.regionMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "region-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no region map vendored in this build" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  app.get("/api/first-discovery-backlog", (_req, res) => {
    perfCount("http.firstDiscoveryBacklog");
    if (!opts.getFirstDiscoveryBacklog) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getFirstDiscoveryBacklog());
  });

  app.get("/api/sector-map", (_req, res) => {
    perfCount("http.sectorMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no sector map built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  /**
   * One sector's systems (Phase 10 step 4).
   *
   * The file is 935 kB for 3,015 systems and would be far larger once the Spansh export lands, so
   * the client never downloads it — it asks for the cell it just clicked. The file is parsed once
   * and held; it changes only when the feeder runs, and re-reading 935 kB per hover would be silly.
   *
   * The cell key arrives as a query parameter rather than a path segment because it contains colons.
   */
  let sectorSystemsCache: { mtimeMs: number; cells: Record<string, unknown[]> } | null = null;
  app.get("/api/sector-systems", (req, res) => {
    perfCount("http.sectorSystems");
    const cell = String(req.query.cell ?? "").trim();
    if (!/^-?\d+:-?\d+:-?\d+$/.test(cell)) {
      res.status(400).json({ error: "cell must look like x:y:z" });
      return;
    }
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-systems.json");
    if (!existsSync(file)) {
      res
        .status(404)
        .json({ error: "no sector systems built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (!sectorSystemsCache || sectorSystemsCache.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { cells?: Record<string, unknown[]> };
      sectorSystemsCache = { mtimeMs, cells: parsed.cells ?? {} };
    }
    res.json({ cell, systems: sectorSystemsCache.cells[cell] ?? [] });
  });
}
