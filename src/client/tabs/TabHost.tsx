/**
 * Tab view's frame (tabStore.ts): the tab strip on top, Main's content below it, and one pane per open
 * screen tab, which the header fills (TabSlot). Off, it renders the app as it always was.
 *
 * Main keeps flowing in the page as before (the window scrolls it); a screen tab's pane covers the
 * window under the strip, the way its pop-up did, so nothing inside a screen has to change.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IS_DETACHED,
  TAB_BRIDGE,
  TAB_SCREENS,
  WINDOW_KEY,
  tabStore,
  useTabState,
  type TabFront,
  type TabKind,
} from "./tabStore";
import { UI_COMMAND_EVENT } from "../useLiveSnapshot";
import type { UiCommand } from "@shared/types";

const DRAG_TYPE = "application/x-edexo-tab";
/** The dragged tab: `{ kind, from }` (from = the window key, so another window can take it). */
function readDrag(ev: { dataTransfer: DataTransfer }): { kind: TabKind; from: string } | null {
  try {
    const v = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE)) as { kind?: unknown; from?: unknown };
    return TAB_SCREENS.some((s) => s.kind === v.kind) && typeof v.from === "string"
      ? { kind: v.kind as TabKind, from: v.from }
      : null;
  } catch {
    return null;
  }
}

/** Set inside a tab's pane: the screen there is a tab, not a pop-up (ui/useModal reads it). */
export const InTabContext = createContext<TabKind | null>(null);
export const useInTab = (): TabKind | null => useContext(InTabContext);

const labelOf = (k: TabKind) => TAB_SCREENS.find((s) => s.kind === k)?.label ?? k;

/** One ref callback per tab for the app's life: a new one each render would unset and set the pane. */
const paneRefs = new Map<TabKind, (el: HTMLDivElement | null) => void>();
const paneRef = (k: TabKind) => {
  let r = paneRefs.get(k);
  if (!r) {
    r = (el) => tabStore.setPane(k, el);
    paneRefs.set(k, r);
  }
  return r;
};

/**
 * Where a screen renders: in tab view, into its tab's pane (once the pane exists); otherwise in place,
 * as the pop-up it has always been.
 */
export function TabSlot({ kind, children }: { kind: TabKind; children: ReactNode }) {
  const st = useTabState();
  if (!st.on) return <>{children}</>;
  const pane = tabStore.pane(kind);
  return pane
    ? createPortal(<InTabContext.Provider value={kind}>{children}</InTabContext.Provider>, pane)
    : null;
}

/**
 * A screen's open state and its setter: the header's own state with tab view off, the tab store with it
 * on (opening goes to the tab, closing closes it).
 */
export function useScreenOpen(kind: TabKind): [boolean, (open: boolean) => void] {
  const st = useTabState();
  const [local, setLocal] = useState(false);
  // One setter for the header's life (its menu openers are memoised once); reads the switch when called.
  const set = useCallback(
    (open: boolean) => {
      if (!tabStore.get().on) setLocal(open);
      else if (open) tabStore.open(kind);
      else tabStore.close(kind);
    },
    [kind],
  );
  return [st.on ? st.tabs.includes(kind) : local, set];
}

