/**
 * The image drawn when a species has no photograph.
 *
 * Shared because three places need to recognise it and each had its own copy: the server writes the
 * URL, the encyclopedia falls back to it on a load error, and the credit line must *not* appear over
 * it — the placeholder is this project's own drawing, and crediting it to ED-DSN would be a false
 * attribution, which is worse than no attribution.
 */
export const BUILTIN_PLACEHOLDER_FILE = "__builtin_placeholder.svg";
export const BUILTIN_PLACEHOLDER_URL = `/photos/${BUILTIN_PLACEHOLDER_FILE}`;
