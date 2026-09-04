import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BodyComputed } from "@shared/types";

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

export const BodyTabStrip = memo(function BodyTabStrip({
  sections,
  selectedBodyKey,
  onSelect,
  onOpenJump,
  bodyCount,
}: {
  sections: TabSection[];
  selectedBodyKey: string | null;
  onSelect: (bodyKey: string) => void;
  onOpenJump: () => void;
  bodyCount: number;
}) {
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
        <span className="tabs-body-heading">BODY</span>
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
                    return (
                      <button
                        key={b.state.key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        data-body-key={b.state.key}
                        className={on ? "tab on" : "tab"}
                        onClick={() => onSelect(b.state.key)}
                      >
                        {b.tabLabel}
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
