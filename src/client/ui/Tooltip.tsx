import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Styled tooltip and info popover, replacing native `title` attributes.
 *
 * The app carried 96 `title` attributes, including a ~700-character paragraph explaining how
 * exobiology payouts are valued. Native tooltips wait ~500 ms, cannot be styled or wrapped, get
 * truncated by the OS, vanish on the smallest pointer move, and never appear for keyboard or touch
 * users — so the longest and most useful text in the app was also the least reachable.
 *
 *   <Tooltip text="…">          hover/focus, 80 ms, for short labels
 *   <InfoPopover title="…">     click an ⓘ, stays open, for long-form help
 */

const OPEN_DELAY_MS = 80;
const EDGE_PADDING = 8;

type Placement = { left: number; top: number };

function anchorPlacement(anchor: DOMRect, floating: DOMRect): Placement {
  // Prefer above; flip below when there is no room, then clamp inside the viewport.
  const preferAbove = anchor.top > floating.height + EDGE_PADDING;
  const top = preferAbove ? anchor.top - floating.height - 6 : anchor.bottom + 6;
  const rawLeft = anchor.left + anchor.width / 2 - floating.width / 2;
  const maxLeft = window.innerWidth - floating.width - EDGE_PADDING;
  return {
    left: Math.max(EDGE_PADDING, Math.min(rawLeft, Math.max(EDGE_PADDING, maxLeft))),
    top: Math.max(EDGE_PADDING, Math.min(top, window.innerHeight - floating.height - EDGE_PADDING)),
  };
}

export function Tooltip({
  text,
  children,
  className,
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Placement | null>(null);

  const show = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const anchor = wrapRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (anchor && bubble) setPos(anchorPlacement(anchor, bubble));
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide]);

  return (
    <span
      ref={wrapRef}
      className={className ? `tip-anchor ${className}` : "tip-anchor"}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              id={id}
              role="tooltip"
              className="tip-bubble"
              style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/**
 * Long-form help behind an explicit ⓘ button: discoverable, dismissable, readable, and reachable
 * by keyboard — none of which a `title` attribute manages.
 */
export function InfoPopover({
  title,
  children,
  label = "More information",
  className,
}: {
  title: string;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Placement | null>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = wrapRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (anchor && panel) setPos(anchorPlacement(anchor, panel));
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (!panelRef.current?.contains(t) && !wrapRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className={className ? `info-anchor ${className}` : "info-anchor"}>
      <button
        type="button"
        className={open ? "info-affordance info-affordance--on" : "info-affordance"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⓘ
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={title}
              className="info-panel"
              style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="info-panel-head">
                <h4 className="info-panel-title">{title}</h4>
                <button
                  type="button"
                  className="info-panel-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="info-panel-body">{children}</div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
