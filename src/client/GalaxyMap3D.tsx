/**
 * `?screen=galaxy` — the 3D galaxy map (G1–G4, docs/galaxy-plan-28092026.md). Its own window, loaded
 * fresh every time it opens and freed when it closes (owner, 2026-09-28). Since G4 it is what the
 * top bar opens; the Classic sector map (`?screen=map`) stays as the fallback where WebGL cannot run.
 *
 * The heavy lifting is in galaxy3d/GalaxyEngine.ts; this is the shell: the toolbar and Find box, the
 * names over the canvas, the hover card, the panels, the commander's own layer and route, the Search
 * and Codex drawers, and what to say when the machine cannot draw it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GalaxyEngine,
  type EngineLabel,
  type EngineStats,
  type HoverInfo,
  type MarkerItem,
  type Selection,
} from "./galaxy3d/GalaxyEngine";
import { detectGraphics, type Graphics } from "./galaxy3d/capabilities";
import { placeLabels } from "./galaxy3d/labelPlacement";
import { formatCount, formatValue } from "./galaxy3d/clusters";
import { fmtLy } from "@shared/format";
import { CodexRecord, IndexRecord, MySystemRecord, SectorRecord } from "./galaxy3d/GalaxyPanels";
import { GalaxySearchPanel, type GalaxySearchApplied } from "./GalaxySearchPanel";
import { GalaxyIndexDownload } from "./GalaxyIndexDownload";
import { GalaxyNavRoutePanel, type NavRouteSystemDTO } from "./GalaxyNavRoutePanel";
import {
  EMPTY_GALAXY_FILTER,
  GalaxyFilterPanel,
  galaxyFilterQuery,
  galaxyFilterTicks,
  isGalaxyFilterState,
} from "./GalaxyFilterPanel";
import { SystemBookmarkButton } from "./BookmarkButton";
import { CopySystemButton } from "./CopySystemButton";
import { galaxyImageRect, loadGalaxyImage, REGION_MAP_SIZE, xForRegionPx, zForRegionPz } from "./regionBackdrop";
import { regionOutlines, type RegionOutlines } from "@shared/regionBorders.js";
import { regionIndexForCoords, regionJoinKey, type RegionMapData } from "@shared/regionMap.js";
import type { GalaxyFindDTO, GalaxyMineDTO, GalaxyNextDTO, GalaxyRouteDTO } from "@shared/types";
import type { CodexMapKind, CodexMapRegionDTO, CodexMapRegionsDTO, CodexMapSystemDTO } from "@shared/dto/codexMap.js";
import { GALAXY_LAYERS, layerPointText, type GalaxyLayerDTO, type GalaxyLayerKind } from "@shared/galaxyLayers.js";
import { isBool, usePersistedState } from "./usePersistedState";

const LABEL_H = 18;
/** Label divs kept between frames; a screen shows well under this many names at once. */
const LABEL_POOL_MAX = 150;
const labelWidth = (l: EngineLabel) => (l.kind === "region" ? 14 : 10) + l.text.length * (l.kind === "region" ? 7.6 : 6.6);
const crShort = (n: number | null) => (n == null ? "—" : formatValue(n / 100_000));
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

type Colour = 0 | 1 | 2;
type Drawer = "none" | "search" | "filter" | "navroute" | "codex" | "plan";
type MineRow = GalaxyMineDTO["systems"][number];

/** The commander's systems: waiting for them amber, done (DSS or plants on foot) green, visited grey. */
const MINE_UNFINISHED = 16;
const mineColour = (f: number, waitingShown: boolean): [number, number, number] =>
  f & MINE_UNFINISHED && waitingShown ? [1, 0.62, 0.16] : f & (4 | 8) ? [0.36, 0.9, 0.46] : [0.62, 0.68, 0.8];
const mineStatus = (r: MineRow) =>
  r.flags & MINE_UNFINISHED
    ? `Still waiting: at least ${crShort(r.unfinishedFloorCr)}`
    : r.flags & (4 | 8)
      ? `Done${r.speciesScanned ? ` · ${r.speciesScanned} species scanned` : " · mapped"}`
      : "Visited";

const codexColour: Record<CodexMapSystemDTO["status"], [number, number, number]> = {
  todo: [1, 0.36, 0.3],
  partial: [1, 0.8, 0.26],
  done: [0.36, 0.9, 0.46],
};
const SEARCH_COLOUR: [number, number, number] = [0.7, 0.5, 1];
/** NavRoute finder markers; green where EDSM does not know the system. */
const NAVROUTE_COLOUR: [number, number, number] = [0.95, 0.6, 0.2];
const PLAN_COLOUR: [number, number, number] = [0.84, 0.7, 1];
/** How many stops the plan can be asked for (G5.3); the target is the first. */
const PLAN_SIZES = [3, 5, 8, 10];
/** Room round a framed plan: the drawer and the panel cover both sides of the map. */
const PLAN_MARGIN = 1.7;

/** The waiting slider: 0 – 500 M CR in 1 M steps, the same range as the Classic map's. */
const WAIT_MAX_M = 500;

/**
 * G5's galaxy-wide floor, in million CR at 1×. Steps rather than a linear slider: nearly everything
 * recorded is under 50 M, and a linear 0–500 M slider spends nine tenths of its travel on a handful.
 */
const WORTH_STEPS_M = [0, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300];

