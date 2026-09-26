import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BodyComputed, ShipProximityDTO } from "@shared/types";
import { BODY_SORT_OPTIONS, type BodySortMode } from "./bodySort";
import { fmtCrShort } from "./credits";
import { Select } from "./ui/Select";

/**
 * One tab model at every width.
 *
 * There used to be three overlapping nav modes — flat strip, orbit-group `<select>` plus a filtered
 * strip, and a whole-system `<select>` fallback — switched by a ResizeObserver that measured
 * overflow. Resizing the window visibly re-flowed the nav, the two dropdowns disagreed about what
 * "the list" was, and the fallback hid the tabs entirely.
 *
 * Now: a horizontal scroller that always shows every body, with edge fades, chevrons that appear
 * only when there is something to scroll to, and Ctrl+K to jump by name.
 */

export type TabSection = {
  key: string;
  /** Orbit-group label, or null when the whole system is one group (then no separator is drawn). */
  label: string | null;
  hostCards: BodyComputed[][];
};

const SCROLL_STEP_PX = 260;

/** "4.2 Ls", "318 Ls", "12.4k Ls" — the tab's distance in Closest; "~" when it is an orbit estimate. */
export function fmtTabDistanceLs(ls: number, estimate: boolean): string {
  const n = ls < 10 ? ls.toFixed(1) : ls < 10_000 ? String(Math.round(ls)) : `${(ls / 1000).toFixed(1)}k`;
  return `${estimate ? "~" : ""}${n} Ls`;
}

function sortTitle(mode: BodySortMode, proximity: ShipProximityDTO | null): string {
  if (mode === "system") return "Tab order: planets with their moons, as they orbit";
  if (mode === "profit")
    return "Tab order: most valuable first (×5 when a first footfall is expected). Re-sorts when a value changes, on a jump or a landing.";
  if (mode === "alpha") return "Tab order: by name";
  if (!proximity?.originLabel) return "Tab order: nearest first";
  return proximity.basis === "arrival"
    ? `Tab order: nearest to ${proximity.originLabel}, the arrival star — the game's own distances. After you land, nearest to that body.`
    : `Tab order: nearest to ${proximity.originLabel}, where the ship is — estimated from the orbits (~). Re-sorts when you land somewhere else.`;
}

