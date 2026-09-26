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

/**
 * A flag on a planet — the first-discovery backlog.
 *
 * Footfall is what the list is about, so the mark is a claim planted on a surface rather than a
 * plant or a chart: these are bodies where the flag is still there to be planted.
 */
export function IconBacklog({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.4 11.6a7.4 7.4 0 0 0 11.2 0" />
      <path d="M5.6 11.6V2.9" />
      <path d="M5.6 3.1h5.1l-1.5 2 1.5 2H5.6" />
    </svg>
  );
}

/**
 * A magnifier over a disc — searching the galaxy, not the system.
 *
 * Distinct from IconGalaxy (the sector heat map) and IconBacklog (a flag on a surface): this one is
 * about looking something up out there, so the lens leads and the galaxy is what it is over.
 */
export function IconGalaxySearch({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
      <path d="M5.1 7.6c1.3-1.9 3.4-2.6 4.9-1.5" />
    </svg>
  );
}

/**
 * Galaxy — the sector heat map.
 *
 * A disc seen edge-on with a bright centre, which is what the map's own side projection shows, so
 * the icon and the thing it opens agree.
 */
export function IconGalaxy({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <ellipse cx="8" cy="8" rx="6.2" ry="2.6" />
      <circle cx="8" cy="8" r="1.2" />
      <path d="M2.6 6.6C4 5 6 4.2 8 4.2" />
      <path d="M13.4 9.4C12 11 10 11.8 8 11.8" />
    </svg>
  );
}

/**
 * Flask over a stack — the data feeder.
 *
 * It builds the profiles the app ranks with, so the icon says "process that produces the data"
 * rather than "settings", which is where it used to be buried.
 */
export function IconFeeder({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M6.4 2.4v3.4L3.3 11a1.6 1.6 0 0 0 1.4 2.4h6.6A1.6 1.6 0 0 0 12.7 11L9.6 5.8V2.4" />
      <path d="M5.6 2.4h4.8" />
      <path d="M4.6 9.6h6.8" />
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

/** Carriers: the flat disc and central tower a Drake-Class reads as from the side. */
export function IconCarrier({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 14h18l-3 3H6z" />
      <path d="M9 14V9h6v5" />
      <path d="M12 9V4M9.5 6.5h5" />
    </svg>
  );
}

/** Statistics: three bars of different heights. */
export function IconStats({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V13M10 20V6M16 20V10M22 20H3" />
    </svg>
  );
}

/** Points of interest: a map pin over a horizon line. */
export function IconPoi({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}

/** The session log: a page with lines, the last one a check. */
export function IconSession({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 11h6M9 15h4M9 19l1.5 1.5L14 17" />
    </svg>
  );
}

/** Two offset sheets — copy to the clipboard. */
export function IconCopy({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

/** A camera — take a branded snapshot of this panel. */
export function IconCamera({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.5 5.5h2.2l1.2-1.8h4.2l1.2 1.8h2.2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
      <circle cx="8" cy="9.3" r="2.3" />
    </svg>
  );
}

/** A tick — the copy happened. */
export function IconCheck({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}