export function GalaxyMap3D() {
  const host = useRef<HTMLDivElement | null>(null);
  const labelLayer = useRef<HTMLDivElement | null>(null);
  const engine = useRef<GalaxyEngine | null>(null);
  /** Names never go under the side panel: while it is open the labels' viewport stops short of it. */
  const panelOpen = useRef(false);
  const regionData = useRef<RegionMapData | null>(null);
  const outlines = useRef<RegionOutlines | null>(null);
  const [graphics] = useState<Graphics>(() => detectGraphics());
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [colour, setColour] = useState<Colour>(0);
  const [exposure, setExposure] = useState(1.2);
  const [layers, setLayers] = useState({ photo: true, borders: true, labels: true, groups: true, you: true });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mine, setMine] = useState<Map<string, MineRow>>(new Map());
  const [route, setRoute] = useState<GalaxyRouteDTO | null>(null);
  const [drawer, setDrawer] = useState<Drawer>("none");
  const codexOn = drawer === "codex";
  const [codexKind, setCodexKind] = useState<CodexMapKind>("bio");
  const [codexRegions, setCodexRegions] = useState<CodexMapRegionsDTO | null>(null);
  const [codexRegion, setCodexRegion] = useState<string | null>(null);
  const [codexSystems, setCodexSystems] = useState<Map<string, CodexMapSystemDTO>>(new Map());
  const [search, setSearch] = useState<GalaxySearchApplied | null>(null);
  const [waitMinM, setWaitMinM] = useState(0);
  const [findText, setFindText] = useState("");
  const [find, setFind] = useState<GalaxyFindDTO | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  /*
    The extra layers (D10): points of interest, phenomena, carriers and bookmarks, each from a list
    already on this PC, fetched when switched on. Remembered between opens of the map.
  */
  const [poiOn, setPoiOn] = usePersistedState("galaxy.layer.poi", false, isBool);
  const [nspOn, setNspOn] = usePersistedState("galaxy.layer.nsp", false, isBool);
  const [carriersOn, setCarriersOn] = usePersistedState("galaxy.layer.carriers", false, isBool);
  const [bookmarksOn, setBookmarksOn] = usePersistedState("galaxy.layer.bookmarks", false, isBool);
  const [gggOn, setGggOn] = usePersistedState("galaxy.layer.ggg", false, isBool);
  /* The status bar's legend folds away (owner, 2026-10-04, plan 3.7), remembered. */
  const [legendOn, setLegendOn] = usePersistedState("galaxy.legendOpen", true, isBool);
  /* The Filter drawer (owner, 2026-10-04): remembered between opens, so the button says when one is on. */
  const [filter, setFilter] = usePersistedState("galaxy.filter", EMPTY_GALAXY_FILTER, isGalaxyFilterState);
  const [filterMatched, setFilterMatched] = useState<number | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const filterAnswer = useRef<{ query: string; bits: Uint8Array; matched: number } | null>(null);
  const filterTicks = galaxyFilterTicks(filter);
  const extraOn: Record<GalaxyLayerKind, boolean> = {
    poi: poiOn,
    nsp: nspOn,
    carriers: carriersOn,
    bookmarks: bookmarksOn,
    ggg: gggOn,
  };
  const extraSet: Record<GalaxyLayerKind, (v: boolean) => void> = {
    poi: setPoiOn,
    nsp: setNspOn,
    carriers: setCarriersOn,
    bookmarks: setBookmarksOn,
    ggg: setGggOn,
  };
  const [extraData, setExtraData] = useState<Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>>({});
  const [worthStep, setWorthStep] = useState(0);
  const [worthCount, setWorthCount] = useState<number | null>(null);
  const [target, setTarget] = useState<GalaxyNextDTO | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [skipVisited, setSkipVisited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [planSize, setPlanSize] = useState(5);
  const [planCopied, setPlanCopied] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  // Drawers, the panel and the banner sit under the toolbar whatever its height (it wraps when narrow).
  useEffect(() => {
    const bar = barRef.current;
    const root = screenRef.current;
    if (!bar || !root) return;
    const set = () => root.style.setProperty("--g3d-top", `${bar.offsetTop + bar.offsetHeight + 8}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [graphics.tier]);

  useEffect(() => {
    document.title = "Galaxy map — ED Exo Compare";
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || graphics.tier === "none") return;
    const pool = new Map<string, HTMLDivElement>();
    const e = new GalaxyEngine(el, {
      tier: graphics.tier,
      onStats: setStats,
      onHover: setHover,
      onSelect: setSelection,
      onPlaneClick: (g) => {
        // The Codex mode: a click on the map picks the region under it.
        const data = regionData.current;
        if (!data) return;
        const name = data.regions[regionIndexForCoords(data, g.x, g.z)];
        // Same region, other spelling ("The Formidine Rift" from the list, "Formidine Rift" from the
        // map): keep the current one, or a missed marker refetched and re-framed the region (tester
        // report, 2026-09-30: "if you miss a dot everything resets").
        if (name) setCodexRegion((cur) => (cur && regionJoinKey(cur) === regionJoinKey(name) ? cur : name));
      },
      // Names: placed without overlaps, written straight into the DOM (every rendered frame).
      onLabels: (labels) => {
        const layer = labelLayer.current;
        if (!layer) return;
        const placed = placeLabels(
          labels.map((l) => ({ ...l, w: labelWidth(l), h: LABEL_H })),
          { width: el.clientWidth - (panelOpen.current ? 380 : 0), height: el.clientHeight },
        );
        const byId = new Map(labels.map((l) => [l.id, l]));
        const seen = new Set<string>();
        for (const p of placed) {
          seen.add(p.id);
          const l = byId.get(p.id)!;
          let div = pool.get(p.id);
          if (!div) {
            div = document.createElement("div");
            layer.appendChild(div);
            pool.set(p.id, div);
          }
          if (div.textContent !== l.text) div.textContent = l.text;
          const cls = `g3d-label g3d-label--${l.kind}`;
          if (div.className !== cls) div.className = cls;
          div.style.transform = `translate(${Math.round(p.left)}px, ${Math.round(p.top)}px)`;
          div.style.display = "";
        }
        // Hidden, kept for the next frame — but a system's label is one div per system ever named, so
        // past a screenful the hidden ones go rather than pile up for the session (plan 2.5, Opus 23).
        for (const [id, div] of pool) {
          if (seen.has(id)) continue;
          if (pool.size > LABEL_POOL_MAX) {
            div.remove();
            pool.delete(id);
          } else div.style.display = "none";
        }
      },
    });
    engine.current = e;
    (window as unknown as { __galaxy: unknown }).__galaxy = {
      stats: () => e.getStats(),
      bench: (n?: number) => e.bench(n),
      camera: () => ({
        target: e.controls.target.toArray().map(Math.round),
        distance: Math.round(e.controls.getDistance()),
        tiltDeg: Math.round((e.controls.getPolarAngle() * 180) / Math.PI),
      }),
      view: (k: "top" | "tilted" | "core" | "sol") => e.view(k),
      targets: () => e.debugTargets(),
      marker: (layer: string) => e.debugMarker(layer),
      filter: () => e.debugFilter(),
      /** For tests: move the camera to a target (game coordinates) at a distance, top-down. */
      lookAt: (x: number, y: number, z: number, distance: number) => {
        e.cancelFlight();
        e.controls.target.set(x, y, -z);
        e.camera.position.set(x, y + distance, -z + 1);
        e.controls.update();
        e.invalidate();
      },
    };

    void e.load();
    // Backdrop: the photograph (placed by the same pin as the 2D map) and the region outlines.
    void Promise.all([
      loadGalaxyImage("/api/galaxy-image").catch(() => null),
      fetch("/api/region-map")
        .then((r) => (r.ok ? (r.json() as Promise<RegionMapData>) : null))
        .catch(() => null),
    ]).then(([img, regions]) => {
      if (engine.current !== e) return;
      regionData.current = regions;
      let photo = null;
      if (img) {
        const r = galaxyImageRect(img.width, img.height);
        photo = {
          url: img.url,
          x0: xForRegionPx(r.x),
          x1: xForRegionPx(r.x + r.width),
          zTop: zForRegionPz(REGION_MAP_SIZE - 1 - r.y),
          zBottom: zForRegionPz(REGION_MAP_SIZE - 1 - (r.y + r.height)),
        };
      }
      outlines.current = regions ? regionOutlines(regions) : null;
      e.setBackdrop(photo, outlines.current);
    });

    // The commander's own systems.
    fetch("/api/galaxy/mine")
      .then((r) => (r.ok ? (r.json() as Promise<GalaxyMineDTO>) : null))
      .then((d) => {
        if (d && engine.current === e) setMine(new Map(d.systems.map((s) => [String(s.addr), s])));
      })
      .catch(() => {});

    const onResize = () => e.resize();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") e.select(null);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      engine.current = null;
      e.dispose();
      pool.forEach((d) => d.remove());
    };
  }, [graphics.tier]);

  // Where the ship is and this session's jumps: every 10 s while the window is visible.
  useEffect(() => {
    if (graphics.tier === "none") return;
    let live = true;
    const tick = () => {
      if (document.hidden) return;
      fetch("/api/galaxy/route")
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyRouteDTO>) : null))
        .then((d) => {
          if (!live || !d) return;
          setRoute(d);
          engine.current?.setRoute(d.route, d.position);
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [graphics.tier]);

  // The extra layers: fetched the first time each is switched on, then only shown or hidden.
  useEffect(() => {
    for (const l of GALAXY_LAYERS) {
      if (!extraOn[l.kind] || extraData[l.kind]) continue;
      void fetch(`/api/galaxy/layers?kind=${l.kind}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: GalaxyLayerDTO | null) => {
          if (d) setExtraData((prev) => ({ ...prev, [l.kind]: d }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiOn, nspOn, carriersOn, bookmarksOn, gggOn, extraData]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    for (const l of GALAXY_LAYERS) {
      const d = extraData[l.kind];
      if (!d) continue;
      const name = `x-${l.kind}`;
      if (!e.hasMarkerLayer(name)) {
        e.setMarkers(
          name,
          d.points.map((p, i) => ({ id: String(i), x: p[0], y: p[1], z: p[2], color: l.colour, size: l.size })),
          l.kind === "bookmarks" ? 3 : 1,
        );
      }
      e.setMarkerLayerVisible(name, extraOn[l.kind]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraData, poiOn, nspOn, carriersOn, bookmarksOn, gggOn, stats?.phase]);
  const extraPoint = (layer: string, id: string) => {
    if (!layer.startsWith("x-")) return null;
    const kind = layer.slice(2) as GalaxyLayerKind;
    const d = extraData[kind];
    const p = d?.points[Number(id)];
    const meta = GALAXY_LAYERS.find((l) => l.kind === kind);
    return d && p && meta ? { p, meta, ...layerPointText(d, p) } : null;
  };

  // The commander's layer, with the "waiting at least" threshold: below it a waiting system is grey.
  const waitMinCr = waitMinM * 1_000_000;
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setMarkers(
      "you",
      [...mine.values()].map((s) => ({
        id: String(s.addr),
        x: s.x,
        y: s.y,
        z: s.z,
        color: mineColour(s.flags, (s.unfinishedFloorCr ?? 0) >= waitMinCr),
        size: s.flags & 32 ? 8 : 6,
      })),
      2,
    );
    e.setMarkerLayerVisible("you", layers.you);
  }, [mine, waitMinCr, layers.you]);

  /** The nearest waiting system at or above the threshold (the Classic map's "nearest that qualifies"). */
  const nearest = useMemo(() => {
    const ship = route?.position;
    if (!ship) return null;
    let best: { row: MineRow; ly: number } | null = null;
    for (const r of mine.values()) {
      if (!(r.flags & MINE_UNFINISHED) || (r.unfinishedFloorCr ?? 0) < waitMinCr) continue;
      const ly = dist(ship, r);
      if (!best || ly < best.ly) best = { row: r, ly };
    }
    return best;
  }, [mine, route, waitMinCr]);

  /*
    The filter's answer: bits over the map's ordinals, asked again only when the ticks change (hide
    on or off is the engine's alone). A quarter second of quiet first, for quick ticking.
  */
  const filterQuery = galaxyFilterQuery(filter);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!filterQuery) {
      filterAnswer.current = null;
      e.setFilter(null, false, 0);
      setFilterMatched(null);
      setFilterBusy(false);
      return;
    }
    const have = filterAnswer.current;
    if (have && have.query === filterQuery) {
      e.setFilter(have.bits, filter.hide, have.matched);
      return;
    }
    let live = true;
    setFilterBusy(true);
    const t = window.setTimeout(() => {
      void fetch(`/api/galaxy/filter?${filterQuery}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await r.arrayBuffer();
          const head = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
          if (head !== "EDXFLT01") throw new Error("not a filter answer");
          const dv = new DataView(buf);
          const matched = dv.getUint32(12, true);
          return { bits: new Uint8Array(buf, 16), matched };
        })
        .then(({ bits, matched }) => {
          if (!live) return;
          filterAnswer.current = { query: filterQuery, bits, matched };
          engine.current?.setFilter(bits, filter.hide, matched);
          setFilterMatched(matched);
        })
        .catch(() => {
          if (live) setFilterMatched(null);
        })
        .finally(() => {
          if (live) setFilterBusy(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [filterQuery, filter.hide]);

  useEffect(() => engine.current?.setColourMode(colour), [colour]);
  useEffect(() => engine.current?.setExposure(exposure), [exposure]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setLayer("photo", layers.photo);
    e.setLayer("borders", layers.borders);
    e.setLayer("labels", layers.labels);
    // The Codex mode has dots of its own; rings over them were clutter (G3).
    e.setLayer("groups", layers.groups && !codexOn);
    if (labelLayer.current) labelLayer.current.style.display = layers.labels ? "" : "none";
  }, [layers, codexOn]);

  useEffect(() => {
    panelOpen.current = !!selection;
    engine.current?.invalidate();
  }, [selection]);

  // -------------------------------------------------------------------------- the NavRoute finder
  /* The systems its filters leave, marked on the map (owner, 2026-10-04); none while it is closed. */
  const [navShown, setNavShown] = useState<NavRouteSystemDTO[]>([]);
  useEffect(() => {
    const items: MarkerItem[] =
      drawer === "navroute"
        ? navShown.slice(0, 5000).map((s) => ({
            id: String(s.address),
            x: s.pos[0],
            y: s.pos[1],
            z: s.pos[2],
            color: s.edsm === false ? [0.36, 0.9, 0.46] : NAVROUTE_COLOUR,
            size: 7,
          }))
        : [];
    engine.current?.setMarkers("navroute", items, 3);
  }, [navShown, drawer]);

  // ------------------------------------------------------------------------------ the Search drawer
  const onApply = useCallback((applied: GalaxySearchApplied | null) => setSearch(applied), []);
  useEffect(() => {
    const items: MarkerItem[] = (search?.hits ?? []).map((h) => ({
      id: String(h.systemAddress),
      x: h.x,
      y: h.y,
      z: h.z,
      color: SEARCH_COLOUR,
      size: 8,
    }));
    engine.current?.setMarkers("search", items, 4);
  }, [search]);
  const searchHits = useMemo(() => new Map((search?.hits ?? []).map((h) => [String(h.systemAddress), h])), [search]);
  const commanderRegionId = useMemo(() => {
    const p = route?.position;
    const data = regionData.current;
    return p && data ? regionIndexForCoords(data, p.x, p.z) || null : null;
  }, [route]);

  // ------------------------------------------------------------------------------ the Codex mode
  useEffect(() => {
    engine.current?.setPlaneClickMode(codexOn);
    if (!codexOn) {
      engine.current?.setMarkers("codex", []);
      setCodexSystems(new Map());
      return;
    }
    if (!codexRegions) {
      fetch("/api/codex/regions")
        .then((r) => (r.ok ? (r.json() as Promise<CodexMapRegionsDTO>) : null))
        .then((d) => d && setCodexRegions(d))
        .catch(() => {});
    }
  }, [codexOn, codexRegions]);

  useEffect(() => {
    if (!codexOn || !codexRegion) return;
    let live = true;
    // The region map and EDSM spell a few regions differently; the join key settles it.
    const summary = codexRegions?.regions.find((r) => r.joinKey === regionJoinKey(codexRegion));
    const name = summary?.name ?? codexRegion;
    fetch(`/api/codex/region?name=${encodeURIComponent(name)}&kind=${codexKind}`)
      .then((r) => (r.ok ? (r.json() as Promise<CodexMapRegionDTO>) : null))
      .then((d) => {
        if (!live || !d) return;
        setCodexSystems(new Map(d.systems.map((s) => [s.systemAddress, s])));
        const items: MarkerItem[] = d.systems.map((s) => ({
          id: s.systemAddress,
          x: s.x,
          y: 0,
          z: s.z,
          color: codexColour[s.status],
          size: 6,
        }));
        engine.current?.setMarkers("codex", items, 3);
        engine.current?.fitTo(d.systems);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [codexOn, codexRegion, codexKind, codexRegions]);

  const codexSummary = useMemo(
    () => (codexRegion ? codexRegions?.regions.find((r) => r.joinKey === regionJoinKey(codexRegion)) : undefined),
    [codexRegion, codexRegions],
  );

  // ------------------------------------------------------------------ G5: worth at least, Next target
  const worthM = WORTH_STEPS_M[worthStep] ?? 0;
  useEffect(() => {
    const e = engine.current;
    if (!e || stats?.phase !== "ready") return;
    setWorthCount(e.setMinValue(worthM * 10)); // million CR → the map's 100 k CR units
  }, [worthM, stats?.phase]);

  /**
   * Ask for the nearest system worth at least the floor that is not done, fly there, copy its name.
   * With the Plan drawer open, the chain of `plan` stops comes along and the camera frames all of it.
   */
  const nextTarget = async (skip: number[], o: { plan?: number; fly?: boolean } = {}) => {
    const plan = o.plan ?? (drawer === "plan" ? planSize : 0);
    setTargetBusy(true);
    try {
      const q = new URLSearchParams({ min: String(worthM * 10), skipVisited: skipVisited ? "1" : "0" });
      if (skip.length) q.set("exclude", skip.join(","));
      if (plan) q.set("plan", String(plan));
      const r = await fetch(`/api/galaxy/next?${q}`);
      const d = r.ok ? ((await r.json()) as GalaxyNextDTO) : null;
      setTarget(d);
      setPlanCopied(false);
      const t = d?.target;
      if (t && o.fly !== false) {
        const stops = d?.plan?.stops ?? [];
        if (stops.length > 1) {
          engine.current?.fitTo([...(d?.from ? [d.from] : []), ...stops], PLAN_MARGIN);
          engine.current?.select({ kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
        } else {
          go(t, 400, { kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
        }
      }
      if (t) {
        try {
          await navigator.clipboard.writeText(t.name);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }
    } finally {
      setTargetBusy(false);
    }
  };
  const skipTarget = () => {
    const t = target?.target;
    if (!t) return;
    const next = [...skipped, t.ordinal];
    setSkipped(next);
    void nextTarget(next);
  };

  // G5.3: the plan — the target and the nearest qualifying system after each stop.
  const plan = drawer === "plan" ? (target?.plan ?? null) : null;
  const openPlan = () => {
    setDrawer("plan");
    void nextTarget(skipped, { plan: planSize });
  };
  /** Skip one stop of the plan: the chain is asked again from the ship, the camera stays. */
  const skipStop = (ordinal: number) => {
    const next = [...skipped, ordinal];
    setSkipped(next);
    void nextTarget(next, { fly: false });
  };
  const planStops = useMemo(() => new Map((plan?.stops ?? []).map((s, i) => [String(s.ordinal), { ...s, n: i + 1 }])), [plan]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const stops = plan?.stops ?? [];
    e.setPlan(
      stops.map((s, i) => ({ x: s.x, y: s.y, z: s.z, label: String(i + 1) })),
      target?.from ?? null,
    );
    e.setMarkers(
      "plan",
      stops.map((s) => ({ id: String(s.ordinal), x: s.x, y: s.y, z: s.z, color: PLAN_COLOUR, size: 9 })),
      5,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target.from travels with the plan
  }, [plan]);

  // ------------------------------------------------------------------------------ the Find box
  useEffect(() => {
    const q = findText.trim();
    if (q.length < 2) {
      setFind(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyFindDTO>) : null))
        .then((d) => live && setFind(d))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [findText]);
  const findRegions = useMemo(() => {
    const q = findText.trim().toLowerCase();
    if (q.length < 2) return [];
    return (outlines.current?.anchors ?? []).filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5);
  }, [findText]);

  const go = (g: { x: number; y: number; z: number }, distance: number, sel?: Selection) => {
    setFindOpen(false);
    engine.current?.flyTo(g, distance);
    if (sel) engine.current?.select(sel);
  };

  if (graphics.tier === "none") {
    return (
      <div className="g3d-screen g3d-screen--fallback">
        <div className="g3d-fallback">
          <h1>The 3D galaxy map needs WebGL 2</h1>
          <p>
            This window cannot draw it ({graphics.renderer}). The Classic map works everywhere and has the same
            search.
          </p>
          <a className="g3d-btn g3d-btn--primary" href="?screen=map">
            Open the Classic map
          </a>
        </div>
      </div>
    );
  }

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const view = (k: "top" | "tilted" | "core" | "sol") => engine.current?.view(k);
  const toShip = () => {
    const ship = engine.current?.getShip();
    if (ship) engine.current?.flyTo(ship, 2_500);
  };
  const openDrawer = (d: Drawer) => {
    setDrawer((cur) => (cur === d ? "none" : d));
    engine.current?.select(null);
  };
  const loading = !stats || stats.phase === "loading";
  const colours: [Colour, string][] = [
    [0, "Evidence"],
    [1, "Species count"],
    [2, "Value"],
  ];

  const tip = (() => {
    if (!hover) return null;
    if (hover.kind === "system") {
      return (
        <>
          <strong>{hover.name ?? "…"}</strong>
          <span>
            {hover.species} species · {formatValue(hover.value)}
          </span>
          <em>Click for details</em>
        </>
      );
    }
    if (hover.kind === "group") {
      return (
        <>
          <strong>{hover.name ?? `${formatCount(hover.count)} systems`}</strong>
          <span>
            {hover.name ? `${formatCount(hover.count)} systems · ` : ""}
            best {formatValue(hover.top)}
          </span>
          <em>{hover.level === 1280 ? "Click for its best systems and to zoom in" : "Click to zoom in"}</em>
        </>
      );
    }
    if (hover.layer === "you") {
      const r = mine.get(hover.id);
      return r ? (
        <>
          <strong>{r.name || "Your system"}</strong>
          <span>{mineStatus(r)}</span>
          <em>Your journals · click for details</em>
        </>
      ) : null;
    }
    if (hover.layer === "plan") {
      const p = planStops.get(hover.id);
      return p ? (
        <>
          <strong>
            {p.n}. {p.name}
          </strong>
          <span>
            {fmtLy(p.legLy)} from {p.n === 1 ? "your ship" : `stop ${p.n - 1}`} · {p.species} species ·{" "}
            {formatValue(p.valueCr / 100_000)}
          </span>
          <em>Plan stop · click for details</em>
        </>
      ) : null;
    }
    const xp = extraPoint(hover.layer, hover.id);
    if (xp) {
      return (
        <>
          <strong>{xp.p[3]}</strong>
          {xp.detail ? <span>{xp.detail}</span> : null}
          <em>{xp.meta.label} · click for details</em>
        </>
      );
    }
    if (hover.layer === "search") {
      const h = searchHits.get(hover.id);
      return h ? (
        <>
          <strong>{h.starSystem}</strong>
          <span>{h.note}</span>
          <em>Search result · click for details</em>
        </>
      ) : null;
    }
    const c = codexSystems.get(hover.id);
    return c ? (
      <>
        <strong>{c.name}</strong>
        <span>
          {c.entries.filter((x) => x.logged).length} of {c.entries.length} codex entries logged
        </span>
        <em>Click for the list</em>
      </>
    ) : null;
  })();

  const panel = (() => {
    if (!selection) return null;
    if (selection.kind === "index") return <IndexRecord ordinal={selection.ordinal} heading />;
    if (selection.kind === "sector") {
      return (
        <SectorRecord
          key={selection.key}
          sectorKey={selection.key}
          onPick={(s) => go(s, 400, { kind: "index", ordinal: s.ordinal, x: s.x, y: s.y, z: s.z })}
        />
      );
    }
    if (selection.layer === "you") return <MySystemRecord addr={selection.id} />;
    if (selection.layer === "plan") return <IndexRecord ordinal={Number(selection.id)} heading />;
    const xs = extraPoint(selection.layer, selection.id);
    if (xs) {
      return (
        <div>
          <h2 className="g3d-panel__name">{xs.p[3]}</h2>
          <p className="g3d-panel__meta">{xs.meta.label}</p>
          {xs.detail ? <p className="g3d-panel__note">{xs.detail}</p> : null}
          {xs.system ? (
            <>
              <p>
                {xs.system} <CopySystemButton system={xs.system} />
              </p>
              <p className="g3d-panel__bm">
                <SystemBookmarkButton system={xs.system} systemAddress={null} pos={{ x: xs.p[0], y: xs.p[1], z: xs.p[2] }} />
              </p>
            </>
          ) : null}
          {route?.position ? (
            <p className="dim">
              {fmtLy(dist(route.position, { x: xs.p[0], y: xs.p[1], z: xs.p[2] }))} from your ship
            </p>
          ) : null}
        </div>
      );
    }
    if (selection.layer === "search") {
      const h = searchHits.get(selection.id);
      return <IndexRecord addr={selection.id} heading fallbackName={h?.starSystem} />;
    }
    const c = codexSystems.get(selection.id);
    return c ? <CodexRecord system={c} region={codexSummary?.name ?? codexRegion ?? ""} /> : null;
  })();

  const ship = route?.position;
  const hasFind = findOpen && (findRegions.length > 0 || (find && (find.sectors.length || find.systems.length)));

  return (
    <div className="g3d-screen" ref={screenRef}>
      <div ref={host} className="g3d-canvas" />
      <div ref={labelLayer} className="g3d-labels" aria-hidden="true" />

      {hover && tip ? (
        <div className="g3d-tip" style={{ transform: `translate(${Math.round(hover.x + 16)}px, ${Math.round(hover.y - 10)}px)` }}>
          {tip}
        </div>
      ) : null}

      {selection ? (
        <aside className="g3d-panel" aria-label="Selected" data-testid="g3d-panel">
          <button type="button" className="g3d-panel__close" aria-label="Close" onClick={() => engine.current?.select(null)}>
            ✕
          </button>
          {panel}
          <div className="g3d-panel__actions">
            <button type="button" className="g3d-btn" onClick={() => engine.current?.flyTo(selection, selection.kind === "sector" ? 9_000 : 250)}>
              Centre here
            </button>
          </div>
        </aside>
      ) : null}

      {drawer === "navroute" ? (
        <aside className="g3d-drawer g3d-drawer--filter" aria-label="NavRoute" data-testid="g3d-navroute">
          <GalaxyNavRoutePanel
            onShown={setNavShown}
            onFly={(s) => engine.current?.flyTo({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }, 250)}
          />
        </aside>
      ) : null}

      {drawer === "filter" ? (
        <aside className="g3d-drawer g3d-drawer--filter" aria-label="Filter" data-testid="g3d-filter">
          <GalaxyFilterPanel value={filter} onChange={setFilter} matched={filterMatched} busy={filterBusy} />
        </aside>
      ) : null}

      {drawer === "search" ? (
        <aside className="g3d-drawer g3d-drawer--search" aria-label="Search" data-testid="g3d-search">
          <GalaxySearchPanel onApply={onApply} commanderRegionId={commanderRegionId} />
          {search ? (
            <p className="g3d-panel__note">
              {search.label}: {search.matchedSystems.toLocaleString()} systems in {search.spreadCells.toLocaleString()} sectors;
              the map shows one per sector ({search.hits.length.toLocaleString()}).
            </p>
          ) : null}
        </aside>
      ) : null}

      {drawer === "plan" ? (
        <aside className="g3d-drawer g3d-plan" aria-label="Plan" data-testid="g3d-plan">
          <div className="g3d-plan__head">
            <strong>Plan{worthM ? ` · worth ≥ ${worthM}M` : ""}</strong>
            <label className="g3d-check">
              Stops
              <select
                className="g3d-select"
                aria-label="Stops in the plan"
                value={planSize}
                onChange={(ev) => {
                  const n = Number(ev.target.value);
                  setPlanSize(n);
                  void nextTarget(skipped, { plan: n, fly: false });
                }}
              >
                {PLAN_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="g3d-panel__close" aria-label="Close the plan" onClick={() => setDrawer("none")}>
              ✕
            </button>
          </div>
          {targetBusy && !plan ? <p className="g3d-panel__note">Planning…</p> : null}
          {plan && plan.stops.length ? (
            <>
              <ol className="g3d-plan__list">
                {plan.stops.map((s, i) => (
                  <li key={s.ordinal}>
                    <button
                      type="button"
                      className="g3d-plan__stop"
                      onClick={() => go(s, 400, { kind: "index", ordinal: s.ordinal, x: s.x, y: s.y, z: s.z })}
                    >
                      <span className="g3d-plan__n">{i + 1}</span>
                      <span className="g3d-plan__name">{s.name}</span>
                      <em>
                        +{fmtLy(s.legLy)} · {s.species} sp. · {formatValue(s.valueCr / 100_000)}
                      </em>
                    </button>
                    <CopySystemButton system={s.name} />
                    <button
                      type="button"
                      className="g3d-btn g3d-plan__skip"
                      title="Skip this one; the plan is worked out again without it"
                      aria-label={`Skip ${s.name}`}
                      disabled={targetBusy}
                      onClick={() => skipStop(s.ordinal)}
                    >
                      Skip
                    </button>
                  </li>
                ))}
              </ol>
              <p className="g3d-plan__total" data-testid="g3d-plan-total">
                {plan.stops.length} stops · {fmtLy(plan.totalLy)} · {formatValue(plan.totalValueCr / 100_000)}
              </p>
              <div className="g3d-panel__actions">
                <button
                  type="button"
                  className="g3d-btn"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(plan.stops.map((s) => s.name).join("\n"))
                      .then(() => setPlanCopied(true))
                      .catch(() => setPlanCopied(false));
                  }}
                >
                  {planCopied ? "Names copied" : "Copy names"}
                </button>
                <button
                  type="button"
                  className="g3d-btn"
                  onClick={() => engine.current?.fitTo([...(target?.from ? [target.from] : []), ...plan.stops], PLAN_MARGIN)}
                >
                  Show all
                </button>
              </div>
              <p className="g3d-panel__note">
                Each stop is the nearest one to the last that is worth the floor and that you have not mapped or
                sampled{skipVisited ? " or visited" : ""}. Values at 1×; legs are straight lines, not jumps.
              </p>
            </>
          ) : target && !targetBusy ? (
            <p className="g3d-panel__note">No plan: nothing qualifies from here.</p>
          ) : null}
        </aside>
      ) : null}

      {codexOn ? (
        <aside className="g3d-drawer g3d-codex" aria-label="Codex" data-testid="g3d-codex">
          <div className="g3d-group" role="group" aria-label="Codex kind">
            {(["bio", "bodies"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={codexKind === k ? "g3d-btn g3d-btn--on" : "g3d-btn"}
                aria-pressed={codexKind === k}
                onClick={() => setCodexKind(k)}
              >
                {k === "bio" ? "Biology" : "Bodies"}
              </button>
            ))}
          </div>
          <p className="g3d-panel__note">Click a region on the map, or pick one:</p>
          <ul className="g3d-codex__regions">
            {(codexRegions?.regions ?? [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => {
                const k = r.kinds[codexKind];
                const on = codexRegion != null && r.joinKey === regionJoinKey(codexRegion);
                return (
                  <li key={r.joinKey}>
                    <button
                      type="button"
                      className={on ? "g3d-codex__region g3d-codex__region--on" : "g3d-codex__region"}
                      onClick={() => setCodexRegion(r.name)}
                    >
                      <span>{r.name}</span>
                      <span className="g3d-num">
                        {k.logged}/{k.entries}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
          {codexRegions ? <p className="g3d-panel__note">{codexRegions.source}</p> : null}
        </aside>
      ) : null}

      {target ? (
        <div className="g3d-banner g3d-banner--target" data-testid="g3d-target">
          {target.target ? (
            <>
              <span>
                Next target{worthM ? ` ≥ ${worthM}M` : ""}: <strong>{target.target.name}</strong> ·{" "}
                {fmtLy(target.target.distanceLy)} · {target.target.species} species ·{" "}
                {formatValue(target.target.valueCr / 100_000)}
                {copied ? " · name copied" : ""}
              </span>
              <CopySystemButton system={target.target.name} />
              <button type="button" className="g3d-btn" onClick={skipTarget} disabled={targetBusy}>
                Skip
              </button>
              <button
                type="button"
                className="g3d-btn"
                onClick={() => {
                  const t = target.target!;
                  go(t, 400, { kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
                }}
              >
                Show
              </button>
              {drawer !== "plan" ? (
                <button type="button" className="g3d-btn" onClick={openPlan} disabled={targetBusy} title="The next few targets, each the nearest to the last">
                  Plan {planSize}
                </button>
              ) : null}
            </>
          ) : (
            <span>
              {target.from
                ? `Nothing left${worthM ? ` worth ≥ ${worthM}M` : ""} that you have not done${skipped.length ? " (after your skips)" : ""}.`
                : "Your ship's position is not known yet — jump once and try again."}
            </span>
          )}
          <label className="g3d-check" title="Also skip systems you have been to, not only the ones you analysed">
            <input type="checkbox" checked={skipVisited} onChange={(ev) => setSkipVisited(ev.target.checked)} />
            skip visited
          </label>
          <button
            type="button"
            className="g3d-panel__close g3d-banner__close"
            aria-label="Close"
            onClick={() => {
              setTarget(null);
              setCopied(false);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {nearest && layers.you && !selection && !target ? (
        <div className="g3d-banner" data-testid="g3d-nearest">
          <span>
            Nearest waiting{waitMinM ? ` ≥ ${waitMinM}M` : ""}: <strong>{nearest.row.name}</strong> ·{" "}
            {fmtLy(nearest.ly)} · at least {crShort(nearest.row.unfinishedFloorCr)}
          </span>
          <CopySystemButton system={nearest.row.name} />
          <button
            type="button"
            className="g3d-btn"
            onClick={() =>
              go(nearest.row, 400, { kind: "marker", layer: "you", id: String(nearest.row.addr), x: nearest.row.x, y: nearest.row.y, z: nearest.row.z })
            }
          >
            Show
          </button>
        </div>
      ) : null}

      <header className="g3d-bar" ref={barRef}>
        <span className="g3d-title">Galaxy map</span>
        <div className="g3d-find">
          <input
            type="search"
            className="g3d-find__input"
            placeholder="Find a system, sector or region"
            aria-label="Find"
            value={findText}
            onChange={(ev) => {
              setFindText(ev.target.value);
              setFindOpen(true);
            }}
            onFocus={() => setFindOpen(true)}
            onKeyDown={(ev) => ev.key === "Escape" && setFindOpen(false)}
          />
          {hasFind ? (
            <ul className="g3d-find__list" role="listbox" data-testid="g3d-find">
              {findRegions.map((a) => (
                <li key={`r${a.index}`}>
                  <button type="button" onClick={() => go({ x: a.x, y: 0, z: a.z }, 40_000)}>
                    <span>{a.name}</span>
                    <em>region</em>
                  </button>
                </li>
              ))}
              {find?.sectors.map((s) => (
                <li key={`s${s.name}`}>
                  <button type="button" onClick={() => go(s, 12_000)}>
                    <span>{s.name}</span>
                    <em>sector · {formatCount(s.systems)}</em>
                  </button>
                </li>
              ))}
              {find?.systems.map((s) => (
                <li key={`y${s.addr ?? s.ordinal}`}>
                  <button
                    type="button"
                    onClick={() =>
                      go(
                        s,
                        400,
                        s.mine
                          ? { kind: "marker", layer: "you", id: s.addr!, x: s.x, y: s.y, z: s.z }
                          : { kind: "index", ordinal: s.ordinal!, x: s.x, y: s.y, z: s.z },
                      )
                    }
                  >
                    <span>{s.name}</span>
                    <em>{s.mine ? "yours" : "system"}</em>
                  </button>
                </li>
              ))}
              {find?.partial ? <li className="g3d-find__more">Type more of the name for the rest</li> : null}
            </ul>
          ) : null}
        </div>
        <div className="g3d-group" role="group" aria-label="View">
          <button type="button" className="g3d-btn" onClick={() => view("top")}>
            Top
          </button>
          <button type="button" className="g3d-btn" onClick={() => view("tilted")}>
            Tilt
          </button>
          <button type="button" className="g3d-btn" onClick={() => view("core")}>
            Core
          </button>
          <button type="button" className="g3d-btn" onClick={() => view("sol")}>
            Sol
          </button>
          <button type="button" className="g3d-btn" onClick={toShip} disabled={!ship} title={route?.system ?? "Position unknown"}>
            Me
          </button>
        </div>
        <label className="g3d-check">
          Colour
          <select
            className="g3d-select"
            aria-label="Colour by"
            value={colour}
            onChange={(ev) => setColour(Number(ev.target.value) as Colour)}
          >
            {colours.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="g3d-pop">
          <button
            type="button"
            className={layersOpen ? "g3d-btn g3d-btn--on" : "g3d-btn"}
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((v) => !v)}
          >
            Layers ▾
          </button>
          {layersOpen ? (
            <div className="g3d-pop__menu" role="group" aria-label="Layers">
              {(["you", "photo", "borders", "groups", "labels"] as const).map((k) => (
                <label key={k} className="g3d-check">
                  <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
                  {{ you: "Your systems", photo: "Milky Way photo", borders: "Region borders", groups: "Groups", labels: "Names" }[k]}
                </label>
              ))}
              {GALAXY_LAYERS.map((l) => {
                const d = extraData[l.kind];
                const missing = d != null && !d.available;
                return (
                  <label key={l.kind} className="g3d-check" title={missing ? l.needs : undefined}>
                    <input type="checkbox" checked={extraOn[l.kind]} onChange={() => extraSet[l.kind](!extraOn[l.kind])} />
                    <span
                      className="g3d-swatch"
                      style={{ background: `rgb(${l.colour.map((c) => Math.round(c * 255)).join(",")})` }}
                    />
                    {l.label}
                    {extraOn[l.kind] && d ? (
                      <span className="dim"> {missing ? `— ${l.needs.toLowerCase()}` : `(${d.points.length.toLocaleString()})`}</span>
                    ) : null}
                  </label>
                );
              })}
              <label className="g3d-slider">
                Brightness
                <input
                  type="range"
                  min={0.2}
                  max={4}
                  step={0.1}
                  value={exposure}
                  onChange={(ev) => setExposure(Number(ev.target.value))}
                />
              </label>
            </div>
          ) : null}
        </div>
        {layers.you ? (
          <label className="g3d-slider" title="Your systems still waiting, worth at least this much">
            Waiting ≥
            <input
              type="range"
              min={0}
              max={WAIT_MAX_M}
              step={1}
              value={waitMinM}
              aria-label="Waiting worth at least (million CR)"
              onChange={(ev) => setWaitMinM(Number(ev.target.value))}
            />
            {/* After the track, in a fixed width: the changing value moved the slider under the cursor
                and pushed every control to its right (tester report, 2026-09-30). */}
            <span className="g3d-slider-val g3d-slider-val--short">{waitMinM ? `${waitMinM}M` : "any"}</span>
          </label>
        ) : null}
        <label className="g3d-slider" title="Only systems whose recorded species add up to at least this (1×)">
          Worth ≥
          <input
            type="range"
            min={0}
            max={WORTH_STEPS_M.length - 1}
            step={1}
            value={worthStep}
            aria-label="Worth at least (million CR)"
            onChange={(ev) => setWorthStep(Number(ev.target.value))}
          />
          <span className="g3d-slider-val">
            {worthM ? `${worthM}M` : "any"}
            {worthCount != null && worthM ? ` (${formatCount(worthCount)})` : ""}
          </span>
        </label>
        <button
          type="button"
          className="g3d-btn g3d-btn--primary-small"
          onClick={() => void nextTarget(skipped)}
          disabled={targetBusy}
          title="The nearest system worth at least that much that you have not mapped or sampled"
        >
          {targetBusy ? "Finding…" : "Next target"}
        </button>
        <button
          type="button"
          className={drawer === "filter" || filterTicks ? "g3d-btn g3d-btn--on" : "g3d-btn"}
          aria-pressed={drawer === "filter"}
          onClick={() => openDrawer("filter")}
          title="Light the systems that have a star, a body or a plant you pick"
        >
          {filterTicks ? `Filter (${filterTicks})` : "Filter"}
        </button>
        <button
          type="button"
          className={drawer === "search" ? "g3d-btn g3d-btn--on" : "g3d-btn"}
          aria-pressed={drawer === "search"}
          onClick={() => openDrawer("search")}
        >
          Search
        </button>
        <button
          type="button"
          className={drawer === "navroute" ? "g3d-btn g3d-btn--on" : "g3d-btn"}
          aria-pressed={drawer === "navroute"}
          onClick={() => openDrawer("navroute")}
          title="Every system on the routes you plotted in the game, with its star type: filter, check EDSM, keep the ones you want"
        >
          NavRoute
        </button>
        <button
          type="button"
          className={codexOn ? "g3d-btn g3d-btn--on" : "g3d-btn"}
          aria-pressed={codexOn}
          onClick={() => openDrawer("codex")}
        >
          Codex
        </button>
        <a className="g3d-btn g3d-classic" href="?screen=map" title="The 2D sector map">
          Classic map
        </a>
      </header>

      {/* Builds leave the index out: the map offers it (plan 4.2, 2026-10-04). */}
      {stats?.phase === "failed" ? <GalaxyIndexDownload /> : null}

      <footer className="g3d-status" data-testid="g3d-status">
        {graphics.tier === "light" ? (
          <span className="g3d-badge" title={graphics.renderer}>
            Light mode — no graphics acceleration, every {stats?.stride ?? 16}th system shown from afar
          </span>
        ) : null}
        {stats?.phase === "failed" ? (
          <span className="g3d-error">
            {/HTTP 404/.test(stats.error ?? "")
              ? "No galaxy index on this PC yet — download it above."
              : `Could not load the galaxy: ${stats.error}`}
          </span>
        ) : loading ? (
          <span>Loading 5.3 million systems…</span>
        ) : (
          <span>
            {stats.overviewPoints.toLocaleString()} systems
            {stats.tilesLoaded ? ` · close-up: ${stats.tilesLoaded} sectors, ${stats.tilePoints.toLocaleString()} systems` : ""}
            {stats.level ? ` · groups of ${stats.level.toLocaleString()} ly` : ""}
            {" · "}
            {fmtLy(stats.distanceLy)} away · tilt {stats.tiltDeg}°
          </span>
        )}
        <button
          type="button"
          className="g3d-legend-toggle"
          aria-expanded={legendOn}
          onClick={() => setLegendOn(!legendOn)}
          title={legendOn ? "Hide the legend" : "Show what the colours mean"}
        >
          {legendOn ? "▾" : "▸"} Legend
        </button>
        {!legendOn ? null : codexOn ? (
          <span className="g3d-legend">
            <i className="g3d-dot g3d-dot--todo" /> nothing logged <i className="g3d-dot g3d-dot--partial" /> some{" "}
            <i className="g3d-dot g3d-dot--done" /> all
          </span>
        ) : colour === 0 ? (
          <span className="g3d-legend">
            <i className="g3d-dot g3d-dot--dss" /> mapped (DSS) <i className="g3d-dot g3d-dot--codex" /> codex logged{" "}
            <i className="g3d-dot g3d-dot--signal" /> signals only
          </span>
        ) : colour === 2 ? (
          <span className="g3d-legend">
            <i className="g3d-ramp" /> recorded value, 100k → 1bn CR
          </span>
        ) : (
          <span className="g3d-legend">
            <i className="g3d-ramp g3d-ramp--species" /> 1 → 8+ species
          </span>
        )}
        {legendOn && layers.you && mine.size ? (
          <span className="g3d-legend">
            You: <i className="g3d-dot g3d-dot--waiting" /> waiting <i className="g3d-dot g3d-dot--done" /> done{" "}
            <i className="g3d-dot g3d-dot--visited" /> visited
          </span>
        ) : null}
        {legendOn && search ? (
          <span className="g3d-legend">
            <i className="g3d-dot g3d-dot--search" /> {search.label}
          </span>
        ) : null}
        <span className="g3d-hint">Left drag pan · right drag tilt / turn · wheel zoom · click a ring or a system</span>
      </footer>
    </div>
  );
}
