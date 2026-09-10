/**
 * The credit line that goes under every species photograph.
 *
 * The images come from the ED-DSN community and are not this project's. Attribution is by link to
 * the network rather than by commander name: the photographs were taken on an expedition years ago
 * and a significant number of those commanders can no longer be reached, so naming the few who can
 * be and not the rest would be worse than naming none. See `NOTICE.md`.
 *
 * One module so the wording cannot drift between the card, the lightbox and the encyclopedia — a
 * credit that says three slightly different things in three places reads as carelessness about the
 * thing it exists to be careful about.
 */
import { BUILTIN_PLACEHOLDER_FILE } from "@shared/photoPlaceholder";

export const PHOTO_CREDIT_URL = "https://ed-dsn.net/";
export const PHOTO_CREDIT_TEXT = `Photo from: ${PHOTO_CREDIT_URL} and its respective owner`;

/**
 * The placeholder is drawn by this project, so it must not carry someone else's credit.
 *
 * Checked on the URL rather than on a flag, because every render site already has the URL and none
 * of them reliably has the note — and a credit shown over a house-drawn placeholder would be a
 * false attribution, which is a worse failure than a missing one.
 */
export function isPlaceholderPhoto(url: string | null | undefined): boolean {
  return !url || url.includes(BUILTIN_PLACEHOLDER_FILE);
}

/**
 * Who took one particular photograph.
 *
 * ED-DSN is the standing credit and the default, because the 97 images the project shipped with are
 * theirs. A contributed photograph carries its own, and the server sends one only for the
 * exceptions — see `server/photoCredits.ts`. Crediting a commander's own work to somebody else is
 * the one mistake this area of the project has been careful about, so the contributor wins whenever
 * there is one.
 */
export interface PhotoContributor {
  name: string;
  url?: string;
  licence?: string;
}

/** Hover text for places too small for a visible line — the compact card, a thumbnail grid. */
export function photoCreditTitle(
  url: string | null | undefined,
  contributor?: PhotoContributor,
): string | undefined {
  if (isPlaceholderPhoto(url)) return undefined;
  return contributor ? `Photo by ${contributor.name}` : PHOTO_CREDIT_TEXT;
}

/**
 * The visible credit. Renders nothing for the placeholder.
 *
 * `variant` only picks the class; the wording is identical everywhere on purpose.
 */
export function PhotoCredit({
  photoUrl,
  variant = "card",
  contributor,
}: {
  photoUrl: string | null | undefined;
  variant?: "card" | "lightbox";
  /** Set when this photograph is not ED-DSN's. Absent means the standing credit applies. */
  contributor?: PhotoContributor;
}) {
  if (isPlaceholderPhoto(photoUrl)) return null;
  if (contributor) {
    return (
      <p className={`photo-credit photo-credit--${variant}`}>
        Photo by{" "}
        {contributor.url ? (
          <a href={contributor.url} target="_blank" rel="noreferrer noopener">
            {contributor.name}
          </a>
        ) : (
          contributor.name
        )}
      </p>
    );
  }
  return (
    <p className={`photo-credit photo-credit--${variant}`}>
      Photo from:{" "}
      <a href={PHOTO_CREDIT_URL} target="_blank" rel="noreferrer noopener">
        ed-dsn.net
      </a>{" "}
      and its respective owner
    </p>
  );
}
