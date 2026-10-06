/**
 * Tab view's frame (tabStore.ts): the tab strip on top, Main's content below it, and one pane per open
 * screen tab, which the header fills (TabSlot). Off, it renders the app as it always was.
 *
 * Main keeps flowing in the page as before (the window scrolls it); a screen tab's pane covers the
 * window under the strip, the way its pop-up did, so nothing inside a screen has to change.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TAB_SCREENS, tabStore, useTabState, type TabFront, type TabKind } from "./tabStore";

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
        ev.dataTransfer.setData("application/x-edexo-tab", front);
        ev.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes("application/x-edexo-tab")) ev.preventDefault();
      }}
      onDrop={(ev) => {
        const kind = ev.dataTransfer.getData("application/x-edexo-tab");
        if (kind && kind !== front) tabStore.move(kind as TabKind, Math.max(0, index));
        ev.preventDefault();
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

export function TabStrip() {
  const st = useTabState();
  return (
    <nav className="tab-strip" role="tablist" aria-label="Screens">
      <TabButton front="main" label="Main" active={st.active === "main"} index={-1} />
      {st.tabs.map((k, i) => (
        <TabButton key={k} front={k} label={labelOf(k)} active={st.active === k} index={i} />
      ))}
      <AddMenu />
      <span className="tab-strip__drag" aria-hidden="true" />
    </nav>
  );
}

export function TabHost({ children }: { children: ReactNode }) {
  const st = useTabState();
  // Scrolling something into view leaves room for the sticky strip (tabs.css html.tab-view).
  useEffect(() => {
    document.documentElement.classList.toggle("tab-view", st.on);
  }, [st.on]);
  // Ctrl+Tab / Ctrl+Shift+Tab step through the tabs; Ctrl+W closes a screen tab.
  useEffect(() => {
    if (!st.on) return;
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.ctrlKey) return;
      const s = tabStore.get();
      const order: TabFront[] = ["main", ...s.tabs];
      if (ev.key === "Tab") {
        const i = order.indexOf(s.active);
        tabStore.activate(order[(i + (ev.shiftKey ? -1 : 1) + order.length) % order.length]!);
        ev.preventDefault();
      } else if ((ev.key === "w" || ev.key === "W") && s.active !== "main") {
        tabStore.close(s.active);
        ev.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st.on]);
  if (!st.on) return <>{children}</>;
  return (
    <>
      <TabStrip />
      <div className="tab-pane tab-pane--main" hidden={st.active !== "main"}>
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
