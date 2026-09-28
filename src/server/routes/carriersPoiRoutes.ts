import express from "express";
import {
  countCarriers,
  fetchCarrierData,
  parseCarrierQueryParams,
  queryCarriers,
  readCarrierStatus,
} from "../edastroCarriers.js";
import { countPoi, fetchPoiData, queryPoi, readPoiStatus } from "../edastroPoi.js";
import { lookupCarrierOnSpansh } from "../spanshCarrier.js";
import { EDASTRO_USER_AGENT } from "../edastroCarriers.js";
import { lookupCarrierOnGalmap } from "../edastroGalmap.js";
import { summariseStatistics } from "../statistics.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerCarriersPoiRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.get("/api/carriers/status", (_req, res) => {
    res.json(readCarrierStatus());
  });

  app.post("/api/carriers/fetch", async (req, res) => {
    const force = req.body?.force === true;
    try {
      const result = await fetchCarrierData({ force });
      if (!result.ok) {
        // 409 rather than 500: a cooldown is the server working, not failing, and the panel shows
        // the message beside a button it leaves enabled.
        res.status(409).json({ ok: false, error: result.error, status: result.status });
        return;
      }
      res.json({ ok: true, unchanged: result.unchanged === true, status: result.status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /*
    Points of interest, from EDAstro's Galactic Exploration Catalog. Same shape as the carrier
    routes, same rule: the commander presses a button, the fetch happens on their machine, and it
    never goes through a server of ours.
  */
  /*
    Statistics: income by source, activity and balances, over a window.

    The scan behind it reads 303 MB of journals and is cached on a manifest of the folder, so the
    first call after a new journal costs a few seconds and the rest are arithmetic.
  */
  app.get("/api/statistics", async (req, res) => {
    if (typeof opts.getStatisticsScan !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const window = typeof req.query?.window === "string" ? req.query.window : "all";
    try {
      const scan = await opts.getStatisticsScan();
      res.json(summariseStatistics(scan, window));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/poi/status", (_req, res) => {
    res.json(readPoiStatus());
  });

  app.post("/api/poi/fetch", async (req, res) => {
    const force = req.body?.force === true;
    try {
      const result = await fetchPoiData({ force });
      if (!result.ok) {
        res.status(409).json({ ok: false, error: result.error, status: result.status });
        return;
      }
      res.json({ ok: true, status: result.status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/poi/query", (req, res) => {
    const groupsRaw = req.query?.groups;
    const groups =
      typeof groupsRaw === "string" && groupsRaw.trim()
        ? groupsRaw
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean)
        : [];
    const minRating = Number(req.query?.minRating);
    const limit = Number(req.query?.limit);
    const origin = opts.getCommanderPosition();
    const query = {
      origin,
      groups,
      organicOnly: req.query?.organicOnly === "1",
      minRating: Number.isFinite(minRating) ? minRating : 0,
      search: typeof req.query?.q === "string" ? req.query.q : "",
      limit: Number.isFinite(limit) ? limit : 100,
    };
    res.json({ rows: queryPoi(query), matchCount: countPoi(query), status: readPoiStatus(), origin });
  });

  /*
    One carrier, checked against Spansh on the commander's own press.

    Deliberately not automatic and deliberately not a correction: the two sources disagree in both
    directions (Spansh newer on 9 of 16 sampled, EDAstro newer on 3), so this answers "does anyone
    else know something" for a single row rather than quietly rewriting the list.
  */
  app.get("/api/carriers/live", async (req, res) => {
    const callsign = typeof req.query?.callsign === "string" ? req.query.callsign : "";
    const cachedSystem = typeof req.query?.system === "string" ? req.query.system : "";
    const origin = opts.getCommanderPosition();
    const distanceFrom = (x: number | null, y: number | null, z: number | null) =>
      origin && x != null && y != null && z != null
        ? Math.sqrt((x - origin.x) ** 2 + (y - origin.y) ** 2 + (z - origin.z) ** 2)
        : null;
    // Compared case-insensitively on the trimmed name: the sources agree on spelling, but a stray
    // space would otherwise read as "it moved".
    const differsFrom = (system: string) =>
      cachedSystem.trim().length > 0 && system.trim().toLowerCase() !== cachedSystem.trim().toLowerCase();

    try {
      /*
        EDAstro's own map feed first.

        It is the only source that knew OASIS Vera Rubin had jumped -- the daily CSV and Spansh both
        still had the previous system, from the same EDDN event. It covers ~2,300 carriers: the
        curated networks and whatever moved recently. Fetched once per session, held in memory, never
        written to disk, so a restart falls back to the CSV and nothing upstream can corrupt what is
        stored.
      */
      const onMap = await lookupCarrierOnGalmap(callsign, EDASTRO_USER_AGENT);
      if (onMap) {
        res.json({
          ok: true,
          fix: {
            callsign: onMap.callsign,
            system: onMap.system,
            // The map carries no per-carrier sighting time, so there is none to report. Saying
            // "unknown" is honest where inventing "now" would not be.
            updatedAt: null,
            distanceLy: distanceFrom(onMap.x, onMap.y, onMap.z),
            differs: differsFrom(onMap.system),
            marketId: null,
            source: "galmap",
            network: onMap.network,
            // 767 of the feed's carriers sit in a cluster pin that is nobody's position.
            positionUnknown: onMap.x == null,
          },
        });
        return;
      }

      // Not on the map: Spansh still covers the other ~88,000.
      const result = await lookupCarrierOnSpansh(callsign);
      if (!result.ok) {
        res.status(result.notFound ? 404 : 502).json({ ok: false, error: result.error });
        return;
      }
      const { fix } = result;
      res.json({
        ok: true,
        fix: {
          callsign: fix.callsign,
          system: fix.system,
          updatedAt: fix.updatedAt,
          distanceLy: distanceFrom(fix.x, fix.y, fix.z),
          differs: differsFrom(fix.system),
          marketId: fix.marketId,
          source: "spansh",
          network: null,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/carriers/query", (req, res) => {
    const origin = opts.getCommanderPosition();
    // One parser, tested: see parseCarrierQueryParams. Inlining this is how the OASIS filter shipped
    // as a chip that did nothing.
    const query = parseCarrierQueryParams(req.query as Record<string, unknown>, origin);
    res.json({
      rows: queryCarriers(query),
      matchCount: countCarriers(query),
      status: readCarrierStatus(),
      origin,
    });
  });
}
