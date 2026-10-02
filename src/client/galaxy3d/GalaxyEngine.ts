/**
 * The 3D galaxy map's engine (G1–G2, docs/galaxy-plan-28092026.md): renderer, camera and controls,
 * the layers, picking, groups, labels, and a frame loop that only runs when something changed.
 *
 * Frame: (1) the backdrop — Milky Way photo and region borders — straight to the screen; (2) every
 * system summed additively into a half-float buffer; (3) that buffer tone-mapped and added on top;
 * (4) the group rings and the hover / selection markers, crisp, on top of everything.
 *
 * Data: the overview (every system, ~1.5 ly precision, or every 16th in light mode) is loaded once.
 * Close in, the 1,280 ly cells around the camera's target are fetched as tiles (0.02 ly) and the
 * overview hides its own points inside them through a one-texel-per-cell mask.
 *
 * Groups (G2): fixed grids — sector cubes, then 320 ly, then 80 ly — picked by camera distance, so a
 * group never jumps while zooming. Clicking a group flies into it. Inside 800 ly the systems stand on
 * their own: hover names them, click selects one (GPU picking: every tile point renders its id).
 *
 * Controls (his test, 2026-09-28): left drag pans on the galactic plane, right drag tilts (0–85°,
 * toward Sol's side from the top view) and turns, wheel/middle zooms to the cursor, Shift/Ctrl + left
 * rotates for a trackpad. Top-down with the core at the top is the start.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { TILE_ORIGIN, TILE_SIZE_LY, TILE_STEP_LY, cellKey, cellMin, maskTexel } from "../../shared/galaxyGrid";
import type { CellBounds, CellCoord } from "../../shared/galaxyGrid";
import type { RegionOutlines } from "../../shared/regionBorders";
import { readCells, readOverview, readTile, type CellList, type OverviewPoints, type Tile } from "./galaxyBinary";
import {
  compositeFragment,
  compositeVertex,
  overviewVertex,
  markerFragment,
  markerVertex,
  pickFragment,
  pickVertex,
  pointFragment,
  ringFragment,
  ringVertex,
  tileVertex,
} from "./shaders";
import {
  chooseShown,
  clustersFromTile,
  distanceToOpen,
  formatCount,
  levelForDistance,
  mergeColumns,
  type Cluster,
  type ClusterLevel,
} from "./clusters";
import type { GraphicsTier } from "./capabilities";

/** The colour scheme's accent (`--accent` on the page), for lines drawn in WebGL. */
function accentColour(): THREE.Color {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (v) return new THREE.Color(v);
  } catch {
    /* no page style (a test): the default below */
  }
  return new THREE.Color(0xff9a3c);
}

/** Sagittarius A* in three's space (the game's z flipped): what "core" frames. */
export const CORE = new THREE.Vector3(25.2, 0, -25_900);
export const SOL = new THREE.Vector3(0, 0, 0);
const TOP_HEIGHT = 110_000;
/** A ring's radius on screen, px: the same log scale as its shader (ringVertex). */
const ringRadius = (count: number) => Math.min(34, Math.max(10, 10 + 5 * Math.log10(Math.max(1, count)))) / 2;
/** Inside this, system names are shown and systems are picked one by one. */
const SYSTEM_DISTANCE = 1_600;

/** System names kept for labels and the hover card; past this the oldest are asked for again. */
const NAMES_MAX = 20_000;

export interface EngineStats {
  phase: "loading" | "ready" | "failed";
  error?: string;
  overviewPoints: number;
  stride: number;
  tilesLoaded: number;
  tilesWanted: number;
  tilePoints: number;
  frames: number;
  lastFrameMs: number;
  distanceLy: number;
  tiltDeg: number;
  level: ClusterLevel;
  groups: number;
}

export type LabelKind = "region" | "sector" | "count" | "system" | "plan";
export interface EngineLabel {
  id: string;
  kind: LabelKind;
  text: string;
  x: number;
  y: number;
  priority: number;
}

export type HoverInfo =
  | { kind: "system"; ordinal: number; name: string | null; species: number; value: number; x: number; y: number }
  | {
      kind: "group";
      level: ClusterLevel;
      count: number;
      top: number;
      name: string | null;
      x: number;
      y: number;
    }
  | { kind: "marker"; layer: string; id: string; x: number; y: number };

/** What was clicked: a galaxy-index system (by ordinal) or a marker of one of the layers. */
export type Selection =
  | { kind: "index"; ordinal: number; x: number; y: number; z: number }
  | { kind: "sector"; key: string; x: number; y: number; z: number }
  | { kind: "marker"; layer: string; id: string; x: number; y: number; z: number };

/** One dot of a marker layer; game coordinates, ly; size in CSS px. */
export interface MarkerItem {
  id: string;
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  size: number;
}

interface MarkerLayer {
  items: MarkerItem[];
  points: THREE.Points;
  /** Screen positions, refreshed when the mouse asks. */
  sx: Float32Array;
  sy: Float32Array;
  /** Higher answers the mouse first where layers overlap. */
  priority: number;
}

export interface EngineOptions {
  tier: Exclude<GraphicsTier, "none">;
  /** Where the API lives; "" for the same origin. */
  apiBase?: string;
  onStats?: (s: EngineStats) => void;
  onLabels?: (labels: EngineLabel[]) => void;
  onHover?: (h: HoverInfo | null) => void;
  onSelect?: (s: Selection | null) => void;
  /** Clicked empty space while plane-click mode is on (the Codex mode picks a region with it). */
  onPlaneClick?: (g: { x: number; z: number }) => void;
}

interface TileEntry {
  key: string;
  cell: CellCoord;
  slot: number;
  points: THREE.Points;
  pick: THREE.Points;
  count: number;
  lastUsed: number;
  positions: Int16Array;
  species: Uint8Array;
  values: Uint16Array;
  ordinals: Uint32Array;
  groups320: Cluster[];
  groups80: Cluster[];
}

interface ShownGroup extends Cluster {
  name: string | null;
  sx: number;
  sy: number;
  radius: number;
}

