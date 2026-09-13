/**
 * Who this client says it is, when it writes to EDSM.
 *
 * Its own file because `edsmUpload.ts` and the ledger both need it and neither should import the
 * other, and because EDSM asks clients to identify themselves honestly: the name here is what shows
 * against the commander's uploads on the site, and it is how the service tells a misbehaving client
 * apart from a well-behaved one. Keep the version in step with `package.json`.
 */
export const JOURNAL_UPLOAD_SOFTWARE = "ED Exo Compare";
export const JOURNAL_UPLOAD_VERSION = "1.1.0";
