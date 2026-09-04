/**
 * Loading placeholders shaped like the content they stand in for.
 *
 * The encyclopedia previously showed a bare "Loading species…" line while it fetched 108 rows, and
 * a lazily-loaded modal chunk showed "Loading…" — both read as "nothing is happening" rather than
 * "this is arriving". A shaped skeleton also stops the layout jumping when the real rows land.
 */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton-block skeleton-thumb" />
          <div className="skeleton-lines">
            <div className="skeleton-block skeleton-line skeleton-line--title" />
            <div className="skeleton-block skeleton-line skeleton-line--wide" />
            <div className="skeleton-block skeleton-line skeleton-line--mid" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Announced to assistive tech; the shapes themselves are decorative. */
export function SkeletonPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-live="polite" aria-label={label}>
      <div className="skeleton-block skeleton-line skeleton-line--title" />
      <div className="skeleton-block skeleton-line skeleton-line--wide" />
      <div className="skeleton-block skeleton-line skeleton-line--mid" />
    </div>
  );
}
