import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import express from "express";
import { getProjectRoot } from "../paths.js";
import { perfCount } from "../perf.js";
import { codexMapRegion, codexMapRegions } from "../codexMap.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerGalaxyRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
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

  /**
   * The galaxy photograph the region map is drawn over, when this machine has one.
   *
   * Served from `data/galaxy/`, which is gitignored, and 404s cleanly when the file is absent — the
   * backdrop then paints exactly as it did before, region colours on nothing. That is deliberate:
   * the image is a picture of the Milky Way as the game renders it, and shipping it inside a public
   * MIT repository is a licensing decision for the owner to make, not a side effect of adding a
   * backdrop. Nothing here copies it anywhere it would be committed.
   */
  app.get("/api/galaxy-image", (_req, res) => {
    perfCount("http.galaxyImage");
    const file = path.join(getProjectRoot(), "data", "galaxy", "milkyway-game-normalized.jpg");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no galaxy image on this machine" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.type("image/jpeg").send(readFileSync(file));
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
