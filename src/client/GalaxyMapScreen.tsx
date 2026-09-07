/**
 * `?screen=map` — the galaxy sector map, on its own (INCLUDE-BODY-IDS Phase 10 step 3).
 *
 * A separate screen rather than a modal inside the app: the map is something a commander leaves open
 * on a second monitor while flying, which is exactly what `?screen=triage` already exists for. It
 * shares that screen's shape — fetch once, no WebSocket, no live state — because the aggregate only
 * changes when the feeder runs.
 */
import { useEffect, useState } from "react";
import type { SectorMapFile } from "@shared/sectorMapFile.js";
import { GalaxySectorMap } from "./GalaxySectorMap";

type Load =
  | { state: "loading" }
  | { state: "ready"; file: SectorMapFile }
  | { state: "missing" }
  | { state: "error"; message: string };

export function GalaxyMapScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

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

  return (
    <main className="galaxy-screen">
      <header>
        <h1>Where the plants are known to be</h1>
        {load.state === "ready" ? (
          <p className="galaxy-screen__meta">
            {load.file.cells.length} sectors · built {new Date(load.file.generatedAt).toLocaleString()}
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

      {load.state === "ready" ? (
        <>
          <GalaxySectorMap file={load.file} />
          {/* The provenance travels with the data; show it rather than paraphrasing it. */}
          <p className="galaxy-screen__note">{load.file.note}</p>
          <p className="galaxy-screen__source">Sector names: {load.file.sectorNameSource}</p>
        </>
      ) : null}
    </main>
  );
}
