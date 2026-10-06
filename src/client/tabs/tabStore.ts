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
const LS_TABS = "edexo.tabs";

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
    if (raw && (raw.active === "main" || (isKind(raw.active) && tabs.includes(raw.active))))
      active = raw.active;
  } catch {
    /* private window, blocked storage: the defaults */
  }
  return { on, tabs, active };
}

let state: TabState = read();
const panes = new Map<TabKind, HTMLElement>();
const listeners = new Set<() => void>();

function emit(next: TabState): void {
  state = next;
  try {
    localStorage.setItem(LS_ON, next.on ? "1" : "0");
    localStorage.setItem(LS_TABS, JSON.stringify({ tabs: next.tabs, active: next.active }));
  } catch {
    /* kept for this session */
  }
  for (const l of listeners) l();
}

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
  /** Opens the screen's tab (or goes to it when it is open) and brings it to the front. */
  open(kind: TabKind): void {
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
  activate(front: TabFront): void {
    if (front === "main" || state.tabs.includes(front)) emit({ ...state, active: front });
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

/** The tab store's state, re-rendering on every change. */
export function useTabState(): TabState {
  return useSyncExternalStore(tabStore.subscribe, tabStore.get, tabStore.get);
}
