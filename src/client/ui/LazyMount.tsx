/**
 * Mount the children only once they come near the screen (owner, 2026-10-04, plan 3.4: the
 * Encyclopedia built every species card, charts and all, at open). Until then a placeholder of about
 * the card's height keeps the scrollbar honest; once mounted a card stays, so scrolling back is free.
 *
 * The observer's root is the nearest scrolling ancestor matching `rootSelector`, so its margin
 * reaches ahead inside that box rather than only at the window's edge. Without IntersectionObserver
 * (an old engine, a test DOM) everything mounts at once, as before.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function LazyMount({
  children,
  minHeight,
  rootSelector,
  className,
}: {
  children: ReactNode;
  /** The placeholder's height, px — about what the content will take. */
  minHeight: number;
  /** CSS selector of the scrolling ancestor to observe against. */
  rootSelector?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const root = rootSelector ? (el.closest(rootSelector) as Element | null) : null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { root, rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootSelector]);
  if (shown) return <>{children}</>;
  return <div ref={ref} className={className} style={{ minHeight }} aria-hidden />;
}
