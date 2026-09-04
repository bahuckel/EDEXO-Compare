"use strict";

/**
 * Injected as win.signtoolOptions.sign so the delay runs after rcedit/metadata edits
 * and immediately before signtool (electron-builder's afterPack runs too early for that).
 */
module.exports = async function electronPreSignDelay(configuration, packager) {
  const raw = process.env.EDEXO_PRE_SIGN_DELAY_MS;
  if (
    process.platform === "win32" &&
    raw !== "0" &&
    raw !== "" &&
    raw != null
  ) {
    const ms = parseInt(raw, 10);
    if (Number.isFinite(ms) && ms > 0) {
      console.info(`[electron-builder] Pre-sign delay ${ms}ms (EDEXO_PRE_SIGN_DELAY_MS; set 0 to skip)`);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  const manager = await packager.signingManager.value;
  return manager.doSign(configuration, packager);
};