export class GalaxyEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private readonly backdrop = new THREE.Scene();
  private readonly points = new THREE.Scene();
  private readonly overlay = new THREE.Scene();
  private readonly pickScene = new THREE.Scene();
  private readonly composite: { scene: THREE.Scene; camera: THREE.OrthographicCamera; material: THREE.ShaderMaterial };
  private accum: THREE.WebGLRenderTarget;
  private readonly pickTarget = new THREE.WebGLRenderTarget(9, 9, { type: THREE.UnsignedByteType, depthBuffer: true });
  private readonly pickCamera = new THREE.PerspectiveCamera();
  private readonly pointUniforms = {
    uSize: { value: 5 },
    uViewH: { value: 800 },
    uIntensity: { value: 0.6 },
    uMode: { value: 0 },
    uMinValue: { value: 0 },
    uMinSize: { value: 1.5 },
  };
  /**
   * With a value floor the survivors are few, and at the brightness meant for millions they vanish
   * (≥100 M: 260 systems, invisible from afar). They get this much more light, and a bigger dot.
   */
  private floorBoost = 1;
  private readonly pickUniforms = {
    uSize: this.pointUniforms.uSize,
    uViewH: { value: 800 },
    uMinValue: this.pointUniforms.uMinValue,
  };
  /** The overview's values, kept to count what clears the value floor. */
  private overviewValues: Uint16Array | null = null;
  private readonly ringUniforms = { uPixelRatio: { value: 1 }, uBase: { value: 0 } };
  /** Marker dots shrink from afar (autoExpose sets it). */
  private readonly markerScale = { value: 1 };
  private overview: THREE.Points | null = null;
  private overviewMaterial: THREE.ShaderMaterial | null = null;
  private cells: CellList | null = null;
  private sectorNames: string[] | null = null;
  private sectorNamesAsked = false;
  private mask: THREE.DataTexture | null = null;
  private readonly tiles = new Map<string, TileEntry>();
  private readonly slots = new Map<number, TileEntry>();
  private nextSlot = 1;
  private readonly inflight = new Set<string>();
  private wanted: string[] = [];
  private photo: THREE.Mesh | null = null;
  private borders: THREE.LineSegments | null = null;
  private anchors: RegionOutlines["anchors"] = [];
  private labelsOn = true;
  private groupsOn = true;
  private groupMesh: THREE.Points | null = null;
  private groupsKey = "";
  /** Every group of the current grid (columns on the plane); only `shownGroups` get a ring. */
  private allGroups: ShownGroup[] = [];
  private shownGroups: ShownGroup[] = [];
  /** Camera signature, and when it last changed: names and rings are chosen once it settles. */
  /** The camera at the last frame (position, then target x and z), to tell whether it moved. */
  private readonly camLast = [NaN, NaN, NaN, NaN, NaN];
  private settleAt = 1;
  private lodDirty = true;
  private readonly hoverMarker: THREE.Points;
  private readonly selectMarker: THREE.Points;
  private hovered: HoverInfo | null = null;
  private readonly markerLayers = new Map<string, MarkerLayer>();
  private routeLine: THREE.Line | null = null;
  private readonly shipMarker: THREE.Points;
  private planeClickMode = false;
  private selected: Selection | null = null;
  private readonly names = new Map<number, string>();
  private namesInflight = false;
  private systemLabels: { ordinal: number; x: number; y: number; z: number; value: number; species: number }[] = [];
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromDist: number; toDist: number; t0: number; ms: number } | null =
    null;
  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private lastLod = 0;
  private down: { x: number; y: number; t: number; button: number } | null = null;
  private hoverQueued: { x: number; y: number } | null = null;
  private readonly stats: EngineStats = {
    phase: "loading",
    overviewPoints: 0,
    stride: 1,
    tilesLoaded: 0,
    tilesWanted: 0,
    tilePoints: 0,
    frames: 0,
    lastFrameMs: 0,
    distanceLy: 0,
    tiltDeg: 0,
    level: 0,
    groups: 0,
  };
  private readonly api: string;
  /** Close-up switches on inside this camera distance. */
  private readonly fineDistance: number;
  private readonly maxTiles: number;
  private readonly maxWanted: number;
  /** Most close-up systems drawn at once: software rendering pays per point (G1: 921 k near Sol, 131 ms). */
  private readonly pointBudget: number;

  constructor(
    private readonly host: HTMLElement,
    private readonly opts: EngineOptions,
  ) {
    this.api = opts.apiBase ?? "";
    const light = opts.tier === "light";
    this.fineDistance = light ? 4_000 : 14_000;
    this.maxTiles = light ? 60 : 400;
    this.maxWanted = light ? 24 : 160;
    this.pointBudget = light ? 250_000 : 6_000_000;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05040a, 1);
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera = new THREE.PerspectiveCamera(50, 1, 5, 1_000_000);
    // A hair south of overhead: the core at the top of the screen with `up` left as +y — the controls
    // orbit around `up`, and anything else made every tilt run on the wrong axis (G0).
    this.camera.position.set(CORE.x, TOP_HEIGHT, CORE.z + 1);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    const c = this.controls;
    c.target.copy(CORE);
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.rotateSpeed = 0.6;
    c.minDistance = 20;
    c.maxDistance = 400_000;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI * 0.47;
    c.update();
    c.addEventListener("change", () => this.invalidate());
    c.addEventListener("start", () => {
      this.flight = null;
      this.setHover(null);
    });

    this.accum = this.makeTarget(1, 1);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: compositeVertex,
      fragmentShader: compositeFragment,
      uniforms: { tAccum: { value: this.accum.texture }, uExposure: { value: 1.2 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    this.composite = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material };

    this.hoverMarker = this.makeMarker(22, 0);
    this.selectMarker = this.makeMarker(30, 1);
    this.shipMarker = this.makeMarker(26, 1);
    this.overlay.add(this.hoverMarker, this.selectMarker, this.shipMarker);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("webglcontextlost", this.onContextLost);
    el.addEventListener("webglcontextrestored", this.onContextRestored);

    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------------------------------- setup

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  }

  private ringMaterial(base = 0): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: { uPixelRatio: this.ringUniforms.uPixelRatio, uBase: { value: base } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** A one-point ring: the hover (thin) and selection (bright) markers. */
  private makeMarker(size: number, hot: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    geo.setAttribute("aCount", new THREE.BufferAttribute(new Float32Array([1]), 1));
    geo.setAttribute("aTop", new THREE.BufferAttribute(new Float32Array([1000]), 1));
    geo.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array([hot]), 1));
    const p = new THREE.Points(geo, this.ringMaterial(size));
    p.frustumCulled = false;
    p.visible = false;
    return p;
  }

  /** Put a marker on a point (or hide it). True when that changed what is drawn. */
  private placeMarker(m: THREE.Points, g: { x: number; y: number; z: number } | null): boolean {
    const wasVisible = m.visible;
    m.visible = !!g;
    if (!g) return wasVisible;
    const a = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (wasVisible && a.getX(0) === g.x && a.getY(0) === g.y && a.getZ(0) === -g.z) return false;
    a.setXYZ(0, g.x, g.y, -g.z);
    a.needsUpdate = true;
    return true;
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    // The window may have moved to a screen at another scaling since the last resize (plan 2.5).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.accum.setSize(size.x, size.y);
    this.pointUniforms.uViewH.value = size.y;
    this.pickUniforms.uViewH.value = h;
    this.ringUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.invalidate();
  }

  /** Load the overview and the cell list; the backdrop comes separately (setBackdrop). */
  async load(): Promise<void> {
    try {
      const stride = this.opts.tier === "light" ? 16 : 1;
      const [pts, cells] = await Promise.all([
        this.fetchBinary(`/api/galaxy/points?stride=${stride}`),
        this.fetchBinary(`/api/galaxy/cells`),
      ]);
      if (this.disposed) return;
      this.addOverview(readOverview(pts));
      this.cells = readCells(cells);
      this.mask = this.makeMask(this.cells.bounds);
      this.bindMask();
      this.stats.phase = "ready";
      this.updateLod(true);
    } catch (e) {
      this.stats.phase = "failed";
      this.stats.error = String(e instanceof Error ? e.message : e);
    }
    this.publish();
    this.invalidate();
  }

  private async fetchBinary(path: string): Promise<ArrayBuffer> {
    const r = await fetch(this.api + path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.arrayBuffer();
  }

  private pointMaterial(vertexShader: string, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader: pointFragment,
      uniforms: { ...this.pointUniforms, ...extra },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }

  private addOverview(o: OverviewPoints): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Int16BufferAttribute(o.positions, 3));
    geo.setAttribute("aTiers", new THREE.Uint8BufferAttribute(o.tiers, 1));
    geo.setAttribute("aSpecies", new THREE.Uint8BufferAttribute(o.species, 1));
    geo.setAttribute("aValue", new THREE.Uint16BufferAttribute(o.values, 1));
    this.overviewMaterial = this.pointMaterial(overviewVertex, {
      uMin: { value: new THREE.Vector3(...o.min) },
      uStep: { value: new THREE.Vector3(...o.step) },
      uMask: { value: null },
      uMaskOn: { value: 0 },
      uGridOrigin: { value: new THREE.Vector3(TILE_ORIGIN.x, TILE_ORIGIN.y, TILE_ORIGIN.z) },
      uCellSize: { value: TILE_SIZE_LY },
      uCellMin: { value: new THREE.Vector3() },
      uCellDims: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.overview = new THREE.Points(geo, this.overviewMaterial);
    this.overview.frustumCulled = false; // quantised positions: three's bounding sphere would be wrong
    this.points.add(this.overview);
    this.stats.overviewPoints = o.count;
    this.stats.stride = o.stride;
    this.overviewValues = o.values;
  }

  private makeMask(b: CellBounds): THREE.DataTexture {
    const tex = new THREE.DataTexture(
      new Uint8Array(b.dims.x * b.dims.y * b.dims.z),
      b.dims.x,
      b.dims.y * b.dims.z,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private bindMask(): void {
    if (!this.overviewMaterial || !this.mask || !this.cells) return;
    const u = this.overviewMaterial.uniforms;
    const b = this.cells.bounds;
    u.uMask!.value = this.mask;
    u.uCellMin!.value.set(b.min.cx, b.min.cy, b.min.cz);
    u.uCellDims!.value.set(b.dims.x, b.dims.y, b.dims.z);
  }

  /** The Milky Way photograph (already placed in ly) and the region outlines. */
  setBackdrop(
    photo: { url: string; x0: number; x1: number; zBottom: number; zTop: number } | null,
    outlines: RegionOutlines | null,
  ): void {
    if (photo) {
      const tex = new THREE.TextureLoader().load(photo.url, () => this.invalidate());
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(photo.x1 - photo.x0, photo.zTop - photo.zBottom),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }),
      );
      plane.rotation.x = -Math.PI / 2; // into the plane; the image's top toward the game's +z
      plane.position.set((photo.x0 + photo.x1) / 2, -1, -(photo.zTop + photo.zBottom) / 2);
      this.backdrop.add(plane);
      this.photo = plane;
    }
    if (outlines) {
      const s = outlines.segments;
      const pos = new Float32Array((s.length / 4) * 6);
      for (let i = 0, j = 0; i < s.length; i += 4, j += 6) {
        pos[j] = s[i]!;
        pos[j + 2] = -s[i + 1]!;
        pos[j + 3] = s[i + 2]!;
        pos[j + 5] = -s[i + 3]!;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.borders = new THREE.LineSegments(
        geo,
        // The scheme's accent, not a fixed orange (review O-26): read once when the borders are built.
        new THREE.LineBasicMaterial({ color: accentColour(), transparent: true, opacity: 0.22, depthTest: false }),
      );
      this.backdrop.add(this.borders);
      this.anchors = outlines.anchors;
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------- settings

  setLayer(which: "photo" | "borders" | "labels" | "groups", on: boolean): void {
    if (which === "photo" && this.photo) this.photo.visible = on;
    if (which === "borders" && this.borders) this.borders.visible = on;
    if (which === "labels") this.labelsOn = on;
    if (which === "groups") {
      this.groupsOn = on;
      this.groupsKey = "";
      this.settleAt = performance.now();
    }
    this.invalidate();
  }

  /**
   * G5: only systems worth at least this (100 k CR units, 1×) are drawn, picked, grouped and named.
   * Returns how many systems clear it (the overview's count, times its stride in light mode).
   */
  setMinValue(units: number): number {
    const u = Math.max(0, Math.floor(units));
    this.pointUniforms.uMinValue.value = u;
    this.groupsKey = "";
    this.settleAt = performance.now();
    this.invalidate();
    const v = this.overviewValues;
    if (!v) return 0;
    let n = 0;
    for (let i = 0; i < v.length; i++) if (v[i]! >= u) n++;
    this.floorBoost = u > 0 ? Math.min(25, Math.sqrt(v.length / Math.max(1, n))) : 1;
    this.pointUniforms.uMinSize.value = u > 0 ? 3.5 : 1.5;
    this.invalidate();
    return n * this.stats.stride;
  }

  setColourMode(mode: 0 | 1 | 2): void {
    this.pointUniforms.uMode.value = mode;
    this.settleAt = performance.now(); // colouring by value ranks the rings by value
    this.invalidate();
  }

  /** 0.2 – 4: how quickly dense areas saturate. */
  setExposure(v: number): void {
    this.composite.material.uniforms.uExposure!.value = v;
    this.invalidate();
  }

  view(kind: "top" | "tilted" | "core" | "sol"): void {
    this.flight = null;
    const c = this.controls;
    const target = kind === "sol" ? SOL : kind === "core" ? CORE : c.target.clone();
    if (kind === "core" || kind === "sol") {
      const d = kind === "sol" ? 6_000 : 30_000;
      c.target.copy(target);
      this.camera.position.set(target.x, d, target.z + 1);
    } else if (kind === "top") {
      this.camera.position.set(target.x, target.y + this.camera.position.distanceTo(target), target.z + 1);
    } else {
      const d = Math.max(2_000, this.camera.position.distanceTo(target));
      // From Sol's side (three +z), 60° off vertical.
      this.camera.position.set(target.x, target.y + d * 0.5, target.z + d * 0.866);
    }
    c.update();
    this.invalidate();
  }

  /** Glide to a point (game coordinates) at a distance, keeping the viewing angle. */
  flyTo(g: { x: number; y: number; z: number }, distance: number, ms = 700): void {
    const to = new THREE.Vector3(g.x, g.y, -g.z);
    this.flight = {
      from: this.controls.target.clone(),
      to,
      fromDist: this.camera.position.distanceTo(this.controls.target),
      toDist: Math.max(this.controls.minDistance, distance),
      t0: performance.now(),
      ms,
    };
    this.invalidate();
  }

  /** Stop a glide where it is (the mouse does this too: any drag or wheel). */
  cancelFlight(): void {
    this.flight = null;
  }

  private stepFlight(): boolean {
    const f = this.flight;
    if (!f) return false;
    const t = Math.min(1, (performance.now() - f.t0) / f.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const target = f.from.clone().lerp(f.to, e);
    // Distance eased on a log scale: a 30 k → 600 ly flight should not spend its time far out.
    const dist = Math.exp(Math.log(f.fromDist) + (Math.log(f.toDist) - Math.log(f.fromDist)) * e);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    if (t >= 1) this.flight = null;
    return true;
  }

  // ---------------------------------------------------------------------------------- marker layers

  /** Replace a layer's markers (G3: the commander's systems, codex dots). Empty removes it. */
  setMarkers(layer: string, items: MarkerItem[], priority = 1): void {
    const old = this.markerLayers.get(layer);
    const wasVisible = old ? old.points.visible : true;
    if (old) {
      this.overlay.remove(old.points);
      old.points.geometry.dispose();
      (old.points.material as THREE.Material).dispose();
      this.markerLayers.delete(layer);
    }
    if (items.length) {
      const n = items.length;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const size = new Float32Array(n);
      items.forEach((m, i) => {
        pos[i * 3] = m.x;
        pos[i * 3 + 1] = m.y;
        pos[i * 3 + 2] = -m.z;
        col.set(m.color, i * 3);
        size[i] = m.size;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      const points = new THREE.Points(
        geo,
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: markerVertex,
          fragmentShader: markerFragment,
          uniforms: { uPixelRatio: this.ringUniforms.uPixelRatio, uMarkerScale: this.markerScale },
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      points.frustumCulled = false;
      points.visible = wasVisible;
      points.renderOrder = priority;
      this.overlay.add(points);
      this.markerLayers.set(layer, { items, points, sx: new Float32Array(n), sy: new Float32Array(n), priority });
    }
    this.invalidate();
  }

  hasMarkerLayer(layer: string): boolean {
    return this.markerLayers.has(layer);
  }

  setMarkerLayerVisible(layer: string, on: boolean): void {
    const l = this.markerLayers.get(layer);
    if (l) l.points.visible = on;
    this.invalidate();
  }

  /** This session's jumps as a line, and the ship at its end (game coordinates). */
  setRoute(route: { x: number; y: number; z: number }[], ship: { x: number; y: number; z: number } | null): void {
    // Polled every 10 s: the same jumps and ship rebuilt the line's geometry each time (plan 2.5).
    const sig = JSON.stringify([route, ship]);
    if (sig === this.routeSig) return;
    this.routeSig = sig;
    if (this.routeLine) {
      this.overlay.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      (this.routeLine.material as THREE.Material).dispose();
      this.routeLine = null;
    }
    if (route.length > 1) {
      const pos = new Float32Array(route.length * 3);
      route.forEach((p, i) => pos.set([p.x, p.y, -p.z], i * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.routeLine = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0x5fe6ff, transparent: true, opacity: 0.8, depthTest: false }),
      );
      this.routeLine.frustumCulled = false;
      this.overlay.add(this.routeLine);
    }
    this.shipPos = ship;
    this.placeMarker(this.shipMarker, ship);
    this.invalidate();
  }
  private shipPos: { x: number; y: number; z: number } | null = null;
  private routeSig = "";

  private planLine: THREE.Line | null = null;
  private planStops: { x: number; y: number; z: number; label: string }[] = [];

  /** G5.3: the planned chain — a line from the ship through each stop, and each stop's number. */
  setPlan(stops: { x: number; y: number; z: number; label: string }[], from: { x: number; y: number; z: number } | null): void {
    if (this.planLine) {
      this.overlay.remove(this.planLine);
      this.planLine.geometry.dispose();
      (this.planLine.material as THREE.Material).dispose();
      this.planLine = null;
    }
    this.planStops = stops;
    const pts = from && stops.length ? [from, ...stops] : stops;
    if (pts.length > 1) {
      const pos = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => pos.set([p.x, p.y, -p.z], i * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.planLine = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xc9a2ff, transparent: true, opacity: 0.9, depthTest: false }),
      );
      this.planLine.frustumCulled = false;
      this.planLine.renderOrder = 4;
      this.overlay.add(this.planLine);
    }
    this.invalidate();
  }

  getShip(): { x: number; y: number; z: number } | null {
    return this.shipPos;
  }

  /** While on, a click on empty space is reported (onPlaneClick) instead of flying toward it. */
  setPlaneClickMode(on: boolean): void {
    this.planeClickMode = on;
  }

  /**
   * Frame a set of points (a codex region's dots, a plan) from above; `margin` > 1 leaves room round
   * them (the plan's drawer and panel cover both sides of the canvas).
   */
  fitTo(points: { x: number; z: number }[], margin = 1.15): void {
    if (!points.length) return;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const span = Math.max(x1 - x0, (z1 - z0) * this.camera.aspect, 400);
    const d = span / 2 / Math.tan(((this.camera.fov / 2) * Math.PI) / 180) / this.camera.aspect;
    this.flyTo({ x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 }, d * margin);
  }

  /** The marker under a screen point: highest-priority layer first, nearest inside its dot. */
  private markerAt(x: number, y: number): { layer: string; item: MarkerItem; sx: number; sy: number } | null {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new THREE.Vector3();
    const layers = [...this.markerLayers.entries()]
      .filter(([, l]) => l.points.visible)
      .sort((a, b) => b[1].priority - a[1].priority);
    for (const [name, l] of layers) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < l.items.length; i++) {
        const m = l.items[i]!;
        v.set(m.x, m.y, -m.z).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        l.sx[i] = sx;
        l.sy[i] = sy;
        const d = Math.hypot(sx - x, sy - y);
        if (d <= m.size / 2 + 4 && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best >= 0) return { layer: name, item: l.items[best]!, sx: l.sx[best]!, sy: l.sy[best]! };
    }
    return null;
  }

  select(sel: Selection | null): void {
    this.selected = sel;
    this.placeMarker(this.selectMarker, sel);
    this.opts.onSelect?.(sel);
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------ close-up

  /** Which cells should be loaded now: the ones nearest the target, while the camera is close. */
  private updateLod(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastLod < 200) return;
    this.lastLod = now;
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.stats.distanceLy = Math.round(dist);
    this.stats.tiltDeg = Math.round((this.controls.getPolarAngle() * 180) / Math.PI);
    if (!this.cells || dist > this.fineDistance) {
      this.wanted = [];
    } else {
      const t = this.controls.target;
      const gx = t.x;
      const gy = t.y;
      const gz = -t.z;
      const radius = Math.min(12_000, Math.max(1_600, dist * 1.4));
      const near: { key: string; cell: CellCoord; d: number; systems: number }[] = [];
      for (const c of this.cells.cells) {
        const m = cellMin(c);
        const dx = m.x + TILE_SIZE_LY / 2 - gx;
        const dy = m.y + TILE_SIZE_LY / 2 - gy;
        const dz = m.z + TILE_SIZE_LY / 2 - gz;
        const d = Math.sqrt(dx * dx + dy * dy * 4 + dz * dz);
        if (d < radius + TILE_SIZE_LY) near.push({ key: cellKey(c), cell: c, d, systems: c.systems });
      }
      near.sort((a, b) => a.d - b.d);
      const pick: typeof near = [];
      let budget = this.pointBudget;
      for (const n of near) {
        if (pick.length >= this.maxWanted || n.systems > budget) break;
        budget -= n.systems;
        pick.push(n);
      }
      this.wanted = pick.map((p) => p.key);
      for (const p of pick) {
        const have = this.tiles.get(p.key);
        if (have) have.lastUsed = now;
        else if (!this.inflight.has(p.key) && this.inflight.size < 6) void this.fetchTile(p.cell);
      }
    }
    this.applyTiles();
    this.stats.tilesWanted = this.wanted.length;
    const level = levelForDistance(dist);
    if (level === 1280 && !this.sectorNamesAsked) void this.loadSectorNames();
    this.publish();
  }

  private async loadSectorNames(): Promise<void> {
    this.sectorNamesAsked = true;
    try {
      const r = await fetch(`${this.api}/api/galaxy/sector-names`);
      if (r.ok) this.sectorNames = (await r.json()) as string[];
      this.groupsKey = "";
      this.settleAt = performance.now();
      this.invalidate();
    } catch {
      /* groups without names are still groups */
    }
  }

  private async fetchTile(cell: CellCoord): Promise<void> {
    const key = cellKey(cell);
    this.inflight.add(key);
    try {
      const r = await fetch(`${this.api}/api/galaxy/tile?c=${key}`);
      if (!r.ok || this.disposed) return;
      this.addTile(readTile(await r.arrayBuffer()));
    } catch {
      /* a failed tile leaves the overview showing there; the next LOD pass asks again */
    } finally {
      this.inflight.delete(key);
      if (!this.disposed) {
        this.updateLod(true);
        this.invalidate();
      }
    }
  }

  private addTile(t: Tile): void {
    const key = cellKey(t.cell);
    if (this.tiles.has(key)) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Int16BufferAttribute(t.positions, 3));
    geo.setAttribute("aTiers", new THREE.Uint8BufferAttribute(t.tiers, 1));
    geo.setAttribute("aSpecies", new THREE.Uint8BufferAttribute(t.species, 1));
    geo.setAttribute("aValue", new THREE.Uint16BufferAttribute(t.values, 1));
    const m = cellMin(t.cell);
    const cellMinLy = { value: new THREE.Vector3(m.x, m.y, m.z) };
    const mat = this.pointMaterial(tileVertex, { uCellMinLy: cellMinLy, uTileStep: { value: TILE_STEP_LY } });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    this.points.add(points);

    // Slots name a tile in the 12 bits the picking id has for it; 0 is "nothing".
    let slot = this.nextSlot;
    while (this.slots.has(slot)) slot = (slot % 4095) + 1;
    this.nextSlot = (slot % 4095) + 1;
    const pickMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pickVertex,
      fragmentShader: pickFragment,
      uniforms: {
        ...this.pickUniforms,
        uCellMinLy: cellMinLy,
        uTileStep: { value: TILE_STEP_LY },
        uSlot: { value: slot },
      },
      blending: THREE.NoBlending,
    });
    const pick = new THREE.Points(geo, pickMat);
    pick.frustumCulled = false;
    pick.visible = false;
    this.pickScene.add(pick);

    const e: TileEntry = {
      key,
      cell: t.cell,
      slot,
      points,
      pick,
      count: t.count,
      lastUsed: performance.now(),
      positions: t.positions,
      species: t.species,
      values: t.values,
      ordinals: t.ordinals,
      groups320: clustersFromTile(t.cell, t.positions, t.values, 320),
      groups80: clustersFromTile(t.cell, t.positions, t.values, 80),
    };
    this.tiles.set(key, e);
    this.slots.set(slot, e);
    this.groupsKey = "";
    this.settleAt = performance.now();
    this.evict();
  }

  /** Show the wanted tiles, hide the rest, and mark the shown ones in the overview's mask. */
  private applyTiles(): void {
    const want = new Set(this.wanted);
    const mask = this.mask;
    const b = this.cells?.bounds;
    if (mask && b) (mask.image.data as Uint8Array).fill(0);
    let loaded = 0;
    let pts = 0;
    for (const e of this.tiles.values()) {
      const on = want.has(e.key);
      if (e.points.visible !== on) this.groupsKey = "";
      e.points.visible = on;
      e.pick.visible = on;
      if (!on) continue;
      loaded++;
      pts += e.count;
      if (mask && b) {
        const t = maskTexel(b, e.cell);
        if (t) (mask.image.data as Uint8Array)[t.v * b.dims.x + t.u] = 255;
      }
    }
    if (mask) mask.needsUpdate = true;
    if (this.overviewMaterial) this.overviewMaterial.uniforms.uMaskOn!.value = loaded ? 1 : 0;
    this.stats.tilesLoaded = loaded;
    this.stats.tilePoints = pts;
  }

  private evict(): void {
    if (this.tiles.size <= this.maxTiles) return;
    const want = new Set(this.wanted);
    const old = [...this.tiles.values()].filter((e) => !want.has(e.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of old.slice(0, this.tiles.size - this.maxTiles)) {
      this.points.remove(e.points);
      this.pickScene.remove(e.pick);
      e.points.geometry.dispose();
      (e.points.material as THREE.Material).dispose();
      (e.pick.material as THREE.Material).dispose();
      this.tiles.delete(e.key);
      this.slots.delete(e.slot);
    }
  }

  // --------------------------------------------------------------------------------------- groups

  /** The groups for the current grid, rebuilt only when the grid or the loaded tiles change. */
  private updateGroups(): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const level = this.groupsOn ? levelForDistance(dist) : 0;
    const shownTiles = [...this.tiles.values()].filter((e) => e.points.visible);
    const minV = this.pointUniforms.uMinValue.value;
    const key = `${level}|${minV}|${this.sectorNames ? 1 : 0}|${shownTiles.map((e) => e.key).join(",")}`;
    if (this.stats.level !== level) {
      this.stats.level = level;
      this.publish(); // the status line names the grid
    }
    if (key === this.groupsKey) return;
    this.groupsKey = key;

    let groups: (Cluster & { name: string | null })[] = [];
    if (level === 1280 && this.cells) {
      groups = mergeColumns(
        this.cells.cells.map((c, i) => ({
          key: `${c.cx}:${c.cz}`,
          x: c.x,
          y: c.y,
          z: c.z,
          count: c.systems,
          top: c.topValue,
          name: this.sectorNames?.[i] || null,
        })),
        (g) => g.key,
      );
    } else if (level === 320 || level === 80) {
      const parts: (Cluster & { name: null })[] = [];
      for (const e of shownTiles) for (const g of level === 320 ? e.groups320 : e.groups80) parts.push({ ...g, name: null });
      groups = mergeColumns(parts, (g) => g.key);
    }
    // With a value floor, a group with nothing worth that much inside is no group worth showing.
    this.allGroups = groups.filter((g) => g.top >= minV).map((g) => ({ ...g, sx: 0, sy: 0, radius: ringRadius(g.count) }));
    this.chooseGroups();
  }

  /** Pick the rings for this view (on settle and when the groups change) and rebuild their mesh. */
  private chooseGroups(): void {
    this.projectGroups(this.allGroups);
    const max = this.stats.level === 1280 ? 44 : 56;
    this.shownGroups = chooseShown(
      this.allGroups,
      { width: this.host.clientWidth, height: this.host.clientHeight },
      this.stats.level ? max : 0,
      this.pointUniforms.uMode.value === 2,
      (g) => g.radius,
    );
    this.stats.groups = this.shownGroups.length;

    if (this.groupMesh) {
      this.overlay.remove(this.groupMesh);
      this.groupMesh.geometry.dispose();
      (this.groupMesh.material as THREE.Material).dispose();
      this.groupMesh = null;
    }
    const groups = this.shownGroups;
    if (!groups.length) return;
    const n = groups.length;
    const pos = new Float32Array(n * 3);
    const count = new Float32Array(n);
    const top = new Float32Array(n);
    groups.forEach((g, i) => {
      pos[i * 3] = g.x;
      pos[i * 3 + 1] = g.y;
      pos[i * 3 + 2] = -g.z;
      count[i] = g.count;
      top[i] = g.top;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aCount", new THREE.BufferAttribute(count, 1));
    geo.setAttribute("aTop", new THREE.BufferAttribute(top, 1));
    geo.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.groupMesh = new THREE.Points(geo, this.ringMaterial());
    this.groupMesh.frustumCulled = false;
    this.overlay.add(this.groupMesh);
  }

  /** Screen positions of groups, for choosing, labels and the mouse. */
  private projectGroups(list: ShownGroup[] = this.shownGroups): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const g of list) {
      v.set(g.x, g.y, -g.z).project(this.camera);
      const on = v.z < 1 && v.z > -1;
      g.sx = on ? ((v.x + 1) / 2) * w : -1e6;
      g.sy = on ? ((1 - v.y) / 2) * h : -1e6;
    }
  }

  private groupAt(x: number, y: number): ShownGroup | null {
    let best: ShownGroup | null = null;
    let bestD = Infinity;
    for (const g of this.shownGroups) {
      const d = Math.hypot(g.sx - x, g.sy - y);
      if (d <= g.radius + 3 && d < bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------- picking

  /** The tile system under a screen point (CSS px), or null. Renders a 9 × 9 window of ids. */
  pickSystem(x: number, y: number): { tile: TileEntry; index: number } | null {
    if (!this.slots.size) return null;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const cam = this.pickCamera;
    cam.copy(this.camera);
    cam.setViewOffset(w, h, Math.round(x) - 4, Math.round(y) - 4, 9, 9);
    cam.updateProjectionMatrix();
    const r = this.renderer;
    r.setRenderTarget(this.pickTarget);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.pickScene, cam);
    r.setRenderTarget(null);
    r.setClearColor(0x05040a, 1);
    const px = new Uint8Array(9 * 9 * 4);
    r.readRenderTargetPixels(this.pickTarget, 0, 0, 9, 9, px);
    let best: { tile: TileEntry; index: number } | null = null;
    let bestD = Infinity;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const o = (row * 9 + col) * 4;
        const id = ((px[o]! << 24) | (px[o + 1]! << 16) | (px[o + 2]! << 8) | px[o + 3]!) >>> 0;
        if (!id) continue;
        const tile = this.slots.get(id >>> 20);
        const index = id & 0xfffff;
        if (!tile || index >= tile.count) continue;
        const d = (row - 4) ** 2 + (col - 4) ** 2;
        if (d < bestD) {
          best = { tile, index };
          bestD = d;
        }
      }
    }
    return best;
  }

  private systemPosition(t: TileEntry, i: number): { x: number; y: number; z: number } {
    const m = cellMin(t.cell);
    return {
      x: m.x + (t.positions[i * 3]! + 32768) * TILE_STEP_LY,
      y: m.y + (t.positions[i * 3 + 1]! + 32768) * TILE_STEP_LY,
      z: m.z + (t.positions[i * 3 + 2]! + 32768) * TILE_STEP_LY,
    };
  }

  private setHover(h: HoverInfo | null): void {
    const same =
      (h === null && this.hovered === null) ||
      (h &&
        this.hovered &&
        h.kind === this.hovered.kind &&
        h.x === this.hovered.x &&
        h.y === this.hovered.y &&
        (h.kind !== "system" || (this.hovered.kind === "system" && h.name === this.hovered.name)));
    if (same) return;
    this.hovered = h;
    this.opts.onHover?.(h);
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.down = { x: ev.offsetX, y: ev.offsetY, t: performance.now(), button: ev.button };
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.button !== 0 || ev.button !== 0) return;
    if (Math.hypot(ev.offsetX - d.x, ev.offsetY - d.y) > 5 || performance.now() - d.t > 500) return;
    this.click(ev.offsetX, ev.offsetY);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (ev.buttons) return;
    // The loop takes it on its next frame; whether anything is drawn is up to the hover (hoverAt).
    this.hoverQueued = { x: ev.offsetX, y: ev.offsetY };
  };

  /*
    The GPU took the context back (a driver reset, a laptop switching GPUs). Without preventDefault it
    never comes back; when it does, three.js uploads everything again on the next frame — but no frame
    was asked for, so the map stayed black until the camera moved (plan 2.5, Opus 23).
  */
  private onContextLost = (ev: Event): void => {
    ev.preventDefault();
  };
  private onContextRestored = (): void => {
    this.resize();
    this.invalidate();
  };

  private onPointerLeave = (): void => {
    this.hoverQueued = null;
    this.setHover(null);
    this.placeMarker(this.hoverMarker, null);
    this.invalidate();
  };

  /** What is under the mouse: a group ring first, else a system (only when close enough to tell). */
  /**
   * A marker dot and a group ring can both be under the cursor (the commander's thousands of dots sit
   * under the Bubble's rings); the one whose centre is nearer wins, so aiming at a ring opens the ring.
   */
  private nearerOf(x: number, y: number) {
    const mk = this.markerAt(x, y);
    const g = this.groupAt(x, y);
    if (mk && g) return Math.hypot(mk.sx - x, mk.sy - y) <= Math.hypot(g.sx - x, g.sy - y) ? { mk, g: null } : { mk: null, g };
    return { mk, g };
  }

  /** What is under the mouse, told to the page; true when the hover marker moved (a frame is due). */
  private hoverAt(x: number, y: number): boolean {
    const { mk, g } = this.nearerOf(x, y);
    if (mk) {
      const moved = this.placeMarker(this.hoverMarker, mk.item);
      this.setHover({ kind: "marker", layer: mk.layer, id: mk.item.id, x: mk.sx, y: mk.sy });
      return moved;
    }
    if (g) {
      const moved = this.placeMarker(this.hoverMarker, null);
      this.setHover({ kind: "group", level: this.stats.level, count: g.count, top: g.top, name: g.name, x: g.sx, y: g.sy });
      return moved;
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    const hit = dist <= this.fineDistance ? this.pickSystem(x, y) : null;
    if (!hit) {
      const moved = this.placeMarker(this.hoverMarker, null);
      this.setHover(null);
      return moved;
    }
    const ordinal = hit.tile.ordinals[hit.index]!;
    const p = this.systemPosition(hit.tile, hit.index);
    const moved = this.placeMarker(this.hoverMarker, p);
    const name = this.names.get(ordinal) ?? null;
    if (name === null) void this.fetchNames([ordinal]);
    const v = new THREE.Vector3(p.x, p.y, -p.z).project(this.camera);
    this.setHover({
      kind: "system",
      ordinal,
      name,
      species: hit.tile.species[hit.index]!,
      value: hit.tile.values[hit.index]!,
      x: ((v.x + 1) / 2) * this.host.clientWidth,
      y: ((1 - v.y) / 2) * this.host.clientHeight,
    });
    return moved;
  }

  private click(x: number, y: number): void {
    const { mk, g } = this.nearerOf(x, y);
    if (mk) {
      const m = mk.item;
      this.select({ kind: "marker", layer: mk.layer, id: m.id, x: m.x, y: m.y, z: m.z });
      return;
    }
    if (g) {
      // A sector ring also opens its panel (its most valuable systems) while the camera flies in.
      if (this.stats.level === 1280) this.select({ kind: "sector", key: g.key, x: g.x, y: g.y, z: g.z });
      this.flyTo(g, distanceToOpen(this.stats.level));
      return;
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    const hit = dist <= this.fineDistance ? this.pickSystem(x, y) : null;
    if (hit) {
      const p = this.systemPosition(hit.tile, hit.index);
      this.select({ kind: "index", ordinal: hit.tile.ordinals[hit.index]!, ...p });
      return;
    }
    if (this.planeClickMode && this.opts.onPlaneClick) {
      const at = this.planePoint(x, y);
      if (at) this.opts.onPlaneClick({ x: at.x, z: -at.z });
      return;
    }
    // Empty space from afar: a click is a way in — glide toward that point on the galactic plane.
    if (dist > this.fineDistance) {
      const at = this.planePoint(x, y);
      if (at) this.flyTo({ x: at.x, y: 0, z: -at.z }, Math.max(3_000, dist * 0.35));
    } else if (this.selected) {
      this.select(null);
    }
  }

  /** Where a screen point meets the galactic plane, in three's space. */
  private planePoint(x: number, y: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((x / this.host.clientWidth) * 2 - 1, -(y / this.host.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  // ---------------------------------------------------------------------------------------- names

  private async fetchNames(ordinals: number[]): Promise<void> {
    const want = ordinals.filter((o) => !this.names.has(o));
    if (!want.length || this.namesInflight) return;
    this.namesInflight = true;
    try {
      const r = await fetch(`${this.api}/api/galaxy/names?i=${want.slice(0, 400).join(",")}`);
      if (r.ok) {
        const got = (await r.json()) as Record<string, string>;
        for (const [k, v] of Object.entries(got)) this.names.set(Number(k), v);
        // A long session of flying about asks for tens of thousands; the oldest go (plan 2.5).
        if (this.names.size > NAMES_MAX) {
          for (const k of this.names.keys()) {
            this.names.delete(k);
            if (this.names.size <= NAMES_MAX * 0.8) break;
          }
        }
      }
    } catch {
      /* labels wait for the next try */
    } finally {
      this.namesInflight = false;
      this.hovered = null; // let the tooltip pick up the name
      if (this.hoverQueued === null && this.lastMouse) this.hoverQueued = this.lastMouse;
      this.invalidate();
    }
  }
  private lastMouse: { x: number; y: number } | null = null;

  /**
   * Which systems get their names on screen when close: the most valuable and most varied on screen,
   * up to 40, chosen when the camera settles (a full pass over the nearby tiles is ~10 ms).
   */
  private chooseSystemLabels(): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (!this.labelsOn || dist > SYSTEM_DISTANCE) {
      this.systemLabels = [];
      return;
    }
    const vp = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = vp.elements;
    const t = this.controls.target;
    const cands: { ordinal: number; x: number; y: number; z: number; value: number; species: number; score: number }[] = [];
    for (const tile of this.tiles.values()) {
      if (!tile.points.visible) continue;
      const m = cellMin(tile.cell);
      const cx = m.x + 640;
      const cz = m.z + 640;
      if (Math.hypot(cx - t.x, cz + t.z) > dist * 3 + 1280) continue;
      for (let i = 0; i < tile.count; i++) {
        const x = m.x + (tile.positions[i * 3]! + 32768) * TILE_STEP_LY;
        const y = m.y + (tile.positions[i * 3 + 1]! + 32768) * TILE_STEP_LY;
        const z = -(m.z + (tile.positions[i * 3 + 2]! + 32768) * TILE_STEP_LY);
        const cw = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
        if (cw <= 0) continue;
        const sx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / cw;
        const sy = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / cw;
        if (sx < -0.95 || sx > 0.95 || sy < -0.9 || sy > 0.9) continue;
        const value = tile.values[i]!;
        if (value < this.pointUniforms.uMinValue.value) continue;
        const species = tile.species[i]!;
        // Valuable first, then varied, then near the middle of the screen.
        const score = Math.log1p(value) * 3 + species - Math.hypot(sx, sy) * 2;
        cands.push({ ordinal: tile.ordinals[i]!, x, y, z: -z, value, species, score });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    this.systemLabels = cands.slice(0, 40);
    void this.fetchNames(this.systemLabels.map((c) => c.ordinal));
  }

  // --------------------------------------------------------------------------------------- frames

  invalidate(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const flying = this.stepFlight();
    // Damping keeps moving after the mouse lets go; update() says whether it did.
    if (this.controls.update() || flying) this.needsRender = true;
    // Did the camera move since the last frame? Names and rings wait until it has been still ~180 ms.
    // Compared as numbers to a tenth: this runs every animation frame, idle or not, and built a string
    // of five formatted numbers each time (plan 2.5, Opus 23 + Fable 9.3).
    const p = this.camera.position;
    const t = this.controls.target;
    const c = this.camLast;
    const r = (v: number) => Math.round(v * 10);
    if (r(p.x) !== c[0] || r(p.y) !== c[1] || r(p.z) !== c[2] || r(t.x) !== c[3] || r(t.z) !== c[4]) {
      c[0] = r(p.x);
      c[1] = r(p.y);
      c[2] = r(p.z);
      c[3] = r(t.x);
      c[4] = r(t.z);
      this.settleAt = now;
      this.lodDirty = true;
      this.needsRender = true;
    }
    if (this.lodDirty && now - this.lastLod >= 200) {
      this.lodDirty = false;
      this.updateLod(true);
      this.needsRender = true;
    }
    if (this.settleAt && now - this.settleAt > 180) {
      this.settleAt = 0;
      this.groupsKey = "";
      this.updateGroups();
      this.chooseSystemLabels();
      this.needsRender = true;
    }
    const hover = this.hoverQueued;
    if (!this.needsRender && !hover) return;
    const due = this.needsRender;
    this.needsRender = false;
    this.updateGroups();
    let markerMoved = false;
    if (hover) {
      this.hoverQueued = null;
      this.lastMouse = hover;
      this.projectGroups();
      markerMoved = this.hoverAt(hover.x, hover.y);
    }
    // A mouse moving over empty space, or along one system, changes nothing on screen: no frame for
    // it (plan 2.5). The hover card itself is the page's, told through onHover.
    if (due || markerMoved) this.renderFrame();
  };

  /**
   * How bright one system is, from how far away the camera is. From afar thousands of systems land on
   * one pixel and a fixed brightness burns the Bubble and the core to white (G0, and the first G1
   * screenshots at every zoom); the number of systems per pixel grows with the distance, so brightness
   * falls with it. The photograph fades out close in, where it is only a brown blur behind the dots.
   */
  private autoExpose(): void {
    const d = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    this.pointUniforms.uIntensity.value = Math.min(0.8, 0.035 * Math.pow(110_000 / d, 0.55) * this.floorBoost);
    this.markerScale.value = d > 30_000 ? 0.45 : d > 8_000 ? 0.7 : 1;
    if (this.photo) {
      const m = this.photo.material as THREE.MeshBasicMaterial;
      m.opacity = 0.5 * Math.min(1, Math.max(0, (d - 4_000) / 30_000));
    }
  }

  /** One frame, now. Also what the benchmark times. */
  renderFrame(): void {
    const t0 = performance.now();
    const r = this.renderer;
    this.autoExpose();
    r.setRenderTarget(null);
    r.clear();
    r.render(this.backdrop, this.camera);
    r.setRenderTarget(this.accum);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.points, this.camera);
    r.setRenderTarget(null);
    r.setClearColor(0x05040a, 1);
    r.render(this.composite.scene, this.composite.camera);
    r.render(this.overlay, this.camera);
    this.stats.frames++;
    this.stats.lastFrameMs = Math.round((performance.now() - t0) * 10) / 10;
    this.projectGroups();
    this.emitLabels();
  }

  private emitLabels(): void {
    if (!this.opts.onLabels) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new THREE.Vector3();
    const out: EngineLabel[] = [];
    const onScreen = (sx: number, sy: number) => sx > -50 && sx < w + 50 && sy > -20 && sy < h + 20;
    // The plan's stop numbers: always, and before anything else (the Names toggle hides the rest).
    this.planStops.forEach((p, i) => {
      v.set(p.x, p.y, -p.z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      if (onScreen(sx, sy)) out.push({ id: `p${i}`, kind: "plan", text: p.label, x: sx + 7, y: sy - 12, priority: 2e9 - i });
    });
    if (!this.labelsOn) {
      this.opts.onLabels(out);
      return;
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    const level = this.stats.level;

    // Regions: always from afar; close in only the one you are in stays useful, and the groups speak.
    if (dist > 6_000) {
      for (const a of this.anchors) {
        v.set(a.x, 0, -a.z).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        if (a.pixels < 3000 && dist > 60_000) continue;
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        if (onScreen(sx, sy)) out.push({ id: `r${a.index}`, kind: "region", text: a.name, x: sx, y: sy, priority: 1e9 + a.pixels });
      }
    }
    // Groups: sector names (with counts) at the sector grid, counts at the finer grids.
    const byCount = [...this.shownGroups].filter((g) => onScreen(g.sx, g.sy)).sort((a, b) => b.count - a.count);
    for (const g of byCount.slice(0, level === 1280 ? 80 : 40)) {
      const text = level === 1280 && g.name ? `${g.name} · ${formatCount(g.count)}` : formatCount(g.count);
      out.push({
        id: `g${g.key}`,
        kind: level === 1280 && g.name ? "sector" : "count",
        text,
        x: g.sx,
        y: g.sy + g.radius + 9,
        priority: 1e6 + g.count,
      });
    }
    // Systems, when close.
    if (dist <= SYSTEM_DISTANCE) {
      for (const s of this.systemLabels) {
        const name = this.names.get(s.ordinal);
        if (!name) continue;
        v.set(s.x, s.y, -s.z).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        if (onScreen(sx, sy)) {
          out.push({ id: `s${s.ordinal}`, kind: "system", text: name, x: sx + 6, y: sy - 11, priority: 1e3 + s.value });
        }
      }
    }
    this.opts.onLabels(out);
  }

  /*
    To the page only when something it shows changed (plan 2.5, Opus 23): the level-of-detail pass
    publishes every 200 ms while the camera moves, and each one re-rendered the whole map component —
    for a pan, with the same distance, tilt and sectors. The frame counters are not shown.
  */
  private publishedSig = "";
  private publish(): void {
    const { frames: _f, lastFrameMs: _ms, ...shown } = this.stats;
    const sig = JSON.stringify(shown);
    if (sig === this.publishedSig) return;
    this.publishedSig = sig;
    this.opts.onStats?.({ ...this.stats });
  }

  getStats(): EngineStats {
    return { ...this.stats };
  }

  /** For tests: the screen position (CSS px) of the first shown group, and of a loaded system. */
  /** For tests: where a marker layer's first on-screen dot is (CSS px). */
  debugMarker(layer: string): { x: number; y: number; id: string } | null {
    const l = this.markerLayers.get(layer);
    if (!l || !l.points.visible) return null;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const m of l.items) {
      v.set(m.x, m.y, -m.z).project(this.camera);
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      if (v.z < 1 && sx > 120 && sx < w - 420 && sy > 120 && sy < h - 120) return { x: sx, y: sy, id: m.id };
    }
    return null;
  }

  debugTargets(): { group: { x: number; y: number } | null; system: { x: number; y: number; ordinal: number } | null } {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const g = [...this.shownGroups]
      .filter((s) => s.sx > 60 && s.sx < w - 60 && s.sy > 80 && s.sy < h - 80)
      .sort((a, b) => b.count - a.count)[0];
    let system: { x: number; y: number; ordinal: number } | null = null;
    const v = new THREE.Vector3();
    for (const t of this.tiles.values()) {
      if (!t.points.visible || system) continue;
      for (let i = 0; i < t.count && !system; i++) {
        const p = this.systemPosition(t, i);
        v.set(p.x, p.y, -p.z).project(this.camera);
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        if (v.z < 1 && sx > 200 && sx < w - 200 && sy > 150 && sy < h - 150 && !this.groupAt(sx, sy)) {
          system = { x: sx, y: sy, ordinal: t.ordinals[i]! };
        }
      }
    }
    return { group: g ? { x: g.sx, y: g.sy } : null, system };
  }

  /** Back-to-back frames with a GPU sync after each; independent of requestAnimationFrame. */
  bench(frames = 30): { avgMs: number; p95Ms: number; canvas: string } {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t = performance.now();
      this.renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      avgMs: Math.round((times.reduce((a, b) => a + b, 0) / frames) * 100) / 100,
      p95Ms: Math.round(times[Math.floor(frames * 0.95)]! * 100) / 100,
      canvas: `${size.x}x${size.y}`,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("webglcontextlost", this.onContextLost);
    el.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.controls.dispose();
    const dispose = (o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    };
    this.backdrop.traverse(dispose);
    this.points.traverse(dispose);
    this.pickScene.traverse(dispose);
    this.overlay.traverse(dispose);
    this.composite.scene.traverse(dispose);
    this.mask?.dispose();
    this.accum.dispose();
    this.pickTarget.dispose();
    this.tiles.clear();
    this.slots.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
