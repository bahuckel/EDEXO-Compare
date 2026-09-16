/**
 * Which way a panel hanging off an app-bar button should open.
 *
 * Both the cockpit menu and the alerts popover are pinned to the left edge of their button and grow
 * rightwards, which is fine until the button is near the right edge of the window — then the panel
 * runs off-screen and the entries at the bottom of it cannot be reached at all.
 *
 * The menu learned to flip; the alerts button did not, and it is further right than the menu on
 * every layout. The rule lives here rather than inline in one of them, because that is exactly how
 * the card and the rows view came to disagree about which photograph to show.
 *
 * Measured against the viewport when the panel opens rather than guessed from a breakpoint: the
 * button's position depends on how much else is in the bar, which depends on the route, the
 * commander's ship and the window width all at once.
 */
export type PopoverSide = "left" | "right";

export function measurePopoverSide(
  wrap: HTMLElement | null | undefined,
  panel: HTMLElement | null | undefined,
  /** The panel's `min-width`, for the first open when it has not been laid out yet. */
  minWidth: number,
): PopoverSide {
  if (!wrap || !panel) return "left";
  const anchor = wrap.getBoundingClientRect();
  /*
    `min-width` is the honest figure here. On the first open the panel may not have been laid out,
    and a `display: none` element measures zero — trusting that would say every side has room.
  */
  const width = Math.max(panel.getBoundingClientRect().width, panel.offsetWidth, minWidth);
  const roomRight = window.innerWidth - anchor.left;
  const roomLeft = anchor.right;
  /*
    Flip only when the right genuinely does not fit *and* the left does. A window narrower than the
    panel has no good side, and flipping there would only move which edge it escapes from.
  */
  return roomRight < width + 8 && roomLeft >= width + 8 ? "right" : "left";
}
