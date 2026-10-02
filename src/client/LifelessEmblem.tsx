/**
 * The empty state for a system that is finished and has nothing in it (owner, 2026-09-28): every
 * body found, no biological signal anywhere. The sweeping radar scope stays for "not scanned yet";
 * this replaces it once the scan is complete, so the two read differently at a glance — the most
 * common screen in the app, a dead system, should say "done, nothing here" and not "still looking".
 *
 * After the owner's old art (no-exo.png, since removed): a leaf struck through inside corner brackets. On arrival
 * the radar makes one last pass and powers down, the brackets close in, the sprout draws itself and
 * a line is struck through it; then it rests with a slow glow and a faint scan line now and then.
 * Pure SVG + CSS (cockpit.css, "lifeless emblem"); reduced motion shows the final frame.
 */
const BRACKETS = ["M14 30V14h16", "M90 14h16v16", "M106 90v16H90", "M30 106H14V90"];

export function LifelessEmblem() {
  return (
    <svg className="lifeless-emblem" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="lifeless-frame">
          <rect x="14" y="14" width="92" height="92" />
        </clipPath>
      </defs>

      {/* The radar that was sweeping: one last turn, then only its rings stay, dimmed. */}
      <g className="lifeless-emblem__scope">
        <circle cx="60" cy="60" r="44" />
        <circle cx="60" cy="60" r="27" />
        <path d="M60 14v8M60 98v8M14 60h8M98 60h8" />
      </g>
      <g className="lifeless-emblem__last-sweep">
        <path d="M60 60 L60 16 A44 44 0 0 1 91.1 28.9 Z" />
      </g>

      {/*
        Corner brackets: close in from outside. The slow glow is a blurred copy whose opacity
        breathes (review F-1.9): animating the drop-shadow itself re-filtered every frame for ever.
      */}
      <g className="lifeless-emblem__brackets">
        <g className="lifeless-emblem__brackets-halo">
          {BRACKETS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {BRACKETS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* The sprout: a stem and two leaves, drawn stroke by stroke. */}
      <g className="lifeless-emblem__sprout">
        <path className="lifeless-emblem__stem" pathLength={1} d="M60 92 C60 80 59 70 60 56" />
        <path
          className="lifeless-emblem__leaf lifeless-emblem__leaf--left"
          pathLength={1}
          d="M60 70 C50 70 40 64 36 52 C47 51 57 57 60 70 Z"
        />
        <path
          className="lifeless-emblem__leaf lifeless-emblem__leaf--right"
          pathLength={1}
          d="M60 58 C62 45 72 36 86 34 C85 48 74 57 60 58 Z"
        />
        <path className="lifeless-emblem__vein" pathLength={1} d="M60 70 C52 64 44 58 38 53" />
        <path className="lifeless-emblem__vein" pathLength={1} d="M60 58 C68 50 76 42 84 36" />
        <path className="lifeless-emblem__ground" d="M44 92h32" />
      </g>

      {/* The verdict: struck through. */}
      <path className="lifeless-emblem__strike" pathLength={1} d="M30 30 L90 90" />

      {/* Resting: a faint scan line passes over the frame now and then. */}
      <g clipPath="url(#lifeless-frame)">
        <rect className="lifeless-emblem__scanline" x="14" y="14" width="92" height="3" />
      </g>
    </svg>
  );
}
