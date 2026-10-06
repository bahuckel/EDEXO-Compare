/**
 * Tab view (owner, 2026-10-06): "a custom title bar with tabs for Galaxy map, Boxels and the rest of the
 * menu items, instead of them being a pop-up on top of the main app". An option, on by default, in the
 * desktop app and in the browser; off, every screen opens as it always did.
 *
 * The big screens become tabs beside a pinned Main tab; one tab per screen (opening one that is open
 * goes to it). The header still owns each screen and its data — it renders it into its tab's pane
 * (TabSlot, a portal), so a tab is the same component as the pop-up, laid out to fill the pane.
 *
 * A small external store (useSyncExternalStore), remembered in localStorage: the switch, the open tabs
 * and the one in front come back after a restart.
 *
 * In the desktop app a tab can be dragged out into a window of its own and back (stage 3,
 * electron/tabWindows.cjs). Each window keeps its own tabs (`?tabwin=<key>`: a detached window, no Main
 * tab); the main process tells every window which tabs the others hold, so opening a screen that lives
 * in another window brings that window forward instead.
 */
import { useSyncExternalStore } from "react";

export type TabKind =
  | "galaxy"
  | "boxels"
  | "myExo"
  | "encyclopedia"
  | "achievements"
  | "stats"
  | "bookmarks"
  | "poi"
  | "carriers"
  | "backlog"
  | "session";

/** The screens that become tabs, in the order the "+" menu lists them. */
export const TAB_SCREENS: readonly { kind: TabKind; label: string }[] = [
  { kind: "galaxy", label: "Galaxy map" },
  { kind: "boxels", label: "Boxels" },
  { kind: "myExo", label: "My discoveries" },
  { kind: "encyclopedia", label: "Encyclopedia" },
  { kind: "achievements", label: "Achievements" },
  { kind: "stats", label: "Statistics" },
  { kind: "bookmarks", label: "Bookmarks" },
  { kind: "poi", label: "Points of interest" },
  { kind: "carriers", label: "Carriers" },
  { kind: "backlog", label: "Unfinished business" },
  { kind: "session", label: "Session log" },
];

const KINDS = new Set<string>(TAB_SCREENS.map((s) => s.kind));
const isKind = (v: unknown): v is TabKind => typeof v === "string" && KINDS.has(v);

export type TabFront = TabKind | "main";

export interface TabState {
  /** Tab view switched on (the option; default on). */
  on: boolean;
  /** Open screen tabs, left to right (Main is always first and not in this list). */
  tabs: readonly TabKind[];
  active: TabFront;
}

const LS_ON = "edexo.tabView";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
/** This window's key: "main" for the app window, else the detached window's (`?tabwin=`). */
export const WINDOW_KEY = params.get("tabwin") ?? "main";
/** A window a tab was dragged out into: no Main tab, and it closes with its last tab. */
export const IS_DETACHED = WINDOW_KEY !== "main";
const LS_TABS = IS_DETACHED ? `edexo.tabs.${WINDOW_KEY}` : "edexo.tabs";

interface TabBridge {
  report(tabs: readonly string[]): void;
  registry(): Promise<Record<string, string[]>>;
  focus(kind: string): Promise<boolean>;
  detach(req: { kind: string; x: number; y: number }): Promise<boolean>;
  moved(req: { kind: string; from: string }): void;
  windowEmpty(): void;
  on(
    cb: (
      m:
        | { type: "registry"; registry: Record<string, string[]> }
        | { type: "remove" | "activate"; kind: string },
    ) => void,
  ): () => void;
}
/** The desktop app's window bridge (electron/preload.cjs `tabs`); null in a browser. */
export const TAB_BRIDGE: TabBridge | null =
  typeof window !== "undefined"
    ? ((window as unknown as { edexoElectron?: { tabs?: TabBridge } }).edexoElectron?.tabs ?? null)
    : null;
/** Which tabs every other window holds (from the main process). */
let elsewhere: Record<string, string[]> = {};

function read(): TabState {
  let on = true;
  let tabs: TabKind[] = [];
  let active: TabFront = "main";
  try {
    const v = localStorage.getItem(LS_ON);
    if (v === "0") on = false;
    const raw = JSON.parse(localStorage.getItem(LS_TABS) ?? "null") as {
      tabs?: unknown;
      active?: unknown;
    } | null;
    if (raw && Array.isArray(raw.tabs)) tabs = [...new Set(raw.tabs.filter(isKind))];
    // A window just made for a dragged-out tab.
    const first = params.get("open");
    if (IS_DETACHED && !tabs.length && isKind(first)) {
      tabs = [first];
      active = first;
    }
    if (raw && (raw.active === "main" || (isKind(raw.active) && tabs.includes(raw.active))))
      active = raw.active;
  } catch {
    /* private window, blocked storage: the defaults */
  }
  if (IS_DETACHED && active === "main") active = tabs[0] ?? "main";
  return { on, tabs, active };
}

