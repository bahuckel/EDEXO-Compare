/**
 * The app's version, as it tells other people's services who is calling.
 *
 * EDSM, Canonn, Spansh, EDAstro and EDDN all see it — in a User-Agent, a client version or a
 * `softwareVersion` — and a volunteer service seeing traffic it did not expect should be able to
 * find out whose it is. A stale number is worse than none because it tells them a lie: every one of
 * these strings still said 1.1.0 at 1.1.4, each with a comment asking to keep it in step.
 *
 * So there is one, and `tests/appVersion.test.ts` fails when it differs from `package.json`. The
 * release commit bumps both.
 */
export const APP_VERSION = "1.2.0";

/** The User-Agent the HTTP lookups send. */
export const APP_USER_AGENT = `ED-Exo-Compare/${APP_VERSION} (+https://github.com/bahuckel/EDEXO-Compare)`;
