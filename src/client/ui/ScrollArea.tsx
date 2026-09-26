import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A scrolling box that says when it is hiding something (owner, 2026-09-25: My discoveries is a
 * fixed size now, "with an indicator to the right to show if there is hidden data — subtle").
 *
 * A fixed window means long lists and wide tables scroll inside it, and a thin scrollbar is easy to
 * miss. So the box fades its right edge while columns run off to the right, and shows a small
 * "more" mark at the bottom right while rows run off below. Both go away at the end.
 */
export function ScrollArea({
  className,
  children,
  resetKey,
}: {
  className?: string;
  children: ReactNode;
  /** Change it to scroll back to the top (a new tab, a new search). */
  resetKey?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ down: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.down === down && m.right === right ? m : { down, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    measure();
  }, [resetKey, measure]);

  // Content changes size without a resize (rows filtered away): check again after each render.
  useEffect(() => {
    measure();
  });

  return (
    <div
      className={`scroll-area${more.down ? " scroll-area--more-down" : ""}${more.right ? " scroll-area--more-right" : ""}`}
    >
      <div ref={ref} className={`scroll-area__viewport${className ? ` ${className}` : ""}`}>
        {children}
      </div>
      {more.right ? <span className="scroll-area__fade-right" aria-hidden /> : null}
      {more.down ? (
        <span className="scroll-area__more" aria-hidden title="More below — scroll">
          ▾ more
        </span>
      ) : null}
    </div>
  );
}
