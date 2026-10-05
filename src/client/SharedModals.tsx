/**
 * Modals opened from more than one place: encyclopedia, unfinished business, habitat match (7.3).
 */
import { SkeletonPanel } from "./ui/Skeleton";
import { lazy, useState, type ComponentType } from "react";

/*
  A lazy modal that opens at once when its code is already here (UI review P8, 2026-09-29).

  A plain `React.lazy` component suspends on its first render even when its chunk was fetched long
  ago, and React then holds the Suspense fallback for about 300 ms before revealing the content —
  which is why every lazy panel took ~330 ms to open and the eager ones ~25 ms. Once the chunk has
  loaded, this renders the component directly. Which one a mounted modal uses is fixed when it
  mounts, so a panel opened before its chunk arrived is never swapped (and reset) underneath.
  `preload` fetches the chunk; `prefetchMenuModals` does it for every panel once the page is idle.
*/
function lazyModal<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  const fetchIt = () =>
    load().then((c) => {
      loaded = c;
      return c;
    });
  const Lazy = lazy(() => fetchIt().then((c) => ({ default: c }))) as unknown as ComponentType<P>;
  function Modal(props: P) {
    const [C] = useState(() => loaded ?? Lazy);
    return <C {...props} />;
  }
  return Object.assign(Modal, { preload: () => void fetchIt().catch(() => {}) });
}

export const EncyclopediaModal = lazyModal(() => import("./EncyclopediaModal").then((m) => m.EncyclopediaModal));

export const ExomasteryHabitatMatchModal = lazyModal(() =>
  import("./exomasteryHabitatMatchModal").then((m) => m.ExomasteryHabitatMatchModal),
);

export const FirstDiscoveryBacklogModal = lazyModal(() =>
  import("./FirstDiscoveryBacklogModal").then((m) => m.FirstDiscoveryBacklogModal),
);

export const CarriersModal = lazyModal(() => import("./CarriersModal").then((m) => m.CarriersModal));

export const PoiModal = lazyModal(() => import("./PoiModal").then((m) => m.PoiModal));

export const BookmarksModal = lazyModal(() => import("./Bookmarks").then((m) => m.BookmarksModal));

export const BoxelScreen = lazyModal(() => import("./Boxel").then((m) => m.BoxelScreen));

export const StatisticsModal = lazyModal(() => import("./StatisticsModal").then((m) => m.StatisticsModal));

/* Achievements and Options were in the main bundle though only the menu opens them (P8). */
export const AchievementsModal = lazyModal(() => import("./AchievementsModal").then((m) => m.AchievementsModal));

export const MapOptionsModal = lazyModal(() => import("./OptionsModal").then((m) => m.MapOptionsModal));

/*
  The header's other four (plan 2.6, Fable 9.2): imported eagerly through a barrel, they carried My
  discoveries' tables and the green gas giant catalogue into the main bundle.
*/
export const MyExobiologyModal = lazyModal(() => import("./MyExobiologyModal").then((m) => m.MyExobiologyModal));

export const DataValueBreakdownModal = lazyModal(() =>
  import("./DataValueBreakdownModal").then((m) => m.DataValueBreakdownModal),
);

export const SessionLogModal = lazyModal(() => import("./SessionLogModal").then((m) => m.SessionLogModal));

export const FeederModal = lazyModal(() => import("./FeederModal").then((m) => m.FeederModal));

/** Fetch every panel's chunk in the background once the page has settled (~130 kB, all local). */
export function prefetchMenuModals(): void {
  const go = () => {
    for (const m of [
      BookmarksModal,
      BoxelScreen,
      StatisticsModal,
      EncyclopediaModal,
      FirstDiscoveryBacklogModal,
      CarriersModal,
      PoiModal,
      AchievementsModal,
      MapOptionsModal,
      ExomasteryHabitatMatchModal,
      MyExobiologyModal,
      DataValueBreakdownModal,
      SessionLogModal,
    ]) {
      m.preload();
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 3000 }) : go()), 1500);
}

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