export const BodyTabStrip = memo(function BodyTabStrip({
  sections,
  selectedBodyKey,
  onSelect,
  onOpenJump,
  bodyCount,
  sortMode,
  onSortChange,
  proximity,
}: {
  sections: TabSection[];
  selectedBodyKey: string | null;
  onSelect: (bodyKey: string) => void;
  onOpenJump: () => void;
  bodyCount: number;
  sortMode: BodySortMode;
  onSortChange: (mode: BodySortMode) => void;
  proximity: ShipProximityDTO | null;
}) {
  const distances = sortMode === "closest" ? (proximity?.distanceLsByBodyKey ?? null) : null;
  const estimate = proximity?.basis === "orbits";
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measureEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft < max - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measureEdges();
    // Listen natively rather than through React's onScroll: scroll does not bubble, and a missed
    // update leaves a chevron pointing at an edge that is already reached.
    el.addEventListener("scroll", measureEdges, { passive: true });
    window.addEventListener("resize", measureEdges);
    const ro = new ResizeObserver(measureEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measureEdges);
      window.removeEventListener("resize", measureEdges);
      ro.disconnect();
    };
  }, [measureEdges, sections]);

  // Keep the selected tab reachable — arrow keys, the palette and auto-select can all move it
  // outside the visible slice of the scroller.
  useEffect(() => {
    if (!selectedBodyKey) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-body-key="${CSS.escape(selectedBodyKey)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measureEdges();
  }, [selectedBodyKey, measureEdges, sections]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const target = Math.max(0, Math.min(max, el.scrollLeft + dir * SCROLL_STEP_PX));
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
    // Smooth scrolling is a no-op in some embedded webviews; make sure the button always moves.
    window.setTimeout(() => {
      if (el.scrollLeft !== target && Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
    }, 240);
  };

  /** Left/right walk the whole flattened tab order, not just the current host card. */
  const step = (dir: -1 | 1) => {
    const keys = sections.flatMap((s) => s.hostCards.flat().map((b) => b.state.key));
    if (!keys.length) return;
    const at = selectedBodyKey ? keys.indexOf(selectedBodyKey) : -1;
    const next = at < 0 ? 0 : (at + dir + keys.length) % keys.length;
    onSelect(keys[next]!);
  };

  return (
    <nav className="tabs tabs-rework" aria-label="Bodies with biological signals">
      <div className="tabs-body-rail">
        <div className="tabs-body-head" title={sortTitle(sortMode, proximity)}>
          <span className="tabs-body-heading">BODY</span>
          <Select
            className="tabs-sort"
            value={sortMode}
            options={BODY_SORT_OPTIONS}
            onChange={onSortChange}
            ariaLabel="Order of the body tabs"
            menuMinWidth={150}
          />
        </div>
        <button
          type="button"
          className={`tabs-chevron${edges.left ? "" : " tabs-chevron--idle"}`}
          onClick={() => nudge(-1)}
          tabIndex={-1}
          aria-hidden={!edges.left}
          title="Scroll body tabs left"
        >
          ‹
        </button>
        <div
          ref={scrollerRef}
          className={`tabs-strip${edges.left ? " tabs-strip--fade-l" : ""}${
            edges.right ? " tabs-strip--fade-r" : ""
          }`}
          role="tablist"
          onKeyDown={(ev) => {
            if (ev.key === "ArrowRight") {
              ev.preventDefault();
              step(1);
            } else if (ev.key === "ArrowLeft") {
              ev.preventDefault();
              step(-1);
            }
          }}
        >
          {sections.map((sec) => (
            <div key={sec.key} className="tabs-orbit-section">
              {sec.label ? <span className="tabs-orbit-label">{sec.label}</span> : null}
              {sec.hostCards.map((grp) => (
                <div
                  key={grp.map((b) => b.state.key).join("|")}
                  className="tabs-strip-host-card"
                  role="presentation"
                >
                  {grp.map((b) => {
                    const on = b.state.key === selectedBodyKey;
                    // The micro-summary (WEBUI-REDESIGN 2.4): bio count, best list price, a dot when a
                    // species here has been analysed. Enough to choose a body without opening it.
                    const bio = b.state.biologicalSignals;
                    const best = b.matches.reduce(
                      (m, x) => (x.unlikely ? m : Math.max(m, x.priceCredits ?? 0)),
                      0,
                    );
                    const done = b.matches.some((x) => x.organicAnalysisComplete === true);
                    // Derived here rather than sent down: the strip already holds the matches, and a
                    // body is worth a detour exactly when something it might grow is worth sampling.
                    const focus = !done && b.matches.some((x) => !x.unlikely && x.collectionFocus === true);
                    const dist = distances?.[b.state.key];
                    // CX: something here would be a new codex entry for this region (owner, 2026-09-26).
                    const cx = b.matches.some((x) => !x.unlikely && x.codexNew === true);
                    return (
                      <button
                        key={b.state.key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        data-body-key={b.state.key}
                        className={`tab${on ? " on" : ""}${done ? " tab--done" : ""}`}
                        onClick={() => onSelect(b.state.key)}
                        title={`${b.tabLabel}: ${bio ?? "?"} biological signal${bio === 1 ? "" : "s"}${best > 0 ? `, best candidate ${best.toLocaleString()} CR list` : ""}${done ? ", a species analysed here" : ""}${focus ? ", carries a species worth sampling" : ""}${cx ? ", a new codex entry for this region (CX)" : ""}${typeof dist === "number" ? `, ${fmtTabDistanceLs(dist, estimate)} from ${proximity?.originLabel ?? "the ship"}` : ""}`}
                      >
                        <span className="tab-label">{b.tabLabel}</span>
                        <span className="tab-meta">
                          {bio ?? "?"}
                          <small>bio</small>
                          {best > 0 ? <> · {fmtCrShort(best)}</> : null}
                          {typeof dist === "number" ? (
                            <span className="tab-dist"> · {fmtTabDistanceLs(dist, estimate)}</span>
                          ) : null}
                          {cx ? <span className="tab-cx"> · CX</span> : null}
                        </span>
                        {done ? <span className="tab-dot" aria-hidden="true" /> : null}
                        {focus ? (
                          <span className="tab-focus" aria-hidden="true">
                            ⌖
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`tabs-chevron${edges.right ? "" : " tabs-chevron--idle"}`}
          onClick={() => nudge(1)}
          tabIndex={-1}
          aria-hidden={!edges.right}
          title="Scroll body tabs right"
        >
          ›
        </button>
        <button
          type="button"
          className="tabs-jump-btn"
          onClick={onOpenJump}
          title="Jump to body by name (Ctrl+K)"
        >
          <span className="tabs-jump-icon" aria-hidden>
            ⌕
          </span>
          <span className="tabs-jump-count">{bodyCount}</span>
          <kbd className="tabs-jump-kbd">Ctrl K</kbd>
        </button>
      </div>
    </nav>
  );
});
