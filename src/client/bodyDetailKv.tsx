import type { ReactNode } from "react";

/**
 * Small presentational pieces shared by the body-detail popup and the exo payout panel.
 *
 * They live apart so that <ExoPayoutRangePanel> — which renders inline in the body pane — does not
 * drag the whole quick-facts popup into the initial bundle.
 */
export function DetailCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `body-detail-card ${className}` : "body-detail-card"}>
      <h5 className="body-detail-card-title">{title}</h5>
      <div className="body-detail-card-body">{children}</div>
    </section>
  );
}

export function KvList({ children }: { children: ReactNode }) {
  return <div className="body-detail-kv-list">{children}</div>;
}

export function KvRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  if (value == null || value === "") return null;
  return (
    <div className="body-detail-kv-row" title={hint}>
      <span className="body-detail-kv-label">{label}</span>
      <span className="body-detail-kv-value">{value}</span>
    </div>
  );
}
