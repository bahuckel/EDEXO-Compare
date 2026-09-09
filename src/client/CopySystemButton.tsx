/**
 * Copy a system name to the clipboard.
 *
 * The last step of every routing answer this app gives: the commander reads a name here and types it
 * into the galaxy map. It exists as its own component because the backlog panel and the sector map
 * both end in that same act, and a copy button that confirms differently in two places reads as two
 * different features.
 *
 * Confirmation is the whole point. A clipboard write is silent, so without the momentary "copied"
 * there is no way to tell a successful copy from a click that missed — and the commander finds out
 * by pasting nothing into the galaxy map.
 */
import { useEffect, useState } from "react";

export function CopySystemButton({
  system,
  className = "fdb-copy",
}: {
  system: string;
  /** The host's own button class; the behaviour is what is shared, not the styling. */
  className?: string;
}) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <button
      type="button"
      className={className}
      // Stops propagation so copying never doubles as picking the row or the marker underneath.
      onClick={(ev) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(system).then(
          () => setDone(true),
          // A refused clipboard leaves the label alone rather than claiming a copy that did not
          // happen: silence is recoverable, a false confirmation is not.
          () => setDone(false),
        );
      }}
      aria-label={`Copy ${system}`}
      title={`Copy "${system}" for the galaxy map`}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}