let state: TabState = read();
const panes = new Map<TabKind, HTMLElement>();
const listeners = new Set<() => void>();

function emit(next: TabState): void {
  const tabsChanged = next.tabs !== state.tabs;
  state = next;
  try {
    localStorage.setItem(LS_ON, next.on ? "1" : "0");
    localStorage.setItem(LS_TABS, JSON.stringify({ tabs: next.tabs, active: next.active }));
  } catch {
    /* kept for this session */
  }
  if (tabsChanged) TAB_BRIDGE?.report(next.tabs);
  // A detached window with nothing left in it closes.
  if (IS_DETACHED && !next.tabs.length) TAB_BRIDGE?.windowEmpty();
  for (const l of listeners) l();
}

/** The window holding `kind` when it is not this one. */
const heldElsewhere = (kind: TabKind): boolean =>
  Object.entries(elsewhere).some(([k, tabs]) => k !== WINDOW_KEY && tabs.includes(kind));

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const tabStore = {
  get: (): TabState => state,
  subscribe,
  setOn(on: boolean): void {
    if (on !== state.on) emit({ ...state, on, active: on ? state.active : "main" });
  },
  /**
   * Opens the screen's tab (or goes to it when it is open) and brings it to the front. One tab per screen
   * across windows: when another window holds it, that window comes forward instead.
   */
  open(kind: TabKind): void {
    if (!state.tabs.includes(kind) && TAB_BRIDGE && heldElsewhere(kind)) {
      void TAB_BRIDGE.focus(kind).then((found) => {
        if (!found) tabStore.adopt(kind);
      });
      return;
    }
    tabStore.adopt(kind);
  },
  /** Takes a tab into this window (opened here, or dropped here from another window). */
  adopt(kind: TabKind): void {
    emit({ ...state, tabs: state.tabs.includes(kind) ? state.tabs : [...state.tabs, kind], active: kind });
  },
  /** Closes the tab; the one to its left (or Main) comes to the front if it was in front. */
  close(kind: TabKind): void {
    const i = state.tabs.indexOf(kind);
    if (i < 0) return;
    const tabs = state.tabs.filter((k) => k !== kind);
    const active = state.active === kind ? (tabs[i - 1] ?? tabs[i] ?? "main") : state.active;
    emit({ ...state, tabs, active });
  },
  /** Drags a tab out of this window into a new one at the drop point (desktop app). */
  detach(kind: TabKind, x: number, y: number): void {
    void TAB_BRIDGE?.detach({ kind, x, y });
  },
  /** A tab dropped here from another window: take it, and tell the window it came from. */
  receive(kind: TabKind, from: string): void {
    if (from === WINDOW_KEY) return;
    tabStore.adopt(kind);
    TAB_BRIDGE?.moved({ kind, from });
  },
  activate(front: TabFront): void {
    if ((front === "main" && !IS_DETACHED) || (front !== "main" && state.tabs.includes(front)))
      emit({ ...state, active: front });
  },
  /** Moves a tab to a new place in the strip (drag within the strip). */
  move(kind: TabKind, toIndex: number): void {
    const tabs = state.tabs.filter((k) => k !== kind);
    if (tabs.length === state.tabs.length) return;
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, kind);
    emit({ ...state, tabs });
  },
  /** The DOM node a tab's screen is rendered into (TabHost registers them; TabSlot portals there). */
  pane: (kind: TabKind): HTMLElement | null => panes.get(kind) ?? null,
  setPane(kind: TabKind, el: HTMLElement | null): void {
    if ((panes.get(kind) ?? null) === el) return;
    if (el) panes.set(kind, el);
    else panes.delete(kind);
    // A new snapshot object, so useSyncExternalStore re-renders the TabSlot waiting for this pane.
    state = { ...state };
    for (const l of listeners) l();
  },
  /** Tests only. */
  resetForTests(next?: Partial<TabState>): void {
    panes.clear();
    state = { on: true, tabs: [], active: "main", ...next };
    for (const l of listeners) l();
  },
};

// The main process tells this window what the others hold, and hands over or takes away its tabs.
if (TAB_BRIDGE) {
  TAB_BRIDGE.on((m) => {
    if (m.type === "registry") elsewhere = m.registry;
    else if (m.type === "remove" && isKind(m.kind)) tabStore.close(m.kind);
    else if (m.type === "activate" && isKind(m.kind)) tabStore.activate(m.kind);
  });
  void TAB_BRIDGE.registry().then((r) => (elsewhere = r ?? {}));
  TAB_BRIDGE.report(state.tabs);
}

/** The tab store's state, re-rendering on every change. */
export function useTabState(): TabState {
  return useSyncExternalStore(tabStore.subscribe, tabStore.get, tabStore.get);
}
