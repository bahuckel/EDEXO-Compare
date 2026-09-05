/**
 * App-bar glyphs.
 *
 * Drawn rather than typed: the header actions used to be three full-width text buttons, and the
 * obvious replacement — Unicode symbols like ✿ ▤ ⚙ — renders as tofu wherever the chosen font
 * lacks the codepoint. These inherit `currentColor`, stay sharp at 16 px, and cost no font load.
 */

const BASE = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

/** Sprout — completed on-foot samples. */
export function IconExobiology({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M8 14V6.4" />
      <path d="M8 7.4C8 4.9 6.2 3 3.6 2.6c-.4 2.6 1.4 4.8 4.4 4.8Z" />
      <path d="M8 8.8c0-2.2 1.6-3.9 3.9-4.3.4 2.3-1.2 4.3-3.9 4.3Z" />
    </svg>
  );
}

/** Ranked bars — the system triage list, tallest first. */
export function IconTriage({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.6 13.4h10.8" />
      <path d="M4.4 13.4V4.2" />
      <path d="M8 13.4V7" />
      <path d="M11.6 13.4v-3.2" />
    </svg>
  );
}

/** Open book — the species encyclopedia. */
export function IconEncyclopedia({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M8 4.4C6.8 3.3 5.1 2.8 2.5 2.8v9c2.6 0 4.3.5 5.5 1.6" />
      <path d="M8 4.4c1.2-1.1 2.9-1.6 5.5-1.6v9c-2.6 0-4.3.5-5.5 1.6" />
      <path d="M8 4.4v9" />
    </svg>
  );
}

/** Sliders — options. */
export function IconOptions({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.6 4.6h10.8M2.6 11.4h10.8" />
      <circle cx="6" cy="4.6" r="1.7" />
      <circle cx="10.4" cy="11.4" r="1.7" />
    </svg>
  );
}

/** Chevron — the header tray toggle. Rotated by CSS when open. */
export function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M4 6.2 8 10.2l4-4" />
    </svg>
  );
}
