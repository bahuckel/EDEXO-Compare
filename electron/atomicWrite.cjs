"use strict";

/**
 * Write a file whole or not at all (code review 2026-10-10, A3): a temporary file beside it, renamed over
 * it, so a crash mid-write leaves the previous window, launcher or HUD layout rather than a torn one that
 * reads back as "no layout". Same as src/server/atomicWrite.ts; throws like fs.writeFileSync.
 */
const fs = require("fs");

function writeFileAtomic(file, data, options = "utf8") {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, data, options);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to tidy */
    }
    throw e;
  }
}

module.exports = { writeFileAtomic };
