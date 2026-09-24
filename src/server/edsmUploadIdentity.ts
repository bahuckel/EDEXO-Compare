/**
 * Who this client says it is, when it writes to EDSM.
 *
 * Its own file because `edsmUpload.ts` and the ledger both need it and neither should import the
 * other, and because EDSM asks clients to identify themselves honestly: the name here is what shows
 * against the commander's uploads on the site, and it is how the service tells a misbehaving client
 * apart from a well-behaved one. The version is `APP_VERSION`, which a test keeps equal to `package.json`.
 */
import { APP_VERSION } from "./appVersion.js";

export const JOURNAL_UPLOAD_SOFTWARE = "ED Exo Compare";
export const JOURNAL_UPLOAD_VERSION = APP_VERSION;
