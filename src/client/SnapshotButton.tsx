/**
 * The camera on a panel (owner, 2026-09-26): click copies a branded image of the panel, Shift+click
 * saves it as a PNG. See `panelSnapshot.ts` for what the image carries.
 *
 * It finds its own panel — the nearest `section.fold` (Exo-signals, Candidate species) or the
 * dialog it sits in (the system map) — so a host only has to place it.
 */
import { useState } from "react";
import { IconCamera, IconCheck } from "./ui/icons";
import { useToast } from "./ui/feedback";
import {
  SNAPSHOT_SKIP_CLASS,
  copyOrSave,
  renderBrandedSnapshot,
  snapshotFileName,
  snapshotStamp,
} from "./panelSnapshot";

export function SnapshotButton({
  what,
  target = "section.fold, [role='dialog']",
  className,
}: {
  /** What the panel is, for the file name ("exo-signals", "candidates", "system-map"). */
  what: string;
  /** CSS selector for the element to capture, searched upward from the button. */
  target?: string;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className={`snapshot-btn ${SNAPSHOT_SKIP_CLASS}${done ? " is-done" : ""}${className ? ` ${className}` : ""}`}
      disabled={busy}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={(ev) => {
        ev.stopPropagation();
        const el = (ev.currentTarget as HTMLElement).closest(target) as HTMLElement | null;
        if (!el) return;
        const save = ev.shiftKey;
        setBusy(true);
        void (async () => {
          try {
            const stamp = snapshotStamp();
            const blob = await renderBrandedSnapshot(el, stamp);
            const how = await copyOrSave(blob, snapshotFileName(what, stamp.systemName, new Date()), save);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
            toast.success(
              how === "copied" ? "Snapshot copied — paste it anywhere." : "Snapshot saved as a PNG.",
            );
          } catch (e) {
            toast.error(e instanceof Error ? `Snapshot failed: ${e.message}` : "Snapshot failed.");
          } finally {
            setBusy(false);
          }
        })();
      }}
      aria-label="Snapshot this panel"
      title="Snapshot: copy this panel as a branded image (Shift+click saves a PNG). Options chooses what is stamped on it."
    >
      {done ? <IconCheck /> : <IconCamera />}
    </button>
  );
}
