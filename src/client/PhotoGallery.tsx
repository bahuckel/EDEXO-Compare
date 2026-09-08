/**
 * The opened photo, with the rest of that species' photographs behind it.
 *
 * A species can have several pictures — the same organism on a different world, at a different hour,
 * by a different commander — and one is not more true than the others. This is the viewer for that
 * set: image, credit, and a way through when there is more than one.
 *
 * Shared by the species card's lightbox and the encyclopedia's zoom so the two cannot drift. They
 * had already drifted once over where the credit sits, which is how this ended up in one place.
 *
 * Degrades to exactly what was there before when a species has one photo: no counter, no arrows,
 * no keyboard handlers competing with the modal's own Escape.
 */
import { useCallback, useEffect, useState } from "react";
import { PhotoCredit } from "./photoCredit";

export function PhotoGallery({
  urls,
  startIndex = 0,
  note,
  onClose,
}: {
  urls: string[];
  startIndex?: number;
  note?: string | null;
  onClose: () => void;
}) {
  const count = urls.length;
  const [i, setI] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));

  // A species whose photo set changed under us (species-tree reload) must not keep an index past
  // the end — that renders a blank frame rather than a picture.
  useEffect(() => {
    setI((cur) => (cur >= count ? 0 : cur));
  }, [count]);

  const step = useCallback(
    (d: number) => setI((cur) => (count === 0 ? 0 : (cur + d + count) % count)),
    [count],
  );

  useEffect(() => {
    if (count < 2) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        step(1);
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, step]);

  const url = urls[i] ?? urls[0];
  if (!url) return null;

  return (
    <div
      className="photo-lightbox-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <button type="button" className="photo-lightbox-close" aria-label="Close" onClick={onClose}>
        ×
      </button>

      {/*
        The backdrop centres its children in a row, so the image and everything that belongs *to* the
        image — its credit, its counter — share one column box. A sibling of the image lands beside
        it instead of beneath it.
      */}
      <div className="photo-lightbox-stack" onClick={(ev) => ev.stopPropagation()}>
        <div className="photo-gallery-frame">
          <img src={url} alt="" className="photo-lightbox-img" />
          {count > 1 ? (
            <>
              <button
                type="button"
                className="photo-gallery-nav photo-gallery-nav--prev"
                aria-label="Previous photo"
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="photo-gallery-nav photo-gallery-nav--next"
                aria-label="Next photo"
                onClick={() => step(1)}
              >
                ›
              </button>
            </>
          ) : null}
        </div>

        {count > 1 ? (
          <div className="photo-gallery-dots" role="tablist" aria-label="Photos of this species">
            {urls.map((u, n) => (
              <button
                key={u}
                type="button"
                role="tab"
                aria-selected={n === i}
                aria-label={`Photo ${n + 1} of ${count}`}
                className={`photo-gallery-dot${n === i ? " photo-gallery-dot--on" : ""}`}
                onClick={() => setI(n)}
              />
            ))}
            <span className="photo-gallery-count">
              {i + 1} / {count}
            </span>
          </div>
        ) : null}

        <PhotoCredit photoUrl={url} variant="lightbox" />
      </div>

      {note ? (
        <p className="photo-lightbox-cap" onClick={(ev) => ev.stopPropagation()}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
