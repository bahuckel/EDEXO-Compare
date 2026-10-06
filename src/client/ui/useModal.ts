import { useEffect, useRef } from "react";
import { useInTab } from "../tabs/TabHost";

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

const isVisible = (el: HTMLElement) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;

/*
  The first and last focusable element that is visible, scanning in from each end (2026-09-30).

  It used to filter *every* focusable element by its size. Reading an element's size lays it out,
  and inside a card skipped by `content-visibility` that means laying the card out — so opening the
  Encyclopedia laid out all 118 cards and its focus trap alone took ~260 ms. Tab only needs the two
  ends, and opening only the first.
*/
function focusEnds(root: HTMLElement | null): { first: HTMLElement | null; last: HTMLElement | null } {
  if (!root) return { first: null, last: null };
  const all = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  let first: HTMLElement | null = null;
  for (let i = 0; i < all.length && !first; i++) if (isVisible(all[i]!)) first = all[i]!;
  let last: HTMLElement | null = null;
  for (let i = all.length - 1; i >= 0 && !last; i--) if (isVisible(all[i]!)) last = all[i]!;
  return { first, last };
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
  // In a tab (Tab view, tabs/TabHost.tsx) the screen is a page, not a dialog: no trap, no Escape, no lock.
  const inTab = useInTab() != null;

  useEffect(() => {
    if (!open || inTab) return;
    const token = Symbol("modal");
    modalStack.push(token);
    const isTopmost = () => modalStack[modalStack.length - 1] === token;
    const root = ref.current;
    const restoreFocusTo = document.activeElement as HTMLElement | null;
    if (lockScroll) lockPageScroll();
    if (autoFocus) {
      const target = focusEnds(root).first ?? root;
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
      const { first, last } = focusEnds(root);
      if (!first || !last) {
        ev.preventDefault();
        root.focus?.({ preventScroll: true });
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const outside = !current || !root.contains(current);
      // Wrap at both ends, and pull focus back in if it escaped the dialog entirely.
      if (ev.shiftKey && (current === first || outside)) {
        ev.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!ev.shiftKey && (current === last || outside)) {
        ev.preventDefault();
        first.focus({ preventScroll: true });
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
  }, [open, inTab, lockScroll, autoFocus]);

  return ref;
}
