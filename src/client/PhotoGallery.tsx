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
import { PhotoCredit, type PhotoContributor } from "./photoCredit";

export function PhotoGallery({
  urls,
  startIndex = 0,
  note,
  creditByUrl,
  variantByUrl,
  onClose,
}: {
  urls: string[];
  startIndex?: number;
  note?: string | null;
  /**
   * Who took each photograph, by URL. Absent for the shipped images, which are ED-DSN's.
   *
   * Passed per photo rather than per species because a species can have both: the ED-DSN
   * photographs it shipped with, and the owner's own of a variant he walked to. The lightbox showed
   * the standing ED-DSN credit for every one of them, which credited his work to somebody else —
   * the one mistake this area of the project has been careful about.
   */
  creditByUrl?: Record<string, PhotoContributor>;
  /** What each photograph is of — "Bacterium Aurasus — Lime". Shown above the open image. */
  variantByUrl?: Record<string, string>;
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
        {/*
          What you are looking at, above the picture.

          A species with several photographs usually has them in several colours, and stepping
          through them silently means the commander is comparing the plant in front of them against
          a variant that is not theirs. The owner asked for the name "only when its open", which is
          exactly right: on the card there is one photograph and it is already the right one.
        */}
        {variantByUrl?.[url] ? <p className="photo-lightbox-what">{variantByUrl[url]}</p> : null}
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

        <PhotoCredit photoUrl={url} variant="lightbox" contributor={creditByUrl?.[url]} />
      </div>

      {note ? (
        <p className="photo-lightbox-cap" onClick={(ev) => ev.stopPropagation()}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
