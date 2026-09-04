import { useEffect, useRef, useState } from "react";

/**
 * Returns a class name for one animation cycle whenever `value` changes.
 *
 * Live numbers — credits, scan counts, jumps remaining — used to swap silently, so the only
 * evidence the app was still receiving journal events was the "Live · 3s ago" pill. A brief
 * highlight makes an incoming event visible where the user is already looking.
 *
 * The first value is never flashed (that is the page loading, not an event).
 */
export function useValueFlash(value: unknown, className = "value-flash"): string {
  const previous = useRef<unknown>(value);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setFlashing(true);
    const t = window.setTimeout(() => setFlashing(false), 900);
    return () => window.clearTimeout(t);
  }, [value]);

  return flashing ? className : "";
}
