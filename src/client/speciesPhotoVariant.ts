/**
 * Point a `/species-photos/...` URL at a generated WebP derivative (see scripts/gen-image-
 * derivatives.mjs). The server falls back to the original when the derivative is missing, so this
 * is always safe — including for artwork a commander dropped in by hand.
 *
 *   "thumb" — 320 px, encyclopedia rows
 *   "card"  — 1024 px, species card artwork
 *
 * Full-size originals stay in use for the lightbox / zoom views.
 */
export function speciesPhotoVariant(url: string, size: "thumb" | "card"): string {
  if (!url || !url.startsWith("/species-photos/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}size=${size}`;
}
