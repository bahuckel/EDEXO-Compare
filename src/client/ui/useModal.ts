import { useEffect, useRef } from "react";

/**
 * Modal behaviour every dialog in the app should have had: Escape to close, focus moved into the
 * dialog, Tab kept inside it, focus restored to whatever opened it, and the page behind it locked
 * from scrolling.
 *
 * Before this hook there were 14 `role="dialog"` surfaces, exactly one `.focus()` call in the whole
 * client, no focus trap, no focus restore and no scroll lock — every dialog was keyboard-hostile —
 * plus 11 hand-rolled Escape listeners that each did a little of the job.
 *
 * Usage:
 *   const dialogRef = useModal(true, onClose);
 *   <div className="modal-backdrop"><div ref={dialogRef} role="dialog" aria-modal="true">…</div></div>
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Stack of open dialogs. Every instance listens on `document` in the capture phase, and listeners
 * on the same node cannot stop each other — so without this, one Escape closed a dialog *and* the
 * dialog behind it. Only the top of the stack reacts to keys.
 */
const modalStack: symbol[] = [];

/** Nested dialogs each lock the page; only the outermost restores the original overflow. */
let scrollLockDepth = 0;
let scrollLockPrevious = "";

function lockPageScroll(): void {
  if (scrollLockDepth === 0) {
    scrollLockPrevious = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockDepth += 1;
}

function unlockPageScroll(): void {
  scrollLockDepth = Math.max(0, scrollLockDepth - 1);
  if (scrollLockDepth === 0) document.body.style.overflow = scrollLockPrevious;
}

function visibleFocusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

export function useModal<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  opts?: { lockScroll?: boolean; autoFocus?: boolean },
) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const lockScroll = opts?.lockScroll !== false;
  const autoFocus = opts?.autoFocus !== false;

  useEffect(() => {
    if (!open) return;
    const token = Symbol("modal");
    modalStack.push(token);
    const isTopmost = () => modalStack[modalStack.length - 1] === token;
    const root = ref.current;
    const restoreFocusTo = document.activeElement as HTMLElement | null;
    if (lockScroll) lockPageScroll();
    if (autoFocus) {
      const target = visibleFocusables(root)[0] ?? root;
      target?.focus?.({ preventScroll: true });
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (ev.key !== "Tab" || !root) return;
      const items = visibleFocusables(root);
      if (items.length === 0) {
        ev.preventDefault();
        root.focus?.({ preventScroll: true });
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const index = current ? items.indexOf(current) : -1;
      // Wrap at both ends, and pull focus back in if it escaped the dialog entirely.
      if (ev.shiftKey && (index <= 0 || index === -1)) {
        ev.preventDefault();
        items[items.length - 1]!.focus({ preventScroll: true });
      } else if (!ev.shiftKey && (index === items.length - 1 || index === -1)) {
        ev.preventDefault();
        items[0]!.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      const at = modalStack.lastIndexOf(token);
      if (at >= 0) modalStack.splice(at, 1);
      document.removeEventListener("keydown", onKeyDown, true);
      if (lockScroll) unlockPageScroll();
      restoreFocusTo?.focus?.({ preventScroll: true });
    };
  }, [open, lockScroll, autoFocus]);

  return ref;
}