function TabButton({
  front,
  label,
  active,
  index,
}: {
  front: TabFront;
  label: string;
  active: boolean;
  index: number;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`tab-strip__tab${active ? " tab-strip__tab--on" : ""}${front === "main" ? " tab-strip__tab--main" : ""}`}
      draggable={front !== "main"}
      onClick={() => tabStore.activate(front)}
      onAuxClick={(ev) => {
        // Middle click closes, as in a browser.
        if (ev.button === 1 && front !== "main") tabStore.close(front);
      }}
      onDragStart={(ev) => {
        if (front === "main") return;
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: front, from: WINDOW_KEY }));
        ev.dataTransfer.effectAllowed = "move";
        TAB_BRIDGE?.dragging(true);
      }}
      onDragEnd={(ev) => {
        /*
          Dropped where nothing took it, outside this window: out into a window of its own (the desktop
          app; a browser keeps it). Dropped on another window's strip, that window took it (onDrop).
        */
        TAB_BRIDGE?.dragging(false);
        if (front === "main" || !TAB_BRIDGE || ev.dataTransfer.dropEffect !== "none") return;
        const { screenX: x, screenY: y } = ev;
        const inside =
          x >= window.screenX &&
          x <= window.screenX + window.outerWidth &&
          y >= window.screenY &&
          y <= window.screenY + window.outerHeight;
        if (!inside) tabStore.detach(front, x, y);
      }}
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes(DRAG_TYPE)) ev.preventDefault();
      }}
      onDrop={(ev) => {
        const d = readDrag(ev);
        ev.preventDefault();
        ev.stopPropagation();
        if (!d) return;
        if (d.from !== WINDOW_KEY) tabStore.receive(d.kind, d.from);
        if (d.kind !== front) tabStore.move(d.kind, Math.max(0, index));
      }}
      title={label}
    >
      <span className="tab-strip__label">{label}</span>
      {front !== "main" ? (
        <button
          type="button"
          className="tab-strip__close"
          aria-label={`Close ${label}`}
          onClick={(ev) => {
            ev.stopPropagation();
            tabStore.close(front);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** The "+" menu: every screen, the open ones marked. */
function AddMenu() {
  const st = useTabState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="tab-strip__add" ref={ref}>
      <button
        type="button"
        className="tab-strip__plus"
        aria-label="Open a screen in a tab"
        aria-expanded={open}
        title="Open a screen in a tab"
        onClick={() => setOpen(!open)}
      >
        +
      </button>
      {open ? (
        <ul className="tab-strip__menu" role="menu">
          {TAB_SCREENS.map((s) => (
            <li key={s.kind}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tabStore.open(s.kind);
                  setOpen(false);
                }}
              >
                {s.label}
                {st.tabs.includes(s.kind) ? <span className="dim"> · open</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The desktop app window draws its own title bar (electron/main.cjs, preload.cjs). */
export const CUSTOM_TITLE_BAR =
  typeof window !== "undefined" &&
  (window as unknown as { edexoElectron?: { customTitleBar?: boolean } }).edexoElectron?.customTitleBar ===
    true;

/** Tab view off in the desktop app: the title bar alone, to drag the window by. */
function TitleBar() {
  return (
    <div className="tab-strip tab-strip--title">
      <span className="tab-strip__title">ED Exo Compare</span>
      <span className="tab-strip__drag" aria-hidden="true" />
    </div>
  );
}

export function TabStrip() {
  const st = useTabState();
  return (
    <nav
      className="tab-strip"
      role="tablist"
      aria-label="Screens"
      // A tab from another window dropped anywhere on the strip moves here, at the end.
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes(DRAG_TYPE)) ev.preventDefault();
      }}
      onDrop={(ev) => {
        const d = readDrag(ev);
        ev.preventDefault();
        if (d && d.from !== WINDOW_KEY) tabStore.receive(d.kind, d.from);
      }}
    >
      {IS_DETACHED ? null : <TabButton front="main" label="Main" active={st.active === "main"} index={-1} />}
      {st.tabs.map((k, i) => (
        <TabButton key={k} front={k} label={labelOf(k)} active={st.active === k} index={i} />
      ))}
      <AddMenu />
      <span className="tab-strip__drag" aria-hidden="true" />
    </nav>
  );
}

/** The tab before or after the one in front, wrapping; Main counts in the main window. */
function stepTab(dir: -1 | 1): void {
  const s = tabStore.get();
  const order: TabFront[] = IS_DETACHED ? [...s.tabs] : ["main", ...s.tabs];
  if (order.length < 2) return;
  const i = order.indexOf(s.active);
  tabStore.activate(order[(i + dir + order.length) % order.length]!);
}

export function TabHost({ children }: { children: ReactNode }) {
  const st = useTabState();
  // Scrolling something into view leaves room for the sticky strip (tabs.css html.tab-view).
  useEffect(() => {
    document.documentElement.classList.toggle("tab-view", st.on || CUSTOM_TITLE_BAR);
    document.documentElement.classList.toggle("custom-title-bar", CUSTOM_TITLE_BAR);
  }, [st.on]);
  // Ctrl+Tab / Ctrl+Shift+Tab step through the tabs; Ctrl+W closes a screen tab.
  useEffect(() => {
    if (!st.on) return;
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.ctrlKey) return;
      const s = tabStore.get();
      if (ev.key === "Tab") {
        stepTab(ev.shiftKey ? -1 : 1);
        ev.preventDefault();
      } else if ((ev.key === "w" || ev.key === "W") && s.active !== "main") {
        tabStore.close(s.active);
        ev.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st.on]);
  /*
    Previous / next tab from inside the game (owner, 2026-10-06; Shift+F1 / Shift+F2 by default, set in
    the launcher). The desktop app sends them to a tab window with tabs to step through, the one clicked
    last when several have (2026-10-08; tabWindows.cjs):
    the app window hears them with the other key binds, a detached window straight from Electron. A
    browser tab steps the main tabs, as before.
  */
  useEffect(() => {
    if (!st.on) return;
    if (IS_DETACHED) {
      const bridge = (
        window as unknown as {
          edexoElectron?: { onUiCommand?: (cb: (cmd: UiCommand) => void) => () => void };
        }
      ).edexoElectron;
      return bridge?.onUiCommand?.((cmd) => {
        if (cmd?.cmd === "screenTab") stepTab(cmd.dir);
      });
    }
    const onCommand = (ev: Event) => {
      const cmd = (ev as CustomEvent<UiCommand>).detail;
      if (cmd?.cmd === "screenTab") stepTab(cmd.dir);
    };
    window.addEventListener(UI_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(UI_COMMAND_EVENT, onCommand);
  }, [st.on]);
  if (!st.on)
    return CUSTOM_TITLE_BAR ? (
      <>
        <TitleBar />
        {children}
      </>
    ) : (
      <>{children}</>
    );
  return (
    <>
      <TabStrip />
      {/* A detached window keeps Main mounted (it owns the screens) but never shows it. */}
      <div className="tab-pane tab-pane--main" hidden={IS_DETACHED || st.active !== "main"}>
        {children}
      </div>
      {st.tabs.map((k) => (
        <div
          key={k}
          className={`tab-pane tab-pane--screen tab-pane--${k}`}
          hidden={st.active !== k}
          ref={paneRef(k)}
        />
      ))}
    </>
  );
}
