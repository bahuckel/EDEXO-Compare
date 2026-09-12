/**
 * Modals opened from more than one place: encyclopedia, unfinished business, habitat match (7.3).
 */
import { SkeletonPanel } from "./ui/Skeleton";
import { lazy } from "react";

export const EncyclopediaModal = lazy(() =>
  import("./EncyclopediaModal").then((m) => ({ default: m.EncyclopediaModal })),
);

export const ExomasteryHabitatMatchModal = lazy(() =>
  import("./exomasteryHabitatMatchModal").then((m) => ({ default: m.ExomasteryHabitatMatchModal })),
);

export const FirstDiscoveryBacklogModal = lazy(() =>
  import("./FirstDiscoveryBacklogModal").then((m) => ({ default: m.FirstDiscoveryBacklogModal })),
);

export function InlineSpinner({ className }: { className?: string }) {
  return <span className={`inline-spinner${className ? ` ${className}` : ""}`} aria-hidden />;
}

/** Shown while a lazily-loaded modal chunk is fetched; the chunks are small and local. */
export function ModalLoading() {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel modal-panel--loading">
        <SkeletonPanel label="Loading panel" />
      </div>
    </div>
  );
}
