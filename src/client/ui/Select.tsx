import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The app's one dropdown (owner, 2026-09-25: "same style for the whole app").
 *
 * There were two kinds before: native `<select>`s, whose open list is drawn by the platform and
 * cannot be themed, and the encyclopedia's own listbox, drawn in the old blue palette. The
 * encyclopedia's also stopped opening in 1b04f55: the cockpit pass gave its wrapper a `clip-path`,
 * and a clip-path cuts everything outside the box — including an absolutely-positioned menu. The
 * modal panels carry one too, so any menu that lives inside a modal can be cut.
 *
 * So the menu is portalled to `<body>` and positioned from the control's rectangle: nothing it opens
 * inside can clip it. It flips upwards when there is no room below, closes on scroll or resize
 * rather than drifting away from its control, and takes Escape before the modal does — a menu open
 * inside the encyclopedia used to close the whole encyclopedia.
 */
export type SelectOption<V extends string = string> = {
  value: V;
  label: string;
  disabled?: boolean;
};

export function Select<V extends string = string>({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  disabled,
  className,
  menuMinWidth,
}: {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  /** For a `<label htmlFor>`. */
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Pixels; the menu is never narrower than its control. */
  menuMinWidth?: number;
}) {
  const autoId = useId();
  const controlId = id ?? `sel-${autoId}`;
  const listId = `${controlId}-list`;
  const controlRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
    maxH: number;
  } | null>(null);

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const current = selectedIndex >= 0 ? options[selectedIndex]! : options[0];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (refocus) controlRef.current?.focus({ preventScroll: true });
  }, []);

  const place = useCallback(() => {
    const el = controlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(288, Math.max(120, options.length * 30 + 8));
    const up = below < Math.min(want, 180) && above > below;
    const maxH = Math.max(96, Math.min(want, up ? above : below));
    const width = Math.max(r.width, menuMinWidth ?? 0);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top: up ? r.top - 4 : r.bottom + 4, width, up, maxH });
  }, [options.length, menuMinWidth]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    place();
    setOpen(true);
  }, [disabled, place, selectedIndex]);

  const choose = useCallback(
    (i: number) => {
      const o = options[i];
      if (!o || o.disabled) return;
      if (o.value !== value) onChange(o.value);
      close(true);
    },
    [options, value, onChange, close],
  );

  // Outside click, scroll and resize close it; Escape is taken before any modal sees it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || controlRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Window, capture phase: runs before useModal's document-level handler.
        e.stopPropagation();
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // Keep the highlighted option in view while arrowing through a long list.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const el = menuRef.current?.querySelectorAll<HTMLElement>("[role=option]")[active];
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = 1; i <= options.length; i++) {
      const j = (from + dir * i + options.length) % options.length;
      if (!options[j]?.disabled) return j;
    }
    return from;
  };

  const onControlKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a < 0 ? -1 : a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a < 0 ? 0 : a, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(step(0, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={controlRef}
        id={controlId}
        type="button"
        className={`ui-select${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onControlKey}
      >
        <span className="ui-select__value">{current?.label ?? "—"}</span>
        <span className="ui-select__chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && pos
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-labelledby={controlId}
              className={`ui-select__menu${pos.up ? " is-up" : ""}`}
              style={{
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxH,
                ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
              }}
            >
              {options.map((o, i) => (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={`ui-select__opt${o.value === value ? " is-selected" : ""}${
                    i === active ? " is-active" : ""
                  }${o.disabled ? " is-disabled" : ""}`}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                >
                  <span className="ui-select__tick" aria-hidden>
                    {o.value === value ? "✓" : ""}
                  </span>
                  <span className="ui-select__label">{o.label}</span>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
