/**
 * `?screen=map` — the galaxy sector map, on its own (INCLUDE-BODY-IDS Phase 10 step 3).
 *
 * A separate screen rather than a modal inside the app: the map is something a commander leaves open
 * on a second monitor while flying, which is exactly what `?screen=triage` already exists for. It
 * shares that screen's shape — fetch once, no WebSocket, no live state — because the aggregate only
 * changes when the feeder runs.
 *
 * ## The galaxy search lives here now (A3)
 *
 * It was a modal behind a magnifying glass in the app's top bar, while this screen carried its own
 * genus and species pickers — two doors to the same room. The owner's verdict: the search belongs
 * with the map, because *"that was the whole point of the map, to explore sectors with less
 * visitors"*. So {@link GalaxySearchPanel} sits above the plot and what it finds filters what is
 * drawn: one question, asked once, answered as a list and as a picture.
 *
 * The applied search is held here rather than in either component, because both need it and neither
 * owns it — the panel decides what was asked and the map decides what that means for a 1 280 ly
 * grid it alone holds the file for.
 */
import { useCallback, useEffect, useState } from "react";
import type { SectorMapFile } from "@shared/sectorMapFile.js";
import { GalaxySectorMap, type CommanderPosition } from "./GalaxySectorMap";
import { GalaxySearchPanel, type GalaxySearchApplied } from "./GalaxySearchPanel";
import {
  loadGalaxyImage,
  renderRegionBackdrop,
  type GalaxyImage,
  type RegionMapPayload,
} from "./regionBackdrop";
import type { BacklogMapDTO, CommanderSectorsDTO } from "@shared/types";

type Load =
  | { state: "loading" }
  | { state: "ready"; file: SectorMapFile }
  | { state: "missing" }
  | { state: "error"; message: string };

export function GalaxyMapScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [commander, setCommander] = useState<CommanderPosition | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  /**
   * The region map itself, kept rather than discarded once the backdrop is painted (A3).
   *
   * It used to be read, turned into a 4 M-pixel image and thrown away. The level-of-detail work
   * needs the same payload as *data* — which sector belongs to which region — and fetching it twice
   * for one file would be worse than holding the one already in hand.
   */
  const [regionMap, setRegionMap] = useState<RegionMapPayload | null>(null);
  /**
   * The galaxy photograph, where this machine has one.
   *
   * Only its URL and size are held; the map draws the image element itself so the browser samples
   * the original once, at the size it is actually shown. A 404 is the ordinary case for anyone who
   * has not put a picture in `data/galaxy/`, and leaves the regions as the backdrop they were.
   */
  const [galaxyImage, setGalaxyImage] = useState<GalaxyImage | null>(null);
  const [backlog, setBacklog] = useState<BacklogMapDTO | null>(null);
  const [commanderSectors, setCommanderSectors] = useState<CommanderSectorsDTO | null>(null);
  const [search, setSearch] = useState<GalaxySearchApplied | null>(null);

  /** Stable, so the panel's own `run` callback does not change identity on every render here. */
  const onApply = useCallback((applied: GalaxySearchApplied | null) => setSearch(applied), []);

  /**
   * The galaxy behind the markers, painted once.
   *
   * Both of these are optional decoration in the strict sense: a failure leaves the sector map
   * exactly as it was before either existed, which is why neither touches `load`. A map that refuses
   * to draw because its backdrop 404'd would be a worse map than one with no backdrop.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/region-map")
      .then((r) => (r.ok ? (r.json() as Promise<RegionMapPayload>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRegionMap(data);
        // ~4 M pixels. Off the critical path on purpose: the markers are already on screen by now.
        setBackdrop(renderRegionBackdrop(data));
      })
      .catch(() => {
        /* no backdrop, same map */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGalaxyImage("/api/galaxy-image")
      .then((img) => {
        if (!cancelled && img) setGalaxyImage(img);
      })
      .catch(() => {
        /* regions on their own, same map */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * This commander's own half of the sector colouring.
   *
   * The corpus half is already in `load.file`; merging happens on this side so the ladder lives in
   * one place and the 900 kB sector file is not parsed twice.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/galaxy/my-sectors")
      .then((r) => (r.ok ? (r.json() as Promise<CommanderSectorsDTO>) : null))
      .then((d) => {
        if (!cancelled && d) setCommanderSectors(d);
      })
      .catch(() => {
        /* the map still draws, in everybody-else's colours */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The backlog layer.
   *
   * Costs the server a species match per body the first time it is asked, so it is fetched once and
   * never polled — the answer only changes when the commander flies somewhere new, and this screen
   * is something left open on a second monitor.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/backlog-map")
      .then((r) => (r.ok ? (r.json() as Promise<BacklogMapDTO>) : null))
      .then((d) => {
        if (!cancelled && d) setBacklog(d);
      })
      .catch(() => {
        /* no layer, same map */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sector-map")
      .then(async (r) => {
        if (r.status === 404) return { state: "missing" } as Load;
        if (!r.ok) return { state: "error", message: `HTTP ${r.status}` } as Load;
        return { state: "ready", file: (await r.json()) as SectorMapFile } as Load;
      })
      .then((next) => {
        if (!cancelled) setLoad(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The commander's position, polled (§10.3).
   *
   * A slow poll rather than a WebSocket: this screen has no live state and wants three numbers. At
   * 1280 ly per cell a jump of ~50 ly rarely leaves the cell, so 15 seconds is far finer than the
   * map can show — and a stale-by-seconds ship is honest in a way that no ship at all is not.
   */
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      fetch("/api/commander-position")
        .then((r) => (r.ok ? (r.json() as Promise<CommanderPosition>) : null))
        .then((p) => {
          if (!cancelled && p) setCommander(p);
        })
        .catch(() => {
          // The map is useful without the ship; a failed poll must not disturb it.
        });
    };
    read();
    const t = setInterval(read, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <main className="galaxy-screen">
      <header>
        <h1>Where the plants are known to be</h1>
        {load.state === "ready" ? (
          <p className="galaxy-screen__meta">
            {load.file.cells.length} sectors · built {new Date(load.file.generatedAt).toLocaleString()}
            {commander?.system ? ` · you are in ${commander.system}` : ""}
          </p>
        ) : null}
      </header>

      {load.state === "loading" ? <p>Loading…</p> : null}

      {load.state === "missing" ? (
        <div className="galaxy-screen__empty">
          <p>No sector map has been built yet.</p>
          <p>
            <code>npm run feeder -- sector-map --write</code>
          </p>
        </div>
      ) : null}

      {load.state === "error" ? <p className="galaxy-screen__empty">Could not load the map: {load.message}</p> : null}

      <GalaxySearchPanel onApply={onApply} />

      {load.state === "ready" ? (
        <>
          <GalaxySectorMap
            file={load.file}
            commander={commander}
            backdrop={backdrop}
            galaxyImage={galaxyImage}
            backlog={backlog}
            commanderSectors={commanderSectors}
            search={search}
            regionMap={regionMap}
          />
          {/* The provenance travels with the data; show it rather than paraphrasing it. */}
          <p className="galaxy-screen__note">{load.file.note}</p>
          <p className="galaxy-screen__source">Sector names: {load.file.sectorNameSource}</p>
        </>
      ) : null}
    </main>
  );
}
