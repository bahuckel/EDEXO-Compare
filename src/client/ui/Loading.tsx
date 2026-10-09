/**
 * "This is loading", for every screen that waits on the server (owner, 2026-10-09: "I prefer to have
 * a visual indicator that its loading instead of the app just attempting to crash every time I open
 * a tab").
 *
 * LoadingNote: a spinner and a line where the content will be, while there is nothing to show yet.
 * RefreshBar: a thin moving bar over content that is being replaced (another filter, another time
 * window, other boxels), so the old figures are never read as the new ones. Put `aria-busy` on the
 * content it covers; `.is-refreshing` dims it.
 */
import type { ReactNode } from "react";

export function LoadingNote({
  label = "Loading…",
  detail,
  className,
}: {
  label?: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`loading-note${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <span className="inline-spinner" aria-hidden />
      <span className="loading-note__text">
        {label}
        {detail ? <span className="loading-note__detail">{detail}</span> : null}
      </span>
    </div>
  );
}

export function RefreshBar({ active }: { active: boolean }) {
  return active ? <div className="refresh-bar" role="progressbar" aria-label="Updating" /> : null;
}
