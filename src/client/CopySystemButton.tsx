/**
 * Copy a system name to the clipboard.
 *
 * The last step of every routing answer this app gives: the commander reads a name here and types it
 * into the galaxy map. One component everywhere a system name is shown (owner, 2026-09-25), because a
 * copy control that looks and confirms differently in two places reads as two different features.
 *
 * An icon right after the name, not a "[copy]" at the end of the row: the players who asked found
 * the row-end text button unintuitive — the thing to copy and the control that copies it should sit
 * together. After a click the icon turns into a tick with a "Copied" tooltip for a moment.
 *
 * Confirmation is the whole point. A clipboard write is silent, so without it there is no way to
 * tell a successful copy from a click that missed — and the commander finds out by pasting nothing
 * into the galaxy map.
 */
import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "./ui/icons";

export function CopySystemButton({
  system,
  className,
}: {
  system: string | null | undefined;
  /** Extra class for a host that needs a different size (the header's system pill). */
  className?: string;
}) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);

  const name = system?.trim() ?? "";
  if (!name || name === "—") return null;

  return (
    <button
      type="button"
      className={`sys-copy${done ? " is-done" : ""}${className ? ` ${className}` : ""}`}
      // A search dropdown closes on blur: keep focus where it is, so copying does not dismiss the list.
      onMouseDown={(ev) => ev.preventDefault()}
      // Stops propagation so copying never doubles as picking the row or the marker underneath.
      onClick={(ev) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(name).then(
          () => setDone(true),
          // A refused clipboard shows no tick: silence is recoverable, a false confirmation is not.
          () => setDone(false),
        );
      }}
      aria-label={done ? `Copied ${name}` : `Copy ${name}`}
      title={done ? "Copied" : `Copy "${name}"`}
    >
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
